import * as THREE from 'three';
import { BallMode } from './Basketball.js';
import { Shot } from './Shot.js';
import { DRIBBLE, SHOT, BALL, HOOP, GRADE } from '../core/Constants.js';
import { clamp, damp, planarDistance, angleDelta, smoothstep } from '../core/MathUtils.js';

const State = {
  LOOSE: 'loose',
  CARRY: 'carry',
  SHOOT: 'shoot',
  LAYUP: 'layup',
  DUNK: 'dunk',
};

/**
 * The gameplay brain that connects the player, hands, ball and hoops. It owns
 * possession state (loose / carrying / shooting / layup / dunk), the
 * physically-shaped dribble, the advanced dribble moves, the timing-based
 * shot, and make/miss detection. Everything the player "feels" about the ball
 * runs through here.
 */
export class BallController {
  constructor({ scene, physics, player, cameraRig, hands, ball, park, audio, gameState, hud }) {
    this.scene = scene;
    this.physics = physics;
    this.player = player;
    this.cam = cameraRig;
    this.hands = hands;
    this.ball = ball;
    this.park = park;
    this.audio = audio;
    this.state = gameState;
    this.hud = hud;

    this.mode = State.LOOSE;
    this.activeSign = 1; // +1 right hand, -1 left hand
    this.phase = 0; // dribble bounce phase 0..1
    this.prevPhase = 0;
    this.bounceHz = DRIBBLE.baseBounceHz;
    this.ballTarget = new THREE.Vector3();
    this.spin = 0;
    this.spinQuat = new THREE.Quaternion();

    this.move = null; // active dribble move
    this._lastTapTime = { KeyA: 0, KeyD: 0 };

    this.shoot = null; // shooting timeline
    this.shotFlight = null; // { hoop, grade, kind, scored, timer }
    this.prevBallY = 0;

    // Dribble handling state.
    this.bodyYaw = 0; // damped facing the dribble is anchored to
    this.handAnchor = new THREE.Vector3(); // smoothed horizontal ball anchor
    this._airborneTime = 0; // debounces the airborne palm so grounded flicker
    this._holdTuck = 0; // 0..1 airborne-hold blend                is ignored
    this._bounceFrac = 1; // 0 at floor contact, 1 at the top of the bounce
    this._handReady = new THREE.Vector3(); // world-space "ready" hand point
  }

  /** Body-facing forward/right (from the damped dribble yaw, not the camera). */
  _bodyBasis() {
    const y = this.bodyYaw;
    return {
      fwd: new THREE.Vector3(-Math.sin(y), 0, -Math.cos(y)),
      right: new THREE.Vector3(Math.cos(y), 0, -Math.sin(y)),
    };
  }

  // ---------------------------------------------------------------------------
  update(dt, input) {
    switch (this.mode) {
      case State.LOOSE: this._updateLoose(dt, input); break;
      case State.CARRY: this._updateCarry(dt, input); break;
      case State.SHOOT: this._updateShoot(dt, input); break;
      case State.LAYUP: this._updateLayup(dt, input); break;
      case State.DUNK: this._updateDunk(dt, input); break;
    }
    this._updateHands(dt);
  }

  // ---------------------------------------------------------------------------
  // LOOSE — ball is a free physics object; watch for pickup + shot results.
  // ---------------------------------------------------------------------------
  _updateLoose(dt, input) {
    const bpos = this.ball.position;

    // Shot-in-flight make/miss tracking.
    if (this.shotFlight) this._trackShot(dt, bpos);

    // Pickup.
    const eye = this.player.eyePosition;
    const dist = bpos.distanceTo(eye);
    const speed = this.ball.velocity.length();
    const canPick = speed < 2.2 && dist < 1.5;
    const autoPick = speed < 1.0 && bpos.distanceTo(this.player.position) < 0.95 && bpos.y < 1.3;
    if ((input.wasPressed('KeyE') && canPick) || autoPick) {
      this._startCarry();
    }
  }

