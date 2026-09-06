# 🏀 Home Court — dribble lab

A first-person basketball game built with **Three.js** and **Rapier**, being
built one mastered system at a time. This stage is the handle: an open outdoor
court, VR-style hands (no arms, no legs), a real basketball, and a dribbling
engine whose whole job is to make the ball feel like it is on a string.

![Home Court](docs/hero.png)

---

## Play

```bash
npm install
npm run dev
```

Open the printed URL, click **Step on the court**, and click again to capture
the mouse. Walk into the ball to pick it up.

The repo also ships a GitHub Pages workflow (`.github/workflows/pages.yml`).
Enable it once under **Settings → Pages → Source: GitHub Actions** and every
push deploys a playable build to `https://<owner>.github.io/<repo>/` — a full
page, so mouse capture works there (embedded previews often refuse it).

### Controls

| Input | Action |
| --- | --- |
| `W A S D` | Move · `Shift` sprint (speed dribble, ball pushed out ahead) |
| Mouse | Look (the ball stays in front of your *body*, not your head) |
| `E` | Pick up the ball · hold ↔ dribble |
| **Left click** | Crossover · with `S` held: **step-back** |
| **Right click** | Between the legs |
| `Q` | Behind the back |
| `F` | In & out |
| `Space` | Hesitation (hang dribble, then explode) |
| `C` (hold) | Low / protect dribble |
| `G` | Drop the ball |
| `Tab` | Live tuning panel |
| `Esc` | Pause / settings |

From a hold, **left click** starts dribbling in the right hand and **right
click** in the left. Moves can be pressed ahead of time: a two-deep buffer
chains them at the next catch, so *click, Q* is a crossover into a behind-
the-back, and a pound can be interrupted early in its carry for snappier
response.

---

## How the dribble works

A dribble is not a sine wave. It is a repeating cycle with two very different
halves, and the engine models both:

1. **Contact** (ball in hand, ~0.15 s for a pound). The ball is caught still
   rising, rides up a few centimetres as the hand absorbs it, then is pushed
   down and out. This is a piecewise cubic Hermite path through a few
   waypoints in the *handle frame* (a body-relative space that trails the feet
   and your look direction with a little lag, so the ball has weight).
   Every move is just a different set of waypoints — carried across the body
   for a crossover, wrapped around the hip for a behind-the-back, rolled
   inward and back out for an in-and-out — plus which hand receives it.

2. **Flight** (ball out of the hand). A real ballistic solve: the release
   velocity is *derived* from where the hand wants the ball back and how high,
   the ball drops, hits the court with vertical restitution and a little
   horizontal loss, and rises into the catch point still moving up ~0.9 m/s
   so the hand meets a rising ball. Cadence is not a tuning number — it falls
   out of the physics (hip-high pound ≈ 85 bpm, knee-high ≈ 120 bpm).

Position **and velocity** are continuous through the whole cycle: the
contact path starts with the flight's arrival velocity and ends with the next
flight's release velocity. Nothing ever snaps.

The hands are choreographed around that cycle: the carrying palm tracks the
ball exactly, follows through after the release, drops with the ball, then
rises ahead of it and descends to meet it at the catch. The other hand
guards, or — when a move switches hands — moves early to hover over where the
ball will arrive. Each move also sways the camera a few centimetres (the body
shifting into the move), which sells it in first person.

### Project layout

```
src/
  core/         Constants (all the feel numbers) · MathUtils · Input · Game (fixed-step loop)
  physics/      Physics — thin Rapier world wrapper
  player/       Player (kinematic capsule) · CameraRig (look + body sway) · HandModel (rigged hand) · Hands (the pair, world-space)
  ball/         Basketball (procedural 8-panel ball) · BounceMath (Flight solver + Hermite Contact)
                Moves (the move library, one cycle plan each) · DribbleController (possession, cycle, buffer, hands, sway)
  world/        World (open court, sun, horizon) · Court · Hoop · Net · Sky
  audio/        AudioManager — synthesised bounce / catch / squeak / footsteps / wind
  ui/           HUD · Menu · Tuning · styles
  state/        Settings (localStorage)
scripts/        smoke.mjs (headless test) · capture.mjs (contact sheets of any move)
```

### The hands and the ball

- **Hands** are a sculpted hand mesh (`src/assets/hand_right.glb`, ~100k
  triangles, forearm cut under a sweatband) that arrived unrigged.
  `scripts/rig_hand.py` rigs it from the geometry alone: it traces the four
  fingers through cross-sections, places knuckle / middle / tip joints by
  arc length, finds the thumb lobe, skins every vertex to the nearest bone
  with a blend across each joint, and writes a skinned GLB whose joint
  frames put -Z down the bone and +Y toward the back of the hand. In the
  game, poses are four scalars (per-finger curl, spread, thumb curl, thumb
  abduction) on top of the sculpt's relaxed pose, damped toward named
  poses (`relaxed`, `open`, `ball`, `grip`, `guard`). The left hand is the
  right hand mirrored. They live in world space, attached to the body —
  turning your head never drags them with it.
- **The ball**'s colour, bump and roughness maps are painted per texel from
  the real seam geometry: an equator, a meridian, and two side circles of
  55° angular radius, which is exactly what produces a basketball's eight
  panels. Pebble grain is hashed value noise stretched to stay isotropic.

---

## Build & test

```bash
npm run build          # production bundle to dist/
npm run preview        # serve the build on http://127.0.0.1:4173
npm run test:smoke     # headless Chromium: boots, dribbles, checks invariants
node scripts/capture.mjs all   # contact sheets of every move → screenshots/
node scripts/capture.mjs poses # the rigged hand in every pose, close up
```

To re-rig the hand from the source sculpt (e.g. after tweaking joint
placement): `python3 scripts/rig_hand.py <hand.obj> src/assets/hand_right.glb`
(needs `numpy`).

The smoke test pumps the fixed-step loop through pickup, a pound rhythm,
every move, sprinting, the low dribble, a buffered combo, and a drop and
chase, and asserts: the ball never dips under the court, its velocity is
continuous across catch and release, the palm stays on the ball while
carrying, every move hands off to the intended hand and returns to a pound,
and nothing goes non-finite. `capture.mjs` renders deterministic 20-frame
contact sheets so a move can be reviewed frame by frame without a GPU.

---

## Tuning

`Tab` opens sliders over every number in `DRIBBLE` (`src/core/Constants.js`):
dribble heights, ball offsets, restitution, catch rise speed, push depth,
handle lag, per-move carry times, sway amplitudes. Changes apply live and are
not persisted — when something feels right, write it into Constants.

## Not here yet (on purpose)

Shooting, layups, dunks, the park, weather and the scoreboard were removed to
keep this stage about the handle; the earlier build is in git history
(`bb515cf`). A spin move is deliberately absent: a first-person spin with no
body is nauseating, and needs a camera treatment of its own.

## Tech

- [Three.js](https://threejs.org/) `0.169`
- [Rapier](https://rapier.rs/) (`@dimforge/rapier3d-compat` `0.14`)
- [Vite](https://vitejs.dev/) `5`

MIT licensed for the code. The court, ball, textures and audio are generated
in code; the hand mesh (`src/assets/hand_right.glb`) is a third-party sculpt
supplied by the project owner under its own licence.
