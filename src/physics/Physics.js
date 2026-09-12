import RAPIER from '@dimforge/rapier3d-compat';
import { GRAVITY } from '../core/Constants.js';

/**
 * Thin wrapper around a single Rapier world. One physics engine, authoritative
 * over the basketball, the court/rim/backboard collision, and the player capsule
 * (as a kinematic character controller).
 *
 * Rapier's WASM must be initialised once before any world is created; see
 * Physics.init().
 */
export class Physics {
  constructor() {
    this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    // A modest solver iteration count keeps the rim rattle stable.
    this.world.integrationParameters.numSolverIterations = 8;
    this.eventQueue = new RAPIER.EventQueue(true);
    this.RAPIER = RAPIER;
    this._contactListeners = [];
    this._tags = new Map(); // collider handle -> string tag
  }

  /**
   * Rapier's world defaults to a 1/60 s step. The game steps it at its own
   * fixed rate, so the two must agree or every free ball runs fast.
   */
  setTimestep(dt) {
    this.world.timestep = dt;
  }

  /** Associate a semantic tag with a collider handle (for collision audio). */
  tagCollider(collider, tag) {
    if (collider) this._tags.set(collider.handle, tag);
  }

  tagOf(handle) {
    return this._tags.get(handle);
  }

  static async init() {
    await RAPIER.init();
    return new Physics();
  }

  /** Fixed-step the simulation. */
  step() {
    this.world.step(this.eventQueue);
    if (this._contactListeners.length) {
      this.eventQueue.drainContactForceEvents((e) => {
        for (const l of this._contactListeners) l.force?.(e);
      });
      this.eventQueue.drainCollisionEvents((h1, h2, started) => {
        for (const l of this._contactListeners) l.collision?.(h1, h2, started);
      });
    }
  }

  onContact(listener) {
    this._contactListeners.push(listener);
  }

  createRigidBody(desc) {
    return this.world.createRigidBody(desc);
  }

  createCollider(desc, body) {
    return this.world.createCollider(desc, body);
  }

  removeRigidBody(body) {
    if (body) this.world.removeRigidBody(body);
  }

  removeCollider(col) {
    if (col) this.world.removeCollider(col, true);
  }
}

export { RAPIER };
