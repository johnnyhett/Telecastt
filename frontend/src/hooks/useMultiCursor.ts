import { useState, useCallback } from 'react';

export interface CursorPosition {
  x: number;
  y: number;
  color: string;
}

export function useMultiCursor() {
  const [cursors, setCursors] = useState<Map<string, CursorPosition>>(new Map());

  const updateCursor = useCallback((id: string, x: number, y: number) => {
    setCursors(prev => {
      const next = new Map(prev);
      const existing = next.get(id);
      next.set(id, {
        x,
        y,
        color: existing?.color || `#${Math.floor(Math.random()*16777215).toString(16)}`
      });
      return next;
    });
  }, []);

  return { cursors, updateCursor };
}
