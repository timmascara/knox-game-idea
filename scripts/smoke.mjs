/**
 * Headless smoke test for Home Court (dribble lab).
 *
 * Boots the built game in Chromium (WebGL via SwiftShader), verifies it
 * reaches a ready state without console/page errors, then pumps the fixed-step
 * loop to exercise the real dribble engine: pickup, pound dribble, every move,
 * sprinting, dropping and re-gathering, then shooting: a green release from
 * the hold, a pull-up out of a moving dribble, and early / late releases. It
 * asserts the physical invariants the feel depends on — the ball never dips
 * under the court, its velocity is continuous across catch/release and
 * through the whole jumper, the hand is on the ball at every catch and
 * through the shot, every move hands off to the intended hand and returns to
 * a pound rhythm, a green release swishes and off-timing lands in its zone —
 * and that nothing goes non-finite.
 *
 * Usage:
 *   npm run build && npm run preview   # serves dist on :4173
 *   node scripts/smoke.mjs
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const URL = process.env.SMOKE_URL || 'http://127.0.0.1:4173/';
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) errors.push(`console: ${m.text()}`);
});

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('hidden'), { timeout: 30000 });
await page.screenshot({ path: `${OUT}/menu.png` });

const result = await page.evaluate(() => {
  const g = window.__game;
  const d = g.dribble;
  g.started = true;
  g.paused = false;
  g.menu.hide();
  g.hud.show();
  g.renderer.setAnimationLoop(null);
  const DT = 1 / 120;
  const R = 0.121;
  const fails = [];
  const check = (ok, msg) => { if (!ok) fails.push(msg); };

  let prevVel = null;
  let prevPos = null;
  let prevFeet = null;
  let prevBounces = 0;
  let maxJump = 0; // largest change of the engine's ball velocity in one tick
  let maxStep = 0; // largest world-space ball displacement in one tick
  let minY = Infinity;
  const tick = (n, keys = [], mouse = null) => {
    for (let i = 0; i < n; i++) {
      for (const k of keys) g.input.keys.add(k);
      if (mouse && i === 0) g.input.mousePressed[mouse] = true;
      g._update(DT);
      g.input.endFrame();
      for (const k of keys) g.input.keys.delete(k);
      if (d.hasBall) {
        const p = d.ballWorld;
        minY = Math.min(minY, p.y - R);
        if (![p.x, p.y, p.z].every(Number.isFinite)) fails.push('ball position non-finite');
        const f = g.player.position;
        if (prevPos) {
          // Ball displacement relative to the body, so running (or the shot's hop) doesn't count.
          const step = Math.hypot(p.x - prevPos.x - (f.x - prevFeet.x), p.y - prevPos.y - (f.y - prevFeet.y), p.z - prevPos.z - (f.z - prevFeet.z));
          if (step > maxStep) { maxStep = step; window.__stepAt = { state: d.state, plan: d.plan?.name, t: d.t, phase: window.__phase, local: [d.ballLocal.x, d.ballLocal.y, d.ballLocal.z], prevLocal: window.__prevLocal, flight: d.flight && { t1: d.flight.t1, T: d.flight.T, A: d.flight.A.toArray(), B: d.flight.B.toArray(), vh: [d.flight.vh.x, d.flight.vh.y] } }; }
        }
        if (d.stats.maxHandGap > (window.__gapMax || 0)) { window.__gapMax = d.stats.maxHandGap; window.__gapAt = { state: d.state, plan: d.plan?.name, t: d.t, phase: window.__phase }; }
        if (p.y - R < minY + 1e-9 && p.y - R < 0) window.__minAt = { state: d.state, plan: d.plan?.name, t: d.t, phase: window.__phase };
        prevPos = { x: p.x, y: p.y, z: p.z };
        window.__prevLocal = [d.ballLocal.x, d.ballLocal.y, d.ballLocal.z];
        prevFeet = { x: f.x, y: f.y, z: f.z };
        if (d.dribbling || d.shooting) {
          const v = d.ballVelLocal;
          const bounced = d.stats.bounces !== prevBounces;
          prevBounces = d.stats.bounces;
          if (prevVel && !bounced) {
            const j = Math.hypot(v.x - prevVel.x, v.y - prevVel.y, v.z - prevVel.z);
            if (j > maxJump) { maxJump = j; window.__jumpAt = { state: d.state, plan: d.plan?.name, t: d.t, phase: window.__phase, v: [v.x, v.y, v.z], pv: [prevVel.x, prevVel.y, prevVel.z] }; }
          }
          prevVel = { x: v.x, y: v.y, z: v.z };
        } else prevVel = null;
      } else { prevPos = null; prevVel = null; prevFeet = null; }
    }
  };
  const press = (code) => { g.input.pressed.add(code); g.input.keys.add(code); };

  window.__phase = 'pickup';
  // 1) Walk into the loose ball → gather → hold.
  g.cameraRig.pitch = -0.4;
  tick(240, ['KeyW']);
  check(d.state === 'hold' || d.state === 'gather', `expected hold after walking into the ball, got ${d.state}`);
  tick(120);
  check(d.state === 'hold', `expected hold, got ${d.state}`);

  window.__phase = 'pound';
  // 2) Start a right-hand dribble and settle into a rhythm.
  tick(1, [], 'left');
  tick(600);
  check(d.dribbling, `expected dribbling, got ${d.state}`);
  check(d.sign === 1, 'expected right hand');
  const c0 = d.stats.catches;
  tick(600);
  const catches = d.stats.catches - c0;
  check(catches >= 6 && catches <= 10, `pound cadence off: ${catches} catches in 5 s`);

  // 3) Every move hands off to the right hand and returns to a pound.
  const moves = [
    ['crossover', 'left', -1],
    ['between', 'right', 1],
    ['behind', 'KeyQ', -1],
    ['inout', 'KeyF', -1],
    ['hesitation', 'KeyR', -1],
    ['stepback', 'left', 1, ['KeyS']],
  ];
  const handoffs = [];
  for (const [name, key, expectSign, hold] of moves) {
    window.__phase = name;
    // wait for a fresh catch so the buffer is consumed predictably
    while (d.state !== 'flight') tick(1);
    const before = d.sign;
    if (key === 'left' || key === 'right') tick(1, hold || [], key); else { press(key); tick(1, hold || []); }
    // run until the move plan has played and the next plan is a pound
    let guard = 0;
    let seen = false;
    while (guard++ < 400) {
      tick(1, hold && guard < 40 ? hold : []);
      if (d.plan?.name === name) seen = true;
      if (seen && d.plan?.name === 'pound' && d.state === 'contact') break;
    }
    check(seen, `move ${name} never played`);
    check(d.sign === expectSign, `after ${name}: expected hand ${expectSign}, got ${d.sign} (from ${before})`);
    handoffs.push(`${name}:${before}->${d.sign}`);
  }

  window.__phase = 'sprint';
  // 4) Speed dribble while sprinting: the ball stays ahead of the feet.
  tick(360, ['KeyW', 'ShiftLeft']);
  const lead = d.ballLocal.z;
  check(g.player.planarSpeed > 5, `sprint speed ${g.player.planarSpeed.toFixed(2)}`);
  check(lead > 0.6, `ball not pushed ahead while sprinting (z=${lead.toFixed(2)})`);
  check(d.dribbling, 'lost the ball while sprinting');
  tick(240);

  window.__phase = 'low';
  // 5) Low dribble is faster.
  const lowC0 = d.stats.catches;
  tick(600, ['KeyC']);
  const lowCatches = d.stats.catches - lowC0;
  check(lowCatches > catches, `low dribble not faster (${lowCatches} vs ${catches})`);

  window.__phase = 'combo';
  // 6) Combo buffering: two inputs queue two moves.
  while (d.state !== 'flight') tick(1);
  tick(1, [], 'left');
  press('KeyQ');
  tick(1);
  check(d.queue.length === 2 || d.plan?.name === 'crossover', `queue not buffered: ${d.queue.join(',')}`);
  const labels = [];
  for (let i = 0; i < 400; i++) { tick(1); if (d.plan?.label && labels[labels.length - 1] !== d.plan.label) labels.push(d.plan.label); }
  check(labels.includes('CROSSOVER') && labels.includes('BEHIND THE BACK'), `combo did not chain: ${labels.join(' > ')}`);

  window.__phase = 'drop';
  // 7) Drop, chase, re-gather.
  press('KeyG');
  tick(1);
  check(d.state === 'loose', `drop failed (state ${d.state})`);
  for (let i = 0; i < 600 && !d.hasBall; i++) {
    const b = g.ball.position;
    const p = g.player.position;
    g.cameraRig.yaw = Math.atan2(-(b.x - p.x), -(b.z - p.z));
    tick(1, ['KeyW']);
  }
  check(d.hasBall, `did not re-gather the ball (state ${d.state})`);

  // 8) Shooting. Hold Space, let go `release` seconds into the shot, then run
  //    until the flight is decided. Continuity is measured by the same tick
  //    monitor through gather, set, rise and flick.
  const shoot = (release, keys = []) => {
    g.input.pressed.add('Space');
    tick(1, ['Space', ...keys]);
    let guard = 0;
    while (d.state !== 'loose' && guard++ < 400) {
      const holding = d.shot && d.shot.t < release - 1e-6;
      if (!holding && g.input.keys.has('Space')) { g.input.keys.delete('Space'); g.input.released.add('Space'); }
      tick(1, holding ? ['Space', ...keys] : keys);
    }
    check(d.state === 'loose', `shot never released (state ${d.state})`);
    for (let i = 0; i < 900 && d.tracker; i++) tick(1);
    check(!d.tracker, 'shot never resolved');
    return d.lastShot;
  };
  const faceHoop = (x, z) => {
    g.player.teleport({ x, y: 0.02, z });
    g.player.velocity.set(0, 0, 0);
    g.cameraRig.yaw = Math.atan2(-(0 - x), -(12.425 - z));
    g.cameraRig.pitch = 0.1;
    g.cameraRig.applyLook(0, 0);
    // A teleport is not ball motion: snap the handle frame to the new spot.
    d._updateFrame(0, true);
    prevPos = null; prevFeet = null; prevVel = null;
  };
  const shots = [];
  window.__phase = 'shoot-green';
  // a) From the hold at the top of the key: green → swish.
  while (d.state !== 'hold' && d.state !== 'loose') { press('KeyE'); tick(1); tick(30); }
  check(d.state === 'hold', `expected hold before shooting, got ${d.state}`);
  faceHoop(0, 6.5);
  tick(30);
  let ls = shoot(0.62);
  shots.push(`${ls?.zone}:${ls?.result}`);
  check(ls?.zone === 'green' && ls?.result === 'swish', `green release should swish, got ${ls?.zone}:${ls?.result}`);
  check(d.stats.maxReleaseJump < 0.5, `release velocity mismatch ${d.stats.maxReleaseJump.toFixed(2)} m/s`);

  window.__phase = 'shoot-pullup';
  // b) Pull-up out of a moving dribble, running in from the wing, still green.
  faceHoop(6.0, 1.5);
  g.ball.setControlled(); d.state = 'hold'; d.plan = null; d.flight = null; d.contact = null; d._ft = null; d.tracker = null;
  d._updateFrame(0, true); d.ballLocal.set(0, 1.14, 0.40); d.ballVelLocal.set(0, 0, 0);
  tick(20);
  tick(1, [], 'left');
  tick(150, ['KeyW']);
  check(d.dribbling && g.player.planarSpeed > 2, `expected a moving dribble before the pull-up (${d.state}, ${g.player.planarSpeed.toFixed(1)} m/s)`);
  const pullupDist = Math.hypot(g.player.position.x, g.player.position.z - 12.425);
  check(pullupDist > 3.5, `pull-up too close to the rim (${pullupDist.toFixed(1)} m)`);
  ls = shoot(0.62, ['KeyW']);
  shots.push(`${ls?.zone}:${ls?.result}`);
  check(ls?.zone === 'green' && (ls?.result === 'swish' || ls?.result === 'made'), `pull-up should go in, got ${ls?.zone}:${ls?.result}`);

  // c) Off timing lands in its zone: late → glass, very early → airball, a touch late → back iron.
  for (const [release, zone, phase] of [[0.73, 'glass', 'shoot-glass'], [0.40, 'air', 'shoot-air'], [0.67, 'iron', 'shoot-iron']]) {
    window.__phase = phase;
    faceHoop(-2.5, 7.5);
    g.ball.setControlled(); d.state = 'hold'; d.plan = null; d.flight = null; d.contact = null; d._ft = null; d.tracker = null;
    d._updateFrame(0, true); d.ballLocal.set(0, 1.14, 0.40); d.ballVelLocal.set(0, 0, 0);
    tick(20);
    ls = shoot(release);
    shots.push(`${ls?.zone}:${ls?.result}`);
    check(ls?.zone === zone && ls?.result === zone, `release at ${release}s should be ${zone}, got ${ls?.zone}:${ls?.result}`);
  }
  check(d.stats.maxReleaseJump < 0.5, `release velocity mismatch ${d.stats.maxReleaseJump.toFixed(2)} m/s`);
  check(g.player.grounded && !g.player.lockMove, 'player still locked after the shot');

  // Invariants.
  check(minY > -0.01, `ball went under the court by ${(-minY).toFixed(3)} m`);
  check(maxJump < 3.0, `ball velocity discontinuity: ${maxJump.toFixed(2)} m/s in one tick`);
  check(maxStep < 0.09, `ball teleported: ${maxStep.toFixed(3)} m in one tick`);
  check(d.stats.maxHandGap < 0.03, `hand left the ball while carrying: gap ${d.stats.maxHandGap.toFixed(3)} m`);
  const p = g.player.position;
  check([p.x, p.y, p.z].every(Number.isFinite), 'player position non-finite');

  return {
    fails,
    catchesPer5s: catches,
    lowCatchesPer5s: lowCatches,
    bounces: d.stats.bounces,
    minBallClearance: minY,
    maxVelJump: maxJump,
    maxStep,
    maxHandGap: d.stats.maxHandGap,
    handoffs,
    combo: labels,
    shots,
    maxReleaseJump: d.stats.maxReleaseJump,
    stepAt: window.__stepAt,
    jumpAt: window.__jumpAt,
    gapAt: window.__gapAt,
    minAt: window.__minAt,
  };
});

await page.screenshot({ path: `${OUT}/smoke-end.png` });
console.log('Smoke result:', JSON.stringify(result, null, 2));
console.log('Errors:', errors.length ? errors : 'none');
await browser.close();

const ok = errors.length === 0 && result.fails.length === 0;
console.log(ok ? '\n✅ SMOKE TEST PASSED' : '\n❌ SMOKE TEST FAILED');
process.exit(ok ? 0 : 1);
