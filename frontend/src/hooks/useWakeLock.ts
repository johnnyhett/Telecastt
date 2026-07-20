import { useEffect, useRef } from 'react';

export const useWakeLock = (enabled: boolean) => {
  const wakeLock = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;

    let active = true;
    const acquire = async () => {
      try {
        wakeLock.current = await navigator.wakeLock.request('screen');
        wakeLock.current.addEventListener('release', () => {
          if (active) acquire(); // Re-acquire if page becomes visible again
        });
      } catch (e) {
        console.warn('Wake Lock failed:', e);
      }
    };

    acquire();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && active) acquire();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      wakeLock.current?.release();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled]);
};