  _startCarry() {
    this.ball.setControlled();
    this.mode = State.CARRY;
    this.activeSign = 1;
    this.phase = 0.5; // start at floor contact so the first move is a push-down
    this.move = null;
    this.shotFlight = null;
    this.hud?.setShotMeter(null);
    // Ease the ball in from wherever it was, facing where the player looks.
    this.bodyYaw = this.cam.yaw;
    this.handAnchor.copy(this.ball.position);
    this._airborneTime = this.player.grounded ? 0 : 0.3;
    this._holdTuck = this.player.grounded ? 0 : 1;
    this.audio?.bounce(0.6);
  }

  // ---------------------------------------------------------------------------
  // CARRY — dribble + trigger shots / layups / dunks.
  // ---------------------------------------------------------------------------
  _updateCarry(dt, input) {
    const grounded = this.player.grounded;
    const speed = this.player.planarSpeed;

    // Drop the ball.
    if (input.wasPressed('KeyE')) {
      this._drop();
      return;
    }

    // Shot / layup / dunk triggers on left mouse.
    if (input.mousePressed?.left) {
      const hoop = this.park.nearestHoop(this.player.position);
      const rim = hoop.getRimCenter();
      const d = planarDistance(this.player.position, rim);
      const toward = this._movingTowardHoop(hoop);
      if (d < SHOT.dunkRange && speed > SHOT.dunkMinSpeed && toward) {
        this._startDunk(hoop);
        return;
      }
      if (d < SHOT.layupRange) {
        this._startLayup(hoop);
        return;
      }
      this._startShoot();
      return;
    }

    // Dribble-move triggers.
    this._detectMoveTriggers(input, speed);

    // Smoothly turn the body toward where the camera looks, so glancing around
    // never whips the ball about you — it stays dribbling in front of your body.
    this.bodyYaw += angleDelta(this.bodyYaw, this.cam.yaw) * (1 - Math.exp(-DRIBBLE.yawLambda * dt));

    // Airborne while carrying → palm/hold the ball (you can't dribble in the
    // air). Debounced so a one-frame grounded flicker never yanks it up.
    if (grounded) this._airborneTime = 0;
    else this._airborneTime += dt;
    const airborne = this._airborneTime > 0.12;
    this._holdTuck = damp(this._holdTuck, airborne ? 1 : 0, 14, dt);

    // Bounce tempo scales with speed.
    const targetHz = this.player.sprinting ? DRIBBLE.sprintBounceHz : DRIBBLE.baseBounceHz + speed * 0.16;
    this.bounceHz = damp(this.bounceHz, targetHz, 6, dt);

    // Advance dribble phase (freeze near top during hesitation / airborne hold).
    let advance = this.bounceHz * dt;
    if (this.move?.type === 'hesitation') {
      this.move.t += dt;
      // hold near top
      if (this.move.t < this.move.dur) advance *= 0.12;
      else this.move = null;
    }
    advance *= 1 - this._holdTuck * 0.95;
    this.prevPhase = this.phase;
    this.phase = (this.phase + advance) % 1;

    // Bounce sound when passing through the floor contact (phase ~0.5).
    if (this._holdTuck < 0.4 && this.prevPhase < 0.5 && this.phase >= 0.5) {
      this.audio?.bounce(clamp(0.5 + speed * 0.08, 0.5, 1.3));
    }

    // Compute the ball world position for this frame.
    this._computeDribblePos(dt, speed);
    this.ball.driveTo(this.ballTarget);
    this._spinBall(dt, this.bounceHz * 6 + speed);
  }

