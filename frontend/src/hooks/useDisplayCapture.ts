import { useCallback, useRef, useState } from 'react';

/**
 * Wraps getDisplayMedia. The user picks which surface to share in the browser
 * picker — this is exactly where they choose the virtual/extended display when
 * one has been provisioned, so the extended screen is what gets streamed.
 */
export function useDisplayCapture(enableAudio = false) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startCapture = useCallback(async (): Promise<MediaStream | null> => {
    setError(null);
    try {
      const constraints: DisplayMediaStreamOptions = {
        video: {
          frameRate: { ideal: 60, max: 144 },
          width: { ideal: 3840, max: 3840 },
          height: { ideal: 2160, max: 2160 },
        },
        audio: enableAudio
          ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
          : false,
      };

      const stream = await navigator.mediaDevices.getDisplayMedia(constraints);

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && 'contentHint' in videoTrack) {
        videoTrack.contentHint = 'detail';
      }
      // If the user stops sharing from the browser chrome, drop our reference.
      if (videoTrack) {
        videoTrack.addEventListener('ended', () => {
          streamRef.current = null;
          setLocalStream(null);
        });
      }

      streamRef.current = stream;
      setLocalStream(stream);
      return stream;
    } catch (err) {
      const e = err as DOMException;
      if (e.name === 'NotAllowedError') return null; // user cancelled picker
      setError(e.message || 'Could not access display media.');
      return null;
    }
  }, [enableAudio]);

  const stopCapture = useCallback(() => {
    const stream = streamRef.current;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLocalStream(null);
  }, []);

  return { localStream, startCapture, stopCapture, error };
}
