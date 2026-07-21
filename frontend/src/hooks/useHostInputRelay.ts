import { useEffect } from 'react';
import type { InputMessage, InjectPayload } from '../lib/types';

// Translate a client's normalized InputMessage into the backend injector's
// payload shape.
function toInject(msg: InputMessage): InjectPayload | null {
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
 * Host-side: listen on the reliable control channel for the client's input and
 * relay each event to the backend for native injection.
 */
export function useHostInputRelay(
  control: RTCDataChannel | null,
  relayInput: (payload: unknown) => void,
  enabled: boolean
) {
  useEffect(() => {
    if (!enabled || !control) return;
    const onMessage = (e: MessageEvent) => {
      let msg: InputMessage;
      try { msg = JSON.parse(e.data); } catch { return; }
      const payload = toInject(msg);
      if (payload) relayInput(payload);
    };
    control.addEventListener('message', onMessage);
    return () => control.removeEventListener('message', onMessage);
  }, [control, relayInput, enabled]);
}
