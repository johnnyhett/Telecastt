import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { InputMessage, PointerKind } from '../lib/types';

// Cap pointer-move traffic to ~100/s. Reliable data channels don't like being
// flooded, and the host can't act on more than a display refresh anyway.
const MOVE_INTERVAL_MS = 10;

/**
 * Captures pointer (mouse/touch/pen), wheel and keyboard input on `targetRef`
 * and forwards it as normalized `InputMessage`s. Uses the Pointer Events API so
 * one code path handles mouse, multi-touch and pen with stable ids and clean
 * down/move/up phases.
 *
 * Events originating inside an element flagged `[data-tc-ui]` (the floating
 * control dock or any overlay) are ignored — otherwise clicking a control would
 * also inject a phantom click onto the host at that spot.
 */
export function usePointerCapture<T extends HTMLElement>(
  targetRef: RefObject<T | null>,
  enabled: boolean,
  send: (msg: InputMessage) => void
) {
  useEffect(() => {
    const el = targetRef.current;
    if (!enabled || !el) return;

    let lastMove = 0;

    const fromUi = (e: Event) =>
      e.target instanceof Element && e.target.closest('[data-tc-ui]') !== null;

    const normalize = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      const x = r.width ? (clientX - r.left) / r.width : 0;
      const y = r.height ? (clientY - r.top) / r.height : 0;
      return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
    };

    const kindOf = (e: PointerEvent): PointerKind =>
      e.pointerType === 'touch' ? 'touch' : e.pointerType === 'pen' ? 'pen' : 'mouse';

    const onPointerDown = (e: PointerEvent) => {
      if (fromUi(e)) return;
      el.focus();
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const { x, y } = normalize(e.clientX, e.clientY);
      send({ t: 'p', phase: 'down', pt: kindOf(e), id: e.pointerId, x, y, button: e.button });
    };

    const onPointerMove = (e: PointerEvent) => {
      if (fromUi(e)) return;
      const now = performance.now();
      if (now - lastMove < MOVE_INTERVAL_MS) return;
      lastMove = now;
      const { x, y } = normalize(e.clientX, e.clientY);
      send({ t: 'p', phase: 'move', pt: kindOf(e), id: e.pointerId, x, y, button: e.button });
    };

    const onPointerUp = (e: PointerEvent) => {
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (fromUi(e)) return;
      const { x, y } = normalize(e.clientX, e.clientY);
      send({ t: 'p', phase: 'up', pt: kindOf(e), id: e.pointerId, x, y, button: e.button });
    };

    const onWheel = (e: WheelEvent) => {
      if (fromUi(e)) return;
      e.preventDefault();
      send({ t: 'wheel', dy: e.deltaY });
    };

    const onContextMenu = (e: Event) => e.preventDefault();

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      send({ t: 'key', phase: 'down', key: e.key });
    };

    const onKeyUp = (e: KeyboardEvent) => {
      e.preventDefault();
      send({ t: 'key', phase: 'up', key: e.key });
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContextMenu);
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('keyup', onKeyUp);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContextMenu);
      el.removeEventListener('keydown', onKeyDown);
      el.removeEventListener('keyup', onKeyUp);
    };
  }, [targetRef, enabled, send]);
}
