import * as THREE from 'three';
import { BallMode } from './Basketball.js';
import { Flight, Contact, dirOf } from './BounceMath.js';
import { MOVES, makeContext } from './Moves.js';
import { HAND_POSES } from '../player/HandModel.js';
import { DRIBBLE as D, BALL, SHOT, PLAYER } from '../core/Constants.js';
import { clamp, damp, angleDelta, smoothstep } from '../core/MathUtils.js';
import { ZONE, zoneFor, zoneForLayup, meterSpec, layupTiming, aimFor, solveLaunch, ShotTracker, RESULT_LABEL, yawToward } from './Shot.js';

/**
 * The dribble engine. Owns possession (loose / gather / hold / dribbling),
 * runs the catch → carry → push → flight cycle from BounceMath, chooses moves
 * from a small input buffer, and choreographs both hands and the camera's
 * body sway around the ball every frame.
 *
 * Everything is planned in the *handle frame*: a body-relative space that
 * trails the feet and the look direction with a little lag (so the ball has
 * weight and a quick glance never whips it around). The frame's origin is on
 * the court surface at the feet; x = right, y = up, z = forward.
 */
const State = {
  LOOSE: 'loose',
  GATHER: 'gather',
  HOLD: 'hold',
  CONTACT: 'contact',
  FLIGHT: 'flight',
  // The jumper: gather → set → rise, ball in both hands, meter running.
  SHOT: 'shot',
  // Button-up: the wrist snap that carries the ball to its launch velocity.
  RELEASE: 'release',
};

const PALM_GAP = 0.012; // palm surface sits this far off the ball
const PALM_CENTER = new THREE.Vector3(0, -0.021, -0.052); // palm surface centre in hand space
const HOLD_POINT = new THREE.Vector3(0, 1.14, 0.40);
const FOLLOW_THROUGH = 0.09; // seconds the hand keeps pushing after release
const APPROACH = 0.13; // seconds before the catch the hand descends to meet the ball

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _h1 = new THREE.Vector3();
const _h2 = new THREE.Vector3();
const _h3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

export class DribbleController {
  constructor({ player, cameraRig, hands, ball, audio, hud, hoops = [] }) {
    this.player = player;
    this.cam = cameraRig;
    this.hands = hands;
    this.ball = ball;
    this.audio = audio;
    this.hud = hud;
    this.hoops = hoops;

    // Shooting.
    this.shot = null; // the live jumper (see _startShot)
    this.tracker = null; // watches the ball after release until the shot is decided
    this._ft = null; // follow-through choreography after release
    this._shooting = false; // frame squares up to the hoop and rides the hop
    this._aimYaw = 0;
    this._shotPending = 0;
    this.ballVelWorld = new THREE.Vector3(); // measured, for the release continuity stat
    this._prevBallWorld = null;
    this.lastShot = null; // { zone, err, result, ... } for the HUD and tests
    this.contested = false; // hook: a defender at the rim tightens the layup window (nothing sets it yet)
    this.hints = { loose: '', hold: '' }; // set by the game from the bindings

    this.state = State.LOOSE;
    this.sign = 1; // hand with the ball: +1 right, -1 left
    this.t = 0; // time into the current segment
    this.plan = null;
    this.contact = null;
    this.flight = null;
    this.queue = [];
    this.low = false;
    this.cycles = 0;
    this.combo = [];
    this._comboTimer = 0;

    this.frame = { pos: new THREE.Vector3(), yaw: 0 };
    this.frameVel = new THREE.Vector3(); // measured motion of the frame origin (world, m/s)
    this._prevFramePos = null;
    this._fwd = new THREE.Vector3(0, 0, -1);
    this._right = new THREE.Vector3(1, 0, 0);

    this.ballLocal = new THREE.Vector3();
    this.ballVelLocal = new THREE.Vector3();
    this.ballWorld = new THREE.Vector3();
    this.ballQuat = new THREE.Quaternion();
    this.angVel = new THREE.Vector3();

    this.sway = { lateral: 0, vertical: 0, roll: 0 };
    this._swayTarget = { lateral: 0, vertical: 0, roll: 0 };
    this._idleT = 0;

    // Per-hand scratch used by the choreography.
    this._release = { pos: new THREE.Vector3(), dir: new THREE.Vector3(), vel: new THREE.Vector3() };
    this.lastEvent = null; // for tests / HUD: 'bounce' | 'catch' | 'release'
    this.stats = { bounces: 0, catches: 0, minBallY: Infinity, maxHandGap: 0, shots: [], made: 0, maxReleaseJump: 0 };
  }

  // ---------------------------------------------------------------------------
  // Frame helpers
  // ---------------------------------------------------------------------------
  _updateFrame(dt, snap = false) {
    const feet = this.player.position;
    // The frame's origin sits on the ground under the feet. Only grounded
    // feet move it vertically, so a hop doesn't lift the bounce path.
    // While shooting the body squares up to the basket (the head is free to
    // look wherever) and the hands ride the hop: the frame follows the feet
    // vertically even in the air.
    const yawTarget = this._shooting ? this._aimYaw : this.cam.yaw;
    const yawLambda = this._shooting ? 18 : D.yawLambda;
    if (snap) {
      this.frame.pos.set(feet.x, this.player.grounded ? feet.y : this.frame.pos.y, feet.z);
      this.frame.yaw = yawTarget;
    } else {
      this.frame.pos.x = damp(this.frame.pos.x, feet.x, D.followLambda, dt);
      this.frame.pos.z = damp(this.frame.pos.z, feet.z, D.followLambda, dt);
      // Holding the ball (or shooting) the ball rides with the body through a
      // hop; only a *dribble's* path stays on the floor.
      if (this._shooting || this.state === State.HOLD || this.state === State.GATHER) this.frame.pos.y = feet.y;
      else if (this.player.grounded) this.frame.pos.y = damp(this.frame.pos.y, feet.y, 20, dt);
      this.frame.yaw += angleDelta(this.frame.yaw, yawTarget) * (1 - Math.exp(-yawLambda * dt));
    }
    const y = this.frame.yaw;
    this._fwd.set(-Math.sin(y), 0, -Math.cos(y));
    this._right.set(Math.cos(y), 0, -Math.sin(y));
    // The frame trails the feet, so its velocity is not the feet's while they
    // accelerate; the release maths needs the real thing.
    if (this._prevFramePos && dt > 0 && !snap) this.frameVel.subVectors(this.frame.pos, this._prevFramePos).divideScalar(dt);
    else this.frameVel.set(this.player.velocity.x, 0, this.player.velocity.z);
    this._prevFramePos = (this._prevFramePos || new THREE.Vector3()).copy(this.frame.pos);
  }

  toWorld(local, out = new THREE.Vector3()) {
    out.copy(this.frame.pos);
    out.addScaledVector(this._right, local.x);
    out.y += local.y;
    out.addScaledVector(this._fwd, local.z);
    return out;
  }

  dirToWorld(local, out = new THREE.Vector3()) {
    out.set(0, local.y, 0);
    out.addScaledVector(this._right, local.x);
    out.addScaledVector(this._fwd, local.z);
    return out;
  }

  dirToLocal(world, out = new THREE.Vector3()) {
    return out.set(world.dot(this._right), world.y, world.dot(this._fwd));
  }

  toLocal(world, out = new THREE.Vector3()) {
    _v.subVectors(world, this.frame.pos);
    out.set(_v.dot(this._right), _v.y, _v.dot(this._fwd));
    return out;
  }

  get hasBall() {
    return this.state !== State.LOOSE;
  }

  /** How far the body is above the handle frame's floor: the hands ride this, a dribble does not. */
  get bodyLift() {
    return this.player.position.y - this.frame.pos.y;
  }

