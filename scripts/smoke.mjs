/**
 * Headless smoke test for Home Court.
 *
 * Boots the built game in Chromium (WebGL via ANGLE/SwiftShader), verifies it
 * reaches a ready state without console/page errors, then pumps the fixed-step
 * update loop to exercise the real gameplay systems (pickup, dribble, a full
 * timing shot) and sanity-checks the make/miss outcome and numerical stability.
 * Screenshots are written to ./screenshots.
 *
 * Usage:
 *   npm run build && npm run preview   # in one terminal (serves dist on :4173)
 *   node scripts/smoke.mjs             # in another
 *
 * Requires a Chromium/Chrome binary. Set CHROME_PATH to override autodetection.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const URL = process.env.SMOKE_URL || 'http://127.0.0.1:4173/';
const CHROME =
  process.env.CHROME_PATH ||
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
  ],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) errors.push(`console: ${m.text()}`);
});

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(
  () => document.getElementById('loading')?.classList.contains('hidden'),
  { timeout: 20000 }
);
await page.screenshot({ path: `${OUT}/menu.png` });

const result = await page.evaluate(() => {
  const g = window.__game;
  g.started = true;
  g.paused = false;
  const bc = g.ballController;
  g.cameraRig.yaw = Math.PI;
  g.cameraRig.yawObject.rotation.y = Math.PI;

  // Shoot a perfectly-timed green from ~5.5m and let it resolve.
  function greenShot(z) {
    g.player.teleport({ x: 0, y: 0, z });
    g.ball.setControlled();
    bc.mode = 'carry';
    bc.ballTarget.set(0, 1, z);
    for (let i = 0; i < 8; i++) g._update(1 / 60);
    bc._startShoot();
    const s = bc.shoot;
    let guard = 0;
    while (bc.mode === 'shoot' && bc.shoot && bc.shoot.t < s.ideal && guard++ < 300) g._update(1 / 60);
    if (bc.mode === 'shoot' && bc.shoot) {
      bc.shoot.t = s.ideal;
      bc._releaseShot(bc.shoot);
    }
    for (let i = 0; i < 480; i++) {
      g._update(1 / 60);
      if (!bc.shotFlight) break;
    }
  }

  const before = g.gameState.makes;
  for (let i = 0; i < 8; i++) greenShot(6.8);
  const greenMakes = g.gameState.makes - before;

  // Numerical stability over a burst of chaotic input.
  let finite = true;
  const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
  for (let i = 0; i < 600; i++) {
    g.input.keys.clear();
    if (i % 5 < 3) g.input.keys.add(keys[(i >> 2) % 4]);
    g._update(1 / 60);
    g.input.endFrame();
    const p = g.player.position;
    if (![p.x, p.y, p.z].every(Number.isFinite)) { finite = false; break; }
  }

  return {
    greenMakes,
    greenAttempts: 8,
    finite,
    percentage: g.gameState.percentage,
  };
});

console.log('Smoke result:', JSON.stringify(result));
console.log('Errors:', errors.length ? errors : 'none');

await browser.close();

const ok =
  errors.length === 0 &&
  result.finite &&
  result.greenMakes >= 6; // green should make the large majority
console.log(ok ? '\n✅ SMOKE TEST PASSED' : '\n❌ SMOKE TEST FAILED');
process.exit(ok ? 0 : 1);
