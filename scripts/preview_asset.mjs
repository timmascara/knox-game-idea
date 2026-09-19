/**
 * Screenshot a converted asset on its own, outside the game.
 *
 * `npm run assets` can report a clean conversion for a model that renders
 * wrong — foliage as solid rectangles, a flat trunk where a normal map was
 * dropped. The file size tells you nothing about that. This is how you look
 * at the thing before wiring it into the world.
 *
 *   npm run dev -- --port 5180        # in another shell
 *   node scripts/preview_asset.mjs tree
 *
 * Writes screenshots/asset_<name>_{front,side,low}.png and prints the model's
 * world bounds, which is usually the first surprise: packs are modelled at
 * wildly different scales and many "a tree" files hold a whole grove.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, cpSync, existsSync } from 'node:fs';

const name = process.argv[2] || 'tree';
const PORT = process.env.PREVIEW_PORT || 5180;
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync('screenshots', { recursive: true });

// The Draco decoder has to be served, not imported — copy it out of the
// package into public/ where vite will hand it over. Gitignored.
if (!existsSync('public/draco')) {
  mkdirSync('public', { recursive: true });
  cpSync('node_modules/three/examples/jsm/libs/draco', 'public/draco', { recursive: true });
}

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on('pageerror', (e) => console.error('pageerror:', e.message));

await page.goto(`http://127.0.0.1:${PORT}/asset-preview.html?asset=${encodeURIComponent(name)}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, { timeout: 120000 });

const err = await page.evaluate(() => window.__err);
if (err) { console.error(`failed to load ${name}.glb: ${err}`); await browser.close(); process.exit(1); }

const info = await page.evaluate(() => window.__info);
console.log(`${name}.glb  size ${info.size.join(' x ')} m   min ${info.min.join(',')}  max ${info.max.join(',')}`);

for (const [label, angle, elev] of [['front', 0, 0.3], ['side', Math.PI / 2, 0.3], ['low', 0.6, 0.02]]) {
  await page.evaluate(([a, e]) => window.__shot(a, e), [angle, elev]);
  await page.screenshot({ path: `screenshots/asset_${name}_${label}.png` });
}
console.log(`wrote screenshots/asset_${name}_{front,side,low}.png`);
await browser.close();