  get dribbling() {
    return this.state === State.CONTACT || this.state === State.FLIGHT;
  }

  get shooting() {
    return this.state === State.SHOT || this.state === State.RELEASE;
  }

  get floorLocal() {
    return BALL.radius; // frame origin sits on the court surface
  }

  // ---------------------------------------------------------------------------
  update(dt, input) {
    this._updateFrame(dt);
    this._handleInput(input);

    this._shotPending = Math.max(0, this._shotPending - dt);
    const wasGrounded = this._wasGrounded;
    this._wasGrounded = this.player.grounded;

    switch (this.state) {
      case State.LOOSE: this._updateLoose(dt); break;
      case State.GATHER: this._updateGather(dt); break;
      case State.HOLD: this._updateHold(dt); break;
      case State.CONTACT: this._updateContact(dt); break;
      case State.FLIGHT: this._updateFlight(dt); break;
      case State.SHOT: this._updateShot(dt); break;
      case State.RELEASE: this._updateRelease(dt); break;
    }

    if (this.state !== State.LOOSE) {
      this.toWorld(this.ballLocal, this.ballWorld);
      if (this._prevBallWorld && dt > 0) this.ballVelWorld.subVectors(this.ballWorld, this._prevBallWorld).divideScalar(dt);
      else this.ballVelWorld.set(0, 0, 0);
      this._prevBallWorld = (this._prevBallWorld || new THREE.Vector3()).copy(this.ballWorld);
      this._spin(dt);
      this.ball.driveTo(this.ballWorld, this.ballQuat);
      this.stats.minBallY = Math.min(this.stats.minBallY, this.ballWorld.y);
    } else {
      this._prevBallWorld = null;
    }

    // After the release: watch the flight, hold the follow-through, land.
    if (this.tracker) {
      const r = this.tracker.update(dt, this.ball.position, this.ball.velocity);
      if (r) this._onShotResult(r);
    }
    if (this._ft) {
      this._ft.t += dt;
      if (this.player.grounded && !wasGrounded && !this._ft.landed) {
        this._ft.landed = true;
        this.cam.triggerLandDip(0.07);
      }
      if (this._ft.t > SHOT.followThrough + 0.35 && this.player.grounded) this._ft = null;
    }
    this._shooting = !!(this.shot || this._ft);
    this.player.lockMove = !!this.shot || !!(this._ft && !this._ft.landed);

    this._updateSway(dt);
    this._updateHands(dt);
    this._comboTimer = Math.max(0, this._comboTimer - dt);
    if (this._comboTimer === 0 && this.combo.length) {
      this.combo = [];
      this.hud?.setCombo(this.combo);
    }
  }

  // ---------------------------------------------------------------------------
  // Input → intent
  // ---------------------------------------------------------------------------
  _handleInput(input) {
    if (!input) return;
    this.low = input.down('low');

    if (this.state === State.LOOSE) {
      if (input.pressedAction('pickup')) this._tryPickup(2.3, 8.0);
      return;
    }
    if (this.state === State.SHOT) {
      if (this.shot.kind === 'layup') {
        // A layup releases on a fresh press of the shoot key while airborne
        // (the takeoff was the jump key, or an earlier press of this one). A
        // press before the top of the jump is held until the ball is up at
        // the rim, so J-then-K in quick succession still releases at the rim.
        if (input.pressedAction('shoot')) {
          if (this.shot.t >= this.shot.spec.releaseTime) this._releaseShot();
          else this.shot.armed = true;
        }
      } else if (input.releasedAction('shoot') || !input.down('shoot')) {
        // A jumper releases on button-up. A tap (already up when the shot
        // began) releases at once — a terrible early shot, as it should be.
        this._releaseShot();
      }
      return;
    }
    if (this.state === State.RELEASE) return;

    if (input.pressedAction('shoot')) {
      if (this.state === State.GATHER) this._shotPending = 0.6;
      else this._requestShot();
      return;
    }
    if (this.state === State.GATHER) return;

    if (input.pressedAction('drop')) {
      this._drop();
      return;
    }

    if (this.state === State.HOLD) {
      if (input.pressedAction('crossover')) this._startDribble(1);
      else if (input.pressedAction('between')) this._startDribble(-1);
      else if (input.pressedAction('pickup')) this._startDribble(this.sign);
      return;
    }

    // Dribbling.
    if (input.pressedAction('pickup')) {
      this._pickUpFromDribble();
      return;
    }
    let move = null;
    if (input.pressedAction('crossover')) move = input.isDown('KeyS') ? 'stepback' : 'crossover';
    else if (input.pressedAction('between')) move = 'between';
    else if (input.pressedAction('behind')) move = 'behind';
    else if (input.pressedAction('inout')) move = 'inout';
    else if (input.pressedAction('hesitation')) move = 'hesitation';
    if (move) this.queueMove(move);
  }

  /** Buffer a move; it starts at the next catch (or now, mid-pound). */
  queueMove(name) {
    if (!MOVES[name]) return;
    if (this.queue.length >= 2) this.queue.shift();
    this.queue.push(name);
    // A pound can be interrupted early in its contact for responsiveness.
    if (this.state === State.CONTACT && this.plan?.interruptible && this.t < this.contact.T * 0.55) {
      this._replanFromCurrent();
    }
  }

  // ---------------------------------------------------------------------------
  // LOOSE / GATHER / HOLD
  // ---------------------------------------------------------------------------
  _updateLoose(dt) {
    this._pickupCooldown = Math.max(0, (this._pickupCooldown || 0) - dt);
    if (this._pickupCooldown > 0) return;
    if (this._lookCatch()) return;
    this._tryPickup(1.15, 3.2, true);
  }

  /**
   * Look at a ball within reach and you catch it, whatever it is doing —
   * bouncing off the iron, rolling, in the air. The gather absorbs its
   * velocity. (Walking into a slow ball still works without looking.)
   */
  _lookCatch() {
    const bpos = this.ball.position;
    const eye = this.player.eyePosition;
    _v.subVectors(bpos, eye);
    const dist = _v.length();
    if (dist > 2.3 || bpos.y > 2.5) return false;
    const look = this.cam.lookDir();
    const along = _v.dot(look);
    if (along < 0.15) return false;
    const perp = Math.sqrt(Math.max(0, dist * dist - along * along));
    if (perp > 0.42) return false;
    if (this.ball.velocity.length() > 10) return false;
    this._beginGather();
    return true;
  }

  _tryPickup(range, maxSpeed, auto = false) {
    const bpos = this.ball.position;
    const feet = this.player.position;
    const dx = bpos.x - feet.x;
    const dz = bpos.z - feet.z;
    const dist = Math.hypot(dx, dz);
    const speed = this.ball.velocity.length();
    if (dist > range || speed > maxSpeed || bpos.y > 1.5) return false;
    // Only auto-gather a ball roughly in front of you.
    if (auto) {
      const facing = (dx * this._fwd.x + dz * this._fwd.z) / Math.max(dist, 1e-3);
      if (facing < 0.1 && dist > 0.5) return false;
    }
    this._beginGather();
    return true;
  }

