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
  by zone, layups inside 2.6 m that go in off the glass, a physics net that drops a made ball under
  the rim, a synthesised swish, a plain jump, and rebindable controls. See
  *Shooting* below. The owner's first-play notes were: a jump key that
  feels right while moving, layups, and the ball not running away after a
  make — all done; the sounds and the meter speed still have no verdict.
- **Stage 3 — the park. Second cut; the owner has seen it, not played it.**
  Trees, rough grass, a chain-link fence, benches, a weathered asphalt court
  and image-based lighting. See *The park* below. Still to come: ambience
  audio, distant people, leaf scatter.

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
ZONE=bank ERRS=-0.3,0,0.15,0.19 SPOTS='[[0.5,11.8],[0.3,12.1],[-0.9,11.9],[0.7,12.4],[-0.4,11.7],[0,10.8],[1.5,11.5],[0,9.9],[-2,11.2],[2.2,12.3],[0,10.0],[1.7,10.6]]' node scripts/shots.mjs
ZONE=bank ERRS=0.15 SPOTS='[[0,10.8]]' TRACE=1 node scripts/shots.mjs
node scripts/restitution.mjs
npm run assets
npm run assets:preview -- tree
```

In order: install; the dev server; the production build served on :4173;
the headless test (run it before every push); contact sheets of every move
and the jumper into `screenshots/`; the rigged hand in each pose, close up;
just the shooting captures; the shot lab over a whole timing zone; the
shot lab with overrides; the layup bank lab over the twelve takeoff spots
it is verified from; and a traced run — `TRACE=1` prints the ball's
position, velocity and net contacts every other tick for each failing row
(`TRACE=all` for every row), which is how the sub-step restitution bug was
found. A spot inside layup range is always a layup, whatever `ZONE` says,
and is graded as a bank. Then the Rapier bounce regression check (see
*Conventions*); the asset pipeline, `assets_raw/<name>/` → 
`src/assets/<name>.glb`; and a screenshot of one converted asset on its own
(see *Bringing in art*).

No `#` comments in these blocks on purpose — macOS zsh passes them through
as arguments, which breaks the command (see rule 0 above).

Sound files go in `src/assets/audio/` and are picked up automatically; see
that folder's README and the Audio section below.

`smoke.mjs`, `capture.mjs`, `shots.mjs` and `restitution.mjs` all need `npm run preview`
serving on :4173. There is no GPU here; all run headless Chromium with
SwiftShader, and `capture.mjs` is how you review animation without being
able to play it. `shots.mjs` is how you tune an outcome: it releases at the
requested timing errors from each spot and prints the zone the game graded,
the physical result, rim/board hit counts and the release continuity, and
`PARAMS` writes into the live `SHOT` constants so an aim offset can be swept
without rebuilding. Note its timing is quantised to the 120 Hz tick, so a
requested error right at a zone boundary can grade as the neighbour — read
the `zone` column, not the `err` you asked for.

## Bringing in art — the asset pipeline

The owner is **not an artist**: the models are packs downloaded from the
internet. Do not send them Blender instructions — they do not use it and do
not want to. They also cannot upload large files through chat, so the route
is: they push the raw download to GitHub, a session converts it here. Give
them a named list of files to upload, not a process to follow.

They drop a download into `assets_raw/<model_name>/` and `npm run assets`
produces one self-contained `src/assets/<model_name>.glb`. Five stages, each
earned by a failure hit converting the first tree — see
`assets_raw/README.md`:

0. **unpack** `.zip`/`.7z` sitting beside the mesh
1. **`scripts/prep_textures.py`** — normalise what glTF cannot express
2. **`assimp`** — source format → glTF
3. **`scripts/fix_materials.mjs`** — restore what assimp's writer drops
4. **`gltf-transform`** — WebP textures, Draco geometry, one binary

**Stages 1 and 3 are not optional polish.** Without them a conversion
*succeeds* and renders wrong:

- glTF permits PNG/JPEG only; packs ship `.tif` and 16-bit height maps.
- OBJ keeps cut-out alpha in its own file (`map_d`); glTF wants it in the
  albedo's alpha. Unfixed, **every leaf is a solid rectangle**.
