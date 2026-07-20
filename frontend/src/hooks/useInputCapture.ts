import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';

export type InputEventType = 'key' | 'mouse' | 'touch' | 'wheel';

export interface BaseInputEvent {
  type: InputEventType;
  timestamp: number;
}

export interface MouseInputData {
  x: number;
  y: number;
  button: number;
  movementX: number;
  movementY: number;
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
  data: MouseInputData | KeyInputData | WheelInputData | Record<string, unknown>;
};

export function useInputCapture(
  targetRef: MutableRefObject<HTMLElement | null>,
  enabled: boolean,
  onInput: (event: InputEventData) => void
) {
  const isPointerLocked = useRef(false);

  useEffect(() => {
    if (!enabled || !targetRef.current) return;
    const target = targetRef.current;

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
      onInput({
        type: 'mouse',
        timestamp: Date.now(),
        data: {
          x: e.clientX,
          y: e.clientY,
          button: e.button,
          movementX: e.movementX,
          movementY: e.movementY
        } as MouseInputData
      });
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (enabled && !isPointerLocked.current) {
        target.requestPointerLock?.();
      }
      onInput({
        type: 'mouse',
        timestamp: Date.now(),
        data: {
          x: e.clientX,
          y: e.clientY,
          button: e.button,
          movementX: e.movementX,
          movementY: e.movementY
        } as MouseInputData
      });
    };

    const handleMouseUp = (e: MouseEvent) => {
      onInput({
        type: 'mouse',
        timestamp: Date.now(),
        data: {
          x: e.clientX,
          y: e.clientY,
          button: e.button,
          movementX: e.movementX,
          movementY: e.movementY
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

    const handleTouch = (e: TouchEvent) => {
      onInput({
        type: 'touch',
        timestamp: Date.now(),
        data: { touches: e.touches.length }
      });
    };

    const handlePointerLockChange = () => {
      isPointerLocked.current = document.pointerLockElement === target;
    };

    target.addEventListener('keydown', handleKeyDown);
    target.addEventListener('keyup', handleKeyUp);
    target.addEventListener('mousemove', handleMouseMove);
    target.addEventListener('mousedown', handleMouseDown);
    target.addEventListener('mouseup', handleMouseUp);
    target.addEventListener('wheel', handleWheel);
    target.addEventListener('touchstart', handleTouch);
    target.addEventListener('touchmove', handleTouch);
    target.addEventListener('touchend', handleTouch);
    document.addEventListener('pointerlockchange', handlePointerLockChange);

    return () => {
      target.removeEventListener('keydown', handleKeyDown);
      target.removeEventListener('keyup', handleKeyUp);
      target.removeEventListener('mousemove', handleMouseMove);
      target.removeEventListener('mousedown', handleMouseDown);
      target.removeEventListener('mouseup', handleMouseUp);
      target.removeEventListener('wheel', handleWheel);
      target.removeEventListener('touchstart', handleTouch);
      target.removeEventListener('touchmove', handleTouch);
      target.removeEventListener('touchend', handleTouch);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      
      if (isPointerLocked.current) {
        document.exitPointerLock?.();
      }
    };
  }, [targetRef, enabled, onInput]);
}
