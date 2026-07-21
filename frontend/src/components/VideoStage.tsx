import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';

interface VideoStageProps {
  stream: MediaStream | null;
  videoRef: RefObject<HTMLVideoElement | null>;
}

/**
 * Renders the remote display. The <video> element ref is owned by the parent
 * so features like Picture-in-Picture can act on the very same element.
 */
export default function VideoStage({ stream, videoRef }: VideoStageProps) {
  const [needsTap, setNeedsTap] = useState(false);

  const play = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      v.muted = true;
      await v.play();
      setNeedsTap(false);
    } catch {
      // Autoplay blocked — surface a tap-to-play affordance.
      setNeedsTap(true);
    }
  }, [videoRef]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !stream) return;
    v.srcObject = stream;
    void play();

    const onAddTrack = () => {
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void play();
      }
    };
    stream.addEventListener('addtrack', onAddTrack);
    return () => stream.removeEventListener('addtrack', onAddTrack);
  }, [stream, videoRef, play]);

  return (
    <div className="video-stage">
      <video ref={videoRef} autoPlay playsInline muted />
      {needsTap && (
        <button className="video-tap" onClick={() => void play()} type="button">
          <span className="video-tap-icon">▶</span>
          <span className="video-tap-title">Tap to start stream</span>
          <span className="video-tap-sub">Your browser needs a tap to begin playback</span>
        </button>
      )}
    </div>
  );
}
