/**
 * Rebindable actions. Every action maps to one key code (`KeyE`, `Space`,
 * `ShiftLeft` …) or one mouse button (`Mouse0` left, `Mouse1` middle,
 * `Mouse2` right). The map lives in Settings, is edited from the pause
 * menu's Controls panel, and is read by Input each frame — nothing in the
 * game checks a physical key directly except WASD movement and the menu's
 * own keys (Tab, Esc).
 */
export const DEFAULT_BINDINGS = {
  jump: 'Space',
  shoot: 'Mouse2',
  crossover: 'Mouse0',
  between: 'KeyV',
  behind: 'KeyQ',
  inout: 'KeyF',
  hesitation: 'KeyR',
  low: 'KeyC',
  pickup: 'KeyE',
  drop: 'KeyG',
  sprint: 'ShiftLeft',
};

/** Order and wording for the Controls panel and the start-menu list. */
export const BINDING_LABELS = [
  ['shoot', 'Shoot (hold, let go in the green)'],
  ['jump', 'Jump'],
  ['pickup', 'Pick up · hold ↔ dribble'],
  ['crossover', 'Crossover · with S held: step-back'],
  ['between', 'Between the legs'],
  ['behind', 'Behind the back'],
  ['inout', 'In & out'],
  ['hesitation', 'Hesitation'],
  ['low', 'Low dribble (hold)'],
  ['drop', 'Drop the ball'],
  ['sprint', 'Sprint'],
];

/** Human name for a code. */
export function codeLabel(code) {
  if (!code) return '—';
  const mouse = { Mouse0: 'Left click', Mouse1: 'Middle click', Mouse2: 'Right click' };
  if (mouse[code]) return mouse[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const named = {
    Space: 'Space',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    ControlLeft: 'Left Ctrl',
    ControlRight: 'Right Ctrl',
    AltLeft: 'Left Alt',
    AltRight: 'Right Alt',
    Tab: 'Tab',
    Enter: 'Enter',
    Backspace: 'Backspace',
    CapsLock: 'Caps Lock',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
  };
  return named[code] || code;
}

/** Keys the game reserves; they cannot be bound to an action. */
export const RESERVED_CODES = new Set(['Escape', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);
