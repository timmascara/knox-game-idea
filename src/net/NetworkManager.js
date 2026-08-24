/**
 * Multiplayer seam. Home Court ships single-player, but the game loop is
 * written to talk to this interface so a networked build can be added without
 * rebuilding gameplay:
 *
 *   - The local player publishes a lightweight state snapshot each frame
 *     (position, look, possession, ball transform) via publishLocalState().
 *   - Remote players/ball would arrive through onRemoteState and be rendered by
 *     interpolating snapshots (proxy avatars), never by making one browser
 *     authoritative over everyone.
 *
 * The default transport is a no-op LocalTransport. A real build swaps in a
 * WebSocket/WebRTC transport that relays through an authoritative server which
 * owns ball possession and shot resolution.
 */
export class NetworkManager {
  constructor(transport = new LocalTransport()) {
    this.transport = transport;
    this.connected = false;
    this.localId = null;
    this.remotePlayers = new Map();
    this.tickRate = 20; // Hz for state broadcast
    this._acc = 0;
    this.transport.onMessage = (msg) => this._onMessage(msg);
  }

  async connect(roomId = 'park-1') {
    this.localId = await this.transport.connect(roomId);
    this.connected = true;
    return this.localId;
  }

  disconnect() {
    this.transport.disconnect?.();
    this.connected = false;
  }

  /** Build a compact snapshot of the local player + owned ball. */
  static snapshot(player, cameraRig, ballController) {
    const p = player.position;
    return {
      t: performance.now(),
      pos: [round(p.x), round(p.y), round(p.z)],
      yaw: round(cameraRig.yaw),
      pitch: round(cameraRig.pitch),
      possession: ballController.mode,
    };
  }

  update(dt, snapshot) {
    if (!this.connected) return;
    this._acc += dt;
    if (this._acc >= 1 / this.tickRate) {
      this._acc = 0;
      this.transport.send({ type: 'state', id: this.localId, snapshot });
    }
  }

  _onMessage(msg) {
    if (msg.type === 'state' && msg.id !== this.localId) {
      this.remotePlayers.set(msg.id, msg.snapshot);
      this.onRemoteState?.(msg.id, msg.snapshot);
    } else if (msg.type === 'leave') {
      this.remotePlayers.delete(msg.id);
      this.onRemoteLeave?.(msg.id);
    }
  }
}

function round(v) {
  return Math.round(v * 1000) / 1000;
}

/** No-op transport for single-player. Swap for a networked one later. */
export class LocalTransport {
  async connect() {
    return 'local-player';
  }
  send() {}
  disconnect() {}
}
