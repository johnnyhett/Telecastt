import { useEffect, useRef } from 'react';

export const useWakeLock = (enabled: boolean) => {
  const wakeLock = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;

    let active = true;
    const acquire = async () => {
      // The browser releases the lock whenever the page is hidden. Re-acquiring
      // from the 'release' handler while hidden just fails and fires again, so
      // only the visibilitychange path below re-arms it — otherwise a
      // backgrounded tab spins on request/reject.
      if (!active || document.visibilityState !== 'visible' || wakeLock.current) return;
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (!active) {
          void sentinel.release().catch(() => { /* already gone */ });
          return;
        }
        wakeLock.current = sentinel;
        sentinel.addEventListener('release', () => {
          if (wakeLock.current === sentinel) wakeLock.current = null;
        });
      } catch (e) {
        console.warn('Wake Lock failed:', e);
      }
    };

    void acquire();

    const handleVisibility = () => { void acquire(); };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      void wakeLock.current?.release().catch(() => { /* already released */ });
      wakeLock.current = null;
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled]);
};
