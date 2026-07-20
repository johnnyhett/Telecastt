import { useEffect, useRef } from 'react';

export function useClipboardSync(dataChannel: RTCDataChannel | null, enabled: boolean) {
  const lastWriteTimestamp = useRef(0);

  useEffect(() => {
    if (!enabled || !dataChannel) return;

    const handleClipboardEvent = async () => {
      if (document.hidden) return; // Optional security measure
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          const payload = JSON.stringify({ type: 'clipboard', text, timestamp: Date.now() });
          if (dataChannel.readyState === 'open') {
            dataChannel.send(payload);
          }
        }
      } catch (err) {
        console.warn('Clipboard read failed:', err);
      }
    };

    const handleMessage = async (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'clipboard' && data.text && data.timestamp > lastWriteTimestamp.current) {
          await navigator.clipboard.writeText(data.text);
          lastWriteTimestamp.current = data.timestamp;
        }
      } catch (err) {
        console.warn('Clipboard write failed:', err);
      }
    };

    window.addEventListener('copy', handleClipboardEvent);
    dataChannel.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('copy', handleClipboardEvent);
      dataChannel.removeEventListener('message', handleMessage);
    };
  }, [dataChannel, enabled]);
}