  _computeDribblePos(dt, speed) {
    const { fwd, right } = this._bodyBasis();
    const feet = this.player.position;

    // Forward + lateral handling offsets. Drive the ball further out in front
    // as you move so it reads as pushing the ball ahead, not glued to you.
    let forwardOff = DRIBBLE.forward + clamp(speed * DRIBBLE.speedForward, 0, DRIBBLE.speedForwardMax);
    let sideOff = DRIBBLE.side * this.activeSign;
    let extraFwd = 0;
    let heightBias = 0;

    // Apply an in-progress move by reshaping the lateral/forward path. The ball
    // dips low and crosses the body, and the handling hand switches mid-move.
    if (this.move && this.move.type !== 'hesitation') {
      const m = this.move;
      m.t += dt;
      const p = clamp(m.t / m.dur, 0, 1);
      const ease = smoothstep(p);
      sideOff = DRIBBLE.side * (m.fromSign + (m.toSign - m.fromSign) * ease);
      const cross = Math.sin(p * Math.PI); // peaks mid-move
      if (m.type === 'crossover') heightBias = -cross * 0.22;
      if (m.type === 'between') { extraFwd = cross * 0.26; heightBias = -cross * 0.4; }
      if (m.type === 'behind') { extraFwd = -cross * 0.5; heightBias = -cross * 0.12; }
      if (p >= 0.5 && this.activeSign === m.fromSign) {
        this.activeSign = m.toSign;
        this.audio?.squeak();
      }
      if (p >= 1) this.move = null;
    }

    // Lead the ball in the movement direction a touch.
    const lead = this.player.moveDir.clone().multiplyScalar(clamp(speed * 0.07, 0, 0.5));

    // Target horizontal anchor, then damp toward it for a weighty, non-snappy
    // handle. Vertical bounce stays crisp (below), so only XZ is smoothed.
    const targetX = feet.x + fwd.x * (forwardOff + extraFwd) + right.x * sideOff + lead.x;
    const targetZ = feet.z + fwd.z * (forwardOff + extraFwd) + right.z * sideOff + lead.z;
    this.handAnchor.x = damp(this.handAnchor.x, targetX, DRIBBLE.followLambda, dt);
    this.handAnchor.z = damp(this.handAnchor.z, targetZ, DRIBBLE.followLambda, dt);

    // Gravity-shaped bounce: quadratic, floor at phase 0.5, top at phase 0 & 1.
    const floor = DRIBBLE.floorClearance;
    const top = DRIBBLE.handHeight;
    const q = 2 * this.phase - 1;
    this._bounceFrac = q * q; // 1 at the top, 0 at the floor — drives the hand
    let h = floor + (top - floor) * this._bounceFrac + heightBias;

    // Airborne: palm the ball at chest height (rises with the jump via feet.y),
    // never up in the face.
    h = h * (1 - this._holdTuck) + DRIBBLE.holdHeight * this._holdTuck;

    this.ballTarget.set(this.handAnchor.x, feet.y + h, this.handAnchor.z);

    // Remember a hip-level "ready" point for the handling hand to return to.
    this._handReady.set(this.handAnchor.x, feet.y + top * 0.96, this.handAnchor.z);
  }

  _detectMoveTriggers(input, speed) {
    if (this.move) return;
    // Right mouse — context move.
    if (input.mousePressed?.right) {
      const axis = input.moveAxis();
      let type = 'crossover';
      if (this.player.sprinting) type = 'hesitation';
      else if (axis.z > 0.3) type = 'between';
      else if (axis.z < -0.3) type = 'behind';
      this._beginMove(type);
      return;
    }
    // Double-tap A/D → directional crossover.
    for (const key of ['KeyA', 'KeyD']) {
      if (input.wasPressed(key)) {
        const now = performance.now();
        if (now - this._lastTapTime[key] < 280) {
          const toSign = key === 'KeyD' ? 1 : -1;
          if (toSign !== this.activeSign) this._beginMove('crossover', toSign);
        }
        this._lastTapTime[key] = now;
      }
    }
  }

  _beginMove(type, toSign = null) {
    const to = toSign ?? -this.activeSign;
    if (type === 'hesitation') {
      this.move = { type, t: 0, dur: 0.34 };
      return;
    }
    this.move = {
      type,
      t: 0,
      dur: type === 'behind' ? 0.42 : type === 'between' ? 0.4 : 0.28,
      fromSign: this.activeSign,
      toSign: to,
    };
    this.audio?.squeak();
  }

  _drop() {
    const fwd = this.cam.forward();
    this.ball.setFree(new THREE.Vector3(fwd.x * 1.5, -1, fwd.z * 1.5));
    this.mode = State.LOOSE;
  }

