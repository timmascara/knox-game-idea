/**
 * Regression check for Rapier's contact prediction distance (Physics.js).
 *
 * Fires the same free ball at the glass from eleven sub-step phases and
 * prints the restitution each time. It must read 0.72 at every phase; with
 * Rapier's default 2 mm prediction distance the phases that end a step
 * 0.5-2 mm short of the board read 0.23-0.42, which is a bank layup dying
 * on the glass one time in eight. Needs `npm run preview` on :4173.
 *
 *   node scripts/restitution.mjs
 *   node scripts/restitution.mjs 0.002     (try another prediction distance)
 */
import { chromium } from 'playwright-core';

const pd = process.argv[2] ? parseFloat(process.argv[2]) : null;
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('hidden'), { timeout: 30000 });
const rows = await page.evaluate((pd) => {
  const g = window.__game;
  g.started = true; g.paused = false; g.menu.hide(); g.renderer.setAnimationLoop(null);
  g.dribble.state = 'loose';
  const ip = g.physics.world.integrationParameters;
  if (pd !== null) ip.normalizedPredictionDistance = pd;
  const out = [{ predictionDistance: +ip.normalizedPredictionDistance.toFixed(5) }];
  const from = [-0.19, 2.57, 11.89];
  const v = [0.25, 4.64, 1.38];
  for (let ph = 0; ph < 1; ph += 0.1) {
    const dt = (1 / 120) * ph;
    g.ball.setPositionHard({ x: from[0] + v[0] * dt, y: from[1] + v[1] * dt - 4.905 * dt * dt, z: from[2] + v[2] * dt });
    g.ball.setFree({ x: v[0], y: v[1] - 9.81 * dt, z: v[2] }, { x: 0, y: 0, z: 0 });
    let before = null;
    let after = null;
    let gap = null;
    for (let i = 0; i < 120; i++) {
      const vv = g.ball.velocity;
      const p = g.ball.position;
      if (vv.z > 0) {
        before = vv.z;
        gap = 12.425 + 0.3786 - p.z - 0.121;
      } else if (before !== null) {
        after = vv.z;
        break;
      }
      g._update(1 / 120);
      g.input.endFrame();
    }
    out.push({ phase: +ph.toFixed(1), gapBeforeBounce: +gap.toFixed(4), restitution: +(-after / before).toFixed(3) });
  }
  return out;
}, pd);
let bad = 0;
for (const r of rows) {
  if (r.restitution !== undefined && Math.abs(r.restitution - 0.72) > 0.06) bad++;
  console.log(JSON.stringify(r));
}
console.log(bad ? `❌ ${bad} phase(s) lost their bounce` : '✅ restitution 0.72 at every phase');
await browser.close();
process.exit(bad ? 1 : 0);
