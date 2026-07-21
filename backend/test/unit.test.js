const assert = require('assert');
const { MessageTypes, encode, decode } = require('../lib/binary-protocol');
const RateLimiter = require('../lib/rate-limiter');
const inputController = require('../lib/input-controller');
const iddController = require('../lib/idd-controller');

console.log("--- STARTING TELECASTT ENTERPRISE TEST SUITE ---");

// Test 1: Binary Protocol Encode & Decode
(function testBinaryProtocol() {
  const payload = { room: 'TEST12', sdp: 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1' };
  const encoded = encode(MessageTypes.OFFER, payload);
  assert(encoded instanceof ArrayBuffer, "Encoded result must be ArrayBuffer");
  
  const decoded = decode(encoded);
  assert.strictEqual(decoded.type, MessageTypes.OFFER, "Type must match");
  assert.strictEqual(decoded.payload.room, 'TEST12', "Payload field room must match");
  assert.strictEqual(decoded.payload.sdp, payload.sdp, "Payload SDP must match");
  console.log("✅ Test 1: Binary Protocol Encode/Decode Passed");
})();

// Test 2: Binary Protocol Error Handling
(function testBinaryProtocolErrors() {
  assert.throws(() => decode(null), /Invalid buffer/, "Null buffer should throw");
  assert.throws(() => decode(new ArrayBuffer(2)), /header too short/, "Short header should throw");
  console.log("✅ Test 2: Binary Protocol Error Validation Passed");
})();

// Test 3: Rate Limiter Token Bucket
(function testRateLimiter() {
  const limiter = new RateLimiter(10, 5); // 10 tokens/sec, capacity 5
  assert.strictEqual(limiter.consume(3), true, "Consuming 3 tokens from capacity 5 should succeed");
  assert.strictEqual(limiter.consume(3), false, "Consuming another 3 tokens should fail (only 2 left)");
  console.log("✅ Test 3: Rate Limiter Token Bucket Passed");
})();

// Test 4: Persistent Input Controller (Mouse, Keyboard, Native Touch)
(function testInputController() {
  // Test mouse move injection
  const moveRes = inputController.injectInput({ action: 'move', nx: 0.5, ny: 0.5 });
  assert.strictEqual(moveRes.success, true, "Mouse move injection should return success");

  // Test native touch injection
  const touchRes = inputController.injectInput({ action: 'touch', nx: 0.25, ny: 0.75, touchId: 1, phase: 'down' });
  assert.strictEqual(touchRes.success, true, "Touch injection should return success");

  // Test keyboard injection
  const keyRes = inputController.injectInput({ action: 'keydown', key: 'Enter' });
  assert.strictEqual(keyRes.success, true, "Keyboard injection should return success");

  console.log("✅ Test 4: Persistent Input Injector (Mouse, Key, Touch) Passed");
})();

// Test 5: VDD Status Query
(async function testVDDStatus() {
  const statusRes = await iddController.getStatus();
  assert(statusRes !== null && typeof statusRes === 'object', "VDD status response must be object");
  console.log("✅ Test 5: Virtual Display Driver Controller Status Query Passed");
})();

console.log("--- ALL ENTERPRISE UNIT TESTS PASSED SUCCESSFULLY ---");