  // ---------------------------------------------------------------------------
  // SHOOT — timing-based jump shot.
  // ---------------------------------------------------------------------------
  _startShoot() {
    const hoop = this.park.nearestHoop(this.player.position);
    this.shoot = {
      t: 0,
      ideal: SHOT.gatherTime + SHOT.setToReleaseTime,
      max: SHOT.gatherTime + SHOT.setToReleaseTime + SHOT.red + 0.12,
      hoop,
      released: false,
    };
    this.mode = State.SHOOT;
  }

  _updateShoot(dt, input) {
    const s = this.shoot;
    s.t += dt;
    const feet = this.player.position;
    const fwd = this.cam.forward();
    const right = this.cam.right();

    // Ball rises from hip -> set point in front of / above the forehead.
    const p = clamp(s.t / s.ideal, 0, 1.15);
    const ease = p * p * (3 - 2 * clamp(p, 0, 1));
    const setPos = new THREE.Vector3(
      feet.x + fwd.x * 0.28 + right.x * 0.08,
      feet.y + this.cam.baseEye + 0.18,
      feet.z + fwd.z * 0.28 + right.z * 0.08
    );
    const hipPos = new THREE.Vector3(
      feet.x + fwd.x * DRIBBLE.forward,
      feet.y + DRIBBLE.handHeight,
      feet.z + fwd.z * DRIBBLE.forward
    );
    this.ballTarget.copy(hipPos).lerp(setPos, ease);
    this.ball.driveTo(this.ballTarget);
    this._spinBall(dt, 1.5);

    // Shot meter for the HUD.
    this.hud?.setShotMeter({
      fill: clamp(s.t / s.ideal, 0, 1),
      idealAt: 1.0,
      window: SHOT.green / s.ideal,
    });

    const release = input.mouseReleased?.left || s.t >= s.max;
    if (release && !s.released) {
      s.released = true;
      this._releaseShot(s);
    }
  }

  _releaseShot(s) {
    const signedErr = s.t - s.ideal; // <0 early, >0 late
    const grade = Shot.grade(Math.abs(signedErr));
    // Launch from where the ball physically is (== the driven set-point).
    const from = this.ball.position.clone();
    const rim = s.hoop.getRimCenter();
    const playerVel = new THREE.Vector3(this.player.velocity.x, 0, this.player.velocity.z);
    const { vel, spin } = Shot.jumpShot(from, rim, grade, signedErr, playerVel);

    this.ball.setFree(vel, spin);
    this.audio?.squeak();
    this.mode = State.LOOSE;
    this.hud?.setShotMeter(null);
    this.hud?.flashGrade(grade);
    this._beginFlight(s.hoop, grade, 'jump');
    this.shoot = null;
  }

  // ---------------------------------------------------------------------------
  // LAYUP
  // ---------------------------------------------------------------------------
  _startLayup(hoop) {
    this.mode = State.LAYUP;
    this.layup = { t: 0, dur: 0.42, hoop, released: false };
    // Gentle assist toward the rim + a hop.
    const rim = hoop.getRimCenter();
    const dir = new THREE.Vector3(rim.x - this.player.position.x, 0, rim.z - this.player.position.z).normalize();
    this.player.velocity.addScaledVector(dir, 1.6);
    if (this.player.grounded) this.player.vy = 4.0;
    this.audio?.squeak();
  }