  _beginGather() {
    const wv = this.ball.velocity;
    const pv = this.player.velocity;
    this._updateFrame(0, true);
    this.ball.setControlled();
    const p0 = this.toLocal(this.ball.position);
    const v0 = new THREE.Vector3(wv.x - pv.x, wv.y, wv.z - pv.z);
    const vl = new THREE.Vector3(v0.dot(this._right), v0.y, v0.dot(this._fwd));
    this.sign = p0.x >= 0 ? 1 : -1;
    const T = clamp(0.22 + p0.distanceTo(HOLD_POINT) * 0.18, 0.25, 0.5);
    this.contact = new Contact([
      { p: p0, v: vl, t: 0, dir: dirOf(this.sign * 0.5, 0.85, 0.1) },
      { p: HOLD_POINT.clone(), v: new THREE.Vector3(), t: T, dir: dirOf(this.sign * 0.9, -0.15, -0.3) },
    ]);
    this.t = 0;
    this.state = State.GATHER;
    this.plan = null;
    this.flight = null;
    this.angVel.set(0, 0, 0);
    // Drive from the real ball state this very tick (no stale frame).
    this.ballLocal.copy(p0);
    this.ballVelLocal.copy(vl);
    this.hud?.setHint(this.hints.hold);
  }

  _updateGather(dt) {
    this.t += dt;
    this.contact.positionAt(this.t, this.ballLocal);
    this.contact.velocityAt(this.t, this.ballVelLocal);
    // A fast incoming ball can make the scoop path dip; never through the court.
    this.ballLocal.y = Math.max(this.ballLocal.y, this.floorLocal);
    if (this.t >= this.contact.T) {
      this.state = State.HOLD;
      this.t = 0;
      this.ballLocal.copy(HOLD_POINT);
      this.ballVelLocal.set(0, 0, 0);
      this.audio?.catchBall(0.5);
      if (this._shotPending > 0) {
        this._shotPending = 0;
        this._requestShot();
      }
    }
  }

  _updateHold(dt) {
    this.t += dt;
    // A slow breathing drift so the held ball never looks frozen.
    this.ballLocal.set(
      HOLD_POINT.x + Math.sin(this.t * 1.1) * 0.006,
      HOLD_POINT.y + Math.sin(this.t * 1.7) * 0.008,
      HOLD_POINT.z + Math.cos(this.t * 0.9) * 0.005
    );
    this.ballVelLocal.set(0, 0, 0);
  }

  _pickUpFromDribble() {
    const p0 = this.ballLocal.clone();
    const v0 = this.ballVelLocal.clone();
    this.contact = new Contact([
      { p: p0, v: v0, t: 0, dir: dirOf(this.sign * 0.5, 0.85, 0.1) },
      { p: HOLD_POINT.clone(), v: new THREE.Vector3(), t: 0.3, dir: dirOf(this.sign * 0.9, -0.15, -0.3) },
    ]);
    this.t = 0;
    this.state = State.GATHER;
    this.plan = null;
    this.flight = null;
    this.queue.length = 0;
    this.hud?.setHint(this.hints.hold);
  }

  _drop() {
    // Hand the ball to the solver with its current world velocity so it just
    // keeps doing what it was doing.
    const vl = this.ballVelLocal;
    const wv = this.dirToWorld(vl);
    wv.x += this.player.velocity.x;
    wv.z += this.player.velocity.z;
    this.ball.setFree(wv, this.angVel);
    this.state = State.LOOSE;
    this._pickupCooldown = 0.6;
    this.plan = null;
    this.flight = null;
    this.contact = null;
    this.queue.length = 0;
    this.hud?.setHint(this.hints.loose);
  }

  // ---------------------------------------------------------------------------
  // DRIBBLING: plan a cycle (contact + flight)
  // ---------------------------------------------------------------------------
  _context(catchPos, inVel, sign) {
    return makeContext({
      sign,
      speed: this.player.planarSpeed,
      sprint: this.player.sprinting,
      low: this.low,
      catchPos,
      inVel,
    });
  }

  _flightOpts() {
    return {
      floor: this.floorLocal,
      restitution: D.restitution,
      horizontalKeep: D.horizontalKeep,
      catchRiseSpeed: D.catchRiseSpeed,
    };
  }

  /** Build the contact + flight for `name` from the given catch state. */
  _plan(name, catchPos, inVel, sign, timeScale = 1) {
    const ctx = this._context(catchPos, inVel, sign);
    const plan = MOVES[name](ctx);
    const wps = plan.waypoints;
    wps[0].p = catchPos.clone();
    wps[0].v = inVel.clone();
    if (timeScale !== 1) for (const w of wps) w.t *= timeScale;
    const last = wps[wps.length - 1];
    // Keep every waypoint off the floor.
    for (const w of wps) w.p.y = Math.max(w.p.y, this.floorLocal + 0.06);
    const flight = new Flight(last.p, plan.target, this._flightOpts());
    last.v = flight.releaseVelocity();
    plan.contact = new Contact(wps);
    plan.flight = flight;
    return plan;
  }

  _startDribble(sign) {
    this.sign = sign;
    const p0 = this.ballLocal.clone();
    const plan = this._plan('pound', p0, new THREE.Vector3(0, -0.3, 0), sign, 1.8);
    plan.label = null;
    this._beginPlan(plan);
    this.hud?.setHint(null);
  }

  _beginPlan(plan) {
    this.plan = plan;
    this.contact = plan.contact;
    this.flight = plan.flight;
    this.t = 0;
    this.state = State.CONTACT;
    this.sign = plan.hand;
    this.hud?.setHand(this.sign);
    if (plan.label) {
      this.combo.push(plan.label);
      if (this.combo.length > 4) this.combo.shift();
      this._comboTimer = 1.6;
      this.hud?.flashMove(plan.label);
      this.hud?.setCombo(this.combo);
    }
    if (plan.squeak && this.player.planarSpeed > 0.8) this.audio?.squeak();
    if (plan.hop) {
      this.player.velocity.addScaledVector(this._fwd, -2.8);
      this.player.vy = 1.5;
      this.player.grounded = false;
    }
    this._swayFor(plan);
  }

  _nextPlanName() {
    return this.queue.length ? this.queue.shift() : 'pound';
  }

  _replanFromCurrent() {
    const name = this._nextPlanName();
    const plan = this._plan(name, this.ballLocal.clone(), this.ballVelLocal.clone(), this.sign);
    this._beginPlan(plan);
  }

  // ---------------------------------------------------------------------------
  _updateContact(dt) {
    this.t += dt;
    const c = this.contact;
    if (this.t >= c.T) {
      // Release.
      c.positionAt(c.T, this.ballLocal);
      c.velocityAt(c.T, this.ballVelLocal);
      this._release.pos.copy(this.ballLocal);
      c.dirAt(c.T, this._release.dir);
      this._release.vel.copy(this.ballVelLocal);
      this.t -= c.T;
      this.state = State.FLIGHT;
      this.lastEvent = 'release';
      this.flight.bounced = false;
      this._updateFlight(0);
      return;
    }
    c.positionAt(this.t, this.ballLocal);
    c.velocityAt(this.t, this.ballVelLocal);
  }

  _updateFlight(dt) {
    this.t += dt;
    const f = this.flight;
    if (!f.bounced && this.t >= f.t1) {
      f.bounced = true;
      this.lastEvent = 'bounce';
      this.stats.bounces++;
      this.audio?.bounce(clamp(f.vf * 0.2, 0.35, 1.4));
      this._swayTarget.vertical -= clamp(f.vf * 0.004, 0, 0.02);
    }
    if (this.t >= f.T) {
      // Catch → plan the next cycle from the actual arrival state.
      f.positionAt(f.T, this.ballLocal);
      f.catchVelocity(this.ballVelLocal);
      this.stats.catches++;
      this.cycles++;
      this.lastEvent = 'catch';
      this.audio?.catchBall(clamp(f.catchRise * 0.3, 0.1, 0.5));
      const name = this._nextPlanName();
      const plan = this._plan(name, this.ballLocal.clone(), this.ballVelLocal.clone(), this.plan.catchHand);
      // The hand is wherever the previous flight asked it to be: start the new
      // contact from that direction so the palm never jumps around the ball.
      plan.waypoints[0].dir.copy(this.plan.catchDir);
      this._beginPlan(plan);
      return;
    }
    f.positionAt(this.t, this.ballLocal);
    f.velocityAt(this.t, this.ballVelLocal);
  }


