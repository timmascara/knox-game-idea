# 🏀 Home Court

A first-person, atmospheric indie basketball game built with **Three.js** and
**Rapier** physics. Walk into a quiet park, pick up the ball, dribble, pull up,
and let it swish through the net. It's about the *feeling* of finding a beautiful
outdoor court and spending an hour there — not NBA 2K.

![Home Court](docs/hero.png)

---

## Play

```bash
npm install
npm run dev
```

Open the printed URL, click **Enter the Park**, and click again to capture the
mouse.

### Controls

| Input | Action |
| --- | --- |
| `W A S D` | Move |
| `Shift` | Sprint |
| `Space` | Jump |
| Mouse | Look |
| `E` | Pick up / drop the ball |
| **Left click** | Shoot (hold to gather, release to time it) · near the rim: **layup** / **dunk** |
| **Right click** | Dribble move — crossover / between-the-legs / behind-the-back / hesitation (context-sensitive) |
| Double-tap `A` / `D` | Quick crossover to that hand |
| `Esc` | Pause / settings |

### Shooting is about timing, not power

Pressing shoot starts the shot motion (**gather → set → release → follow-through**).
When you release determines your timing grade:

- **GREEN** — perfect. Near-automatic swish. The green window is small, so hitting
  it is the skill.
- **YELLOW** — slightly off. Usually good, sometimes off the backboard or rim.
- **ORANGE** — possible make or miss.
- **RED** — mostly misses.
- **EXTREME** — airballs.

Every shot is solved into a believable **arc** (distance-aware apex, drag-
compensated), then handed to the physics engine — makes, backboard banks, rim
rattles, bricks and airballs all *emerge* from the simulation. Chase down the
rebound and keep playing.

---

## Build & test

```bash
npm run build          # production bundle to dist/
npm run preview        # serve the build on http://127.0.0.1:4173
npm run test:smoke     # headless Chromium smoke test (boot + gameplay + stability)
```

The smoke test boots the built game in headless Chromium, checks it renders
without errors, then pumps the fixed-step loop to exercise pickup, dribbling and
a full timing shot — asserting green shots make and that nothing goes non-finite.
Set `CHROME_PATH` if your Chrome/Chromium isn't at the default path.

---

## How it works

One physics engine (Rapier) is authoritative over the ball, the court / rim /
backboard / props collision, and the player capsule. Rendering, materials,
instancing and animation are Three.js.

### Project layout

```
src/
  core/         Constants · MathUtils · Input (pointer lock) · Game (orchestrator)
  physics/      Physics — thin Rapier world wrapper + collider tagging
  player/       Player (kinematic character controller) · CameraRig (FPS look) · Hands
  ball/         Basketball (dynamic/kinematic modes) · BallController (the gameplay brain)
                Dribble + moves + shooting + layups + dunks live here · Shot (arc + grading math)
  world/        Court · Hoop · Net (verlet) · Park · Grass · Trees · Props · Weather · Sky · environments
  audio/        AudioManager — fully synthesised SFX + ambience (no asset files)
  ui/           HUD · Menu · styles
  state/        Settings (localStorage) · GameState (scoreboard)
  net/          NetworkManager — multiplayer seam (no-op transport by default)
main.js         Boot: init Rapier WASM → build Game → run
```

### Notable systems

- **Physically-shaped dribble.** While carried, the ball is a kinematic body
  driven along a *gravity-accurate* bounce (a quadratic that kisses the floor at
  the bottom and reaches the hand at the top), offset to the active hand, leading
  the player as they move. Crossovers, between-the-legs, behind-the-back and
  hesitations reshape that path and switch hands. On a shot / drop / rebound the
  ball becomes a fully dynamic Rapier body again — no teleporting.
- **Real hoop.** A perfectly horizontal circular rim (a ring of sphere colliders
  so the ball can drop through and rattle), a cuboid backboard, and a verlet-
  simulated net that only ever hangs from the rim and swishes as the ball passes.
- **Instanced world.** Grass (thousands of blades, one `InstancedMesh` with a wind
  shader), trees (each a merged low-poly prototype, one draw call for the grove),
  rocks, bushes and fence posts are all GPU-instanced. Trees are faceted forms,
  not green spheres.
- **Synthesised audio.** Ball bounces, rim, backboard, net swish, footsteps, shoe
  squeaks, wind, birds and rain are all generated at runtime via the Web Audio
  API, so the game is fully self-contained.
- **Environments.** `afternoon`, `fall`, `dusk` and `rain` are palette + lighting
  presets over shared geometry (switchable in Settings) — a single strong
  environment, reskinnable rather than five half-built ones.

---

## Roadmap / architecture seams

The project is intentionally structured so the big future features slot in
without a rewrite:

- **Multiplayer.** `net/NetworkManager` defines the client contract — publish a
  compact local snapshot each tick, receive remote snapshots to interpolate proxy
  avatars. The default `LocalTransport` is a no-op; a real build swaps in a
  WebSocket/WebRTC transport backed by an **authoritative server** that owns ball
  possession and shot resolution (never one browser). Player, ball and possession
  state are already isolated behind clean interfaces.
- **Desktop / Steam.** The game is a self-contained Three.js app with no hard
  browser-tab dependency, so it can be wrapped by Electron/Tauri for macOS /
  Windows / Linux, with Steamworks (friends, invites, lobbies, achievements)
  layered on later.
- **More courts & moves.** New environments are one entry in `world/environments`;
  new dribble moves are one case in the `BallController` move system.

## Tech

- [Three.js](https://threejs.org/) `0.169`
- [Rapier](https://rapier.rs/) (`@dimforge/rapier3d-compat` `0.14`)
- [Vite](https://vitejs.dev/) `5`

MIT licensed. All geometry, textures and audio are generated procedurally in
code — no third-party assets are bundled.
