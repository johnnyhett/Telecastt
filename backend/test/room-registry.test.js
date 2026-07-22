'use strict';

/**
 * Unit tests for the multi-peer RoomRegistry. No sockets required — peers are
 * plain objects with a `send` spy, so the full host/client routing model is
 * exercised deterministically.
 */
const assert = require('assert');
const { RoomRegistry } = require('../lib/room-registry');

const mkPeer = () => {
  const sent = [];
  return { send: (m) => sent.push(m), sent };
};

console.log('--- STARTING ROOM REGISTRY TEST SUITE ---');

// 1. Room creation shape + uniqueness + capacity cap.
(function testCreate() {
  const reg = new RoomRegistry();
  const r = reg.createRoom();
  assert(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(r.roomId), 'room code must be 6 ambiguity-free chars');
  assert(typeof r.hostToken === 'string' && r.hostToken.length === 32, 'host token must be 32 hex chars');
  assert(r.expiresAt > Date.now(), 'expiry must be in the future');
  assert.strictEqual(reg.size, 1, 'registry should hold one room');

  const capped = new RoomRegistry({ maxRooms: 1 });
  capped.createRoom();
  assert.deepStrictEqual(capped.createRoom(), { error: 'capacity' }, 'second room must be rejected at cap');
  console.log('OK  Test 1: createRoom shape, uniqueness & capacity cap');
})();

// 2. validateRoom: unknown / expired / full / valid.
(function testValidate() {
  const reg = new RoomRegistry({ maxPeersPerRoom: 2 });
  assert.strictEqual(reg.validateRoom('NOPE00').code, 404, 'unknown room → 404');

  const { roomId } = reg.createRoom(1000);
  const expired = reg.validateRoom(roomId, 1000 + reg.ttlMs + 1);
  assert.strictEqual(expired.code, 410, 'expired room → 410');
  assert.strictEqual(reg.getRoom(roomId), undefined, 'expired room is evicted on validate');

  const { roomId: id2 } = reg.createRoom();
  reg.join(id2, mkPeer(), {});
  reg.join(id2, mkPeer(), {});
  assert.strictEqual(reg.validateRoom(id2).code, 409, 'full room → 409');

  const { roomId: id3 } = reg.createRoom();
  const ok = reg.validateRoom(id3);
  assert.strictEqual(ok.valid, true, 'fresh room is valid');
  assert.strictEqual(ok.peerCount, 0, 'fresh room has zero peers');
  console.log('OK  Test 2: validateRoom (unknown/expired/full/valid)');
})();

// 3. Roles: client by default, host only with the token.
(function testRoles() {
  const reg = new RoomRegistry();
  const { roomId, hostToken } = reg.createRoom();

  const client = mkPeer();
  const cRes = reg.join(roomId, client, {});
  assert.strictEqual(cRes.role, 'client', 'no token → client');
  assert.strictEqual(client.role, 'client', 'peer object annotated with role');

  const host = mkPeer();
  const hRes = reg.join(roomId, host, { role: 'host', hostToken });
  assert.strictEqual(hRes.role, 'host', 'valid token → host');
  assert.strictEqual(reg.getRoom(roomId).hostId, host.id, 'room tracks the host id');

  const impostor = reg.join(roomId, mkPeer(), { role: 'host' });
  assert.strictEqual(impostor.code, 403, 'claiming host without token → 403');

  const wrongToken = reg.join(roomId, mkPeer(), { role: 'host', hostToken: 'deadbeef'.repeat(4) });
  assert.strictEqual(wrongToken.code, 403, 'wrong token + host role → 403');
  console.log('OK  Test 3: host authentication & roles');
})();

// 4. Capacity enforced on join.
(function testJoinCapacity() {
  const reg = new RoomRegistry({ maxPeersPerRoom: 2 });
  const { roomId } = reg.createRoom();
  assert.strictEqual(reg.join(roomId, mkPeer(), {}).ok, true, 'peer 1 joins');
  assert.strictEqual(reg.join(roomId, mkPeer(), {}).ok, true, 'peer 2 joins');
  assert.strictEqual(reg.join(roomId, mkPeer(), {}).code, 409, 'peer 3 rejected at cap');
  console.log('OK  Test 4: join capacity enforcement');
})();

