const assert = require('assert');
const { MessageTypes, encode, decode } = require('../lib/binary-protocol');
const RateLimiter = require('../lib/rate-limiter');

console.log("--- STARTING UNIT TESTS ---");

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

// Test 3: Rate Limiter
(function testRateLimiter() {
  const limiter = new RateLimiter(10, 5); // 10 tokens/sec, capacity 5
  assert.strictEqual(limiter.consume(3), true, "Consuming 3 tokens from capacity 5 should succeed");
  assert.strictEqual(limiter.consume(3), false, "Consuming another 3 tokens should fail (only 2 left)");
  console.log("✅ Test 3: Rate Limiter Token Bucket Passed");
})();

console.log("--- ALL UNIT TESTS PASSED SUCCESSFULLY ---");
