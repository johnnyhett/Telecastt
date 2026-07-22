import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import type { DisplayRegion } from '../lib/types';

interface VideoStageProps {
  stream: MediaStream | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  region?: DisplayRegion;
}

// When a sub-region is assigned (extend mode), enlarge the video so the region
// exactly fills the stage and offset it so the region's top-left sits at 0,0.
// `object-fit: fill` maps the region onto the viewport (the standard video-wall
// behaviour); the full frame (w=h=1) is the identity, i.e. a plain mirror.
function cropStyle(region?: DisplayRegion): CSSProperties | undefined {
  if (!region) return undefined;
  const { x, y, w, h } = region;
  if (w >= 1 && h >= 1 && x <= 0 && y <= 0) return undefined;
  return {
    position: 'absolute',
    width: `${100 / w}%`,
    height: `${100 / h}%`,
    left: `${(-x / w) * 100}%`,
    top: `${(-y / h) * 100}%`,
    objectFit: 'fill',
  };
}

/**
 * Renders the remote display. The <video> element ref is owned by the parent
 * so features like Picture-in-Picture can act on the very same element.
 */
export default function VideoStage({ stream, videoRef, region }: VideoStageProps) {
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
      <video ref={videoRef} autoPlay playsInline muted style={cropStyle(region)} />
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
