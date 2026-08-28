/**
 * Central tuning + dimensional constants for Home Court.
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
// Court (full court, regulation-ish). Long axis is Z, width is X.
// A regulation court is 28.65m x 15.24m. We centre it at the origin.
// ---------------------------------------------------------------------------
export const COURT = {
  length: 28.0, // along Z
  width: 15.0, // along X
  lineWidth: 0.05,
  threePointRadius: 6.75, // arc radius from basket
  threePointStraight: 0.9, // distance of straight sections from sideline
  keyWidth: 4.9, // the paint width (along X)
  freeThrowFromBaseline: 5.8, // free-throw line distance from baseline
  freeThrowCircleRadius: 1.8,
  centerCircleRadius: 1.8,
  restrictedRadius: 1.25,
  rimFromBaseline: 1.575, // basket centre distance from baseline
};

// Basket / hoop
export const HOOP = {
  rimHeight: 3.05,
  rimRadius: 0.2286, // inner radius ~0.4572 diameter
  rimTube: 0.018,
  backboardWidth: 1.8,
  backboardHeight: 1.05,
  backboardThickness: 0.05,
  backboardBottomFromRim: 0.15, // rim sits this far below top... computed in Hoop
  netLength: 0.45,
  poleRadius: 0.09,
};

// Basketball
export const BALL = {
  radius: 0.121, // ~0.242 diameter (size 7)
  mass: 0.62,
  restitution: 0.62,
  friction: 0.75,
  linearDamping: 0.03, // near-zero air drag so shot arcs land true
  angularDamping: 0.28,
  rollDecay: 1.6, // extra rolling resistance applied on the ground per second
};

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
export const PLAYER = {
  height: 1.78,
  eyeHeight: 1.66,
  radius: 0.34,
  walkSpeed: 3.0,
  runSpeed: 4.7,
  sprintSpeed: 7.0,
  accel: 34.0,
  deaccel: 42.0,
  airAccel: 8.0,
  jumpSpeed: 4.9,
  gravity: -18.0, // player feels a slightly snappier gravity than the ball
  stepHeight: 0.35,
};

// ---------------------------------------------------------------------------
// Dribble / ball handling
// ---------------------------------------------------------------------------
export const DRIBBLE = {
  // Height the ball rises to at the top of a bounce (waist/hip high).
  handHeight: 1.02,
  // How far in front of the body the handling position sits. Pushed out enough
  // that the ball is clearly framed in your lower view while dribbling instead
  // of hugging your feet off the bottom of the screen.
  forward: 0.92,
  // Lateral offset for the left/right hand (kept fairly centred so the ball
  // reads in front of you, not tucked into a corner).
  side: 0.22,
  baseBounceHz: 2.05, // stationary dribble tempo
  sprintBounceHz: 3.05,
  floorClearance: 0.121, // ball radius, so it kisses the floor
  // How fast the ball's horizontal position follows the body (weighty, not
  // instant). Lower = looser/heavier handle.
  followLambda: 16,
  // How fast the dribble's facing follows the camera yaw. This decouples the
  // ball from mouse-look so glancing around never whips the ball about you.
  yawLambda: 9,
  // Extra forward push per m/s of movement speed (drive the ball ahead of you).
  speedForward: 0.06,
  speedForwardMax: 0.5,
  holdHeight: 1.06, // where the ball is palmed while airborne (chest-ish)
};

// ---------------------------------------------------------------------------
// Shooting
// ---------------------------------------------------------------------------
export const SHOT = {
  gatherTime: 0.28, // gather -> set
  setToReleaseTime: 0.34, // set -> ideal release point
  // Timing windows (seconds of error from the ideal release moment).
  green: 0.05,
  yellow: 0.11,
  orange: 0.18,
  red: 0.28,
  // Arc apex bias — higher = rainbow. Blended by distance. A tall apex gives a
  // steep entry angle, which is what makes a clean shot drop through the rim.
  minApex: 1.7,
  maxApex: 3.3,
  layupRange: 2.6, // within this of the rim, shooting produces a layup
  dunkRange: 1.7,
  dunkMinSpeed: 4.2,
};

// Grades returned by the shot grader.
export const GRADE = {
  GREEN: 'green',
  YELLOW: 'yellow',
  ORANGE: 'orange',
  RED: 'red',
  EXTREME: 'extreme',
};

// Rendering / collision groups (Rapier interaction groups: 16-bit membership,
// 16-bit filter). Kept simple: everything collides with everything except a
// couple of special cases.
export const GROUP = {
  WORLD: 0x0001,
  BALL: 0x0002,
  PLAYER: 0x0004,
};
