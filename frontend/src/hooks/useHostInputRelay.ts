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
 *
 * Crucially, it tracks every key, mouse button and touch contact currently held
 * *down* and synthesizes the matching release when the channel closes (peer
 * disconnect) or the relay tears down. Without this, a client that drops mid
 * key-press or drag leaves a modifier (Ctrl/Alt/Shift/Meta) or mouse button
 * stuck down on the host — a nasty, hard-to-diagnose failure.
 */
export function useHostInputRelay(
  control: RTCDataChannel | null,
  relayInput: (payload: unknown) => void,
  enabled: boolean
) {
  useEffect(() => {
    if (!enabled || !control) return;

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

    control.addEventListener('message', onMessage);
    control.addEventListener('close', releaseAll);
    return () => {
      control.removeEventListener('message', onMessage);
      control.removeEventListener('close', releaseAll);
      releaseAll(); // flush any still-held inputs on teardown / peer change
    };
  }, [control, relayInput, enabled]);
}