  // ---------------------------------------------------------------------------
  // SHOOTING
  //
  // A jumper is one pre-planned Contact path in the handle frame — gather →
  // set (beside the eyes) → load (above the forehead) → release — whose end
  // velocity *is* the launch velocity that swishes, so a green release is
  // continuous in position and velocity like every other transition. The
  // meter runs on the same clock. On button-up the ball is wherever it is on
  // that path; a short "flick" segment replans from there to the launch the
  // timing zone deserves, so even a bad release is a continuous hand motion
  // rather than a velocity snap.
  // ---------------------------------------------------------------------------
  _pickHoop() {
    if (!this.hoops.length) return null;
    const feet = this.player.position;
    const fwd = this.cam.forward();
    let best = null;
    let bestScore = -Infinity;
    for (const h of this.hoops) {
      const dx = h.rimCenter.x - feet.x;
      const dz = h.rimCenter.z - feet.z;
      const dist = Math.hypot(dx, dz) || 1e-3;
      const facing = (dx * fwd.x + dz * fwd.z) / dist;
      const score = facing - dist * 0.03;
      if (score > bestScore) {
        bestScore = score;
        best = h;
      }
    }
    return best;
  }

  /** Axes of the handle frame at a given yaw (what the frame becomes once it has squared up). */
  _axesAt(yaw) {
    return {
      fwd: new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)),
      right: new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)),
    };
  }

  /** True when the ball is in hand, on the ground, inside layup range of `hoop`. */
  _inLayupRange(hoop) {
    if (!hoop || !this.player.grounded) return false;
    const feet = this.player.position;
    return Math.hypot(hoop.rimCenter.x - feet.x, hoop.rimCenter.z - feet.z) < SHOT.layupRange;
  }

  /**
   * The jump key with the ball near the rim: the layup takeoff. Returns true
   * when it took the jump, so the game does not also do a plain hop.
   */
  tryLayupTakeoff() {
    if (this.state === State.LOOSE || this.state === State.GATHER || this.shot) return false;
    const hoop = this._pickHoop();
    if (!this._inLayupRange(hoop)) return false;
    this._startShot('layup', hoop);
    return true;
  }

  /** The shoot key: near the rim it is also a layup takeoff (then tap again), else the jumper. */
  _requestShot() {
    if (this.state === State.LOOSE || this.state === State.GATHER || this.shot) return;
    const hoop = this._pickHoop();
    if (!hoop) return;
    this._startShot(this._inLayupRange(hoop) ? 'layup' : 'jumper', hoop);
  }

  /**
   * What differs between a jumper and a layup: the timeline, where the ball
   * is carried, how hard the hop is, how much momentum the feet keep, the
   * hand's contact directions, and how the timing is graded.
   */
  _shotSpec(kind) {
    if (kind === 'layup') {
      const { releaseTime, meterTime } = layupTiming();
      return {
        kind,
        // The takeoff *is* t = 0: the feet leave the floor at once, the ball
        // sweeps up the shooting side in one motion, and the ideal tap is
        // just past the apex.
        setTime: 0,
        releaseTime,
        meterTime,
        jumpSpeed: SHOT.layupJumpSpeed,
        jumpAt: 0,
        set: null, // no pause between the scoop and the carry
        load: SHOT.layupCarry,
        loadSpeed: SHOT.layupCarrySpeed,
        extension: SHOT.layupExtension,
        decel: 0, // airborne from the first tick: momentum carries to the rim
        // One hand under the ball, palm up: a finger roll.
        dirSet: dirOf(0.12, -0.85, -0.5),
        dirLoad: dirOf(0.03, -0.93, -0.36),
        dirRel: dirOf(0, -0.96, -0.28),
        fingers: (u) => _v2.set(0.05, 0.6, 0.8),
        sway: { lateral: 0.35, roll: 0.5 }, // the body leans into the drive
        landsWithBall: true, // no tap before the feet land → come down holding it
        showMeter: this.contested, // uncontested there is nothing to time
        showTiming: this.contested,
        zoneFn: (err) => zoneForLayup(err, this.contested),
        meter: meterSpec('layup', this.contested),
      };
    }
    return {
      kind: 'jumper',
      setTime: SHOT.setTime,
      releaseTime: SHOT.releaseTime,
      meterTime: SHOT.meterTime,
      jumpSpeed: SHOT.jumpSpeed,
      set: SHOT.setPoint,
      load: SHOT.loadPoint,
      loadSpeed: SHOT.loadSpeed,
      extension: SHOT.extension,
      decel: PLAYER.shotDecel,
      dirSet: dirOf(0.15, -0.72, -0.68),
      dirLoad: dirOf(0.08, -0.8, -0.6),
      dirRel: dirOf(0.02, -0.88, -0.47),
      jumpAt: null, // timed so the hop's apex lands on the ideal release
      sway: null,
      landsWithBall: false,
      showMeter: true,
      showTiming: true,
      // Fingers straight up the back of the ball at the set (wrist cocked,
      // forearm vertical beneath it), rolling forward toward the rim as the
      // arm extends: the wrist snap. (An up-forward hint at the set is nearly
      // anti-parallel to the contact normal and degenerates.)
      fingers: (u) => _v2.set(0.02 + 0.03 * u, 1 - 0.2 * u, -0.35 + 0.9 * u),
      zoneFn: zoneFor,
      meter: meterSpec('jumper'),
    };
  }

  _startShot(kind = 'jumper', hoop = null) {
    if (this.state === State.LOOSE || this.state === State.GATHER || this.shot) return;
    hoop = hoop || this._pickHoop();
    if (!hoop) return;
    const spec = this._shotSpec(kind);
    const feet = this.player.position;
    this._aimYaw = yawToward(feet, hoop.rimCenter);
    this._shooting = true;
    this._ft = null;
    this.player.lockMove = true;
    this.player.lockDecel = spec.decel;

    // Where the frame will be at the ideal release: the feet after slowing
    // (or not — a layup keeps its momentum) through the grounded part of the
    // timeline and drifting through the hop, at the apex, squared up.
    const ax = this._axesAt(this._aimYaw);
    const canJump = this.player.grounded;
    if (kind === 'layup' && canJump) {
      // Pace the drive: arrive `layupStandoff` from the rim at the release,
      // wherever the takeoff was. A sprint slows to that; a standing start
      // hops forward up to `layupLunge`.
      // Reach the standoff by *landing*, not by the release: a late tap on the
      // way down must still be beside the rim, not under it.
      // Inside the standoff there is no room: the takeoff steps *back* to it
      // (a fade-away, capped at `layupFade`), or the ball would be carried
      // under the rim and the toss would go up into the iron.
      // The fade paces to the *release* rather than the landing: from a
      // takeoff at the rim the ball has to be clear of the front iron when
      // it leaves the hand, or no bank can rise past it.
      const dist = Math.hypot(hoop.rimCenter.x - feet.x, hoop.rimCenter.z - feet.z);
      const short = dist - SHOT.layupStandoff;
      const want = short / (short >= 0 ? spec.meterTime : spec.releaseTime);
      const cur = Math.hypot(this.player.velocity.x, this.player.velocity.z);
      const speed = want >= 0 ? Math.min(want, Math.max(cur, SHOT.layupLunge)) : Math.max(want, -SHOT.layupFade);
      this.player.velocity.set(ax.fwd.x * speed, 0, ax.fwd.z * speed);
    }
    const pv = this.player.velocity;
    const sp = Math.hypot(pv.x, pv.z);
    const tJump = spec.jumpAt ?? spec.releaseTime - spec.jumpSpeed / -PLAYER.gravity;
    const origin = new THREE.Vector3(feet.x, feet.y, feet.z);
    if (sp > 0.05) {
      const a = spec.decel;
      const tStop = a > 1e-3 ? sp / a : Infinity;
      const tG = Math.min(canJump ? tJump : spec.releaseTime, tStop);
      let drift = sp * tG - 0.5 * a * tG * tG;
      if (canJump) drift += Math.max(0, sp - a * tG) * (spec.releaseTime - tJump);
      origin.addScaledVector(_v.set(pv.x / sp, 0, pv.z / sp), drift);
    }
    if (canJump) origin.y += (spec.jumpSpeed * spec.jumpSpeed) / (2 * -PLAYER.gravity);
    const toWorldA = (l) => new THREE.Vector3(origin.x, origin.y + l.y, origin.z).addScaledVector(ax.right, l.x).addScaledVector(ax.fwd, l.z);
    const toLocalA = (w) => new THREE.Vector3(w.dot(ax.right), w.y, w.dot(ax.fwd));

    const set = spec.set ? new THREE.Vector3().fromArray(spec.set) : null;
    const load = new THREE.Vector3().fromArray(spec.load);
    if (kind === 'layup') {
      // Taking off right beside the rim, carry the ball overhead rather than
      // out in front, or it is under the rim before it leaves the hand.
      const distNow = Math.hypot(hoop.rimCenter.x - feet.x, hoop.rimCenter.z - feet.z);
      const room = clamp((distNow - 0.5) / (SHOT.layupStandoff - 0.5), 0, 1);
      load.z = 0.18 + (SHOT.layupCarry[2] - 0.18) * room;
      // …and reach higher: from beside the rim the ball leaves the hand only
      // a few centimetres from the front iron, and a bank has to rise past
      // it. A fully extended reach-up is what a player does there anyway.
      load.y += SHOT.layupReachUp * (1 - room);
    }
    // The extension runs along the launch direction, which depends on where
    // the extension ends: a couple of fixed-point iterations settle it.
    let dirL = new THREE.Vector3(0, 0.75, 0.66).normalize();
    let rel = null;
    let launch = null;
    for (let i = 0; i < 3; i++) {
      rel = load.clone().addScaledVector(dirL, spec.extension);
      const relW = toWorldA(rel);
      const info = aimFor(kind === 'layup' ? ZONE.BANK : ZONE.GREEN, 0, hoop, relW, kind);
      launch = info.launch ? info.launch.clone() : solveLaunch(relW, info.aim, info.entry) || new THREE.Vector3(info.dir.x * 3, 5, info.dir.z * 3);
      // The frame carries the body's velocity into the launch.
      launch.x -= canJump ? Math.max(0, sp - spec.decel * tJump) * (pv.x / Math.max(sp, 1e-6)) : 0;
      launch.z -= canJump ? Math.max(0, sp - spec.decel * tJump) * (pv.z / Math.max(sp, 1e-6)) : 0;
      dirL = toLocalA(launch).normalize();
    }
    const vRel = toLocalA(launch);
    const speed = vRel.length();
    // Constant-acceleration extension: its duration follows from its length
    // and the speeds at either end, so the arm snaps harder for a long shot.
    const tau = clamp((2 * spec.extension) / (spec.loadSpeed + speed), 0.06, 0.2);
    const tLoad = spec.releaseTime - tau;

    const p0 = this.ballLocal.clone();
    const v0 = this.ballVelLocal.clone();
    p0.y = Math.max(p0.y, this.floorLocal + 0.02);
    // With a set point the ball pauses there (the jumper's set); without one
    // it sweeps straight up to the load point (the layup's scoop).
    const tSet = set ? clamp(0.14 + p0.distanceTo(set) * 0.14 + v0.length() * 0.015, spec.setTime - 0.04, tLoad - 0.12) : tLoad * 0.5;
    // Hand contact direction at the start: wherever the carrying hand is now.
    let dir0;
    if (this.state === State.CONTACT && this.contact) dir0 = this.contact.dirAt(this.t, new THREE.Vector3());
    else if (this.state === State.FLIGHT && this.plan) dir0 = this.plan.catchDir.clone();
    else dir0 = dirOf(0.92, -0.18, -0.28);
    const over = rel.clone().addScaledVector(dirL, 0.08);
    const waypoints = [{ p: p0, v: v0, t: 0, dir: dir0 }];
    if (set) waypoints.push({ p: set, v: new THREE.Vector3(0, 0.5, 0), t: tSet, dir: spec.dirSet });
    waypoints.push(
      { p: load, v: dirL.clone().multiplyScalar(spec.loadSpeed), t: tLoad, dir: spec.dirLoad },
      { p: rel, v: vRel, t: spec.releaseTime, dir: spec.dirRel },
      { p: over, v: new THREE.Vector3(), t: spec.releaseTime + SHOT.overhold, dir: spec.dirRel }
    );
    const path = new Contact(waypoints);

    this.shot = {
      kind,
      spec,
      hoop,
      t: 0,
      path,
      tSet,
      tLoad,
      tJump,
      jumped: !canJump,
      dirL,
      relLocal: rel,
      dirRel: spec.dirRel,
      fromDribble: this.dribbling,
      groundY: feet.y,
      zone: null,
      err: null,
      flick: null,
    };
    if (this.dribbling) this.audio?.catchBall(0.35);
    this.state = State.SHOT;
    this.t = 0;
    this.plan = null;
    this.flight = null;
    this.contact = null;
    this.queue.length = 0;
    this.sign = 1;
    this.hud?.setHand(1);
    this.hud?.setHint(spec.kind === 'layup' ? this.hints.layup : null);
    if (spec.showMeter) this.hud?.meter?.show(spec.meter);
    else this.hud?.meter?.hide();
    // A layup leaves the floor on the very tick it starts.
    if (tJump <= 0 && !this.shot.jumped) {
      this.shot.jumped = true;
      if (this.player.jump(spec.jumpSpeed)) this.audio?.footstep(0.8);
    }
  }

  /**
   * A layup with no tap before the feet land: the body comes down with the
   * ball and gathers it back into the hold. No shot, no result.
   */
  _landWithBall() {
    const s = this.shot;
    if (!s) return;
    const p0 = this.ballLocal.clone();
    const v0 = this.ballVelLocal.clone();
    this.contact = new Contact([
      { p: p0, v: v0, t: 0, dir: s.dirRel.clone() },
      { p: HOLD_POINT.clone(), v: new THREE.Vector3(), t: 0.28, dir: dirOf(0.9, -0.15, -0.3) },
    ]);
    this.shot = null;
    this._shooting = false;
    this.player.lockMove = false;
    this.state = State.GATHER;
    this.t = 0;
    this.hud?.meter?.hide();
    this.hud?.setHint(this.hints.hold);
  }

  _updateShot(dt) {
    const s = this.shot;
    s.t += dt;
    this.t = s.t;
    if (!s.jumped && s.t >= s.tJump) {
      s.jumped = true;
      if (this.player.jump(s.spec.jumpSpeed)) this.audio?.footstep(0.7);
    }
    s.path.positionAt(s.t, this.ballLocal);
    if (s.t >= s.path.T) this.ballVelLocal.set(0, 0, 0);
    else s.path.velocityAt(s.t, this.ballVelLocal);
    this.ballLocal.y = Math.max(this.ballLocal.y, this.floorLocal);
    if (s.armed && s.t >= s.spec.releaseTime) {
      this._releaseShot();
      return;
    }
    this.hud?.meter?.set(s.t / s.spec.meterTime);
    if (s.t >= s.spec.meterTime) {
      if (s.spec.landsWithBall && this.player.grounded) this._landWithBall();
      else if (!s.spec.landsWithBall) this._releaseShot();
      else if (s.t > s.spec.meterTime + 0.5) this._landWithBall(); // never landed (fell off the court?) — give up
    }
  }

  /** Button-up: grade the timing, aim for that outcome, plan the flick. */
  _releaseShot() {
    const s = this.shot;
    if (!s || this.state !== State.SHOT) return;
    const err = s.t - s.spec.releaseTime;
    const zone = s.spec.zoneFn(err);
    const p = this.ballLocal.clone();
    const v = this.ballVelLocal.clone();
    const pv = this.frameVel;
    let vEnd = v.length() > 0.5 ? v.clone() : s.dirL.clone().multiplyScalar(0.5);
    let pEnd = null;
    let tau = 0.06;
    let info = null;
    for (let i = 0; i < 3; i++) {
      tau = clamp((2 * SHOT.flickLength) / (v.length() + vEnd.length()), 0.04, 0.12);
      pEnd = p.clone().addScaledVector(_v.copy(v).add(vEnd), 0.5 * tau); // constant acceleration through the flick
      // Where the feet will be at the end of the flick: still rising or
      // falling through the hop, or back on the floor if it lands first.
      let dy = 0;
      let vyPred = 0;
      if (!this.player.grounded) {
        const vy = this.player.vy;
        dy = vy * tau + 0.5 * PLAYER.gravity * tau * tau;
        vyPred = vy + PLAYER.gravity * tau;
        const floor = s.groundY - this.player.position.y;
        if (dy < floor) {
          dy = floor;
          vyPred = 0;
        }
      }
      const frameVel = _v2.set(pv.x, vyPred, pv.z);
      const pEndW = this.toWorld(pEnd);
      pEndW.x += pv.x * tau;
      pEndW.z += pv.z * tau;
      pEndW.y += dy;
      info = aimFor(zone, err, s.hoop, pEndW, s.kind);
      const launch = info.launch ? info.launch.clone() : solveLaunch(pEndW, info.aim, info.entry) || new THREE.Vector3(info.dir.x * 3, 5, info.dir.z * 3);
      vEnd = this.dirToLocal(launch.sub(frameVel));
    }
    s.flick = new Contact([
      { p, v, t: 0, dir: s.dirRel.clone() },
      { p: pEnd, v: vEnd, t: tau, dir: s.dirRel.clone() },
    ]);
    s.zone = zone;
    s.err = err;
    s.tRelease = s.t;
    this.state = State.RELEASE;
    this.t = 0;
    if (s.spec.showMeter) this.hud?.meter?.release(s.tRelease / s.spec.meterTime, zone, err);
    if (s.spec.showTiming) this.hud?.flashTiming?.(zone, err, s.kind);
  }

  _updateRelease(dt) {
    const s = this.shot;
    s.t += dt;
    this.t += dt;
    const f = s.flick;
    if (this.t >= f.T) {
      f.positionAt(f.T, this.ballLocal);
      f.velocityAt(f.T, this.ballVelLocal);
      // The ball left the hand part-way through this tick: it has been free
      // for the remainder, so it must not sit still for a frame first.
      this._launch(this.t - f.T);
      return;
    }
    f.positionAt(this.t, this.ballLocal);
    f.velocityAt(this.t, this.ballVelLocal);
  }

  /** The ball leaves the hand: a fresh solve from where it actually is. */
  _launch(remainder = 0) {
    const s = this.shot;
    this.toWorld(this.ballLocal, this.ballWorld);
    const from = this.ballWorld.clone();
    const info = aimFor(s.zone, s.err, s.hoop, from, s.kind);
    const { aim, entry, dir, side, dist } = info;
    const launch = info.launch ? info.launch.clone() : solveLaunch(from, aim, entry) || new THREE.Vector3(dir.x * 3, 5, dir.z * 3);
    // A bank is solved without spin: backspin on the glass adds a friction
    // kick the model does not carry, and it dropped the carom short.
    const spin = side.clone().multiplyScalar(s.kind === 'layup' ? 0 : SHOT.backspin);
    // Continuity stat: what the hand was doing at the release instant (the
    // flick's end velocity, plus the body carrying it) against what the ball
    // was given. The flick was planned to make these equal.
    const hand = this.dirToWorld(this.ballVelLocal, _v);
    hand.x += this.frameVel.x;
    hand.z += this.frameVel.z;
    if (!this.player.grounded) hand.y += this.player.vy;
    this.lastReleaseJump = hand.distanceTo(launch);
    this.stats.maxReleaseJump = Math.max(this.stats.maxReleaseJump, this.lastReleaseJump);
    // Free for `remainder` seconds already this tick: advance both position
    // and velocity along the arc, or the ball gets a phantom upward kick.
    const start = from.clone().addScaledVector(launch, remainder);
    start.y -= 0.5 * 9.81 * remainder * remainder;
    const vNow = launch.clone();
    vNow.y -= 9.81 * remainder;
    this.ball.setPositionHard(start);
    this.ball.setFree(vNow, spin);
    this.ball.syncMesh();

    this.tracker = new ShotTracker(s.hoop, s.zone, { err: s.err, dist });
    const wrist = this.hands.get('right').target.pos;
    this._ft = {
      t: 0,
      landed: this.player.grounded,
      wristLocal: this.toLocal(wrist, new THREE.Vector3()),
      dirL: this.dirToLocal(launch, new THREE.Vector3()).normalize(),
    };
    this.lastShot = {
      kind: s.kind,
      zone: s.zone,
      err: s.err,
      result: null,
      dist,
      launchSpeed: launch.length(),
      launch: launch.toArray(),
      from: from.toArray(),
      aim: aim.toArray(),
    };
    this.stats.shots.push(this.lastShot);
    this.audio?.release?.();

    this.shot = null;
    this.state = State.LOOSE;
    this._pickupCooldown = 0.9;
    this.plan = null;
    this.flight = null;
    this.contact = null;
    this.lastEvent = 'shot';
  }

  _onShotResult(r) {
    const t = this.tracker;
    this.tracker = null;
    if (this.lastShot) {
      this.lastShot.result = r;
      this.lastShot.rimHits = t?.rimHits ?? 0;
      this.lastShot.boardHits = t?.boardHits ?? 0;
    }
    const made = r === 'swish' || r === 'made';
    if (made) this.stats.made++;
    const label = made && this.lastShot?.kind === 'layup' ? 'LAYUP' : RESULT_LABEL[r] || r;
    this.hud?.flashResult?.(label, r);
    this.hud?.setScore?.(this.stats.made, this.stats.shots.length);
    this.hud?.setHint(this.hints.loose);
    return t;
  }

  /** Physics contact events for the ball (fed from the game's listener). */
  onBallContact(tag) {
    this.tracker?.contact(tag);
  }

  // ---------------------------------------------------------------------------
  // Ball spin: rolls with its horizontal motion in flight, settles in hand.
  // ---------------------------------------------------------------------------
  _spin(dt) {
    if (this.state === State.FLIGHT) {
      const vh = this.dirToWorld(_v.set(this.ballVelLocal.x, 0, this.ballVelLocal.z), _v2);
      const speed = vh.length();
      if (speed > 0.05) {
        _v3.crossVectors(UP, vh).normalize().multiplyScalar((speed / BALL.radius) * 0.35 + 2.5);
        this.angVel.lerp(_v3, 1 - Math.exp(-14 * dt));
      }
    } else if (this.state === State.CONTACT) {
      this.angVel.multiplyScalar(Math.exp(-6 * dt));
    } else {
      this.angVel.multiplyScalar(Math.exp(-4 * dt));
    }
    const w = this.angVel.length();
    if (w > 1e-4) {
      _q.setFromAxisAngle(_v.copy(this.angVel).divideScalar(w), w * dt);
      this.ballQuat.premultiply(_q).normalize();
    }
  }

  // ---------------------------------------------------------------------------
  // Camera body sway
  // ---------------------------------------------------------------------------
  _swayFor(plan) {
    this._swayPlan = plan.sway || { lateral: 0, vertical: 0, roll: 0 };
  }

  _updateSway(dt) {
    const tgt = this._swayTarget;
    let lat = 0;
    let ver = 0;
    let roll = 0;
    if (this.state === State.SHOT && this.shot) {
      const sw = this.shot.spec.sway;
      if (sw) {
        // The drive: lean into the rim through the rise, settle after release.
        const u = smoothstep(clamp(this.shot.t / this.shot.spec.releaseTime, 0, 1));
        lat = sw.lateral * D.swayLateral * u;
        roll = sw.roll * D.swayRoll * u;
        ver = -0.02 * Math.sin(clamp(this.shot.t / 0.12, 0, 1) * Math.PI);
      } else {
        const u = clamp(this.shot.t / this.shot.tSet, 0, 1);
        ver = -0.035 * Math.sin(u * Math.PI);
      }
    } else if (this.plan && this._swayPlan && (this.state === State.CONTACT || this.state === State.FLIGHT)) {
      const s = this._swayPlan;
      let k;
      if (this.state === State.CONTACT) {
        const u = clamp(this.t / this.contact.T, 0, 1);
        if (s.rebound) k = Math.sin(u * Math.PI); // in, then back out
        else if (s.hold) k = smoothstep(clamp(u * 2.2, 0, 1)) * (1 - smoothstep(clamp((u - 0.7) / 0.3, 0, 1)));
        else k = smoothstep(u);
      } else {
        const u = clamp(this.t / this.flight.T, 0, 1);
        k = s.rebound || s.hold ? 0 : 1 - smoothstep(clamp(u * 1.6, 0, 1));
      }
      lat = s.lateral * D.swayLateral * k;
      ver = s.vertical * D.swayVertical * k;
      roll = s.roll * D.swayRoll * k;
    }
    // Vertical target also carries the little bounce dip added on floor hits.
    tgt.lateral = lat;
    tgt.vertical = damp(tgt.vertical, ver, 18, dt);
    tgt.roll = roll;
    this.sway.lateral = damp(this.sway.lateral, tgt.lateral, 12, dt);
    this.sway.vertical = damp(this.sway.vertical, tgt.vertical, 12, dt);
    this.sway.roll = damp(this.sway.roll, tgt.roll, 10, dt);
    this.cam.setSway(this.sway.lateral, this.sway.vertical, this.sway.roll);
  }

  // ---------------------------------------------------------------------------
  // Hands
  // ---------------------------------------------------------------------------
  _side(sign) {
    return sign > 0 ? 'right' : 'left';
  }

  /** Finger direction: along the ball's surface, as forward-and-down as possible (or as `hint` asks). */
  _fingerDir(dirW, out, hint = null) {
    if (hint) out.copy(hint);
    else out.copy(this._fwd).multiplyScalar(0.8).addScaledVector(UP, -0.55);
    out.addScaledVector(dirW, -out.dot(dirW));
    if (out.lengthSq() < 1e-4) out.copy(this._fwd);
    return out.normalize();
  }

  /** Place a hand so its palm rests on the ball at world contact direction dirW. */
  _handOnBall(side, ballW, dirW, lambda, pose, rotLambda = lambda, fingerHint = null) {
    const contact = _h1.copy(ballW).addScaledVector(dirW, BALL.radius + PALM_GAP);
    const fingers = this._fingerDir(dirW, _h3, fingerHint);
    const palm = _h2.copy(dirW).multiplyScalar(-1);
    const q = this.hands.get(side).target.quat;
    const quat = HandsQuat(palm, fingers, q);
    const wrist = contact.clone().sub(PALM_CENTER.clone().applyQuaternion(quat));
    this.hands.setTargetQuat(side, wrist, quat, lambda, rotLambda);
    this.hands.setPose(side, pose);
    return wrist;
  }

  _handGuard(side, sign, lambda = 14) {
    const local = _v.set(sign * 0.40, 0.96 + this.sway.vertical * 0.5 + this.bodyLift, 0.46);
    local.x -= this.sway.lateral * 0.6; // counterbalance the body
    const pos = this.toWorld(local);
    const palm = this.dirToWorld(_v2.set(-sign * 0.35, -0.75, 0.55)).normalize();
    const fingers = this.dirToWorld(_v3.set(sign * 0.3, -0.2, 0.92)).normalize();
    this.hands.setTarget(side, pos, palm, fingers, lambda, lambda);
    this.hands.setPose(side, HAND_POSES.guard);
  }

  _handRest(side, sign, t) {
    const local = _v.set(sign * 0.25, 0.86 + Math.sin(t * 1.3 + sign) * 0.008 + this.bodyLift, 0.20);
    const pos = this.toWorld(local);
    const palm = this.dirToWorld(_v2.set(-sign * 0.85, -0.2, 0.3)).normalize();
    const fingers = this.dirToWorld(_v3.set(0, -0.5, 0.85)).normalize();
    this.hands.setTarget(side, pos, palm, fingers, 10, 10);
    this.hands.setPose(side, HAND_POSES.relaxed);
  }

  _updateHands(dt) {
    this._idleT += dt;
    const ballW = this.ballWorld;

    if (this.state === State.LOOSE) {
      if (this._ft && this._ft.t < SHOT.followThrough) {
        this._handFollowThrough();
        return;
      }
      this._handRest('right', 1, this._idleT);
      this._handRest('left', -1, this._idleT);
      return;
    }

    if (this.state === State.SHOT || this.state === State.RELEASE) {
      this._handsShooting();
      return;
    }

    if (this.state === State.HOLD || this.state === State.GATHER) {
      // Both hands on the sides of the ball, slightly behind it.
      const k = this.state === State.GATHER ? clamp(this.t / this.contact.T, 0, 1) : 1;
      for (const sign of [1, -1]) {
        const side = this._side(sign);
        const dirW = this.dirToWorld(_v.set(sign * 0.92, -0.18, -0.28)).normalize();
        if (this.state === State.GATHER && sign !== this.sign && k < 0.5) {
          this._handGuard(side, sign, 16);
        } else {
          this._handOnBall(side, ballW, dirW, 30 + k * 30, HAND_POSES.grip);
        }
      }
      return;
    }

    // Dribbling.
    const plan = this.plan;
    const carrySide = this._side(plan.hand);
    const catchSide = this._side(plan.catchHand);
    const offSign = -plan.hand;

    if (this.state === State.CONTACT) {
      const dirW = this.dirToWorld(this.contact.dirAt(this.t, _v));
      this._handOnBall(carrySide, ballW, dirW, 240, HAND_POSES.ball, 60);
      if (plan.catchHand !== plan.hand) {
        // The receiving hand gets ready above where the ball will arrive.
        this._handReady(catchSide, plan, 1.0);
      } else {
        this._handGuard(this._side(offSign), offSign);
      }
      return;
    }

    // FLIGHT
    const f = this.flight;
    const remaining = f.T - this.t;
    // 1) Follow-through for the hand that just released.
    if (this.t < FOLLOW_THROUGH || plan.catchHand !== plan.hand) {
      const ft = clamp(this.t / FOLLOW_THROUGH, 0, 1);
      const relW = this.toWorld(this._release.pos);
      const dirW = this.dirToWorld(this._release.dir).normalize();
      const velW = this.dirToWorld(this._release.vel);
      const ease = 1 - (1 - ft) * (1 - ft);
      const p = relW.addScaledVector(velW, ease * FOLLOW_THROUGH * 0.85);
      if (this.t < FOLLOW_THROUGH) {
        this._handOnBall(carrySide, p, dirW, 40, HAND_POSES.open);
      } else {
        this._handGuard(carrySide, plan.hand, 12);
      }
    }
    // 2) The catching hand: hover above the arrival point, then descend to meet
    //    the rising ball so the catch is exact.
    if (remaining > APPROACH) {
      if (plan.catchHand === plan.hand && this.t < FOLLOW_THROUGH) {
        // still following through (handled above)
      } else {
        this._handReady(catchSide, plan, 1.0);
      }
    } else {
      const u = 1 - clamp(remaining / APPROACH, 0, 1);
      this._handMeet(catchSide, plan, u);
    }
    if (plan.catchHand === plan.hand) {
      this._handGuard(this._side(offSign), offSign);
    }
  }

  /**
   * A hand waiting for the ball. The hand that just released it follows it
   * down for the first part of the flight (a real hand travels about half the
   * ball's amplitude) and then rises ahead of it to hover above the catch
   * point. The *other* hand — receiving a crossover, say — does not chase the
   * ball: it moves early to hover over where the ball will arrive.
   */
  _handReady(side, plan, lambda) {
    const f = this.flight || plan.flight;
    const targetW = this.toWorld(f.B, _v2);
    const dirW = this.dirToWorld(plan.catchDir, _v3).normalize();
    const hoverY = targetW.y + 0.09;
    const sameHand = side === this._side(plan.hand);
    if (!sameHand || !this.flight) {
      const p = _v.copy(targetW);
      p.y = hoverY + 0.03;
      this._handOnBall(side, p, dirW, 14 * lambda, HAND_POSES.open, 14);
      return;
    }
    const u = clamp(this.t / f.T, 0, 1);
    // Follow: just above the ball, but never lower than ~38 cm under the catch.
    const followY = Math.max(this.ballWorld.y + BALL.radius + 0.05, targetW.y - 0.38);
    const k = smoothstep(clamp((u - 0.15) / 0.6, 0, 1));
    const p = _v.copy(this.ballWorld).lerp(targetW, k);
    p.y = followY + (hoverY - followY) * k;
    this._handOnBall(side, p, dirW, 18 * lambda, HAND_POSES.open, 16);
  }

  /** Blend from the hover down onto the ball as it arrives (u 0→1). */
  _handMeet(side, plan, u) {
    const f = this.flight;
    const targetW = this.toWorld(f.B, _v2);
    const dirW = this.dirToWorld(plan.catchDir, _v3).normalize();
    const k = smoothstep(u);
    // Track the actual ball horizontally, ease vertically from the hover.
    const p = _v.copy(this.ballWorld).lerp(targetW, 1 - k);
    p.y = targetW.y + 0.09 * (1 - k) + (this.ballWorld.y - targetW.y) * k;
    this._handOnBall(side, p, dirW, 30 + k * 40, k > 0.6 ? HAND_POSES.ball : HAND_POSES.open, 30);
  }

  /**
   * Both hands on the ball through the jumper. The shooting hand sits under
   * and behind the ball, fingers up its back toward the rim; the guide hand
   * rests on the side and eases off through the extension so the ball leaves
   * one hand, as it should.
   */
  _handsShooting() {
    const s = this.shot;
    const ballW = this.ballWorld;
    const path = this.state === State.SHOT ? s.path : s.flick;
    const tt = this.state === State.SHOT ? s.t : this.t;
    const dirW = this.dirToWorld(path.dirAt(tt, _v)).normalize();
    const u = this.state === State.SHOT ? clamp((s.t - s.tLoad) / (s.spec.releaseTime - s.tLoad), 0, 1) : 1;
    const fingers = this.dirToWorld(s.spec.fingers(u)).normalize();
    this._handOnBall('right', ballW, dirW, 400, HAND_POSES.shoot, 60, fingers);

    const gdir = this.dirToWorld(_v3.set(-0.94, -0.12, -0.32)).normalize();
    const gp = _h2.copy(ballW).addScaledVector(gdir, u * 0.07);
    const gfingers = this.dirToWorld(_v2.set(-0.1, 0.85, 0.5)).normalize();
    // Early in the gather the guide hand is still arriving from wherever it
    // was; a softer spring reads as the hand reaching for the ball.
    const arriving = this.state === State.SHOT && s.t < s.tSet * 0.6;
    this._handOnBall('left', gp, gdir, arriving ? 40 : 200, u < 0.5 ? HAND_POSES.grip : HAND_POSES.open, 30, gfingers);
  }

  /** The gooseneck: wrist snapped over, fingers hanging at the rim. */
  _handFollowThrough() {
    const ft = this._ft;
    const k = smoothstep(clamp(ft.t / 0.22, 0, 1));
    const settle = smoothstep(clamp((ft.t - 0.3) / 0.25, 0, 1));
    const local = _v.copy(ft.wristLocal).addScaledVector(ft.dirL, 0.05 + 0.12 * k);
    local.y += this.bodyLift - 0.06 * settle;
    const pos = this.toWorld(local);
    const fwdL = _v2.set(ft.dirL.x, 0, ft.dirL.z).normalize();
    // The palm rolls from under the ball (facing up-forward) to facing
    // down-forward as the wrist snaps through.
    const palmL = _v3.set(fwdL.x * (0.5 + 0.1 * k), 0.85 - 1.7 * k, fwdL.z * (0.5 + 0.1 * k)).normalize();
    const palm = this.dirToWorld(palmL, _h1).normalize();
    const fingersL = _v3.set(fwdL.x * 0.8, 0.5 - 1.1 * k, fwdL.z * 0.8).normalize();
    const fingersW = this.dirToWorld(fingersL, _h2).normalize();
    this.hands.setTarget('right', pos, palm, fingersW, 30, 22);
    this.hands.setPose('right', k > 0.35 ? HAND_POSES.followThrough : HAND_POSES.shoot);

    // The guide hand stays up beside the shot, then drifts down.
    const gl = _v.set(-0.30, 1.62 - 0.35 * settle + this.bodyLift, 0.30);
    const gpos = this.toWorld(gl);
    const gpalm = this.dirToWorld(_v2.set(0.75, -0.25, 0.6)).normalize();
    const gfingers = this.dirToWorld(_v3.set(-0.05, 0.9, 0.42)).normalize();
    this.hands.setTarget('left', gpos, gpalm, gfingers, 14, 14);
    this.hands.setPose('left', HAND_POSES.open);
  }

  /** Test hook: how far the carrying palm sits off the ball surface (m). */
  _measureGap(side) {
    const h = this.hands.get(side);
    _v.copy(PALM_CENTER).applyQuaternion(h.quat).add(h.pos);
    const gap = Math.abs(_v.distanceTo(this.ballWorld) - BALL.radius - PALM_GAP);
    if (gap > this.stats.maxHandGap) this.stats.maxHandGap = gap;
  }

  /** Called after the physics step to place the ball mesh when it is free. */
  postStep() {
    if (this.ball.mode === BallMode.FREE) this.ball.syncMesh();
    else if (this.state === State.CONTACT && this.plan) this._measureGap(this._side(this.plan.hand));
    else if (this.state === State.SHOT || this.state === State.RELEASE) this._measureGap('right');
  }
}

// Local import shim so the controller can build hand orientations without a
// circular dependency on Hands.
import { Hands } from '../player/Hands.js';
const HandsQuat = (palm, fingers, out) => Hands.quatFromPalm(palm, fingers, out);
