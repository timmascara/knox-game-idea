/**
 * Shot lab. Fires a timing zone from a list of court spots and reports, for
 * each shot, the zone the game graded, the physical result (swish / made /
 * iron / glass / air), rim and board hit counts, the apex, where the ball
 * crossed the rim plane, and the release continuity — so an outcome's aim
 * point can be tuned against the real physics without playing.
 *
 *   npm run build && npm run preview          # serves dist on :4173
 *   ZONE=green node scripts/shots.mjs
 *   ZONE=iron ERRS=0.04,-0.04 SPOTS='[[0,6.5],[3.5,7.5]]' PARAMS='{"ironDepth":0.05}' node scripts/shots.mjs
 *
 * ZONE   green | iron | glass | air — decides the default ERRS and what counts as correct
 * ERRS   signed timing errors (s) to release at; quantised to the 120 Hz tick,
 *        so a value right at a zone boundary can grade as the neighbour
 * SPOTS  [x, z] court positions (the near hoop is at z = 12.425)
 * PARAMS overrides written into the live SHOT constants before shooting
 */
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('hidden'), { timeout: 30000 });
const zone = process.env.ZONE || 'iron';
const errs = (process.env.ERRS || (zone==='green'?'0.005':zone==='iron'?'0.05,-0.05':zone==='glass'?'0.1,-0.1':'0.2,-0.25')).split(',').map(Number);
const spots = JSON.parse(process.env.SPOTS || '[[0,6.5],[0,8.5],[3.5,7.5],[-5.5,11.5],[0,3.6],[6.2,12.2],[-2,5],[4.5,10.5],[0,10.8],[-6.5,9.5]]');
const params = JSON.parse(process.env.PARAMS || '{}');
const r = await page.evaluate(async ({ spots, errs, params, zone }) => {
  const g = window.__game; const d = g.dribble; g.started = true; g.paused = false; g.menu.hide(); g.hud.show(); g.renderer.setAnimationLoop(null);
  const DT = 1 / 120;
  const tick = (n) => { for (let i = 0; i < n; i++) { g._update(DT); g.input.endFrame(); } };
  const hold = (x, z) => {
    g.player.teleport({ x, y: 0.02, z }); g.player.velocity.set(0,0,0); g.player.vy = 0; g.player.grounded = true;
    g.cameraRig.yaw = Math.atan2(-(0 - x), -(12.425 - z)); g.cameraRig.pitch = 0.1; g.cameraRig.applyLook(0,0);
    d._ft = null; d.shot = null; d.tracker = null; d._shooting = false; g.player.lockMove = false;
    d._updateFrame(0, true); g.ball.setControlled(); d.state = 'hold'; d.t = 0; d.plan = null; d.flight = null; d.contact = null;
    d.ballLocal.set(0, 1.14, 0.40); d.ballVelLocal.set(0,0,0); tick(30); g.hands.snapToTargets();
  };
  const out = [];
  for (const [k, v] of Object.entries(params)) window.__CONST.SHOT[k] = v;
  for (const [x, z] of spots) for (const e of errs) {
    hold(x, z);
    const dist0 = Math.hypot(x, 12.425 - z);
    const isLayup = dist0 < window.__CONST.SHOT.layupRange;
    const layupIdeal = window.__CONST.SHOT.layupJumpSpeed / 18 + window.__CONST.SHOT.layupReleaseAfterApex;
    const target = (isLayup ? layupIdeal : 0.62) + e;
    const S = g.input.bindings.shoot; const J = g.input.bindings.jump;
    // A jumper is hold-then-release; a layup is the jump key, then a tap of the shoot key.
    g.input.pressed.add(isLayup ? J : S); g.input.keys.add(isLayup ? J : S); g._update(DT); g.input.endFrame(); if (isLayup) g.input.keys.delete(J);
    let guard = 0; let released = false;
    while (d.state !== 'loose' && d.state !== 'hold' && guard++ < 400) {
      if (isLayup) {
        if (!released && d.shot && d.shot.t >= target - 1e-6) { g.input.pressed.add(S); released = true; }
      } else if (d.shot && d.shot.t < target - 1e-6) g.input.keys.add(S); else if (!released) { g.input.keys.delete(S); g.input.released.add(S); released = true; }
      g._update(DT); g.input.endFrame();
    }
    let ft = 0; let maxH = 0; let minBoard = Infinity; let rimPlane = null; let hits = [];
    while (d.tracker && ft < 900) {
      tick(1); ft++;
      const p = g.ball.position; maxH = Math.max(maxH, p.y);
      if (d.tracker && rimPlane === null && d.tracker.rimPlaneOffset !== null) rimPlane = d.tracker.rimPlaneOffset;
      if (d.tracker) { const t = d.tracker; const key = `${t.rimHits}/${t.boardHits}`; if (hits[hits.length-1] !== key) hits.push(key); }
    }
    const ls = d.lastShot;
    out.push({ spot: [x, z], kind: ls?.kind, err: e, zone: ls?.zone, result: ls?.result, dist: +ls?.dist.toFixed(2), jump: +d.lastReleaseJump.toFixed(2), hits: hits.join(' '), apex: +maxH.toFixed(2), rimPlane: rimPlane === null ? null : +rimPlane.toFixed(3) });
  }
  return out;
}, { spots, errs, params, zone });
let good = 0;
for (const row of r) { const ok = (zone === 'green' && row.result === 'swish') || (zone !== 'green' && row.result === zone); good += ok; console.log((ok ? '  ' : '✗ ') + JSON.stringify(row)); }
console.log(`${zone}: ${good}/${r.length} correct`, errors.length ? errors : '');
await browser.close();
