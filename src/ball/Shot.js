import * as THREE from 'three';
import { SHOT, HOOP, BALL, PLAYER } from '../core/Constants.js';
import { clamp } from '../core/MathUtils.js';

/**
 * Pure shot maths. Nothing here touches the scene: the controller feeds it
 * world-space points and gets back launch velocities, aim points and a
 * verdict on where the release landed on the meter.
 *
 * The launch is a closed-form ballistic solve that includes Rapier's linear
 * damping, so the ball flies exactly where it is aimed (validated in the
 * headless harness to ~5 mm at the rim). The arc is defined by its *entry
 * angle* at the rim rather than an apex height — that is how shooters
 * actually keep the same shape from every distance, and a 47° entry is what
 * makes a centred ball drop cleanly through a 45 cm rim.
 */
const G = 9.81;
const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

/** Where a release landed on the meter, from its signed timing error. */
export const ZONE = { GREEN: 'green', IRON: 'iron', GLASS: 'glass', AIR: 'air', FRONT: 'front', BANK: 'bank' };

export function zoneFor(err) {
  const e = Math.abs(err);
  if (e <= SHOT.green) return ZONE.GREEN;
  if (e <= SHOT.iron) return ZONE.IRON;
  if (e <= SHOT.glass) return ZONE.GLASS;
  return ZONE.AIR;
}

/** Layups: a wide make window (narrow when contested) that goes in off the glass, otherwise the front iron. */
export function zoneForLayup(err, contested = false) {
  const w = contested ? SHOT.layupContestedWindow : SHOT.layupWindow;
  return Math.abs(err) <= w ? ZONE.BANK : ZONE.FRONT;
}

/**
 * A layup's clock runs from the takeoff: the ideal tap is just past the top
 * of the jump, and the meter runs out when the feet land.
 */
export function layupTiming() {
  const tApex = SHOT.layupJumpSpeed / -PLAYER.gravity;
  return { releaseTime: tApex + SHOT.layupReleaseAfterApex, meterTime: 2 * tApex, tApex };
}

/** The meter's band layout for each kind of shot: [maxAbsError, zone] outward from the ideal. */
export function meterSpec(kind, contested = false) {
  if (kind === 'layup') {
    const { releaseTime, meterTime } = layupTiming();
    return {
      releaseTime,
      meterTime,
      zones: [[contested ? SHOT.layupContestedWindow : SHOT.layupWindow, ZONE.BANK], [Infinity, ZONE.FRONT]],
    };
  }
  return {
    releaseTime: SHOT.releaseTime,
    meterTime: SHOT.meterTime,
    zones: [[SHOT.green, ZONE.GREEN], [SHOT.iron, ZONE.IRON], [SHOT.glass, ZONE.GLASS], [Infinity, ZONE.AIR]],
  };
}

export const ZONE_LABEL = {
  [ZONE.GREEN]: 'SWISH',
  [ZONE.IRON]: 'BACK IRON',
  [ZONE.GLASS]: 'OFF THE GLASS',
  [ZONE.AIR]: 'AIRBALL',
  [ZONE.FRONT]: 'FRONT RIM',
  [ZONE.BANK]: 'OFF THE GLASS',
};

/** ∫₀ᵀ e^{−kt} dt — the drag-damped "effective time" for a horizontal velocity. */
const E = (T, k) => (k > 1e-6 ? (1 - Math.exp(-k * T)) / k : T);

/**
 * A bank: the launch from `from` that hits the glass `h` above the rim
 * plane and whose carom drops through the rim centre. Nothing is tuned by
 * hand — it is the physics run backward:
 *
 *   before the glass   ballistic with drag, from `from` to the contact
 *   at the glass       normal velocity reversed × e (the Max restitution
 *                      rule makes e the ball's, 0.72); lateral and vertical
 *                      carried through
 *   after the glass    ballistic with drag from the contact, descending
 *                      through the rim plane at the rim centre
 *
 * The lateral axis is uniform motion the whole way, so it decouples. The
 * normal axis fixes the post-bounce time t from the pre-bounce time T1.
 * That leaves one equation — the carom's height reaching the rim plane
 * exactly at the centre — in one unknown, T1, solved by bisection. Tries
 * a few glass heights and skips any root whose rise would clip the near
 * iron. Returns null only if nothing works (then the caller falls back to
 * a soft drop).
 */
