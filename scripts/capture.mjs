/**
 * Visual capture harness. Boots the built game in headless Chromium, drives
 * the simulation deterministically through window.__game, and writes
 * screenshots to ./screenshots so the hands, ball and dribble can be reviewed
 * frame by frame without a GPU or a human at the mouse.
 *
 *   npm run build && npm run preview     # serve dist on :4173
 *   node scripts/capture.mjs [scenario...]
 *
 * Scenarios: hero, hold, handclose, ball, ballclose, pound, crossover, between, behind, inout, hesitation,
 * stepback, speed, low, shoot, shothands, flight, net, meter, all (default: hold pound).
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const URL = process.env.SMOKE_URL || 'http://127.0.0.1:4173/';
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
const wanted = args.length ? args : ['hold', 'pound'];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('hidden'), { timeout: 30000 });

// Shared in-page helpers.
await page.evaluate(() => {
  const g = window.__game;
  g.started = true;
  g.paused = false;
  g.menu.hide();
  g.hud.show();
  // Take over the frame loop: the harness ticks and renders explicitly so
  // every screenshot is a deterministic simulation state.
  g.renderer.setAnimationLoop(null);
  window.__h = {
    tick(n, dt = 1 / 120) { for (let i = 0; i < n; i++) { g._update(dt); g.input.endFrame(); } },
    look(pitch, yaw = 0) { g.cameraRig.pitch = pitch; g.cameraRig.yaw = yaw; g.cameraRig.applyLook(0, 0); },
    render() {
      if (this._cam) { g.renderer.render(g.scene, this._cam); return; }
      g.cameraRig.update(0, g.player.position, 0, true); g.renderer.render(g.scene, g.cameraRig.camera);
    },
    // Free camera for close-ups: from (x,y,z) looking at target.
    closeup(from, at, fov = 40) {
      const c = g.cameraRig.camera.clone();
      c.fov = fov; c.updateProjectionMatrix();
      c.position.set(from.x, from.y, from.z); c.lookAt(at.x, at.y, at.z);
      c.updateMatrixWorld(true);
      this._cam = c;
    },
    freecam() { this._cam = null; },
    // Contact sheet: draw successive renders into a 2D canvas overlaid on the page.
    sheetBegin(cols, rows, w = 426, h = 240) {
      let c = document.getElementById('sheet');
      if (!c) { c = document.createElement('canvas'); c.id = 'sheet'; document.body.appendChild(c); }
      c.width = cols * w; c.height = rows * h;
      c.style.cssText = 'position:fixed;left:0;top:0;z-index:99;background:#000';
      this._sheet = { c, cols, rows, w, h, i: 0 };
    },
    sheetAdd() {
      this.render();
      const s = this._sheet;
      const ctx = s.c.getContext('2d');
      const x = (s.i % s.cols) * s.w;
      const y = Math.floor(s.i / s.cols) * s.h;
      ctx.drawImage(g.renderer.domElement, x, y, s.w, s.h);
      ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif'; ctx.fillText(String(s.i), x + 6, y + 18);
      s.i++;
    },
    sheetEnd() { const c = document.getElementById('sheet'); if (c) c.remove(); this._sheet = null; },
    press(code) { g.input.pressed.add(code); g.input.keys.add(code); },
    release(code) { g.input.keys.delete(code); },
    click(btn) { g.input.mousePressed[btn] = true; },
    // Put the ball in the hands (hold) instantly.
    hold() {
      const d = g.dribble;
      g.player.teleport({ x: 0, y: 0.02, z: 6.5 });
      d._updateFrame(0, true);
      g.ball.setControlled();
      d.state = 'hold'; d.t = 0; d.plan = null; d.flight = null; d.contact = null;
      d.ballLocal.set(0, 1.14, 0.40);
      this.tick(30);
      g.hands.snapToTargets();
    },
    dribble(sign = 1) { this.hold(); d_start(sign); },
    // Stand at (x, z) facing the near hoop, ball in the hands.
    faceHoop(x, z, pitch = 0.12) {
      const g = window.__game; const d = g.dribble;
      g.player.teleport({ x, y: 0.02, z }); g.player.velocity.set(0, 0, 0);
      g.cameraRig.yaw = Math.atan2(-(0 - x), -(12.425 - z)); g.cameraRig.pitch = pitch; g.cameraRig.applyLook(0, 0);
      d._ft = null; d.shot = null; d.tracker = null; d._shooting = false; g.player.lockMove = false;
      d._updateFrame(0, true); g.ball.setControlled(); d.state = 'hold'; d.t = 0; d.plan = null; d.flight = null; d.contact = null;
      d.ballLocal.set(0, 1.14, 0.40); d.ballVelLocal.set(0, 0, 0); this.tick(30); g.hands.snapToTargets();
    },
    // Start a jumper; tick with Space held until `release` seconds in, then let go.
    shootTo(release) {
      const g = window.__game; const d = g.dribble;
      g.input.pressed.add('Space'); g.input.keys.add('Space'); g._update(1 / 120); g.input.endFrame();
      while (d.shot && d.shot.t < release - 1e-6) { g.input.keys.add('Space'); g._update(1 / 120); g.input.endFrame(); }
      g.input.keys.delete('Space'); g.input.released.add('Space');
    },
  };
  function d_start(sign) { window.__game.dribble._startDribble(sign); }
});

async function shot(name) {
  await page.evaluate(() => window.__h.render());
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('wrote', `${OUT}/${name}.png`);
}

const scenarios = {
  async hold() {
    await page.evaluate(() => { window.__h.hold(); window.__h.look(-0.62); window.__h.tick(60); });
    await shot('hold');
    await page.evaluate(() => { window.__h.look(-0.95); });
    await shot('hold-down');
  },
  async handclose() {
    await page.evaluate(() => { window.__h.hold(); window.__h.look(-0.62); window.__h.tick(60); });
    // Right hand from the front-right, and from above.
    await page.evaluate(() => {
      const h = window.__game.hands.right.pos;
      window.__h.closeup({ x: h.x + 0.28, y: h.y + 0.22, z: h.z - 0.30 }, { x: h.x, y: h.y, z: h.z - 0.05 }, 45);
    });
    await shot('hand-front');
    await page.evaluate(() => {
      const h = window.__game.hands.right.pos;
      window.__h.closeup({ x: h.x + 0.05, y: h.y + 0.42, z: h.z + 0.1 }, { x: h.x, y: h.y, z: h.z - 0.05 }, 45);
    });
    await shot('hand-top');
    await page.evaluate(() => {
      const h = window.__game.hands.left.pos;
      window.__h.closeup({ x: h.x - 0.35, y: h.y - 0.05, z: h.z - 0.15 }, { x: h.x, y: h.y, z: h.z - 0.05 }, 45);
    });
    await shot('hand-side');
    await page.evaluate(() => window.__h.freecam());
  },
  async hero() {
    // Mid-carry frame of a right-hand pound, for the README.
    await page.evaluate(() => { window.__h.dribble(1); window.__h.look(-0.55); window.__h.tick(150); while (window.__game.dribble.state !== 'contact') window.__h.tick(1); window.__h.tick(6); });
    await shot('hero');
  },
  async poses() {
    // The right hand alone, in every named pose, from three angles.
    const poses = ['relaxed', 'open', 'ball', 'grip'];
    for (const pose of poses) {
      await page.evaluate((pose) => {
        const g = window.__game; const THREE = window.__THREE;
        const h = g.hands.right;
        g.ball.mesh.visible = false; g.hands.left.model.root.visible = false;
        h.pos.set(0, 1.2, 4); h.quat.identity();
        h.model.root.position.copy(h.pos); h.model.root.quaternion.identity();
        h.model.setPose(window.__game.hands.constructor.POSES?.[pose] || window.__POSES[pose], true);
        h.model.applyPose();
        h.model.root.updateMatrixWorld(true);
      }, pose);
      const views = { back: [0.05, 1.5, 4.05], palm: [0.0, 0.9, 3.95], side: [-0.32, 1.22, 3.92], front: [0.0, 1.25, 3.62] };
      for (const [vn, from] of Object.entries(views)) {
        await page.evaluate(({ from }) => window.__h.closeup({ x: from[0], y: from[1], z: from[2] }, { x: 0, y: 1.2, z: 3.92 }, 42), { from });
        await shot(`pose-${pose}-${vn}`);
      }
    }
    await page.evaluate(() => { window.__h.freecam(); window.__game.ball.mesh.visible = true; window.__game.hands.left.model.root.visible = true; });
  },
  async ballclose() {
    await page.evaluate(() => {
      const g = window.__game;
      g.ball.setFree();
      g.ball.setPositionHard({ x: 3, y: 0.121, z: 3 });
      g.dribble.state = 'loose';
      g.player.teleport({ x: 0, y: 0.02, z: 6.5 });
      window.__h.tick(2);
      window.__h.closeup({ x: 3.35, y: 0.32, z: 3.3 }, { x: 3, y: 0.121, z: 3 }, 40);
    });
    await shot('ball-close');
    await page.evaluate(() => window.__h.freecam());
  },
  async ball() {
    await page.evaluate(() => {
      const g = window.__game;
      g.ball.setFree();
      g.ball.setPositionHard({ x: 0, y: 0.35, z: 5.9 });
      g.player.teleport({ x: 0, y: 0.02, z: 6.3 });
      g.dribble.state = 'loose';
      window.__h.look(-0.9);
      window.__h.tick(2);
    });
    await shot('ball');
  },
  async pound() {
    await page.evaluate(() => { window.__h.dribble(1); window.__h.look(-0.62); window.__h.tick(150); });
    await page.evaluate(() => {
      const h = window.__h;
      h.sheetBegin(5, 4);
      for (let i = 0; i < 20; i++) { h.tick(5); h.sheetAdd(); }
    });
    await page.locator('#sheet').screenshot({ path: `${OUT}/pound-sheet.png` });
    console.log('wrote', `${OUT}/pound-sheet.png`);
    await page.evaluate(() => window.__h.sheetEnd());
  },
  /** The jumper from the player's eyes: gather → set → rise → release → follow-through, 30 ms apart. */
  async shoot() {
    await page.evaluate(() => { const h = window.__h; h.faceHoop(0, 6.5, 0.16); h.sheetBegin(5, 5); h.shootTo(0.62); });
    // shootTo returns at the release tick; rewind the sheet through the whole shot deterministically.
    await page.evaluate(() => { const h = window.__h; h.faceHoop(0, 6.5, 0.16); h.sheetBegin(5, 5);
      const g = window.__game; const d = g.dribble;
      g.input.pressed.add('Space'); g.input.keys.add('Space'); g._update(1 / 120); g.input.endFrame(); h.sheetAdd();
      for (let i = 1; i < 25; i++) {
        for (let k = 0; k < 4; k++) {
          const hold = d.shot && d.shot.t < 0.62 - 1e-6;
          if (hold) g.input.keys.add('Space'); else if (g.input.keys.has('Space')) { g.input.keys.delete('Space'); g.input.released.add('Space'); }
          g._update(1 / 120); g.input.endFrame();
        }
        h.sheetAdd();
      }
    });
    await page.locator('#sheet').screenshot({ path: `${OUT}/shoot-sheet.png` });
    console.log('wrote', `${OUT}/shoot-sheet.png`);
    await page.evaluate(() => window.__h.sheetEnd());
  },
  /** The hands on the ball at the set and at the release, from the side and from above. */
  async shothands() {
    for (const [label, at] of [['set', 0.30], ['load', 0.50], ['release', 0.60], ['flick', 0.64]]) {
      await page.evaluate(({ at }) => {
        const h = window.__h; h.faceHoop(0, 6.5, 0.16);
        const g = window.__game; const d = g.dribble;
        g.input.pressed.add('Space'); g.input.keys.add('Space'); g._update(1 / 120); g.input.endFrame();
        while (d.shot && d.shot.t < at - 1e-6) { if (d.shot.t < 0.62) g.input.keys.add('Space'); else { g.input.keys.delete('Space'); g.input.released.add('Space'); } g._update(1 / 120); g.input.endFrame(); }
        const b = g.ball.mesh.position;
        h.closeup({ x: b.x + 0.75, y: b.y + 0.05, z: b.z + 0.25 }, { x: b.x, y: b.y - 0.05, z: b.z }, 40);
      }, { at });
      await shot(`shot-${label}-side`);
      await page.evaluate(() => { const g = window.__game; const b = g.ball.mesh.position; window.__h.closeup({ x: b.x - 0.05, y: b.y + 0.15, z: b.z - 0.7 }, { x: b.x, y: b.y - 0.1, z: b.z + 0.1 }, 45); });
      await shot(`shot-${label}-front`);
    }
    // Follow-through, 0.2 s after the launch, from the player's eyes and from the side.
    await page.evaluate(() => { const h = window.__h; h.faceHoop(0, 6.5, 0.16); h.shootTo(0.62); const g = window.__game; h.freecam(); while (g.dribble.state !== 'loose') h.tick(1); h.tick(24); });
    await shot('shot-followthrough');
    await page.evaluate(() => { const g = window.__game; const w = g.hands.right.pos; window.__h.closeup({ x: w.x + 0.7, y: w.y + 0.1, z: w.z + 0.2 }, { x: w.x, y: w.y, z: w.z - 0.1 }, 40); });
    await shot('shot-followthrough-side');
    await page.evaluate(() => window.__h.freecam());
  },
  /** The arc from the player's eyes, 100 ms apart, through the swish. */
  async flight() {
    await page.evaluate(() => { const h = window.__h; h.faceHoop(0, 6.5, 0.24); h.shootTo(0.62); const g = window.__game; while (g.dribble.state !== 'loose') h.tick(1); });
    await page.evaluate(() => { const h = window.__h; h.sheetBegin(5, 4); for (let i = 0; i < 20; i++) { h.tick(12); h.sheetAdd(); } });
    await page.locator('#sheet').screenshot({ path: `${OUT}/flight-sheet.png` });
    console.log('wrote', `${OUT}/flight-sheet.png`);
    await page.evaluate(() => window.__h.sheetEnd());
  },
  /** The net taking a swish, from beside the rim, 40 ms apart. */
  async net() {
    await page.evaluate(() => {
      const h = window.__h; h.faceHoop(0, 7.5, 0.2); h.shootTo(0.62);
      const g = window.__game; while (g.dribble.state !== 'loose') h.tick(1);
      h.closeup({ x: 1.3, y: 3.0, z: 11.4 }, { x: 0, y: 2.9, z: 12.425 }, 38);
      // run until the ball is just above the rim
      let guard = 0; while (guard++ < 400 && !(g.ball.position.y < 3.45 && g.ball.velocity.y < 0)) h.tick(1);
      h.sheetBegin(5, 4, 426, 240); for (let i = 0; i < 20; i++) { h.tick(5); h.sheetAdd(); }
    });
    await page.locator('#sheet').screenshot({ path: `${OUT}/net-sheet.png` });
    console.log('wrote', `${OUT}/net-sheet.png`);
    await page.evaluate(() => window.__h.sheetEnd());
    await page.evaluate(() => { const h = window.__h; h.closeup({ x: 0.9, y: 2.75, z: 11.6 }, { x: 0, y: 2.85, z: 12.425 }, 34); });
    await shot('net-close');
    await page.evaluate(() => window.__h.freecam());
  },
  /** The HUD meter mid-fill and at a green / late result. */
  async meter() {
    await page.evaluate(() => { const h = window.__h; h.faceHoop(0, 6.5, 0.16); const g = window.__game; g.input.pressed.add('Space'); g.input.keys.add('Space'); g._update(1 / 120); g.input.endFrame(); while (g.dribble.shot.t < 0.45) { g.input.keys.add('Space'); g._update(1 / 120); g.input.endFrame(); } h.render(); });
    await page.screenshot({ path: `${OUT}/meter-fill.png` });
    console.log('wrote', `${OUT}/meter-fill.png`);
    await page.evaluate(() => { const h = window.__h; h.faceHoop(0, 6.5, 0.16); h.shootTo(0.62); h.tick(3); h.render(); });
    await page.screenshot({ path: `${OUT}/meter-green.png` });
    await page.evaluate(() => { const h = window.__h; h.faceHoop(0, 6.5, 0.16); h.shootTo(0.74); h.tick(3); h.render(); });
    await page.screenshot({ path: `${OUT}/meter-late.png` });
    // result text: run out the green shot until the tracker resolves
    await page.evaluate(() => { const h = window.__h; h.faceHoop(0, 6.5, 0.16); h.shootTo(0.62); const g = window.__game; let n = 0; while (n++ < 900 && (g.dribble.state !== 'loose' || g.dribble.tracker)) h.tick(1); h.tick(6); h.render(); });
    await page.screenshot({ path: `${OUT}/meter-result.png` });
    console.log('wrote', `${OUT}/meter-*.png`);
  },
  async move(name, key, extra = {}) {
    await page.evaluate(({ key, extra }) => {
      const h = window.__h;
      h.dribble(1);
      h.look(-0.62);
      if (extra.sprint) { h.press('KeyW'); h.press('ShiftLeft'); }
      if (extra.low) h.press('KeyC');
      if (extra.back) h.press('KeyS');
      h.tick(150);
      if (key === 'left' || key === 'right') h.click(key); else h.press(key);
      h.tick(1);
    }, { key, extra });
    // 20 frames, 6 ticks (50 ms) apart, on one sheet.
    await page.evaluate(() => {
      const h = window.__h;
      h.sheetBegin(5, 4);
      for (let i = 0; i < 20; i++) { h.tick(6); h.sheetAdd(); }
    });
    await page.locator('#sheet').screenshot({ path: `${OUT}/${name}-sheet.png` });
    console.log('wrote', `${OUT}/${name}-sheet.png`);
    await page.evaluate(() => window.__h.sheetEnd());
  },
};

for (const name of wanted) {
  const list = name === 'all' ? ['hold', 'ball', 'pound', 'crossover', 'between', 'behind', 'inout', 'hesitation', 'stepback', 'speed', 'low', 'shoot', 'shothands', 'flight', 'net', 'meter'] : [name];
  for (const s of list) {
    if (scenarios[s]) await scenarios[s]();
    else if (s === 'crossover') await scenarios.move('crossover', 'left');
    else if (s === 'between') await scenarios.move('between', 'right');
    else if (s === 'behind') await scenarios.move('behind', 'KeyQ');
    else if (s === 'inout') await scenarios.move('inout', 'KeyF');
    else if (s === 'hesitation') await scenarios.move('hesitation', 'KeyR');
    else if (s === 'stepback') await scenarios.move('stepback', 'left', { back: true });
    else if (s === 'speed') await scenarios.move('speed', 'KeyX', { sprint: true });
    else if (s === 'low') await scenarios.move('low', 'KeyX', { low: true });
    else console.log('unknown scenario', s);
  }
}

console.log('Errors:', errors.length ? errors : 'none');
await browser.close();

