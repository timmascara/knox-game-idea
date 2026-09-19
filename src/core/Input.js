import { DEFAULT_BINDINGS } from './Bindings.js';

/**
 * Keyboard + mouse + pointer-lock input. Exposes a per-frame snapshot the rest
 * of the game reads. Mouse deltas accumulate between frames and are consumed by
 * the camera each update.
 *
 * Mouse buttons are tracked as codes (`Mouse0`, `Mouse2`) in the same sets as
 * keys, so an action can be bound to either; game code asks for actions
 * (`down('shoot')`, `pressedAction('jump')`) rather than physical keys.
 */
export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.bindings = { ...DEFAULT_BINDINGS };
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;

    // Edge-triggered button state.
    this.pressed = new Set();
    this.released = new Set();
    this.mouseDown = { left: false, right: false };
    this.mousePressed = { left: false, right: false };
    this.mouseReleased = { left: false, right: false };

    this.sensitivity = 0.0022;
    this.invertY = false;

    // Fallback for hosts that refuse pointer lock (embedded frames): read
    // mouse deltas and buttons without the lock.
    this.allowUnlocked = false;
    // Unlocked-mode cursor position on the canvas, normalised to -1..1.
    this.cursor = { x: 0, y: 0, inside: false };
    this._enabled = true;
    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const code = e.code;
      if (!this.keys.has(code)) this.pressed.add(code);
      this.keys.add(code);
      // Prevent the page from scrolling on space etc. while playing.
      if ((this.locked || this.allowUnlocked) && ['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked && !this.allowUnlocked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
      if (!this.locked) {
        const r = this.dom.getBoundingClientRect();
        this.cursor.x = ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1;
        this.cursor.y = ((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1;
        this.cursor.inside = true;
      }
    });
    document.addEventListener('mouseleave', () => { this.cursor.inside = false; });
    window.addEventListener('blur', () => { this.cursor.inside = false; });

    document.addEventListener('mousedown', (e) => {
      if (!this.locked && !this.allowUnlocked) return;
      if (e.target && e.target.closest && e.target.closest('.overlay, #tuning')) return;
      // Playing unlocked: keep asking for the lock on every click — some
      // hosts only grant it from a click directly on the canvas.
      if (!this.locked && this.allowUnlocked && e.target === this.dom) this.requestLock();
      const code = `Mouse${e.button}`;
      if (!this.keys.has(code)) this.pressed.add(code);
      this.keys.add(code);
      if (e.button === 0) {
        this.mouseDown.left = true;
        this.mousePressed.left = true;
      }
      if (e.button === 2) {
        this.mouseDown.right = true;
        this.mousePressed.right = true;
      }
    });
    document.addEventListener('mouseup', (e) => {
      const code = `Mouse${e.button}`;
      this.keys.delete(code);
      this.released.add(code);
      if (e.button === 0) {
        this.mouseDown.left = false;
        this.mouseReleased.left = true;
      }
      if (e.button === 2) {
        this.mouseDown.right = false;
        this.mouseReleased.right = true;
      }
    });
    document.addEventListener('contextmenu', (e) => {
      if (this.locked || this.allowUnlocked) e.preventDefault();
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      if (!this.locked) {
        this.keys.clear();
        this.mouseDown.left = false;
        this.mouseDown.right = false;
      }
      this.onLockChange?.(this.locked);
    });
  }

  requestLock() {
    try {
      const r = this.dom.requestPointerLock?.();
      if (r && r.catch) r.catch(() => {});
    } catch (e) {
      /* host refused; the unlocked fallback takes over */
    }
  }

  exitLock() {
    document.exitPointerLock?.();
  }

  setBindings(map) {
    this.bindings = { ...DEFAULT_BINDINGS, ...(map || {}) };
  }

  // --- Actions (through the binding map) ------------------------------------
  down(action) {
    return this.isDown(this.bindings[action]);
  }

  pressedAction(action) {
    const c = this.bindings[action];
    if (this.pressed.has(c)) return true;
    // The harnesses poke mousePressed directly; honour that for mouse codes.
    if (c === 'Mouse0' && this.mousePressed.left) return true;
    if (c === 'Mouse2' && this.mousePressed.right) return true;
    return false;
  }

  releasedAction(action) {
    const c = this.bindings[action];
    if (this.released.has(c)) return true;
    if (c === 'Mouse0' && this.mouseReleased.left) return true;
    if (c === 'Mouse2' && this.mouseReleased.right) return true;
    return false;
  }

  isDown(code) {
    return this.keys.has(code);
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  wasReleased(code) {
    return this.released.has(code);
  }

  /**
   * Consume accumulated mouse look, returning {dx, dy} in radians. Without a
   * pointer lock the cursor stops at the frame edge, so an edge zone keeps
   * the view turning: push the cursor toward an edge to keep turning that
   * way, bring it back toward the centre to stop.
   */
  consumeLook(dt = 0) {
    let dx = this.mouseDX * this.sensitivity;
    let dy = this.mouseDY * this.sensitivity * (this.invertY ? -1 : 1);
    this.mouseDX = 0;
    this.mouseDY = 0;
    if (!this.locked && this.allowUnlocked && dt > 0) {
      const zone = 0.72; // beyond ±zone the edge turn engages
      const rate = 2.4; // rad/s at the very edge
      const edge = (v) => {
        const a = Math.abs(v);
        if (a <= zone) return 0;
        const k = Math.min(1, (a - zone) / (1 - zone));
        return Math.sign(v) * k * k * rate * dt;
      };
      dx += edge(this.cursor.x);
      dy += edge(this.cursor.y) * 0.6 * (this.invertY ? -1 : 1);
    }
    return { dx, dy };
  }

  /** Movement axis from WASD, normalised. x = strafe (+right), z = forward(+). */
  moveAxis() {
    let x = 0;
    let z = 0;
    if (this.keys.has('KeyW')) z += 1;
    if (this.keys.has('KeyS')) z -= 1;
    if (this.keys.has('KeyD')) x += 1;
    if (this.keys.has('KeyA')) x -= 1;
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    return { x, z, magnitude: Math.min(1, len) };
  }

  /** Call at the end of every frame to clear edge-triggered state. */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mousePressed.left = false;
    this.mousePressed.right = false;
    this.mouseReleased.left = false;
    this.mouseReleased.right = false;
  }
}