export function solveBank(from, hoop, opts = {}) {
  const k = opts.k ?? BALL.linearDamping;
  const e = opts.restitution ?? BALL.restitution;
  // Tangential velocity kept through the glass contact. Rapier's friction
  // brings a solid sphere to rolling, which costs 2/7 of the tangential
  // speed; measured in-game at 0.70-0.71 for both the lateral and vertical
  // components. Ignoring it left wide-angle caroms 30 % short and on the
  // near iron.
  const tau = opts.tangential ?? 5 / 7;
  const R = BALL.radius;
  const rim = hoop.rimCenter;
  const bn = hoop.getShootDir(); // board normal, toward the court
  const bs = new THREE.Vector3().crossVectors(bn, UP);
  const rel = new THREE.Vector3().subVectors(from, rim);
  const pBn = rel.dot(bn); // distance out from the rim centre, along the normal
  const pBs = rel.dot(bs); // lateral offset from the rim centre
  const pY = from.y - rim.y; // height above the rim plane (negative below it)
  const face = hoop.boardFrontOffset; // rim centre → glass face
  const cBn = -(face - R); // ball centre at contact, along the normal
  const travelIn = pBn - cBn; // how far the ball travels toward the glass
  if (travelIn < 0.15) return null; // already at the glass
  const a = -G;

  // Preferred kiss heights above the rim first; the taller ones are what a
  // low, close launch (a late tap after landing, a metre out) needs to arc
  // over the front iron. All are on the glass: the board runs to 0.945 m
  // above the rim.
  const heights = opts.heights || [0.30, 0.24, 0.36, 0.42, 0.18, 0.48, 0.55, 0.62, 0.70, 0.80];
  const halfW = HOOP.backboardWidth / 2 - R - 0.05; // contact must be on the glass
  for (const h of heights) {
    // Vertical after the glass, as a function of T1, at the moment the carom
    // has come back to the rim centre; we want it to be exactly zero.
    const evalAt = (T1) => {
      const E1 = E(T1, k);
      const vBn0 = travelIn / E1; // toward the glass, launch
      const vBnC = vBn0 * Math.exp(-k * T1); // at contact
      const ratio = (k * -cBn) / (e * vBnC); // carom must travel back |cBn| to the centre
      if (ratio >= 1) return null; // too slow to come back with drag
      const t = k > 1e-6 ? -Math.log(1 - ratio) / k : -cBn / (e * vBnC);
      const vY0 = a / k + (h - pY - (a / k) * T1) / E1;
      const vYC = tau * ((vY0 - a / k) * Math.exp(-k * T1) + a / k); // after the glass
      const yEnd = h + (a / k) * t + (vYC - a / k) * E(t, k);
      return { f: yEnd, T1, t, vBn0, vBnC, vY0, vYC, E1 };
    };
    // Scan for sign changes, then bisect each bracket; keep the first root
    // whose path clears the iron on the way in and on the way down.
    let prev = null;
    for (let T1 = 0.12; T1 <= 1.4; T1 += 0.02) {
      const cur = evalAt(T1);
      if (cur && prev && Math.sign(cur.f) !== Math.sign(prev.f)) {
        let lo = prev.T1;
        let hi = cur.T1;
        let flo = prev.f;
        for (let i = 0; i < 40; i++) {
          const mid = 0.5 * (lo + hi);
          const m = evalAt(mid);
          if (!m) break;
          if (Math.sign(m.f) === Math.sign(flo)) {
            lo = mid;
            flo = m.f;
          } else hi = mid;
        }
        const root = evalAt(0.5 * (lo + hi));
        if (root && Math.abs(root.f) < 0.01) {
          const vBs0 = -pBs / (root.E1 + tau * Math.exp(-k * root.T1) * E(root.t, k));
          const onGlass = Math.abs(pBs + vBs0 * root.E1) < halfW;
          const ok = onGlass && bankIsClean(root, { pBn, pBs, vBs0, pY, h, k, e, tau, a, R, cBn, travelIn });
          if (ok) {
            const launch = new THREE.Vector3()
              .addScaledVector(bn, -root.vBn0)
              .addScaledVector(bs, vBs0);
            launch.y = root.vY0;
            const contact = rim.clone().addScaledVector(bn, cBn).addScaledVector(bs, pBs + vBs0 * root.E1);
            contact.y = rim.y + h;
            launch.flightTime = root.T1 + root.t;
            return { launch, contact, h, T1: root.T1, t: root.t };
          }
        }
      }
      if (cur) prev = cur;
    }
  }
  return null;
}

