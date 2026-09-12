# Home Court — working notes

Read this before changing anything. It is the handoff document between
sessions: what exists, what must not break, and what comes next.

## What this project is

A first-person basketball game (Three.js + Rapier, plain Vite, no framework),
built **one system at a time to a high standard** rather than all at once.
The owner's rule for the project: master the thing you are on before adding
the next thing.

- **Stage 1 — the handle. Done and verified in real play.** Open outdoor
  court, VR-style hands (no arms, no legs), a real basketball, and a dribble
  engine. Deployed, mouse capture confirmed working by the owner.
- **Stage 2 — shooting. Built and verified headless; not yet played by the
  owner.** A 2K-style jumper with a timing meter, deterministic outcomes by
  zone, a physics net and a synthesised swish. See *Shooting* below. Needs a
  real-play pass on feel: meter speed, how the hands look through the
  release, the sounds.
- **Stage 3 — not chosen.** Layups/dunks under the rim are the obvious next
  thing (see the close-range gap under *Shooting*).

## Leave the repo ready for the next session

The owner works in short chats, roughly one per feature, tweak or bug. A
session that ends without updating the repo strands the next one. So before
you finish **any** piece of work, however small:

1. Commit and push. Never leave work sitting only in the working tree.
2. Update this file. Change *Where we are* if the stage moved, *Next stage* if
   you learned something that changes the plan, and *Decisions already made*
   if you made a call worth not re-litigating.
3. Write down anything that surprised you — a constraint you hit, a dead end
   worth not repeating, a host or tool that behaves oddly. That is the part a
   fresh session cannot rediscover cheaply.
4. Run `npm run test:smoke` and see it pass before the final push.

Treat this file as the project's memory. It is the only thing a new session
reads automatically, so if it is not written here it did not happen.

## Run it

```bash
npm install
npm run dev                    # dev server
npm run build && npm run preview   # production build on :4173
npm run test:smoke             # headless test — run this before every push
node scripts/capture.mjs all   # contact sheets of every move + the jumper → screenshots/
node scripts/capture.mjs poses # the rigged hand in each pose, close up
node scripts/capture.mjs shoot shothands flight net meter   # just the shooting captures
ZONE=green node scripts/shots.mjs          # shot lab: fire a zone from many spots, report outcomes
ZONE=iron ERRS=0.04,-0.04 SPOTS='[[0,6.5]]' PARAMS='{"ironDepth":0.05}' node scripts/shots.mjs
```

`smoke.mjs`, `capture.mjs` and `shots.mjs` all need `npm run preview`
serving on :4173. There is no GPU here; all run headless Chromium with
SwiftShader, and `capture.mjs` is how you review animation without being
able to play it. `shots.mjs` is how you tune an outcome: it releases at the
requested timing errors from each spot and prints the zone the game graded,
the physical result, rim/board hit counts and the release continuity, and
`PARAMS` writes into the live `SHOT` constants so an aim offset can be swept
without rebuilding. Note its timing is quantised to the 120 Hz tick, so a
requested error right at a zone boundary can grade as the neighbour — read
the `zone` column, not the `err` you asked for.

## Invariants — the smoke test enforces these

A change that breaks one of these is wrong even if it looks fine:

1. The ball never dips below the court surface.
2. Ball velocity is continuous across every catch and release (no snapping).
   Measured in the handle frame so running does not count as a discontinuity.
   This includes the whole jumper: gather → set → rise → flick, and the
   launch itself (`stats.maxReleaseJump`, the gap between what the hand was
   doing at the release instant and the velocity the ball was given, must
   stay under 0.5 m/s; it is ~0.15).
3. The carrying palm stays within ~2 cm of the ball surface while carrying,
   and the shooting palm through the shot.
4. Every move hands off to the intended hand and returns to a pound rhythm.
5. Buffered moves chain; drop and re-gather works.
6. A green release swishes (from the hold and from a moving pull-up); a
   late release goes off the glass, a slightly late one catches back iron, a
   very early one airballs. Deterministic — no randomness anywhere in the shot.
7. Nothing goes non-finite.

## The dribble engine — concepts you need before editing it

