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
- **Stage 2 — shooting. Built, played once by the owner, first feedback
  applied.** A 2K-style jumper with a timing meter, deterministic outcomes
  by zone, layups inside 2.6 m, a physics net that drops a made ball under
  the rim, a synthesised swish, a plain jump, and rebindable controls. See
  *Shooting* below. The owner's first-play notes were: a jump key that
  feels right while moving, layups, and the ball not running away after a
  make — all done; the sounds and the meter speed still have no verdict.
- **Stage 3 — not chosen.** Candidates under *Next*.

## Leave the repo ready for the next session

The owner works in short chats, roughly one per feature, tweak or bug. A
session that ends without updating the repo strands the next one. So before
you finish **any** piece of work, however small:

0. **Hand the owner a local run terminal with every update, and never merge
   to `main` without their go-ahead.** They test locally first; `main` is
   what publishes. A standing instruction from the owner, not a nicety.

   **Never put a `#` comment in a block the owner will paste.** They are on
   macOS, whose zsh does *not* strip `#` comments at an interactive prompt
   (`INTERACTIVE_COMMENTS` is off by default). A line like
   `git clone <url>   # first time only` sends git five arguments and fails
   with "Too many arguments", and then every following line fails too
   because the clone never happened. This actually happened; it cost the
   owner a round trip. Put the explanation in prose outside the block, and
   keep the block pure commands, one per line — no `#` anywhere, not even
   on its own line.

   Give two blocks, first-run and update, with this session's branch name
   filled in:

   ```bash
   cd ~
   git clone https://github.com/timmascara/knox-game-idea.git
   cd knox-game-idea
   git checkout <this session's branch>
   npm install
   npm run dev
   ```

   ```bash
   cd ~/knox-game-idea
   git fetch origin
   git checkout <this session's branch>
   git pull
   npm install
   npm run dev
   ```

   Only merge to `main` when they say so.
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
npm run dev
npm run build && npm run preview
npm run test:smoke
node scripts/capture.mjs all
node scripts/capture.mjs poses
node scripts/capture.mjs shoot shothands flight net meter
ZONE=green node scripts/shots.mjs
ZONE=iron ERRS=0.04,-0.04 SPOTS='[[0,6.5]]' PARAMS='{"ironDepth":0.05}' node scripts/shots.mjs
```

In order: install; the dev server; the production build served on :4173;
the headless test (run it before every push); contact sheets of every move
and the jumper into `screenshots/`; the rigged hand in each pose, close up;
just the shooting captures; the shot lab over a whole timing zone; and the
shot lab with overrides.

No `#` comments in these blocks on purpose — macOS zsh passes them through
as arguments, which breaks the command (see rule 0 above).

Sound files go in `src/assets/audio/` and are picked up automatically; see
that folder's README and the Audio section below.

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

**Catching.** Looking at a ball within 2.3 m (the look ray passing within
~0.4 m of its centre) catches it whatever it is doing — off the iron,
rolling, in the air, up to 10 m/s (`_lookCatch`); the gather absorbs the
velocity. Walking into a slow ball still works without looking; the pick
up key reaches 2.3 m / 8 m/s. The owner's ask: "pick it up whenever my
cursor looks at it" — before this, a rebound coming back off the rim
could not be caught.

**Hands and the hop.** The handle frame's floor stays put through a hop
so a *dribble's* bounce path does not lift. Everything else rides the
body: while holding (or gathering) the frame follows the feet, so the held
ball rises with you; the free hands' rest / guard / follow-through targets
add `bodyLift` (feet minus frame floor). Before this the hands and a held
ball stayed at floor height when you jumped and visibly detached.