- Download sites rewrite spaces in filenames, so `mtllib tree lowpoly.mtl`
  arrives as `tree+lowpoly.mtl` and the mesh silently loses all materials.
- Packs wire up normal/roughness and leave `map_Kd` out, giving a flat grey
  trunk next to a perfectly good bark texture.
- assimp drops `alphaMode`, `doubleSided`, normalTexture and
  metallicRoughnessTexture whatever the `.mtl` said. glTF also packs
  roughness in a metallicRoughness texture's **G channel**, so a loose
  greyscale roughness map has to be rechannelled, not attached.

**Always render before believing a conversion.** `npm run assets:preview --
<name>` (needs `npm run dev -- --port 5180`) writes
`screenshots/asset_<name>_*.png` and prints world bounds. Size reduction says
nothing about whether it looks right. It also catches the scale surprise:
**packs are modelled at any scale, and a file called "tree" is often a
grove** — the first one converted here is nine trees spanning 46 m.

Measured end to end on the first real pack: **24.5 MB → 1.06 MB, 96%
smaller**, textures embedded, leaves masking correctly.

**Tooling notes that cost time to find:**

- `assimp` and `7z` are **not preinstalled**. `apt-get install assimp-utils
  p7zip-full` 404s until `apt-get update` runs first. No Blender, no trimesh;
  assimp is the only thing here that reads `.fbx`.
- **The interim glTF must be written beside its own source.** assimp emits
  texture paths relative to the file it writes, so staging it in a temp
  directory breaks every link and optimize fails with a bare non-zero exit.
- **Repair materials before compression, not after.** Reading a Draco+WebP
  GLB back needs extensions registered and a decoder; the uncompressed
  interim needs neither.
- `fix_materials.mjs` writes its result as `.glb` so the external buffers and
  loose PNGs assimp left behind get cleaned up in one go.
- Toy inputs get *bigger* through the pipeline (fixed Draco/WebP/JSON
  overhead). Only judge the ratio on real assets.
- Extracted textures are gitignored (`assets_raw/**/*.png` etc). The archive
  is the committed artifact; everything else regenerates.

**Converted so far** (each verified by preview, not by size):

| asset | source | out | notes |
|---|---|---|---|
| `tree.glb` | obj + .7z textures | 1.06 MB | **nine trees in one file**, 46 m span; needs splitting to instance |
| `grass.glb` | fbx, textures never shipped | 80 KB | modelled blades, two clumps 1.9 m; `meta.json` scale 0.01 + heightTint |
| `assets_raw/leaf_decals/` | zip | — | leaf/petal cut-out textures, not a model; for scatter quads |