  _updateLayup(dt, input) {
    const l = this.layup;
    l.t += dt;
    const p = clamp(l.t / l.dur, 0, 1);
    const rim = l.hoop.getRimCenter();
    const eye = this.player.eyePosition;
    // Ball rises from hand up toward the rim as the player gathers.
    const raise = new THREE.Vector3(
      eye.x, eye.y + 0.15 + p * 0.35, eye.z
    );
    const dir = l.hoop.getShootDir().clone().multiplyScalar(-1); // toward rim
    raise.addScaledVector(dir, p * 0.25);
    this.ballTarget.lerp(raise, 0.4);
    if (l.t < dt * 2) this.ballTarget.copy(raise);
    this.ball.driveTo(this.ballTarget);
    this._spinBall(dt, 3);

    if (p >= 1 && !l.released) {
      l.released = true;
      const dist = planarDistance(this.player.position, rim);
      const useBackboard = Math.random() < 0.7;
      // Layups are high-percentage: tight error unless badly placed.
      const grade = Math.random() < 0.82 ? GRADE.GREEN : GRADE.YELLOW;
      const shootDir = l.hoop.getShootDir();
      const { vel, spin } = Shot.layup(this.ballTarget.clone(), rim, shootDir, grade, useBackboard);
      this.ball.setFree(vel, spin);
      this.mode = State.LOOSE;
      this._beginFlight(l.hoop, grade, 'layup');
      this.layup = null;
    }
  }

  // ---------------------------------------------------------------------------
  // DUNK — only from believable range (checked before entering).
  // ---------------------------------------------------------------------------
  _startDunk(hoop) {
    this.mode = State.DUNK;
    this.dunk = { t: 0, dur: 0.45, hoop, slammed: false };
    const rim = hoop.getRimCenter();
    const dir = new THREE.Vector3(rim.x - this.player.position.x, 0, rim.z - this.player.position.z).normalize();
    this.player.velocity.addScaledVector(dir, 2.6);
    this.player.vy = 5.6; // big hop
    this.audio?.squeak();
  }

