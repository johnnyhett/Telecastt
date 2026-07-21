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
  const payloadStr = JSON.stringify(payload ?? {});
  const payloadBytes = new TextEncoder().encode(payloadStr);
  const length = payloadBytes.length;
  
  // Header: 1 byte (type) + 4 bytes (length)
  const buffer = new ArrayBuffer(1 + 4 + length);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  
  view.setUint8(0, type);
  view.setUint32(1, length, false); // big-endian 32-bit integer
  
  bytes.set(payloadBytes, 5);
  
  return buffer;
}

function decode(buffer) {
  if (!buffer) {
    throw new Error("Invalid buffer: buffer is null or undefined");
  }

  let arrayBuffer;
  if (buffer instanceof ArrayBuffer) {
    arrayBuffer = buffer;
  } else if (ArrayBuffer.isView(buffer)) {
    arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  } else {
    throw new Error("Unsupported buffer type");
  }

  if (arrayBuffer.byteLength < 5) {
    throw new Error("Invalid protocol buffer: header too short");
  }

  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  
  const type = view.getUint8(0);
  const length = view.getUint32(1, false);
  
  if (bytes.length < 5 + length) {
    throw new Error("Invalid protocol buffer: payload length mismatch");
  }

  const payloadBytes = bytes.slice(5, 5 + length);
  const payloadStr = new TextDecoder().decode(payloadBytes);
  const payload = JSON.parse(payloadStr);
  
  return { type, payload };
}

module.exports = { MessageTypes, encode, decode };
