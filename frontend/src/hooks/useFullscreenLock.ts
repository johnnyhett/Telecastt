import { useEffect, useCallback } from 'react';

export const useFullscreenLock = (enabled: boolean) => {
  const requestFullscreen = useCallback(async () => {
    if (!enabled) return;
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
      // Lock to landscape if available
      if ('orientation' in screen && 'lock' in (screen.orientation as any)) {
        try {
          await (screen.orientation as any).lock('landscape');
        } catch { /* Not all browsers support orientation lock */ }
      }
    } catch (e) {
      console.warn('Fullscreen lock failed:', e);
    }
  }, [enabled]);

  useEffect(() => {
    if (enabled) {
      // Auto-request on first user interaction
      const handler = () => {
        requestFullscreen();
        document.removeEventListener('click', handler);
      };
      document.addEventListener('click', handler);
      return () => document.removeEventListener('click', handler);
    }
  }, [enabled, requestFullscreen]);

  return { requestFullscreen };
};
