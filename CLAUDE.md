# Home Court — working notes

Read this before changing anything. It is the handoff document between
sessions: what exists, what must not break, and what comes next.

## What this project is

A first-person basketball game (Three.js + Rapier, plain Vite, no framework),
built **one system at a time to a high standard** rather than all at once.
The owner's rule for the project: master the thing you are on before adding
the next thing.

- **Stage 1 — the handle. Done.** Open outdoor court, VR-style hands (no arms,
  no legs), a real basketball, and a dribble engine.
- **Stage 2 — shooting. Not started.** See *Next stage* below.

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
node scripts/capture.mjs all   # contact sheets of every move → screenshots/
node scripts/capture.mjs poses # the rigged hand in each pose, close up
```

`smoke.mjs` and `capture.mjs` both need `npm run preview` serving on :4173.
There is no GPU here; both run headless Chromium with SwiftShader, and
`capture.mjs` is how you review animation without being able to play it.

## Invariants — the smoke test enforces these

A change that breaks one of these is wrong even if it looks fine:

1. The ball never dips below the court surface.
2. Ball velocity is continuous across every catch and release (no snapping).
   Measured in the handle frame so running does not count as a discontinuity.
3. The carrying palm stays within ~2 cm of the ball surface while carrying.
4. Every move hands off to the intended hand and returns to a pound rhythm.
5. Buffered moves chain; drop and re-gather works.
6. Nothing goes non-finite.

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
- `Game._update(dt)` is public so tests can pump the loop deterministically.
- `window.__game`, `window.__THREE`, `window.__POSES` are exposed for the
  capture and smoke harnesses.

## Hosting and the pointer-lock situation

- The published single-file page is at
  https://claude.ai/code/artifact/384fc635-8bc4-4a67-9d6e-aeea111aeb34 —
  it runs in a sandboxed frame that **refuses pointer lock**. Nothing in the
  page can change that. There is an edge-turn fallback for it: push the hidden
  cursor toward a frame edge to keep turning.
- The real fix is a full page. `.github/workflows/pages.yml` deploys to GitHub
  Pages, but **only the repo's default branch is allowed to deploy** by the
  `github-pages` environment.
- The single-file build inlines the hand GLB as a data URI. Strict CSP hosts
  refuse `fetch()` on `data:` URLs, so `HandAsset.js` base64-decodes it
  directly. **Do not reintroduce a fetch there.**

## Branches

The repo's default branch is currently `claude/adoring-noether-9rslwx`, which
holds the **old** pre-dribble park game at `bb515cf`. All current work is on
`claude/basketball-dribbling-game-bhij3v`, and `main` now points at the same
head. Setting `main` as the repo default fixes both the Pages deploy and
fresh-session checkouts. If you start a session and the code looks like a park
with grass and trees and a shot meter, you are on the wrong branch.

## Next stage: shooting

Nothing is built yet. What is already in place to build on:

- `solveArc()` in `src/core/MathUtils.js` — ballistic launch solver, currently
  unused, kept for this.
- `src/world/Hoop.js` — regulation rim built as a ring of sphere colliders so
  the ball can drop through and rattle, plus backboard and pole colliders.
- `src/world/Net.js` — verlet net that swishes when the ball passes.
- `DribbleController` owns possession. Shooting is a **new state alongside
  `CONTACT`/`FLIGHT`**, entered from `HOLD` or from a gather out of a dribble.

Reference, do not paste back: commit `bb515cf` has a complete older shooting
system in `src/ball/Shot.js` and `src/ball/BallController.js` — timing-based
gather → set → release graded green/yellow/orange/red, layups, dunks, and a
two-stage make detector (pending when the ball descends through the rim plane
inside the hoop, confirmed once clearly below, cancelled if it pops back up).
That make detector is sound and worth reusing conceptually. The rest was built
on the old dribble model and will not fit the current one.

**The hard part** is the gather: dribble → two hands → up into the shot must
be continuous in position and velocity like every other transition. That is
the invariant most likely to be broken by a naive port.

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
