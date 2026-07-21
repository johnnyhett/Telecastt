const assert = require('assert');
const { MessageTypes, encode, decode } = require('../lib/binary-protocol');
const RateLimiter = require('../lib/rate-limiter');
const inputController = require('../lib/input-controller');
const iddController = require('../lib/idd-controller');

console.log('--- STARTING TELECASTT TEST SUITE ---');

async function main() {
  // Test 1: Binary Protocol Encode & Decode
  (function testBinaryProtocol() {
    const payload = { room: 'TEST12', sdp: 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1' };
    const encoded = encode(MessageTypes.OFFER, payload);
    assert(encoded instanceof ArrayBuffer, 'Encoded result must be ArrayBuffer');

    const decoded = decode(encoded);
    assert.strictEqual(decoded.type, MessageTypes.OFFER, 'Type must match');
    assert.strictEqual(decoded.payload.room, 'TEST12', 'Payload field room must match');
    assert.strictEqual(decoded.payload.sdp, payload.sdp, 'Payload SDP must match');
    console.log('OK  Test 1: Binary Protocol Encode/Decode');
  })();

  // Test 2: Binary Protocol Error Handling
  (function testBinaryProtocolErrors() {
    assert.throws(() => decode(null), /Invalid buffer/, 'Null buffer should throw');
    assert.throws(() => decode(new ArrayBuffer(2)), /header too short/, 'Short header should throw');
    console.log('OK  Test 2: Binary Protocol Error Validation');
  })();

  // Test 3: Rate Limiter Token Bucket
  (function testRateLimiter() {
    const limiter = new RateLimiter(10, 5); // 10 tokens/sec, capacity 5
    assert.strictEqual(limiter.consume(3), true, 'Consuming 3 tokens from capacity 5 should succeed');
    assert.strictEqual(limiter.consume(3), false, 'Consuming another 3 tokens should fail (only 2 left)');
    console.log('OK  Test 3: Rate Limiter Token Bucket');
  })();

  // Test 4: Persistent Input Controller (Mouse, Keyboard, Native Touch)
  // These succeed (buffered) even where PowerShell is unavailable, and must
  // NOT crash the process when the injector fails to spawn.
  (function testInputController() {
    const moveRes = inputController.injectInput({ action: 'move', nx: 0.5, ny: 0.5 });
    assert.strictEqual(moveRes.success, true, 'Mouse move injection should return success');

    const touchRes = inputController.injectInput({ action: 'touch', nx: 0.25, ny: 0.75, touchId: 1, phase: 'down' });
    assert.strictEqual(touchRes.success, true, 'Touch injection should return success');

    const keyRes = inputController.injectInput({ action: 'keydown', key: 'Enter' });
    assert.strictEqual(keyRes.success, true, 'Keyboard injection should return success');

    console.log('OK  Test 4: Persistent Input Injector (Mouse, Key, Touch)');
  })();

  // Test 5: Input payload sanitization rejects malformed data
  (function testInputSanitization() {
    assert.strictEqual(inputController.injectInput(null).success, false, 'Null payload must be rejected');
    assert.strictEqual(inputController.injectInput('nope').success, false, 'Non-object payload must be rejected');
    console.log('OK  Test 5: Input Payload Sanitization');
  })();

  // Test 6: VDD Status Query resolves to an object (never throws / crashes)
  const statusRes = await iddController.getStatus();
  assert(statusRes !== null && typeof statusRes === 'object', 'VDD status response must be object');
  console.log('OK  Test 6: Virtual Display Driver Status Query');

  console.log('--- ALL UNIT TESTS PASSED ---');
}

main()
  .then(() => {
    inputController.killInjector();
    process.exit(0);
  })
  .catch((err) => {
    console.error('TEST FAILURE:', err.message);
    inputController.killInjector();
    process.exit(1);
  });
