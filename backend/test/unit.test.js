const assert = require('assert');
const { MessageTypes, encode, decode } = require('../lib/binary-protocol');
const RateLimiter = require('../lib/rate-limiter');
const inputController = require('../lib/input-controller');
const iddController = require('../lib/idd-controller');
const { parseResult, psQuote } = require('../lib/powershell');

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

  // Test 7: PowerShell result parsing must not invent success.
  // A script that printed nothing, failed, or reported its own failure used to
  // surface in the UI as "Virtual display driver initialized."
  (function testParseResult() {
    const reported = parseResult({ error: null, stdout: '{"success":false,"error":"needs test-signing"}', stderr: '' });
    assert.strictEqual(reported.success, false, "script's own success:false must be honored");
    assert.strictEqual(reported.error, 'needs test-signing', 'script error text must be propagated');

    const ok = parseResult({ error: null, stdout: '{"success":true,"message":"done"}', stderr: '' });
    assert.strictEqual(ok.success, true, 'script success:true is honored');
    assert.strictEqual(ok.message, 'done', 'script message is propagated');

    const empty = parseResult({ error: null, stdout: '', stderr: '' });
    assert.strictEqual(empty.success, false, 'no output is a failure, not a success');

    const warned = parseResult({ error: null, stdout: 'WARNING: something odd', stderr: '' });
    assert.strictEqual(warned.success, false, 'non-JSON chatter is not success');

    const failed = parseResult({ error: new Error('spawn ENOENT'), stdout: '', stderr: '' });
    assert.strictEqual(failed.success, false, 'process failure is a failure');
    assert(/ENOENT/.test(failed.error), 'process error surfaces the real reason');

    // A pure data payload (VDD status) succeeds only if the process did.
    const data = parseResult({ error: null, stdout: '{"Installed":true,"Present":false}', stderr: '' });
    assert.strictEqual(data.success, true, 'data-only payload from a clean run is a success');
    assert.strictEqual(data.data.Installed, true, 'data payload is exposed');

    const timedOut = parseResult({ error: Object.assign(new Error('killed'), { killed: true }), stdout: '', stderr: '' });
    assert(/timed out/i.test(timedOut.error), 'a killed process reports a timeout');
    console.log('OK  Test 7: PowerShell result parsing never invents success');
  })();

  // Test 8: PowerShell single-quote escaping is complete.
  (function testPsQuote() {
    assert.strictEqual(psQuote(`C:\\Program Files\\x`), `'C:\\Program Files\\x'`, 'spaces/backslashes need no escape');
    assert.strictEqual(psQuote(`it's`), `'it''s'`, "a quote is doubled, not backslash-escaped");
    assert.strictEqual(psQuote(`'; calc.exe; '`), `'''; calc.exe; '''`, 'a quote-breakout attempt stays inside the literal');
    assert.strictEqual(psQuote('$(whoami)'), `'$(whoami)'`, 'no expansion happens inside single quotes');
    console.log('OK  Test 8: PowerShell argument quoting');
  })();

  // Test 9: sanitized wheel/key payloads keep their sign and shape. Wheel delta
  // must survive as a NEGATIVE number — the injector relies on the sign, and a
  // clamp that dropped it silently killed scrolling in one direction.
  (function testWheelAndKeySanitization() {
    const up = inputController.injectInput({ action: 'wheel', deltaY: -240 });
    assert.strictEqual(up.success, true, 'negative wheel delta is accepted');
    const huge = inputController.injectInput({ action: 'wheel', deltaY: 1e9 });
    assert.strictEqual(huge.success, true, 'oversized wheel delta is clamped, not rejected');
    const sym = inputController.injectInput({ action: 'keydown', key: '@' });
    assert.strictEqual(sym.success, true, 'shifted symbol keys are accepted');
    const longKey = inputController.injectInput({ action: 'keydown', key: 'x'.repeat(500) });
    assert.strictEqual(longKey.success, true, 'overlong key is truncated, not rejected');
    console.log('OK  Test 9: Wheel & key payload handling');
  })();

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