**Handle frame.** All dribble planning happens in a body-relative space that
trails the feet and the look direction with a little lag: `x` right, `y` up
from the ground, `z` forward. This is why looking around does not whip the
ball about you, and why the ball has weight. `DribbleController._updateFrame`
owns it. Its origin only moves vertically when grounded, so a hop does not
lift the bounce path.

**The cycle.** A dribble is two alternating segments, both in `BounceMath.js`:

- `Contact` — ball in hand. A piecewise cubic Hermite path through waypoints.
  Endpoint velocities are the neighbouring flights' velocities, which is what
  makes the whole cycle continuous.
- `Flight` — ball out of hand. A real ballistic solve: the release velocity is
  *derived* from where the hand wants the ball back and how high. Drop, floor
  bounce with restitution and horizontal loss, rise into the catch still
  moving up. **Cadence is not a tuning number** — it falls out of this.

**Moves are cycle plans.** `Moves.js` is a library where each move returns one
cycle: waypoints for the carry, which hand receives the next catch, sway
keyframes, contact duration. Adding a move is adding one entry there plus a
key binding in `DribbleController._handleInput`. Do not add move logic to the
controller.

**Hands are choreographed around the cycle, in world space.** They are not
parented to the camera — they belong to the body, so turning your head never
drags them. The carrying palm tracks the ball exactly; the free hand follows
it down then rises ahead to meet it; a hand receiving a crossover moves early
to hover over the arrival point rather than chasing.

## Shooting — how it works

Read `src/ball/Shot.js` (pure maths) and the SHOOTING section of
`DribbleController` (the states) before touching it. Every feel number is
in `SHOT` in `Constants.js`; the Tab panel has a SHOT TUNING section.

**Input.** Hold Space to start the jumper (from the hold or straight out of a
live dribble, whichever hand), release Space to let go. Hesitation moved to
R to free Space. A tap releases immediately (an airball, as in 2K). Movement
locks for the duration; the body squares up to the basket on its own while
the head stays free (the handle frame's yaw is driven by the hoop direction
during a shot, not the camera).

**The timeline is fixed** (`SHOT.releaseTime` = 0.62 s is the green centre,
the meter fills to `meterTime` = 0.84 s and auto-releases there). The whole
jumper is one `Contact` path in the handle frame: current ball state →
set point beside the right eye → load point above the forehead → release
point = load + `extension` along the launch direction, whose end velocity
*is* the world launch velocity that swishes (minus the body's velocity, so a
pull-up compensates for momentum). The extension is a constant-acceleration
segment so its duration follows from its length and the launch speed. The
hop (`jumpSpeed`) is timed so its apex lands on the ideal release. Beyond
the ideal point the ball travels `overhold` further and stalls in the hand.

**Button-up → zone → flick → launch.** The timing error grades into a zone
(`zoneFor`: green ≤ 0.03 s, iron ≤ 0.075, glass ≤ 0.135, else air). The
ball is wherever it is on the path; a short "flick" `Contact` replans from
that position and velocity to the launch velocity that zone's aim point
needs (`aimFor`), so a bad release is still a continuous hand motion. At
the flick's end the launch is re-solved from the ball's actual world
position and the ball goes free with backspin. If the flick ends part-way
through a tick, both position *and* velocity are advanced by the remainder
— forgetting the velocity gave the ball a phantom +g·dt upward kick that
cost an afternoon and only showed up as "green shots 8 cm long".

**The arc solver** (`solveLaunch`) is closed-form and includes Rapier's
linear damping; it lands within ~5 mm at the rim. Arcs are defined by the
entry angle at the rim (47°), not an apex, which keeps the shape the same
from every distance. Close to the basket a fixed entry angle cannot clear
the front iron, so `entryFor` swaps to a minimum-apex rule (`minApexSwish`,
`minApexIron`).

**Outcomes are aim points, physics does the rest.** Swish: rim centre + 2 cm.
Back iron: the ball's centre crosses the rim plane `ironDepth` past the back
tube, so it meets the top of the back iron and pops out long. Glass: the
board `glassHeight` above the rim, `glassSide` across on the *far* side from
the shooter (the near side too often banks in), early releases a touch
lower. Airball: `airShort` short of the front rim and `airDrop` below it,
flat when early, floaty when late. `scripts/shots.mjs` verified these from
16+ spots across the court (deep threes, corners, the far hoop) at the
edges of every zone: green 100%, glass 100%, air 100%, iron ~97%.

