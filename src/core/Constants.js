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
  // Drag while the ball is in the net. A net catches nearly all of the
  // ball's forward motion and a little of its fall, so a made shot drops
  // out under the rim instead of carrying on past it.
  netDragHorizontal: 22.0,
  netDragVertical: 3.5,
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
  jumpSpeed: 4.2, // the plain jump (Space by default)
  gravity: -18.0,
  stepHeight: 0.35,
  shotDecel: 10.0, // feet slow at this rate through a jumper (m/s²)
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

// ---------------------------------------------------------------------------
// Shooting. The jumper is a fixed timeline (2K style): the meter starts when
// the shot is triggered and the release quality is how close the button-up
// lands to `releaseTime`. Outcome zones are deterministic — a green release
// always swishes, a slightly-off one always catches back iron, and so on.
// ---------------------------------------------------------------------------
export const SHOT = {
  // Timeline, seconds from the trigger.
  setTime: 0.24, // the ball reaches the set point (beside the eyes)
  releaseTime: 0.62, // the ideal release — centre of the green window
  meterTime: 0.84, // the meter is full; still holding here releases late
  overhold: 0.12, // after the ideal point the ball travels this long before it stalls in the hand
  jumpSpeed: 3.4, // the shot hop, timed so its apex lands on releaseTime
  // Timing windows, |error| in seconds from the ideal release.
  green: 0.03, // swish
  iron: 0.075, // back iron and out
  glass: 0.135, // off the backboard and out; beyond this is an airball
  // Arc.
  entryAngle: 47, // degrees below horizontal as the ball reaches the rim
  minApexSwish: 0.45, // close in, a swish must still peak this far above the rim
  minApexIron: 0.24, // ...and a back-iron miss comes in flat, peaking only this high
  entryAngleEarly: 36, // a flat, short airball
  entryAngleLate: 58, // a high, short airball
  backspin: 14, // rad/s
  // Where the ball goes, handle frame metres (x right, y up from the feet,
  // z forward). Right-handed shooter: the ball sets beside the right eye.
  setPoint: [0.16, 1.58, 0.36],
  loadPoint: [0.14, 1.78, 0.30],
  extension: 0.50, // the arm extends this far along the launch direction
  flickLength: 0.30, // the wrist snap that carries the release
  loadSpeed: 1.2, // ball speed leaving the load point (m/s)
  followThrough: 0.55, // seconds the shooting hand holds the gooseneck
  // Aim offsets by outcome, metres (see Shot.js aimFor).
  swishDepth: 0.02,
  ironDepth: 0.03, // ball centre passes this far beyond the back rim tube
  glassHeight: 0.62, // backboard hit this far above the rim plane
  glassSide: 0.27, // and this far across, to the far side from the shooter
  airShort: 0.45, // airballs fall this far short of the front rim
  airDrop: 0.18, // and this far below rim height

  // Layups: inside `layupRange` of the rim the shoot button is a layup — a
  // quicker, one-handed drive to the rim with a forgiving window. Uncontested
  // (there is nothing to contest yet) it goes in whenever the release is
  // within `layupWindow`; a contested one (a hook for later) only inside
  // `layupContestedWindow`. Misses catch the front iron.
  layupRange: 2.6,
  layupSetTime: 0.18,
  layupReleaseTime: 0.52,
  layupMeterTime: 0.72,
  layupJumpSpeed: 3.8,
  layupWindow: 0.09,
  layupContestedWindow: 0.03,
  layupPoint: [0.24, 1.30, 0.38], // gathered at the right hip
  layupCarry: [0.26, 1.95, 0.44], // carried up beside the head, in view
  layupExtension: 0.42,
  layupMinApex: 0.35, // the soft drop peaks this far above the rim
  layupDecel: 6.0, // a layup keeps a step of momentum, not a sprint's worth
  frontDepth: 0.04, // a missed layup's centre falls this short of the front tube
};

// Rapier interaction groups: 16-bit membership | 16-bit filter.
export const GROUP = {
  WORLD: 0x0001,
  BALL: 0x0002,
  PLAYER: 0x0004,
};
