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
npm run assets                 # assets_raw/<name>/ → src/assets/<name>.glb
```

`smoke.mjs` and `capture.mjs` both need `npm run preview` serving on :4173.
There is no GPU here; both run headless Chromium with SwiftShader, and
`capture.mjs` is how you review animation without being able to play it.

## Bringing in art — the asset pipeline

The owner is **not an artist**: the models are packs downloaded from the
internet, arriving as loose files (a `.fbx`/`.obj` mesh, a `.mtl` sidecar, a
folder of textures, sometimes animations in their own files). Do not send them
Blender instructions — they do not use it and do not want to.

The flow is: they push the raw download into `assets_raw/<model_name>/`, and
`npm run assets` turns each folder into one self-contained
`src/assets/<model_name>.glb`. See `assets_raw/README.md` for the rules that
matter (keep the download's folder structure, include the `.mtl`, one model
per folder). Two stages, because neither tool does the whole job:

1. **assimp** reads the source format and writes glTF. It leaves textures as
   *external file references* — the output is not self-contained.
2. **gltf-transform** resolves those references, re-encodes the textures to
   WebP, Draco-compresses the geometry and embeds everything into one binary.

Measured on the real hand asset through this pipeline: **1.72 MB → 101.9 KB,
94% smaller**, textures embedded.

**Tooling notes that cost time to find:**

- `assimp` is **not preinstalled** in the sandbox. `apt-get install
  assimp-utils` 404s until you run `apt-get update` first. Neither Blender nor
  trimesh is available; assimp is the only thing here that reads `.fbx`.
- `gltf-transform` comes from `npx --yes @gltf-transform/cli@latest` and works
  offline of any install step.
- **The interim glTF must be written beside its own source.** assimp emits
  texture references relative to the file it writes, so staging it in a temp
  directory breaks every texture link and the optimize step fails with a bare
  non-zero exit. This was a real bug in the first version of the script.
- Toy inputs get *bigger* through the pipeline (fixed Draco/WebP/JSON
  overhead). Only judge the ratio on real assets.

**Not solved: animations shipped in separate files** (the Mixamo pattern —
mesh in one file, each clip in its own). The script converts the mesh file and
ignores the rest. Merging clips onto one skeleton needs the rigs to match and
is fragile. Nobody has tried it here yet.

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

## The owner's actual goal: a park, not a bare court

Recorded 2026-09-19 after the owner pushed back on a session that had claimed
the visuals were fine. **They are not.** Rendered from the current build at
eye level, the game is a grey slab, a flat khaki band, three flat hills and a
stick with a rectangle on it. It is a greybox.

What the owner wants: **a park basketball court — trees, grass, birds
chirping, kids playing in the distance.** They have not raised it before now
only because the handle had to come first.

Do not repeat this session's mistake of arguing that the world is
"procedural, therefore fine". The court, hoop and ball being generated in code
is a sound decision; the world being *empty* is the problem, and no material
or lighting pass fixes an empty world. Note also that the court is a
full NBA two-hoop layout, which is the wrong court for a park.

Infrastructure that does **not** exist yet and is needed before any of this
lands (all verified absent by grep):

- **No `LoadingManager`.** One hardcoded GLB import is the entire asset system.
- **No `InstancedMesh`.** Trees and grass cannot be placed as individual meshes.
- **No `LOD` or `Sprite`.** Nothing for distant kids as billboard imposters.
- **No environment map** anywhere — `scene.environment` is never set, so every
  `MeshStandardMaterial` is running PBR with no IBL. Cheap, large win.
- **Audio is 100% synthesized oscillators** (`AudioManager.js`), with no file
  loading at all. Bird and park ambience need a sample loader that does not
  exist.

Budget for the whole park, over GitHub Pages: **8–12 MB** of assets is
realistic and enough. The JS bundle is already 5.3 MB (2.0 MB gzipped). Note
`assetsInlineLimit` is 4 MB in `vite.config.js` — at park scale the single-file
artifact build stops being viable and the Pages build becomes the only target.

**Open question for the owner:** whether the park comes before or after
shooting. They have not said, and the sequencing is theirs to choose.

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