// 5. Reconnecting host evicts a stale host instead of being locked out.
(function testHostReconnect() {
  const reg = new RoomRegistry({ maxPeersPerRoom: 2 });
  const { roomId, hostToken } = reg.createRoom();
  const staleHost = mkPeer();
  reg.join(roomId, staleHost, { role: 'host', hostToken });
  reg.join(roomId, mkPeer(), {}); // a client is present → room at capacity (2)

  const newHost = mkPeer();
  const res = reg.join(roomId, newHost, { role: 'host', hostToken });
  assert.strictEqual(res.ok, true, 'reconnecting host is admitted even at capacity');
  assert.strictEqual(res.evicted, staleHost, 'the stale host is evicted');
  assert.strictEqual(reg.getRoom(roomId).hostId, newHost.id, 'new host takes the host slot');
  assert.strictEqual(reg.getRoom(roomId).peers.has(staleHost.id), false, 'stale host removed from room');
  console.log('OK  Test 5: host reconnection eviction');
})();

// 6. Relay: broadcast to others, stamped with `from`.
(function testRelayBroadcast() {
  const reg = new RoomRegistry();
  const { roomId } = reg.createRoom();
  const a = mkPeer(); const b = mkPeer(); const c = mkPeer();
  reg.join(roomId, a, {}); reg.join(roomId, b, {}); reg.join(roomId, c, {});

  const out = reg.relay(a, { type: 'offer', offer: { sdp: 'x' } });
  assert.strictEqual(out.count, 2, 'broadcast reaches the two other peers');
  assert.strictEqual(a.sent.length, 0, 'sender does not receive its own message');
  assert.strictEqual(b.sent[0].from, a.id, 'message stamped with sender id');
  assert.strictEqual(b.sent[0].type, 'offer', 'message type preserved');
  console.log('OK  Test 6: relay broadcast with from-stamp');
})();

// 7. Relay: targeted delivery via `to`.
(function testRelayTargeted() {
  const reg = new RoomRegistry();
  const { roomId } = reg.createRoom();
  const a = mkPeer(); const b = mkPeer(); const c = mkPeer();
  reg.join(roomId, a, {}); reg.join(roomId, b, {}); reg.join(roomId, c, {});

  const out = reg.relay(a, { type: 'answer', to: b.id, answer: { sdp: 'y' } });
  assert.strictEqual(out.count, 1, 'targeted relay reaches exactly one peer');
  assert.strictEqual(b.sent.length, 1, 'the named peer receives it');
  assert.strictEqual(c.sent.length, 0, 'other peers do not');

  assert.strictEqual(reg.relay(a, { type: 'offer', to: 'ghost' }).ok, false, 'unknown target → not ok');
  assert.strictEqual(reg.relay(a, { type: 'chat' }).ok, false, 'non-signaling type is not relayed');
  console.log('OK  Test 7: relay targeted delivery & guards');
})();

// 8. canInject reflects live membership.
(function testCanInject() {
  const reg = new RoomRegistry();
  const { roomId } = reg.createRoom(1000);
  const p = mkPeer();
  reg.join(roomId, p, {}, 1000);
  assert.strictEqual(reg.canInject(p, 1000), true, 'joined peer may inject');
  assert.strictEqual(reg.canInject(p, 1000 + reg.ttlMs + 1), false, 'expired room blocks injection');
  reg.leave(p);
  assert.strictEqual(reg.canInject(p, 1000), false, 'departed peer may not inject');
  console.log('OK  Test 8: canInject membership gate');
})();

// 9. Leave: room persists with survivors, is deleted when empty; host flag.
(function testLeave() {
  const reg = new RoomRegistry();
  const { roomId, hostToken } = reg.createRoom();
  const host = mkPeer(); const client = mkPeer();
  reg.join(roomId, host, { role: 'host', hostToken });
  reg.join(roomId, client, {});

  const l1 = reg.leave(host);
  assert.strictEqual(l1.wasHost, true, 'leaving host reported');
  assert.strictEqual(l1.removed, false, 'room survives while a client remains');
  assert.strictEqual(reg.getRoom(roomId).hostId, null, 'host slot cleared');

  const l2 = reg.leave(client);
  assert.strictEqual(l2.removed, true, 'room deleted when last peer leaves');
  assert.strictEqual(reg.getRoom(roomId), undefined, 'room gone');
  console.log('OK  Test 9: leave lifecycle');
})();

// 10. Sweep reaps expired and long-idle empty rooms.
(function testSweep() {
  const reg = new RoomRegistry();
  const a = reg.createRoom(1000);          // will expire
  const b = reg.createRoom(1000);          // idle & empty
  reg.getRoom(b.roomId); // no-op, keep empty
  const removed = reg.sweep(1000 + reg.ttlMs + 1);
  assert(removed.includes(a.roomId), 'expired room reaped');
  assert(removed.includes(b.roomId), 'idle empty room reaped');
  assert.strictEqual(reg.size, 0, 'registry emptied');
  console.log('OK  Test 10: sweep reaps expired & idle rooms');
})();

console.log('--- ALL ROOM REGISTRY TESTS PASSED ---');