  _updateDunk(dt, input) {
    const d = this.dunk;
    d.t += dt;
    const p = clamp(d.t / d.dur, 0, 1);
    const rim = d.hoop.getRimCenter();
    // Carry the ball up and over the rim, then drive it down through.
    const up = 1 - Math.pow(1 - p, 2);
    const above = new THREE.Vector3(rim.x, rim.y + 0.55 - p * 0.55, rim.z);
    const eye = this.player.eyePosition;
    this.ballTarget.set(
      THREE.MathUtils.lerp(eye.x, above.x, up),
      THREE.MathUtils.lerp(eye.y + 0.3, above.y, up),
      THREE.MathUtils.lerp(eye.z, above.z, up)
    );
    this.ball.driveTo(this.ballTarget);
    this._spinBall(dt, 2);

    if (p >= 1 && !d.slammed) {
      d.slammed = true;
      // Release just below the rim with downward velocity. Because the ball
      // starts below the rim it never crosses the rim plane from above, so the
      // dunk make is recorded here directly rather than by flight tracking.
      this.ball.setPositionHard(new THREE.Vector3(rim.x, rim.y - 0.05, rim.z));
      this.ball.setFree(new THREE.Vector3(0, -4.6, 0), new THREE.Vector3(7, 0, 0));
      this.audio?.rim();
      this.audio?.swish();
      this.mode = State.LOOSE;
      this.state.recordShot({ grade: GRADE.GREEN, made: true, kind: 'dunk' });
      this.hud?.flashMake('DUNK');
      this.shotFlight = null;
      this.dunk = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Shot flight tracking → make/miss.
  // ---------------------------------------------------------------------------
  _beginFlight(hoop, grade, kind) {
    this.shotFlight = { hoop, grade, kind, scored: false, timer: 0, settle: 0 };
    this.prevBallY = this.ball.position.y;
  }

  _trackShot(dt, bpos) {
    const f = this.shotFlight;
    f.timer += dt;
    const rim = f.hoop.getRimCenter();
    const rimY = rim.y;
    const horiz = Math.hypot(bpos.x - rim.x, bpos.z - rim.z);
    const vy = this.ball.velocity.y;

    // Two-stage make detection so a rim-out is not miscounted as a make:
    //  1) the ball descends through the rim plane inside the hoop (pending),
    //  2) it is then confirmed once it drops clearly below the rim, and
    //     cancelled if it pops back up above the rim (rattled out).
    if (!f.scored) {
      if (!f.pending && this.prevBallY > rimY && bpos.y <= rimY && horiz < HOOP.rimRadius * 0.9 && vy < 0) {
        f.pending = true;
        f.pendingClean = horiz < HOOP.rimRadius * 0.5;
      }
      if (f.pending) {
        if (bpos.y > rimY + 0.06) {
          f.pending = false; // came back up — rimmed out
        } else if (bpos.y < rimY - 0.16 && horiz < HOOP.rimRadius + BALL.radius) {
          f.scored = true;
          this.audio?.swish();
          this.state.recordShot({ grade: f.grade, made: true, kind: f.kind });
          this.hud?.flashMake(f.pendingClean ? 'SWISH' : f.kind === 'dunk' ? 'DUNK' : 'BUCKET');
        }
      }
    }
    this.prevBallY = bpos.y;

    // Settle / miss detection.
    const speed = this.ball.velocity.length();
    if (speed < 0.8 && bpos.y < 0.6) f.settle += dt;
    else f.settle = 0;

    // Once scored, close out quickly; otherwise wait for the ball to settle.
    if ((f.scored && (f.settle > 0.2 || f.timer > 2.5)) || f.settle > 0.45 || f.timer > 8) {
      if (!f.scored) {
        this.state.recordShot({ grade: f.grade, made: false, kind: f.kind });
      }
      this.shotFlight = null;
    }
  }

  // ---------------------------------------------------------------------------
  _movingTowardHoop(hoop) {
    const rim = hoop.getRimCenter();
    const to = new THREE.Vector3(rim.x - this.player.position.x, 0, rim.z - this.player.position.z).normalize();
    return this.player.moveDir.dot(to) > 0.4;
  }

  _spinBall(dt, rate) {
    this.spin += rate * dt;
    const axis = this.cam.right();
    this.spinQuat.setFromAxisAngle(axis, this.spin);
  }

  // ---------------------------------------------------------------------------
  // Hands follow the ball / shot depending on state.
  // ---------------------------------------------------------------------------
  _updateHands(dt) {
    const carrying = this.mode !== State.LOOSE;
    if (!carrying) {
      this.hands.toRest('left');
      this.hands.toRest('right');
      return;
    }
    const cam = this.cam.camera;
    cam.updateMatrixWorld(true);
    const ballLocal = cam.worldToLocal(this.ballTarget.clone());

    const activeSide = this.activeSign > 0 ? 'right' : 'left';
    const offSide = this.activeSign > 0 ? 'left' : 'right';

    if (this.mode === State.CARRY) {
      // The handling hand pushes down onto the ball near the top of the bounce
      // and recovers to a hip-level "ready" pose as the ball drops — it does not
      // chase the ball all the way to the floor.
      const onTop = ballLocal.clone();
      onTop.y += BALL.radius * 0.72;
      const ready = cam.worldToLocal(this._handReady.clone());
      // Bias toward the ball only in the upper half of the bounce.
      const follow = smoothstep(clamp(this._bounceFrac * 1.35, 0, 1)) * (1 - this._holdTuck);
      const target = ready.clone().lerp(onTop, follow);
      const push = -1.1 - follow * 0.5; // palm tips down as it presses the ball
      this.hands.setTarget(activeSide, target, new THREE.Euler(push, 0, this.activeSign * 0.25));

      // Off hand guards loosely out in front rather than sitting idle.
      const g = this.hands.rest[offSide].pos.clone();
      g.z -= 0.06;
      this.hands.setTarget(offSide, g, this.hands.rest[offSide].rot);
    } else {
      // Shooting / layup / dunk: both hands cup the ball.
      const cup = ballLocal.clone();
      cup.y -= BALL.radius * 0.2;
      const l = cup.clone(); l.x += 0.06;
      const r = cup.clone(); r.x -= 0.06;
      this.hands.setTarget('left', l, new THREE.Euler(-1.4, 0.3, 0.2));
      this.hands.setTarget('right', r, new THREE.Euler(-1.4, -0.3, -0.2));
    }
  }

  // Called after physics step to place the ball mesh.
  postStep() {
    if (this.ball.mode === BallMode.FREE) {
      this.ball.syncMesh();
    } else {
      this.ball.syncMeshControlled(this.ballTarget, this.spinQuat);
    }
  }
}