/**
 * The ball's centre stays out of reach of the ring's tube the whole way — in
 * to the glass and back down to the centre — measured as a true distance to
 * the tube's centreline, so a ball passing beside the iron and above it is
 * fine while one skimming it is not. On the way in it also must not rise
 * through the hoop from below (a ball under the rim goes up through the
 * net), and the carom is coming down as it reaches the rim plane.
 */
function bankIsClean(root, g) {
  const reach = BALL.radius + HOOP.rimTube + 0.015; // tube centreline to ball centre, with a margin
  const N = 30;
  const near = (bn, bs, y) => {
    const d = Math.hypot(bn, bs);
    return Math.hypot(d - HOOP.rimRadius, y) < reach;
  };
  // In: from the launch point to the glass.
  for (let i = 1; i < N; i++) {
    const travel = (g.travelIn * i) / N;
    const ratio = (g.k * travel) / root.vBn0;
    if (ratio >= 1) return false;
    const tt = g.k > 1e-6 ? -Math.log(1 - ratio) / g.k : travel / root.vBn0;
    const bn = g.pBn - travel;
    const bs = g.pBs + g.vBs0 * E(tt, g.k);
    const y = g.pY + (g.a / g.k) * tt + (root.vY0 - g.a / g.k) * E(tt, g.k);
    if (near(bn, bs, y)) return false;
    if (Math.hypot(bn, bs) < HOOP.rimRadius && y < g.R) return false; // up through the hoop
  }
  // Out: the carom from the glass back to the rim centre.
  const vBnOut = g.e * root.vBnC; // away from the glass
  const vBsC = g.tau * g.vBs0 * Math.exp(-g.k * root.T1);
  const bsC = g.pBs + g.vBs0 * root.E1;
  for (let i = 1; i < N; i++) {
    const tt = (root.t * i) / N;
    const Et = E(tt, g.k);
    const bn = g.cBn + vBnOut * Et;
    const bs = bsC + vBsC * Et;
    const y = g.h + (g.a / g.k) * tt + (root.vYC - g.a / g.k) * Et;
    if (near(bn, bs, y)) return false;
  }
  const vYEnd = (root.vYC - g.a / g.k) * Math.exp(-g.k * root.t) + g.a / g.k;
  return vYEnd < -0.5;
}

/**
 * Launch velocity (world) that carries a ball from `from` to `to`, arriving
 * `entryDeg` below horizontal, under gravity and linear damping `k` (Rapier's
 * per-second linear damping coefficient). Returns null only if the geometry
 * is impossible (target below the launch with a negative entry angle).
 *
 * With damping v' = a − k v the position is closed-form:
 *   x(T) = x0 + vx0 · E,            E = (1 − e^{−kT}) / k
 *   y(T) = y0 + (a/k) T + (vy0 − a/k) · E
 * The flight time comes from the undamped entry-angle condition, which is
 * within a fraction of a degree of the damped one at these speeds.
 */
export function solveLaunch(from, to, entryDeg = SHOT.entryAngle, k = BALL.linearDamping, out = new THREE.Vector3()) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dy = to.y - from.y;
  const D = Math.hypot(dx, dz);
  const tanE = Math.tan(entryDeg * DEG);
  const T2 = (2 * (dy + D * tanE)) / G;
  if (T2 <= 1e-6) return null;
  const T = Math.sqrt(T2);
  const E = k > 1e-6 ? (1 - Math.exp(-k * T)) / k : T;
  const a = -G;
  const vh = D > 1e-6 ? D / E : 0;
  const vy = k > 1e-6 ? a / k + (dy - (a / k) * T) / E : (dy + 0.5 * G * T * T) / T;
  out.set(D > 1e-6 ? (vh * dx) / D : 0, vy, D > 1e-6 ? (vh * dz) / D : 0);
  out.flightTime = T;
  return out;
}

