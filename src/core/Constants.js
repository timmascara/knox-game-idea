/**
 * Central tuning + dimensional constants for Home Court (dribble lab).
 *
 * All units are metres / seconds / radians unless noted. Court and hoop
 * dimensions follow FIBA/NBA regulation values so proportions read as a real
 * outdoor court rather than a toy.
 */

// ---------------------------------------------------------------------------
// World / physics
// ---------------------------------------------------------------------------
export const GRAVITY = -9.81;

// ---------------------------------------------------------------------------
// Court (full court, regulation-ish). Long axis is Z, width is X, centred at
// the origin.
// ---------------------------------------------------------------------------
export const COURT = {
  length: 28.0, // along Z
  width: 15.0, // along X
  apron: 2.2, // extra asphalt beyond the boundary lines
  lineWidth: 0.05,
  threePointRadius: 6.75,
  threePointStraight: 0.9,
  keyWidth: 4.9,
  freeThrowFromBaseline: 5.8,
  freeThrowCircleRadius: 1.8,
  centerCircleRadius: 1.8,
  restrictedRadius: 1.25,
  rimFromBaseline: 1.575,
};

export const HOOP = {
  rimHeight: 3.05,
  rimRadius: 0.2286,
  rimTube: 0.018,
  backboardWidth: 1.8,
  backboardHeight: 1.05,
  backboardThickness: 0.05,
  netLength: 0.45,
  poleRadius: 0.09,
};

// Size-7 basketball.
export const BALL = {
  radius: 0.121,
  mass: 0.62,
  restitution: 0.72, // free-ball restitution against the court (Rapier)
  friction: 0.75,
  linearDamping: 0.03,
  angularDamping: 0.28,
  rollDecay: 1.6,
};

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
export const PLAYER = {
  height: 1.80,
  eyeHeight: 1.64,
  radius: 0.34,
  walkSpeed: 2.6,
  runSpeed: 4.2,
  sprintSpeed: 6.4,
  accel: 30.0,
  deaccel: 38.0,
  airAccel: 8.0,
  jumpSpeed: 4.6,
  gravity: -18.0,
  stepHeight: 0.35,
};

// ---------------------------------------------------------------------------
// Dribble / ball handling. These are the live-tunable "feel" numbers; the
// tuning panel (Tab) writes straight into this object.
// ---------------------------------------------------------------------------
export const DRIBBLE = {
  // Bounce physics used by the dribble solver. `restitution` is the vertical
  // energy kept by the ball on the court; `horizontalKeep` is how much of the
  // horizontal velocity survives the bounce (the rest becomes spin/friction).
  restitution: 0.80,
  horizontalKeep: 0.92,
  // The hand meets the ball while it is still rising by roughly this speed.
  catchRiseSpeed: 0.9,

  // Where the ball lives relative to the body (metres; body frame).
  // forward = +ahead of the feet, side = +toward the dribbling hand.
  forward: 0.62,
  side: 0.32,
  catchHeight: 0.98, // hip-high pound dribble
  releaseDrop: 0.10, // the hand pushes the ball this far below the catch
  absorb: 0.06, // the ball rides up this far in the hand before the push

  // Low / protect dribble (hold C).
  lowCatchHeight: 0.60,

  // Speed dribble: the ball is pushed out ahead as you run.
  speedLead: 0.10, // extra forward metres per m/s of body speed
  speedLeadMax: 0.55,
  speedHeightGain: 0.06, // slightly higher pound while moving fast

  // Handle frame: how fast the dribble anchor follows the feet / body yaw.
  followLambda: 14,
  yawLambda: 8,

  // Contact (ball-in-hand) durations by move, seconds.
  contactPound: 0.15,
  contactCross: 0.17,
  contactBetween: 0.18,
  contactBehind: 0.30,
  contactInOut: 0.26,
  contactHesi: 0.42,

  // Body sway (camera) magnitudes while a move plays.
  swayLateral: 0.075,
  swayVertical: 0.045,
  swayRoll: 0.035,
};

// Rapier interaction groups: 16-bit membership | 16-bit filter.
export const GROUP = {
  WORLD: 0x0001,
  BALL: 0x0002,
  PLAYER: 0x0004,
};
