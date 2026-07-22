'use strict';

/**
 * room-registry.js — WebSocket-agnostic room & peer manager.
 *
 * Extracted from server.js so the signaling logic can be unit-tested without a
 * live socket, and so it can support a real multi-peer topology: one **host**
 * PC serving **N client** PCs (each client is an extended-display surface).
 *
 * A "peer" is any object with a `send(obj)` method. The registry assigns each
 * joined peer an `id` and `role`, tracks room membership, and routes signaling
 * messages either to a specific peer (`data.to`) or, for backward compatibility
 * with the original 2-peer broadcast flow, to every other peer in the room.
 *
 * Design notes:
 *  - The host is authenticated by presenting the room's `hostToken`. A peer that
 *    claims `role: 'host'` without the token is rejected. This closes a real gap
 *    where any socket could previously act as the screen-sharing host.
 *  - A reconnecting host (whose stale socket may not have been cleaned up yet)
 *    evicts the stale host rather than being locked out — reconnection safety.
 */

const crypto = require('crypto');

// Ambiguity-free charset (no O/0/I/1) — 32 chars → no modulo bias on a byte.
const CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RELAY_TYPES = new Set(['offer', 'answer', 'ice-candidate']);

function generateRoomCode() {
  let code = '';
  const bytes = new Uint8Array(6);
  crypto.webcrypto.getRandomValues(bytes);
  for (let i = 0; i < 6; i++) code += CODE_CHARSET[bytes[i] % CODE_CHARSET.length];
  return code;
}

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

function generatePeerId() {
  return crypto.randomBytes(8).toString('hex');
}

class RoomRegistry {
  /**
   * @param {object} [opts]
   * @param {number} [opts.ttlMs]           Room lifetime.
   * @param {number} [opts.maxRooms]        Hard cap on concurrent rooms.
   * @param {number} [opts.maxPeersPerRoom] Host + clients per room.
   * @param {number} [opts.idleMs]          Empty-room grace before the sweeper reaps it.
   */
  constructor(opts = {}) {
    this.ttlMs = opts.ttlMs ?? 30 * 60 * 1000;
    this.maxRooms = opts.maxRooms ?? 500;
    this.maxPeersPerRoom = opts.maxPeersPerRoom ?? 8;
    this.idleMs = opts.idleMs ?? 5 * 60 * 1000;
    this.rooms = new Map();
  }

  get size() {
    return this.rooms.size;
  }

  createRoom(now = Date.now()) {
    if (this.rooms.size >= this.maxRooms) return { error: 'capacity' };
    let id = generateRoomCode();
    while (this.rooms.has(id)) id = generateRoomCode();
    const room = {
      id,
      createdAt: now,
      expiresAt: now + this.ttlMs,
      status: 'waiting',
      peers: new Map(),
      hostId: null,
      hostToken: generateToken(),
    };
    this.rooms.set(id, room);
    return { roomId: id, hostToken: room.hostToken, expiresAt: room.expiresAt };
  }

  getRoom(id) {
    return this.rooms.get(String(id || '').toUpperCase());
  }

  validateRoom(id, now = Date.now()) {
    const room = this.getRoom(id);
    if (!room) return { valid: false, code: 404, message: 'Room code does not exist.' };
    if (now > room.expiresAt) {
      this.rooms.delete(room.id);
      return { valid: false, code: 410, message: 'Room code has expired.' };
    }
    if (room.peers.size >= this.maxPeersPerRoom) {
      return { valid: false, code: 409, message: 'Room is already full.' };
    }
    return { valid: true, code: 200, status: room.status, peerCount: room.peers.size };
  }