**Input.** Every action goes through the binding map (`src/core/Bindings.js`,
stored in Settings, edited in the pause menu's Controls panel; game code
asks `input.down('shoot')` / `pressedAction('jump')`, never a key). Defaults
(the owner's choice, second play-test): **shoot = K, jump = J**, crossover
= left mouse, between = right mouse, behind Q, in&out F, hesitation R, low
C, pick up E, drop G, sprint Shift. WASD, Tab and Esc are reserved.
`BINDINGS_VERSION` in `Bindings.js` is bumped when the defaults change, and
Settings then replaces a saved layout with the new one — the owner's
browser had the old defaults persisted. Hold K to start a jumper (from the
hold or straight out of a live dribble, whichever hand), let go to release.
A tap releases immediately (an airball, as in 2K). Movement input locks for
the duration but the feet keep momentum — a jumper decelerates at
`PLAYER.shotDecel` (10 m/s²) — and the body squares up to the basket on
its own while the head stays free (the handle frame's yaw is driven by the
hoop direction during a shot, not the camera). The plain jump
(`PLAYER.jumpSpeed`) works any time the body is not mid-shot; jumping while
dribbling leaves the bounce path on the floor, by the handle frame's design.

**Layups are J then K.** Inside `SHOT.layupRange` (2.6 m) of the rim,
the jump key with the ball is the takeoff (`tryLayupTakeoff`, asked by the
game before it does a plain hop): the feet leave the floor on that tick at
`layupJumpSpeed` (5.0 → ~0.7 m, 0.55 s in the air), momentum carries the
body at the rim (no deceleration: it is airborne from t = 0), the ball
sweeps from wherever it was — hip, or mid-bounce — up the shooting side to
`layupCarry` beside the head in **one continuous motion** (no set point;
the first cut paused at a chest-high gather and the ball rushed there and
stalled, a visible stutter that also tripped the velocity invariant), then
a short extension (`layupExtension`, 0.30) at the rim, one hand, palm up,
and the camera leans into the drive. A *tap* of the shoot key while airborne releases. The
release point is `layupReleaseAfterApex` (0.08 s) past the top of the jump
(`layupTiming()` in `Shot.js` derives the clock from the jump speed); a
tap *before* that is held (`shot.armed`) and the ball leaves at that point,
a tap after leaves at once — so J then K in any quick succession always
releases up at the rim with the full animation. **Uncontested, every tap
while airborne goes in** (`layupWindow` is 9 s, i.e. the whole airtime):
the owner's call, "jump with J, click K once, make it every time". The
meter and timing flash are not shown for an uncontested layup — there is
nothing to time. Contested (`contested` hook) narrows the window to
`layupContestedWindow` and brings the meter back. No tap before the feet
land → `_landWithBall`: the ball gathers back into the hold, no shot.

**The takeoff paces the drive** (`layupStandoff` 1.2 m, `layupLunge`
2.5 m/s): at J the body's horizontal velocity is set toward the rim so the
feet *land* 1.2 m from it wherever the takeoff was — a sprint slows, a
standing start hops forward. The ball is carried ~0.75 m ahead of the
feet, so every release, early or late on the way down, happens about half
a metre from the rim. Two lessons here: pacing to reach the standoff *at
the release* left late taps under the rim (the body kept drifting), and a
0.8 m standoff did the same because of the carry. Before any of this, a
sprinting drive covered the whole 2.3 m before the tap and released from
under the rim, where the soft drop goes up through the net and off the
glass: the owner saw a bank on every layup. Taking off *inside* the
standoff, the takeoff steps back to it instead (`layupFade`, up to 1.5
m/s — a fade-away) and the ball is carried overhead rather than out front
(`load.z` shrinks toward 0.18 as the takeoff nears 0.5 m from the rim);
without both, a takeoff beside the rim still had the ball under it. Lab:
48/48 from twelve spots, right beside the rim to 2.5 m out, at taps from
0.3 s early to 0.19 s late; smoke: J-then-K at once, at the top, late,
from a sprint, and no tap (lands holding the ball). The shoot key near
the rim on the ground is *also* a takeoff (so K, K works) rather than a
no-timing auto-layup, which would have made the window meaningless. The
first build had the layup as hold-and-release on the shoot key with the
hop timed inside it; the owner found they were already back on the floor
by the release and asked for J-then-K.

"Contested" in the owner's spec means a defender at the rim; there are no
defenders, so the hook is `DribbleController.contested` (tightens the
window to `layupContestedWindow`) and nothing sets it yet.

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
needs (`aimFor`), so a bad release is still a continuous hand motion. The
body's contribution is the *measured* frame velocity (`frameVel`), not the
feet's: the handle frame trails the feet, and while they decelerate the two
differ by enough to show in the continuity stat. At
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
the ball touches becomes drag on the ball (`Basketball.applyNetDrag`),
strongly anisotropic (`BALL.netDragHorizontal` 22 /s vs `netDragVertical`
3.5 /s): a net catches nearly all of the ball's forward motion and only a
little of its fall, so a made shot drops out under the rim, bounces and
settles there instead of carrying on downcourt (the owner's first
complaint; the smoke test now checks the ball rests within 1.5 m of the
rim after a swish). The same contact drives the swish sound from
`Game._update` (physical: any ball through the net sounds, a rattled make
included).

**Audio: the synths are placeholders and the owner knows it.** They have
heard them and called them not great, and plan a day of uploading recorded
assets. So the pipeline is built and verified: **any file dropped into
`src/assets/audio/` named after a sound plays instead of that synth**, with
no code change — `swish.wav`, `rim.wav`, plus `rim-2.wav`/`rim-3.wav` as
extra takes picked at random (never the same twice running).
`src/audio/Samples.js` globs the folder at build time and lists the
recognised names; `AudioManager._playSample` is the first line of each sfx
method and bails out to the synth when there is no file.
`src/assets/audio/README.md` is written for the owner — the naming table,
the several-takes trick, where the per-sound gain lives. Unrecognised
filenames are ignored and warned about in the console.

Verified end to end in headless Chromium with generated test WAVs: files
decode, sampled sounds take the sample path, unsampled ones fall through,
takes never repeat back to back. The test files were deleted afterwards —
do not commit placeholder audio, an empty folder is the correct state.

Do not spend time re-tuning the synths; they are being replaced. Spend it
on the loader if anything about an upload does not work. The synth versions
(swish = white noise through a sweeping bandpass over a lower whoosh with
cord snaps; rim = an inharmonic partial set over a thud; glass = a board
thump with a ring) stay as the fallback so the game is never silent.

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

## Next: second play-test, then decide stage 3

The owner has played the jumper once; layups, the jump key, rebinding, and
the ball settling under the rim came out of that and have only been
verified headless. Still wanting a verdict from real play:

- The new defaults (right-mouse shoot, Space jump) — or whatever the owner
  rebinds them to.
- The layup: the window (`SHOT.layupWindow`, 0.09 s) and how it reads from
  the eyes (`node scripts/capture.mjs layup`).

**Contested shooting is the owner's next real want, and it is the bridge to
multiplayer** — their stated end goal for the game. The ask, in their
words: how contested a shot was should affect whether it goes in *even on a
perfect release*. Design notes before anyone builds it:

- This does **not** require randomness, and should not introduce any. A
  contest value (0 = wide open, 1 = hand in the face) can shift the *aim
  point* continuously — a contested green drifts off centre by an amount
  that grows with the contest — so the outcome stays a deterministic
  function of (timing, contest, geometry). That keeps the existing
  decision intact and, more importantly, keeps it replayable across a
  network: same inputs, same result on every client, which is what a
  multiplayer build needs. A `Math.random()` in the shot would have to
  become a seeded, replicated PRNG later; not adding it is cheaper.
- The hook already exists: `DribbleController.contested` (a bool today,
  should become 0..1), consumed by `zoneForLayup` and `meterSpec`. It is
  read but never set, because there is nothing to be contested *by*.
- So the real prerequisite is **defenders** — even one dummy defender with
  a position and a reach is enough to compute a contest value (distance to
  the shooter, whether they are between the shooter and the rim, how high
  their hand is at the release instant).

Candidates for stage 3, in the order that serves the end goal: defenders
(unlocks contested, and is the thing multiplayer needs anyway); dunks (the
layup machinery is the base — a dunk is a layup whose release point is
above the rim and whose "launch" is a slam); or a rebound/chase loop.
`solveArc()` in `MathUtils.js` is still unused. Reference commit `bb515cf`
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
  When contested shooting arrives it must stay deterministic too — contest
  shifts the aim, it does not roll dice (see *Next*). The game is headed
  for multiplayer, where a deterministic shot is worth a great deal.
- **The meter timing is LOCKED.** `SHOT.releaseTime` 0.62 s, `meterTime`
  0.84 s, `green` ±0.03 s. The owner played it and called it perfect —
  "I missed enough and made enough, so it's fair". Do not retune these,
  and do not let a later change to the shot timeline shift them by
  accident. Anything that changes how long the jumper takes changes the
  difficulty the owner signed off on.
- **The synthesised sounds are placeholders awaiting recorded assets.** Drop
  files in `src/assets/audio/`; see the Audio section. Do not polish the
  synths.
- **Controls are rebindable; defaults are shoot = K, jump = J** (the
  owner's own choice after two play-tests; between-the-legs went back to
  right mouse). Nothing reads physical keys except WASD and the menu. Bump
  `BINDINGS_VERSION` when defaults change so saved layouts migrate.
- **Layups are J (takeoff) then a K tap (release), never a hold, and
  uncontested they always go in.** Owner's calls: "by then I'm already on
  the ground" and "jump with J, click K once, make it every time". Timing
  pressure on a layup only arrives with defenders (the `contested` hook).
- **Looking at a nearby ball catches it.** Speed does not matter (below 10
  m/s); the gather absorbs it.
- **Always right-handed.** The shot gathers into the right hand whichever
  hand was dribbling.
- **The body squares up to the basket during a shot** while the head stays
  free. Turning the camera for the player would be nauseating; letting the
  ball follow a turned head would make every shot miss.
- **The shot arc keeps a fixed entry angle (47°), not a fixed apex.**