**Known gap: inside ~0.8 m of the rim** a slightly-off release can hit the
back iron and still fall in, and from directly under the rim nothing is
guaranteed. That is layup territory; a jumper from there is the wrong
animation anyway.

**After release** `ShotTracker` (in `Shot.js`) watches the ball: rim / board
/ court contacts come from the physics contact events via
`DribbleController.onBallContact`, and the make detector is the two-stage
one from the old game (pending on descending through the rim plane inside
the hoop, confirmed clearly below, cancelled if it pops back up). Its miss
rule must never fire before the apex — an early release starts below the
rim. Results: swish, made, iron, glass, air. The HUD flashes the timing
("SLIGHTLY LATE") on button-up and the result when it is decided.

**The net** (`Net.js`) is a verlet cloth rendered as instanced cord
cylinders and knots (no more 1 px lines): 12 loops, diamond weave, hanging
loops on the rim, full 3D sphere push-out so a ball pushes the cords apart
and drags the net down, then it whips back and swings. The number of nodes
the ball touches becomes drag on the ball (`Basketball.applyNetDrag`) — a
real net slows the ball and that is much of why a swish reads as a swish —
and drives the swish sound from `Game._update` (physical: any ball through
the net sounds, a rattled make included).

**Audio** is still fully synthesised. The swish is white noise through a
sweeping bandpass (cord brush) over a lower whoosh (the net body) with a few
cord snaps; rim is an inharmonic partial set over a thud, velocity-scaled;
glass is a board thump with a short ring. None of it has been heard by a
human yet — the sandbox has no audio — so treat the mix as a first draft.

## The hands

`src/assets/hand_right.glb` is a **third-party sculpt supplied by the owner**
(check its licence before shipping commercially). It arrived unrigged.
`scripts/rig_hand.py` rigs it from geometry alone — traces fingers through
cross-sections, places joints by arc length on an anatomical knuckle arc,
finds the thumb lobe, skins with a per-joint blend, and writes a skinned GLB
whose joint frames put -Z down the bone and +Y toward the back of the hand.

Re-rig with `python3 scripts/rig_hand.py <hand.obj> src/assets/hand_right.glb`
(needs numpy). The source OBJ is not in the repo; ask the owner for it.

The left hand is the right hand mirrored in X. Poses are four scalars
(per-finger curl, spread, thumb curl, thumb abduction) applied *on top of* the
sculpt's own relaxed bind pose, so `curl: 0` is relaxed and negative
straightens.

**Known gap:** the mesh has no skin texture — flat colour plus roughness.

## Conventions

- **Every feel number lives in `DRIBBLE` in `src/core/Constants.js`.** The Tab
  tuning panel writes straight into that object at runtime. When something
  feels right in the panel, write it back into Constants — panel values are
  not persisted.
- Fixed 120 Hz simulation step (`Game.fixedDt`) so timing is identical at any
  frame rate. Edge-triggered input applies only to the first sub-step.
  **The Rapier world's timestep is set to match** (`Physics.setTimestep`).
  It defaulted to 1/60 while being stepped 120×/s, so every free ball used
  to run at double speed; the dribble never noticed because it is the
  controller's own maths. Do not remove that call.
- `Game._update(dt)` is public so tests can pump the loop deterministically.
- `window.__game`, `window.__THREE`, `window.__POSES`, `window.__CONST`
  (`{ SHOT, DRIBBLE }`, live) are exposed for the capture, smoke and shot-lab
  harnesses.
- **Rapier integrates positions exactly** (velocity-Verlet-like, so
  x = x₀ + v₀t + ½at² with no ½·a·dt·t drift); a continuous-time solver
  matches it. Do not add a "symplectic correction" — that was tried and it
  made things worse.
- **Hoop geometry:** the glass is `rimRadius + 0.15` behind the rim centre
  (regulation). It used to be 0.15 from the *centre*, which put the back of
  the rim inside the board and made centred shots brush the glass on the way
  down. The rim collider is now 40 overlapping spheres so the iron feels
  like a smooth ring.

## Hosting and the pointer-lock situation

