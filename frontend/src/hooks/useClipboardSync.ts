import { useEffect, useRef } from 'react';

/**
 * Bidirectional text clipboard sync over the reliable "clipboard" data channel.
 * On local copy the text is sent to the peer; incoming text is written to the
 * local clipboard. A monotonic timestamp guards against echo/loops.
 */
export function useClipboardSync(channel: RTCDataChannel | null, enabled: boolean) {
  const lastApplied = useRef(0);

  useEffect(() => {
    if (!enabled || !channel) return;

    const onCopy = async () => {
      if (document.hidden) return;
      try {
        const text = await navigator.clipboard.readText();
        if (text && channel.readyState === 'open') {
          channel.send(JSON.stringify({ type: 'clipboard', text, ts: Date.now() }));
        }
      } catch {
        /* clipboard permission denied / unavailable */
      }
    };

    const onMessage = async (e: MessageEvent) => {
      let data: { type?: string; text?: string; ts?: number };
      try { data = JSON.parse(e.data); } catch { return; }
      if (data.type !== 'clipboard' || typeof data.text !== 'string') return;
      const ts = typeof data.ts === 'number' ? data.ts : 0;
      if (ts <= lastApplied.current) return;
      lastApplied.current = ts;
      try {
        await navigator.clipboard.writeText(data.text);
      } catch {
        /* clipboard write blocked */
      }
    };

    window.addEventListener('copy', onCopy);
    channel.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('copy', onCopy);
      channel.removeEventListener('message', onMessage);
    };
  }, [channel, enabled]);
}
