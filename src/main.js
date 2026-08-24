import { Physics } from './physics/Physics.js';
import { Settings } from './state/Settings.js';
import { Game } from './core/Game.js';

/**
 * Boot sequence: initialise Rapier's WASM, build the game, and hand control to
 * the menu. A small loading overlay covers the async warm-up so the first frame
 * the player sees is already the park.
 */
async function boot() {
  const loading = document.getElementById('loading');
  const fill = document.getElementById('loading-fill');
  const text = document.getElementById('loading-text');
  const setProgress = (p, msg) => {
    fill.style.width = `${Math.round(p * 100)}%`;
    if (msg) text.textContent = msg;
  };

  try {
    setProgress(0.1, 'Warming up physics…');
    const physics = await Physics.init();

    setProgress(0.45, 'Building the park…');
    const settings = new Settings();
    // Yield a frame so the progress paint lands before the heavy world build.
    await new Promise((r) => requestAnimationFrame(r));

    const game = new Game(physics, settings);
    // Exposed for debugging / automated smoke tests.
    window.__game = game;
    setProgress(0.9, 'Chalking the lines…');

    game.start();
    setProgress(1.0, 'Ready.');
    setTimeout(() => loading.classList.add('hidden'), 350);
  } catch (err) {
    console.error(err);
    text.textContent = 'Something went wrong starting Home Court. Check the console.';
    fill.style.background = '#e0483a';
  }
}

boot();