/**
 * The aim point and entry angle for a release in `zone`, shooting from
 * `from` at `hoop`. `err` is the signed timing error (negative = early).
 * Every zone is a deliberate, deterministic target: the physics then does
 * the rest (the back rim kicks the ball out, the glass carom drops it on
 * the near rim, the airball falls short of everything).
 */
export function aimFor(zone, err, hoop, from, kind = 'jumper') {
  const rim = hoop.rimCenter;
  const dir = new THREE.Vector3(rim.x - from.x, 0, rim.z - from.z);
  const dist = dir.length();
  if (dist < 1e-3) dir.set(0, 0, -1);
  else dir.divideScalar(dist);
  const side = new THREE.Vector3().crossVectors(dir, UP); // shooter's right
  const late = err > 0;
  const aim = rim.clone();
  let entry = SHOT.entryAngle;

  switch (zone) {
    case ZONE.GREEN:
      aim.addScaledVector(dir, SHOT.swishDepth);
      break;
    case ZONE.IRON:
      // The ball's centre crosses the rim plane just past the back tube, so
      // it meets the top of the back iron on the way down and pops out long.
      aim.addScaledVector(dir, HOOP.rimRadius + SHOT.ironDepth);
      break;
    case ZONE.GLASS: {
      // Hit the board above the square, off to one side, so the carom lands
      // on the rim and falls away. Aimed in board space so it holds from the
      // wing as well as from straight on. Early releases hit a touch lower.
      const bn = hoop.getShootDir(); // board normal, toward the court
      const bs = new THREE.Vector3().crossVectors(bn, UP);
      // Always the far side of the board from the shooter: the carom then
      // lands outside the far rim tube and kicks away. (On the near side it
      // drops back onto the iron and too often rattles in.)
      const shooterSide = Math.sign(bs.dot(new THREE.Vector3(from.x - rim.x, 0, from.z - rim.z))) || 1;
      aim.addScaledVector(bn, -(hoop.boardFrontOffset - BALL.radius));
      aim.addScaledVector(bs, -SHOT.glassSide * shooterSide);
      aim.y = rim.y + SHOT.glassHeight - (late ? 0 : 0.08);
      break;
    }
    case ZONE.FRONT:
      // A missed layup: short, onto the front iron, which kicks it away.
      aim.addScaledVector(dir, -(HOOP.rimRadius + SHOT.frontDepth));
      break;
    case ZONE.BANK: {
      // A made layup: off the glass and through. The launch is solved
      // outright; a soft drop is the fallback if no clean bank exists.
      const bank = solveBank(from, hoop);
      if (bank) return { aim: bank.contact, entry: 0, dir, side, dist, launch: bank.launch, bank };
      aim.addScaledVector(dir, SHOT.swishDepth);
      entry = entryFor(from, aim, entry, SHOT.layupMinApex);
      return { aim, entry, dir, side, dist };
    }
    case ZONE.AIR:
    default:
      aim.addScaledVector(dir, -(HOOP.rimRadius + SHOT.airShort));
      aim.y = rim.y - SHOT.airDrop;
      entry = late ? SHOT.entryAngleLate : SHOT.entryAngleEarly;
      break;
  }
  // Close to the basket a fixed entry angle gives a low, flat arc that
  // cannot clear the front iron, so each outcome asks for a minimum apex
  // above the rim instead: a swish must rise well above the rim and drop
  // in steeply; a back-iron miss comes in flat so the kick carries it back
  // out over the front.
  if (zone === ZONE.GREEN) entry = entryFor(from, aim, entry, kind === 'layup' ? SHOT.layupMinApex : SHOT.minApexSwish);
  else if (zone === ZONE.IRON) entry = entryFor(from, aim, entry, SHOT.minApexIron);
  else if (zone === ZONE.GLASS) entry = entryFor(from, aim, entry, 0.12);
  else if (zone === ZONE.FRONT) entry = entryFor(from, aim, entry, 0.3);
  return { aim, entry, dir, side, dist };
}

/**
 * The entry angle (degrees) that reaches `to` from `from` with the natural
 * `entryDeg` arc, unless that arc would peak less than `minApex` above the
 * target — then the angle of the arc that peaks exactly `minApex` above it.
 */