  /**
   * Add `peer` to a room. Returns `{ ok, code, message?, peerId?, role?, room? }`.
   * Mutates `peer` with `.id`, `.role`, `._roomId` on success.
   */
  join(roomId, peer, { role, hostToken } = {}, now = Date.now()) {
    const room = this.getRoom(roomId);
    if (!room) return { ok: false, code: 404, message: 'Room code does not exist.' };
    if (now > room.expiresAt) {
      this.rooms.delete(room.id);
      return { ok: false, code: 410, message: 'Room session has expired.' };
    }

    // Resolve role. Presenting the valid host token grants (and re-claims) the
    // host slot; claiming host without it is rejected.
    const presentsHostToken = Boolean(hostToken) && hostToken === room.hostToken;
    if (!presentsHostToken && role === 'host') {
      return { ok: false, code: 403, message: 'Invalid host credentials.' };
    }

    let evicted = null;
    if (presentsHostToken && room.hostId && room.peers.has(room.hostId)) {
      // Reconnecting host — evict the stale host so the room is never locked.
      evicted = room.peers.get(room.hostId);
      room.peers.delete(room.hostId);
      room.hostId = null;
    }

    if (room.peers.size >= this.maxPeersPerRoom) {
      return { ok: false, code: 409, message: 'Room capacity reached.' };
    }

    const id = generatePeerId();
    peer.id = id;
    peer.role = presentsHostToken ? 'host' : 'client';
    peer._roomId = room.id;
    room.peers.set(id, peer);
    if (peer.role === 'host') room.hostId = id;
    if (room.peers.size >= 2) room.status = 'connected';

    return { ok: true, code: 200, peerId: id, role: peer.role, room, evicted };
  }

  peersOf(room) {
    return [...room.peers.values()];
  }

  othersOf(room, peer) {
    return this.peersOf(room).filter((p) => p.id !== peer.id);
  }

  /**
   * Relay a signaling message from `peer`. If `data.to` names a peer in the same
   * room, deliver only to that peer; otherwise broadcast to every other peer
   * (legacy 2-peer behaviour). The sender's id is stamped as `from` so a host
   * can tell which client an answer/candidate came from.
   * Returns `{ ok, count }`.
   */
  relay(peer, data) {
    const room = peer._roomId ? this.rooms.get(peer._roomId) : null;
    if (!room || !room.peers.has(peer.id)) return { ok: false, count: 0 };
    if (!data || !RELAY_TYPES.has(data.type)) return { ok: false, count: 0 };

    let targets;
    if (data.to) {
      const target = room.peers.get(data.to);
      if (!target) return { ok: false, count: 0 };
      targets = [target];
    } else {
      targets = this.othersOf(room, peer);
    }

    const msg = { ...data, from: peer.id };
    let count = 0;
    for (const t of targets) {
      try { t.send(msg); count++; } catch { /* drop on send error */ }
    }
    return { ok: true, count };
  }

  /** True if `peer` may inject input: still a member of a live, unexpired room. */
  canInject(peer, now = Date.now()) {
    const room = peer && peer._roomId ? this.rooms.get(peer._roomId) : null;
    return Boolean(room) && room.peers.has(peer.id) && now <= room.expiresAt;
  }

  /**
   * True if `token` is the host token of some live room. Used to authenticate
   * privileged device-control HTTP endpoints (virtual display, Bluetooth) so a
   * drive-by page or unauthenticated LAN client can't trigger them.
   */
  isHostToken(token, now = Date.now()) {
    if (!token || typeof token !== 'string') return false;
    for (const room of this.rooms.values()) {
      if (room.hostToken === token && now <= room.expiresAt) return true;
    }
    return false;
  }

  /**
   * Remove `peer` from its room. Returns `{ room, removed, wasHost }` where
   * `removed` indicates the room itself was deleted (it became empty).
   */
  leave(peer) {
    const room = peer && peer._roomId ? this.rooms.get(peer._roomId) : null;
    if (!room) return { room: null, removed: false, wasHost: false };
    const wasHost = room.hostId === peer.id;
    room.peers.delete(peer.id);
    if (wasHost) room.hostId = null;
    if (room.peers.size === 0) {
      this.rooms.delete(room.id);
      return { room, removed: true, wasHost };
    }
    room.status = 'waiting';
    return { room, removed: false, wasHost };
  }

  /** Reap expired rooms and long-idle empty rooms. Returns removed room ids. */
  sweep(now = Date.now()) {
    const removed = [];
    for (const [id, room] of this.rooms.entries()) {
      if (now > room.expiresAt || (room.peers.size === 0 && now - room.createdAt > this.idleMs)) {
        this.rooms.delete(id);
        removed.push(id);
      }
    }
    return removed;
  }
}

module.exports = { RoomRegistry, generateRoomCode, generateToken, generatePeerId };
