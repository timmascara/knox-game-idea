/**
 * Keyboard + mouse + pointer-lock input. Exposes a per-frame snapshot the rest
 * of the game reads. Mouse deltas accumulate between frames and are consumed by
 * the camera each update.
 */
export class Input {
  constructor(domElement) {
    this.dom = domElement;
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
      if (this.locked && ['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });

    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
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
      if (this.locked) e.preventDefault();
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
    this.dom.requestPointerLock?.();
  }

  exitLock() {
    document.exitPointerLock?.();
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

  /** Consume accumulated mouse look, returning {dx, dy} in radians. */
  consumeLook() {
    const dx = this.mouseDX * this.sensitivity;
    const dy = this.mouseDY * this.sensitivity * (this.invertY ? -1 : 1);
    this.mouseDX = 0;
    this.mouseDY = 0;
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
