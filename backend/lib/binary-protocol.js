const MessageTypes = {
  JOIN: 0x01,
  OFFER: 0x02,
  ANSWER: 0x03,
  ICE: 0x04,
  READY: 0x05,
  ERROR: 0x06,
  PEER_DISCONNECTED: 0x07,
  SETTINGS: 0x08
};

function encode(type, payload) {
  const payloadStr = JSON.stringify(payload);
  const payloadBytes = new TextEncoder().encode(payloadStr);
  const length = payloadBytes.length;
  
  const buffer = new ArrayBuffer(1 + 2 + length);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  
  view.setUint8(0, type);
  view.setUint16(1, length, false); // big-endian
  
  bytes.set(payloadBytes, 3);
  
  return buffer;
}

function decode(buffer) {
  if (buffer instanceof ArrayBuffer) {
    // it's an ArrayBuffer
  } else if (buffer.buffer instanceof ArrayBuffer) {
    buffer = buffer.buffer;
  }

  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  
  const type = view.getUint8(0);
  const length = view.getUint16(1, false);
  
  const payloadBytes = bytes.slice(3, 3 + length);
  const payloadStr = new TextDecoder().decode(payloadBytes);
  const payload = JSON.parse(payloadStr);
  
  return { type, payload };
}

module.exports = { MessageTypes, encode, decode };