- The published single-file page is at
  https://claude.ai/code/artifact/384fc635-8bc4-4a67-9d6e-aeea111aeb34 —
  it runs in a sandboxed frame that **refuses pointer lock**. Nothing in the
  page can change that. There is an edge-turn fallback for it: push the hidden
  cursor toward a frame edge to keep turning.
- **Play here: https://timmascara.github.io/knox-game-idea/** — published by
  `.github/workflows/pages.yml` on every push to `main`. A full page, so
  pointer lock works; the owner has confirmed mouse capture behaves there.
  **This is the canonical link.** Send people here, not to the artifact.
- Note the deploy only fires on push to `main`. A session that pushes only to
  a feature branch will not publish anything.
- This sandbox's proxy blocks `github.io` (CONNECT 403), so you cannot curl
  the live site from a session. Confirm a deploy landed via the API instead:
  `/repos/<owner>/<repo>/deployments?environment=github-pages` and read the
  latest deployment's status — `state: success` plus an `environment_url`
  means it published.
- **Pages gotcha, cost three failed runs to diagnose.** The `github-pages`
  *environment* has a deployment-branch rule that is separate from, and
  overrides, the workflow's `on: push: branches:` trigger. When it rejects a
  ref the `build` job succeeds and the `deploy` job fails **in about one
  second having run no steps at all** — no logs, no annotations worth
  reading. That signature means an environment rejection, not a build
  problem, so do not go debugging the build. Fix it at Settings →
  Environments → github-pages → Deployment branches.
- The workflow deploys from `main` only. Do not add a second triggering
  branch: the shared `concurrency: pages` group means a second push cancels
  main's in-flight deploy.
- The single-file build inlines the hand GLB as a data URI. Strict CSP hosts
  refuse `fetch()` on `data:` URLs, so `HandAsset.js` base64-decodes it
  directly. **Do not reintroduce a fetch there.**

## Branches

**`main` is the default branch and the one to work from.** Start new sessions
there.

`claude/adoring-noether-9rslwx` still holds the **old** pre-dribble park game
at `bb515cf`, kept only as reference for the shooting stage. If you open a
session and the code looks like a park with grass, trees and a shot meter,
you are on the wrong branch.

## Next: play it, then decide stage 3

The shooting stage has only been verified headless. The first thing the
next session should do is get the owner's read on real play:

- Meter speed and the size of the green window (`SHOT.green`, 0.03 s).
- Whether the hands read well through the release from the eyes — the mesh
  has no forearm, so the wrist cut is visible at the follow-through.
- The sounds: nobody has heard the swish / rim / glass synths yet.
- Whether the shot should also be triggerable by mouse.

Candidates for stage 3: layups and dunks (the close-range gap above), or a
rebound/chase loop so a miss is not a dead end. `solveArc()` in
`MathUtils.js` is still unused and available. Reference commit `bb515cf`
still has the old layup/dunk code (built on the old dribble model; do not
paste it back).

## Decisions already made — do not silently reverse

- **Shooting, layups, dunks, the park, weather and the scoreboard were deleted
  on purpose** to keep stage 1 about the handle. They are in git history at
  `bb515cf`. Removing them was deliberate, not an oversight.
- **No spin move.** A first-person spin with no body is nauseating; it needs a
  camera treatment of its own before it is worth adding.
- **Hands live in world space, not parented to the camera.** This is the whole
  reason the ball reads as attached to a body.
- **The ball's texture is generated per texel from real seam geometry** (an
  equator, a meridian, two side circles at 55°), not drawn by eye.
- Cadence emerges from the bounce physics. Do not add a "bounce speed" knob.
- **Shot outcomes are deterministic by timing zone.** No randomness in the
  aim: a green is always a swish, iron is always back iron and out, and so
  on, exactly as the owner specified. Do not add "realistic" random misses.
- **Space is the shot button; hesitation moved to R.** The jump shot is a
  hold-and-release, and Space reads as "jump".
- **Always right-handed.** The shot gathers into the right hand whichever
  hand was dribbling.
- **The body squares up to the basket during a shot** while the head stays
  free. Turning the camera for the player would be nauseating; letting the
  ball follow a turned head would make every shot miss.
- **The shot arc keeps a fixed entry angle (47°), not a fixed apex.**