export function entryFor(from, to, entryDeg, minApex) {
  const D = Math.hypot(to.x - from.x, to.z - from.z);
  const dy = to.y - from.y;
  const tanE = Math.tan(entryDeg * DEG);
  const T2 = (2 * (dy + D * tanE)) / G;
  if (T2 > 1e-6) {
    const vx = D / Math.sqrt(T2);
    const h = (vx * tanE) ** 2 / (2 * G);
    if (h >= minApex) return entryDeg;
  }
  const tUp = Math.sqrt((2 * Math.max(0.01, dy + minApex)) / G);
  const tDown = Math.sqrt((2 * minApex) / G);
  const vx = D / (tUp + tDown);
  const vyE = Math.sqrt(2 * G * minApex);
  return Math.atan2(vyE, Math.max(vx, 1e-4)) / DEG;
}

/**
 * Tracks a shot after release: rim / board / court contacts (fed in from the
 * physics contact events) and the two-stage make detector. A make is
 * *pending* when the ball descends through the rim plane inside the hoop,
 * *confirmed* once it is clearly below, and cancelled if it pops back up.
 * Resolves to one of: swish, made, iron, glass, air, miss.
 */
export class ShotTracker {
  constructor(hoop, zone, meta = {}) {
    this.hoop = hoop;
    this.zone = zone;
    this.meta = meta;
    this.rimHits = 0;
    this.boardHits = 0;
    this.courtHits = 0;
    this.pending = false;
    this.clean = true; // untouched by rim or board so far
    this.made = false;
    this.result = null;
    this.timer = 0;
    this.prevY = null;
    this.rimPlaneOffset = null; // where the centre crossed the rim plane (for tests)
  }

  contact(tag) {
    if (this.result) return;
    if (tag === 'rim') {
      this.rimHits++;
      if (!this.made) this.clean = false;
    } else if (tag === 'backboard') {
      this.boardHits++;
      if (!this.made) this.clean = false;
    } else if (tag === 'court') {
      this.courtHits++;
    }
  }

  /** Returns the result string once the shot is decided, else null. */
  update(dt, pos, vel) {
    if (this.result) return this.result;
    this.timer += dt;
    const rim = this.hoop.rimCenter;
    const horiz = Math.hypot(pos.x - rim.x, pos.z - rim.z);

    if (!this.made) {
      if (this.prevY !== null && !this.pending && this.prevY > rim.y && pos.y <= rim.y && horiz < HOOP.rimRadius * 0.92 && vel.y < 0) {
        this.pending = true;
        const s = (this.prevY - rim.y) / Math.max(1e-6, this.prevY - pos.y);
        this.rimPlaneOffset = horiz * (1 - s) + (this._prevHoriz ?? horiz) * s;
      }
      if (this.pending) {
        if (pos.y > rim.y + 0.05) this.pending = false; // rattled back out
        else if (pos.y < rim.y - 0.16 && horiz < HOOP.rimRadius + BALL.radius) {
          this.made = true;
          this.result = this.clean ? 'swish' : 'made';
        }
      }
    }
    this.prevY = pos.y;
    this._prevHoriz = horiz;
    if (this.result) return this.result;

    // A miss is certain once the ball is on its way down, well below the
    // rim and outside the hoop (or inside it without ever having crossed the
    // plane from above), or once it has touched the court, or after a long
    // time. Never before the apex: a low, early release starts below the rim.
    const descending = vel.y < 0;
    const lowOutside = descending && pos.y < rim.y - 0.3 && (horiz > HOOP.rimRadius + BALL.radius || !this.pending);
    if (this.courtHits > 0 || lowOutside || this.timer > 8) {
      if (this.boardHits > 0) this.result = 'glass';
      else if (this.rimHits > 0) this.result = this.zone === ZONE.FRONT ? 'front' : 'iron';
      else this.result = 'air';
    }
    return this.result;
  }
}

export const RESULT_LABEL = {
  swish: 'SWISH',
  made: 'BUCKET',
  iron: 'BACK IRON',
  front: 'FRONT RIM',
  glass: 'OFF THE GLASS',
  air: 'AIRBALL',
  miss: 'MISS',
};

/** Yaw that faces a world point from another (the frame's yaw convention). */
export function yawToward(from, to) {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

export { clamp };
