import { useEffect } from 'react';
import type { MutableRefObject } from 'react';

export type InputEventType = 'key' | 'mouse' | 'touch' | 'wheel';

export interface BaseInputEvent {
  type: InputEventType;
  timestamp: number;
}

export interface MouseInputData {
  x: number;
  y: number;
  normalizedX: number; // 0.0 to 1.0 relative to display
  normalizedY: number; // 0.0 to 1.0 relative to display
  button: number;
  state: 'move' | 'down' | 'up' | 'click';
}

export interface TouchInputData {
  touches: Array<{ x: number; y: number; normalizedX: number; normalizedY: number }>;
  gesture: 'tap' | 'drag' | 'pinch' | 'release';
}

export interface KeyInputData {
  key: string;
  code: string;
  down: boolean;
}

export interface WheelInputData {
  deltaX: number;
  deltaY: number;
}

export type InputEventData = BaseInputEvent & {
  data: MouseInputData | TouchInputData | KeyInputData | WheelInputData | Record<string, unknown>;
};

export function useInputCapture(
  targetRef: MutableRefObject<HTMLElement | null>,
  enabled: boolean,
  onInput: (event: InputEventData) => void
) {
  useEffect(() => {
    if (!enabled || !targetRef.current) return;
    const target = targetRef.current;

    const getNormalizedCoords = (clientX: number, clientY: number) => {
      const rect = target.getBoundingClientRect();
      const normalizedX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const normalizedY = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      return { normalizedX, normalizedY };
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      onInput({
        type: 'key',
        timestamp: Date.now(),
        data: { key: e.key, code: e.code, down: true } as KeyInputData
      });
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      onInput({
        type: 'key',
        timestamp: Date.now(),
        data: { key: e.key, code: e.code, down: false } as KeyInputData
      });
    };

    const handleMouseMove = (e: MouseEvent) => {
      const { normalizedX, normalizedY } = getNormalizedCoords(e.clientX, e.clientY);
      onInput({
        type: 'mouse',
        timestamp: Date.now(),
        data: {
          x: e.clientX,
          y: e.clientY,
          normalizedX,
          normalizedY,
          button: e.button,
          state: 'move'
        } as MouseInputData
      });
    };

    const handleMouseDown = (e: MouseEvent) => {
      const { normalizedX, normalizedY } = getNormalizedCoords(e.clientX, e.clientY);
      onInput({
        type: 'mouse',
        timestamp: Date.now(),
        data: {
          x: e.clientX,
          y: e.clientY,
          normalizedX,
          normalizedY,
          button: e.button,
          state: 'down'
        } as MouseInputData
      });
    };

    const handleMouseUp = (e: MouseEvent) => {
      const { normalizedX, normalizedY } = getNormalizedCoords(e.clientX, e.clientY);
      onInput({
        type: 'mouse',
        timestamp: Date.now(),
        data: {
          x: e.clientX,
          y: e.clientY,
          normalizedX,
          normalizedY,
          button: e.button,
          state: 'up'
        } as MouseInputData
      });
    };

    const handleWheel = (e: WheelEvent) => {
      onInput({
        type: 'wheel',
        timestamp: Date.now(),
        data: { deltaX: e.deltaX, deltaY: e.deltaY } as WheelInputData
      });
    };

    const handleTouchStart = (e: TouchEvent) => {
      const touches = Array.from(e.touches).map(t => {
        const { normalizedX, normalizedY } = getNormalizedCoords(t.clientX, t.clientY);
        return { x: t.clientX, y: t.clientY, normalizedX, normalizedY };
      });

      onInput({
        type: 'touch',
        timestamp: Date.now(),
        data: {
          touches,
          gesture: 'tap'
        } as TouchInputData
      });
    };

    const handleTouchMove = (e: TouchEvent) => {
      const touches = Array.from(e.touches).map(t => {
        const { normalizedX, normalizedY } = getNormalizedCoords(t.clientX, t.clientY);
        return { x: t.clientX, y: t.clientY, normalizedX, normalizedY };
      });

      onInput({
        type: 'touch',
        timestamp: Date.now(),
        data: {
          touches,
          gesture: touches.length > 1 ? 'pinch' : 'drag'
        } as TouchInputData
      });
    };

    const handleTouchEnd = () => {
      onInput({
        type: 'touch',
        timestamp: Date.now(),
        data: {
          touches: [],
          gesture: 'release'
        } as TouchInputData
      });
    };

    target.addEventListener('keydown', handleKeyDown);
    target.addEventListener('keyup', handleKeyUp);
    target.addEventListener('mousemove', handleMouseMove);
    target.addEventListener('mousedown', handleMouseDown);
    target.addEventListener('mouseup', handleMouseUp);
    target.addEventListener('wheel', handleWheel);
    target.addEventListener('touchstart', handleTouchStart);
    target.addEventListener('touchmove', handleTouchMove);
    target.addEventListener('touchend', handleTouchEnd);

    return () => {
      target.removeEventListener('keydown', handleKeyDown);
      target.removeEventListener('keyup', handleKeyUp);
      target.removeEventListener('mousemove', handleMouseMove);
      target.removeEventListener('mousedown', handleMouseDown);
      target.removeEventListener('mouseup', handleMouseUp);
      target.removeEventListener('wheel', handleWheel);
      target.removeEventListener('touchstart', handleTouchStart);
      target.removeEventListener('touchmove', handleTouchMove);
      target.removeEventListener('touchend', handleTouchEnd);
    };
  }, [targetRef, enabled, onInput]);
}
