import type { InputMessage, InjectPayload } from './types';

/** Translate a client's normalized InputMessage into the injector payload. */
export function toInject(msg: InputMessage): InjectPayload | null {
  if (msg.t === 'p') {
    if (msg.pt === 'touch') {
      return { action: 'touch', phase: msg.phase, normalizedX: msg.x, normalizedY: msg.y, touchId: msg.id };
    }
    if (msg.phase === 'down') {
      return { action: 'mousedown', normalizedX: msg.x, normalizedY: msg.y, button: msg.button };
    }
    if (msg.phase === 'up') {
      return { action: 'mouseup', normalizedX: msg.x, normalizedY: msg.y, button: msg.button };
    }
    return { action: 'move', normalizedX: msg.x, normalizedY: msg.y };
  }
  if (msg.t === 'wheel') return { action: 'wheel', deltaY: msg.dy };
  if (msg.t === 'key') return { action: msg.phase === 'down' ? 'keydown' : 'keyup', key: msg.key };
  return null;
}

/**
 * Attach host input-relay to a single client's control channel: forward each
 * event to `relayInput`, track every key/button/touch held down, and release
 * them if the channel closes or on cleanup. Returns a disposer. One instance
 * per connected secondary PC, so a drop on any one client can't leave input
 * stuck on the host.
 */
export function attachHostInput(
  channel: RTCDataChannel,
  relayInput: (payload: unknown) => void
): () => void {
  const heldKeys = new Set<string>();
  const heldButtons = new Set<number>();
  const heldTouches = new Map<number, { x: number; y: number }>();
  let lastX = 0.5;
  let lastY = 0.5;

  const track = (msg: InputMessage) => {
    if (msg.t === 'key') {
      if (msg.phase === 'down') heldKeys.add(msg.key);
      else heldKeys.delete(msg.key);
    } else if (msg.t === 'p') {
      lastX = msg.x;
      lastY = msg.y;
      if (msg.pt === 'touch') {
        if (msg.phase === 'down' || msg.phase === 'move') heldTouches.set(msg.id, { x: msg.x, y: msg.y });
        else heldTouches.delete(msg.id);
      } else if (msg.phase === 'down') {
        heldButtons.add(msg.button);
      } else if (msg.phase === 'up') {
        heldButtons.delete(msg.button);
      }
    }
  };

  const releaseAll = () => {
    heldKeys.forEach((key) => relayInput({ action: 'keyup', key }));
    heldKeys.clear();
    heldButtons.forEach((button) =>
      relayInput({ action: 'mouseup', normalizedX: lastX, normalizedY: lastY, button })
    );
    heldButtons.clear();
    heldTouches.forEach(({ x, y }, id) =>
      relayInput({ action: 'touch', phase: 'up', normalizedX: x, normalizedY: y, touchId: id })
    );
    heldTouches.clear();
  };

  const onMessage = (e: MessageEvent) => {
    let msg: InputMessage;
    try { msg = JSON.parse(e.data); } catch { return; }
    track(msg);
    const payload = toInject(msg);
    if (payload) relayInput(payload);
  };

  channel.addEventListener('message', onMessage);
  channel.addEventListener('close', releaseAll);
  return () => {
    channel.removeEventListener('message', onMessage);
    channel.removeEventListener('close', releaseAll);
    releaseAll();
  };
}

/**
 * Apply inbound clipboard text from a peer to the local OS clipboard. Returns a
 * disposer. A monotonic timestamp guards against echo loops.
 */
export function attachClipboardReceiver(channel: RTCDataChannel): () => void {
  let lastApplied = 0;
  const onMessage = async (e: MessageEvent) => {
    let data: { type?: string; text?: string; ts?: number };
    try { data = JSON.parse(e.data); } catch { return; }
    if (data.type !== 'clipboard' || typeof data.text !== 'string') return;
    const ts = typeof data.ts === 'number' ? data.ts : 0;
    if (ts <= lastApplied) return;
    lastApplied = ts;
    try { await navigator.clipboard.writeText(data.text); } catch { /* write blocked */ }
  };
  channel.addEventListener('message', onMessage);
  return () => channel.removeEventListener('message', onMessage);
}