**Pack quality is the real bottleneck, not the pipeline.** Three downloads,
three surprises: the tree was nine trees, the grass shipped with no
textures (FBX paths into the author's `C:\Users`), the "pavement" pack was
leaf decals with no pavement. Expect every pack to need looking at.
**Still missing for the park: a tiling ground/grass surface and an asphalt
court surface.** Poly Haven (CC0, complete sets) is the obvious source and
is **blocked from this sandbox** (`api.polyhaven.com` CONNECT refused), so
the owner has to download those; 1K JPG zips are a few MB each. If they
would rather not, both generate acceptably from noise — the court less well
than the grass.

**Not solved:** animations in separate files (the Mixamo pattern) are not
merged, and nothing splits a multi-object file into separately placeable
models — which the tree pack needs before it can be instanced around a park.

## The park — how it is built

`src/core/Assets.js` loads everything the park needs up front
(`loadParkAssets`, run in parallel with the hands during boot) and hands it
to `Game` → `World` → `Park`. `World` still builds without it, as the old
greybox, which is what any harness constructing a `World` directly gets.

- **`src/world/Park.js`** places trees and grass by a seeded scatter
  (`mulberry32(7)`, so every load is the same park) and instances them:
  one `InstancedMesh` per primitive per variant, the node's own transform
  folded into each instance matrix (that is what stands the Z-up grass
  upright). Trees get a fixed Rapier cylinder for the trunk so the player
  and the ball stop at them; grass has no collider. 34 trees in a ring
  12–42 m out, 220 grass clumps in a band hugging the apron. ~2.1 M
  triangles, ~95 draw calls.
- **Ground** is the 400 m plane with the Poly Haven "leafy grass" set tiled
  every 3.2 m. That texture is a dry, leaf-strewn lawn, average colour tan,
  so the material carries a green `color` multiplier (`0x8fbe6a`). A
  genuinely green texture dropped into `assets_raw/ground/` would make the
  tint unnecessary.
- **Court** (`Court.js`): the markings canvas is painted over a tiled
  asphalt photo (`createPattern`, one tile per 2.6 m), with the court and
  apron tints laid on at partial alpha so the grain shows. The asphalt's
  normal and roughness maps go on the slab through a **second UV set**
  (`uv1`, `texture.channel = 1`) because the markings need the whole slab
  to be one untiled UV space and three.js allows one transform per UV
  channel.
- **Environment light** (`World.buildEnvironment`): the gradient sky dome is
  rendered through `PMREMGenerator` into `scene.environment` at intensity
  0.55, over a ground-coloured floor so the lower hemisphere is not blue.
  Zero assets. Must run after the renderer exists — `Game` calls it right
  after constructing the world, not inside `_initRenderer`, which runs
  first (that ordering bug was the one boot failure this cut had).
- **Draco decoder** lives in `public/draco/` (wasm + wrapper, ~250 KB) and
  is served as files; `DRACOLoader.setDecoderPath(BASE_URL + 'draco/')`.
  WebP textures need nothing — `GLTFLoader` handles `EXT_texture_webp`.
- **`vite.config.js` inlines only the hand GLB now** (`assetsInlineLimit`
  is a function). Park models and textures are fetched as files, ~3 MB
  total. The single-file artifact build therefore no longer carries the
  park; the Pages build is the target, as recorded below.

**Splitting fused packs** (`scripts/split_objects.mjs`, `meta.json`
`"splitObjects": true`): connected components over the triangle graph,
ground-touching components of ≥ 40 triangles are trunk seeds (a leaf card
brushing the grass is two triangles and must not seed a tree), seeds within
1.5 m merge, everything else joins the nearest seed in the ground plane,
and each cluster becomes a node `tree_<i>` rebased to its footprint. Two
lessons: OBJ `l` elements arrive as LINES primitives and poison the
triangle walk unless skipped; and `gltf-transform optimize` **joins nodes
by default** (`--no-join` now), which is what had fused the pack into two
meshes in the first place. Result on the tree pack: **7 placeable trees**,
not 9 — two pairs of saplings share a ground patch and come out as a pair.
Acceptable; not worth more time.

### What the owner's first look found — all four were real

1. **Trees standing on the court.** `Park._instance` folded the variant
   node's *whole* world matrix into each instance. Those nodes come from
   `split_objects.mjs` and still carry where each tree stood in the original
   46 m grove, so every tree was displaced by up to 27 m from where it was
   placed. **Fold in rotation and scale only** (`.setPosition(0,0,0)` on the
   local matrix) — the rotation still matters, it is what stands the Z-up
   grass upright.
2. **"The court lines are terrible."** They were: the three-point *arc* was
   not drawn at all. `ctx.arc` was called with the endpoints swapped, so it
   swept the short way and produced two stubs by the baseline and nothing
   else. Canvas angles run clockwise because +Z maps down the canvas, so the
   basket at +Z needs `anticlockwise = true` and the one at −Z `false`.
3. **"The grass is in clumps."** The pack's clump is ~1.9 m across; at the
   old 0.6–1.15 scale each was a 1–2 m shrub with bald ground between. Now
   0.16–0.46, in overlapping drifts.
4. **"Everything is white."** Only in the published artifact, never locally
   — see *Models carry their textures as separate files* below.

Also fixed: the court is weathered (cracks, patches, chipped paint) instead
of looking like a televised court dropped in a field, and the pro-only
restricted-area arc and rim tick are gone. A chain-link fence with a
walk-through gap each side, plus benches, is what actually made it read as
a park rather than "here are some trees around your court".

### Models carry their textures as separate files, not embedded

`npm run assets` writes `public/models/<name>/model.gltf` with its textures
as sibling `.webp` files. **Do not go back to a single self-contained
`.glb`.** An embedded texture has to reach the browser as a `blob:` URL, and
strict-CSP hosts — the published artifact frame among them — refuse images
from `blob:`. The model still loads, every material comes through untextured
white and cut-out foliage becomes solid shards. That is exactly what the
owner saw, and it is invisible here: headless Chromium has no such policy,
so **a screenshot from this sandbox cannot catch it**. Separate files are
ordinary same-origin requests and always work.

`public/` is deliberate: Vite copies it verbatim, so the `.gltf`'s relative
texture URIs still resolve. Only `hand_right.glb` is still inlined, because
the single-file page needs it.

### Publishing to the artifact: `npm run artifact`

The artifact host serves a fixed extension list that excludes `.glb`,
`.gltf` and `.bin`. `scripts/prep_artifact.mjs` stages `dist/` into
`.artifact/`, renaming `.gltf`→`.json` and `.bin`/`.glb`→`.wasm` and
rewriting every reference (GLTFLoader sniffs content, not extension;
`application/wasm` is binary-safe). It also drops the 7 MB sourcemap. Run
`npm run build && npm run artifact` and publish `.artifact/index.html` with
the printed file map.

### What makes it read as a park — THE thing, got wrong three times

The owner said the same thing three times and three passes missed it:
*"you can still see it as an open world... in the concept art everywhere you
looked it was a neighborhood."*

**The test is occlusion, not decoration.** Standing on the court and looking
in any direction, if the ground plane runs away to a horizon, the scene reads
as open country — and no amount of furniture scattered on it changes that.
The three failed passes all added *things* (fence, benches, lamps, houses at
60–112 m) while leaving every sightline open. Houses that far away and 3–6 m
tall are a strip of dots under an empty sky; the eye goes straight past them
to the horizon behind.

What works is a **close, tall, continuous ring you cannot see past**:

- Three rings of buildings, fronts at ~30 m / ~50 m / ~78 m, **7–15 m tall**
  (two and three storeys, not bungalows), walked round the perimeter in even
  angular steps so each row is continuous.
- Front rows use `wFrac` under 1, leaving **alleys between the houses** —
  that is what makes a street read as separate buildings rather than a wall.
  The **back row is deliberately continuous** (`wFrac` over 1) as the
  backstop that closes the sightlines those alleys open.
- Buildings face the park. Heights alternate short/tall along each row so the
  skyline is jagged. Houses (under 8.5 m) get a ridge roof, blocks get a flat
  roof with a parapet.
- Wall colours must be **varied and fairly saturated**. The first attempt used
  muted beiges and the sky's blue-green bounce flattened them all into one
  grey-green wall.
- The tree belt was pulled in to sit *between* the fence and the houses
  rather than sprawling past them.

**`Park.verifyEnclosure()` measures it** — 1,800 rays from five points on the
court at eye height, and every one must hit a building. It is not decoration:
adding the alleys took it from 0 escapes to 9, which is how the need for the
continuous back row was found. **Re-run it after touching any of this.**

Other dead ends, do not repeat:
- Flat green planes as a "far treeline" behind the houses: reads as a
  cardboard wall with the houses pasted on it.
- A 4-sided `ConeGeometry` roof sized off `max(w,d) * 0.78`. Its base square
  has *diagonal* 2r, so the roof came out half again as wide as its house
  and left pale triangles jutting over the grass. Radius is `d / sqrt2`.
- A footpath placed 28 m out running parallel to the court, connected to
  nothing: foreshortens into a pale triangle. It now runs out of the gate.

Also in: street lamps, leaf litter (260 instanced quads from the decal pack,
`scripts/prep_decals.py` merges each set's separate alpha into RGBA WebP), a
bin, and a warmer lower sun with `toneMappingExposure` 1.18 because ACES
pulls the midtones into mud.

**Still not the reference:** that photograph is golden hour; this is a mild
late afternoon. The owner has not chosen. Knobs are in `World._buildLights`
and `Game._initRenderer`.

### Performance

The owner reported the build going "SUPER LAGGY" — while on 3% battery,
which puts a Mac in Low Power Mode and throttles the GPU hard, so that is
the likely cause rather than the scene. Treat it as unconfirmed until they
run it on mains power. **Do not let that excuse a sloppy scene**, though;
two real faults were found looking into it:

- `frustumCulled = false` was set on every scattered InstancedMesh. Nothing
  could ever be culled, including from the **shadow pass**, which re-renders
  every caster every frame.
- Every tree cast shadows, at any distance. Trees now only cast within 30 m
  (`SHADOW_RANGE` in `_placeTrees`) — beyond that the shadow lands where no
  one can see it and is pure cost.

Current: **1.53 M triangles, ~149 draw calls.** If it needs to go lower, the
next levers in order are the grass count, the shadow map size (2048), and
chunking the scatter spatially so culling can actually reject cells.

### Triangle budget — the harness is the canary

`scripts/smoke.mjs` renders through SwiftShader with no GPU, so a scene the
owner's machine would shrug at can blow its 30 s screenshot timeout. That is
a **useful** signal, not a nuisance: it caught the grass clump shipping at
**14,880 triangles** for something rendered a few centimetres tall — 900 of
them was 6.7 M triangles, 92% of the whole scene, and 7.3 M total stalled
the harness outright.

`meta.json` now takes `simplify` (a target triangle ratio) and
`simplifyError`, passed through to gltf-transform. The grass at `0.08` came
down to 1,193 triangles with no visible loss at the size it renders, which
bought the density that fixed "it's all so bare": **56 trees and 1,500 grass
tufts at 1.56 M triangles and 110 draw calls** — less than a quarter of the
first cut's cost, several times its density. Check any new pack's triangles
per instance before scattering it.

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
while airborne goes in, off the glass** (`layupWindow` is 9 s, i.e. the
whole airtime): the owner's calls, "jump with J, click K once, make it
every time" and "nobody scores layups as a swish, it's always a bank off
the backboard" — the first build dropped them softly through the net and
the owner rejected it, so a made layup is a bank, never a swish, and the
HUD calls it LAYUP. The meter and timing flash are not shown for an
uncontested layup — there is nothing to time. Contested (`contested`
hook) narrows the window to `layupContestedWindow` and brings the meter
back. No tap before the feet land → `_landWithBall`: the ball gathers back
into the hold, no shot.

**The bank is an exact carom solve** (`solveBank` in `Shot.js`, zone
`BANK`, kind-aware `aimFor`). In board axes (normal, lateral, up) the ball
flies from the hand to a contact point on the glass a chosen height above
the rim, bounces with Rapier's restitution (0.72, measured) and keeps 5/7
of its tangential velocity (Rapier's friction brings a solid sphere to
rolling; measured 0.70–0.71 in-game — ignoring it left wide-angle caroms
30 % short and on the near iron), and comes down through the rim centre.
The normal axis fixes the carom time from the flight time, the lateral
axis is then linear, and one bisection in the flight time makes the
carom's height hit zero at the centre. Candidate kiss heights are tried
in order (0.30 m first, up to 0.80 — the board runs to 0.945 above the
rim); a candidate is rejected if the ball's centre comes within
`radius + tube + 15 mm` of the ring's centreline anywhere on the way in
or on the way down (a true 3D distance — the first version used a
vertical-wall test that rejected every straight-on bank), if it would
rise through the hoop from below, if the contact is off the glass, or if
the carom is not clearly descending at the rim. A layup is launched with
**no backspin** (spin on the glass is a friction kick the model does not
carry). `solveBank` returning null falls back to the old soft drop; in the
lab it no longer does from anywhere in layup range.

**The takeoff paces the drive** (`layupStandoff` 1.2 m, `layupLunge`
2.5 m/s): at J the body's horizontal velocity is set toward the rim so the
feet *land* 1.2 m from it wherever the takeoff was — a sprint slows, a
standing start hops forward. The ball is carried ~0.75 m ahead of the
feet, so every release, early or late on the way down, happens about half
a metre from the rim. Two lessons here: pacing to reach the standoff *at
the release* left late taps under the rim (the body kept drifting), and a
0.8 m standoff did the same because of the carry. Before any of this, a
sprinting drive covered the whole 2.3 m before the tap and released from
under the rim, where nothing clean is possible. Taking off *inside* the
standoff, the takeoff steps back to it instead (`layupFade`, up to 1.5
m/s — a fade-away, and this one paces to the *release*, since the ball
must be clear of the front iron when it leaves the hand or no bank can
rise past it), the ball is carried overhead rather than out front
(`load.z` shrinks toward 0.18 as the takeoff nears 0.5 m from the rim)
and higher (`layupReachUp`, +0.2 m at the rim, a full reach-up); without
all three, a takeoff beside the rim released the ball 7 mm from the front
tube and the solver rightly refused it. Lab (`ZONE=bank`): 48/48 banks
from twelve spots, right beside the rim to 2.5 m out, at taps from 0.3 s
early to 0.19 s late, every one off the glass and through; smoke:
J-then-K at once, at the top, late, from a sprint (each asserted made
*with* a board hit), and no tap (lands holding the ball). The shoot key near
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
- **Rapier's contact prediction distance is set to 0.5 mm**
  (`normalizedPredictionDistance` in `Physics.js`; the default is 2 mm).
  With the default, a step ending with the ball 0.5–2 mm short of a
  surface makes a "predicted" contact that stops the ball at the surface
  *without bouncing it*, and the next step bounces the near-zero remainder:
  measured restitution 0.23–0.42 instead of 0.72 for about one contact
  phase in five, on every surface (glass, iron, court). It showed up as one
  bank layup in eight dying on the glass and dropping onto the back iron —
  identical launch, different sub-step phase. `node scripts/restitution.mjs`
  is the regression check: it fires the same free ball at the board from
  eleven sub-step phases and fails unless every one reads 0.72. Penetrating a few mm before the real bounce is corrected
  positionally and does not change the bounce velocity (verified).
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

- ~~Asset loading, instancing, environment map~~ — **built in the first
  park cut** (see *The park*). Still absent:
- **No `LOD` or `Sprite`.** Nothing for distant kids as billboard imposters.
- **No leaf scatter** — `assets_raw/leaf_decals/` is converted-ready but
  nothing places the cut-outs.
- **The court is still the NBA two-hoop layout.** A park court is the
  owner's stated want; not yet redrawn.
- **Audio sfx are drop-in** (`src/assets/audio/`, see the Audio section),
  but only one-shot effects keyed to game events. Bird and park *ambience*
  is a looping bed with no event to trigger it — that needs a small
  addition to `AudioManager`, not a new loader.

Budget for the whole park, over GitHub Pages: **8–12 MB** of assets is
realistic and enough. The JS bundle is already 5.3 MB (2.0 MB gzipped). Note
`assetsInlineLimit` is 4 MB in `vite.config.js` — at park scale the single-file
artifact build stops being viable and the Pages build becomes the only target.

**Decided 2026-09-19 by the owner: shooting is done; stage 3 is the park.**
Defenders and contested shooting (below) stay the want after that.

## Shooting still wants a second play-test

The owner has played the jumper once; layups, the jump key, rebinding, and
the ball settling under the rim came out of that and have only been
verified headless. Still wanting a verdict from real play:

- The new defaults (right-mouse shoot, Space jump) — or whatever the owner
  rebinds them to.
- The layup as a bank: the kiss height (0.30 m above the rim when the
  geometry allows, taller from a low or close release), the fade from a
  takeoff at the rim, and how it reads from the eyes
  (`node scripts/capture.mjs layup`). Verified headless only.

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

The owner chose the park for stage 3 (see the section above). After it,
candidates in the order that serves the end goal: defenders (unlocks
contested, and is the thing multiplayer needs anyway); dunks (the layup
machinery is the base — a dunk is a layup whose release point is above the
rim and whose "launch" is a slam); or a rebound/chase loop.
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
  uncontested they always go in — off the backboard, never a swish.**
  Owner's calls: "by then I'm already on the ground", "jump with J, click
  K once, make it every time" and "nobody scores layups as a swish, it's
  always a bank off the backboard" (the last one was misread the first
  time as a complaint about banking; it was the spec). Timing pressure on
  a layup only arrives with defenders (the `contested` hook).
- **Looking at a nearby ball catches it.** Speed does not matter (below 10
  m/s); the gather absorbs it.
- **Always right-handed.** The shot gathers into the right hand whichever
  hand was dribbling.
- **The body squares up to the basket during a shot** while the head stays
  free. Turning the camera for the player would be nauseating; letting the
  ball follow a turned head would make every shot miss.
- **The shot arc keeps a fixed entry angle (47°), not a fixed apex.**
