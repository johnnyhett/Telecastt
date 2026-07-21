import React, { useRef, useEffect, useState } from 'react';

interface VideoSurfaceProps {
  stream: MediaStream | null;
}

const VideoSurface: React.FC<VideoSurfaceProps> = ({ stream }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [needsUserAction, setNeedsUserAction] = useState(false);

  const attemptPlay = async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      video.muted = true;
      video.setAttribute('playsinline', 'true');
      video.setAttribute('autoplay', 'true');
      await video.play();
      setNeedsUserAction(false);
    } catch (err) {
      console.warn("Autoplay requires user interaction:", err);
      setNeedsUserAction(true);
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;
    attemptPlay();

    const handleTrackAdded = () => {
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        attemptPlay();
      }
    };

    stream.addEventListener('addtrack', handleTrackAdded);
    return () => {
      stream.removeEventListener('addtrack', handleTrackAdded);
    };
  }, [stream]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', backgroundColor: '#000' }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          objectFit: 'contain'
        }}
      />
      {needsUserAction && (
        <div 
          onClick={attemptPlay}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(2, 6, 23, 0.9)',
            color: '#fff',
            cursor: 'pointer',
            zIndex: 999,
            padding: '2rem',
            textAlign: 'center'
          }}
        >
          <div style={{ fontSize: '3.5rem', marginBottom: '1rem', filter: 'drop-shadow(0 0 20px var(--accent-glow))' }}>▶</div>
          <h3 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>Tap to Start Stream</h3>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.9rem' }}>Browser requires a tap to initialize video playback</p>
        </div>
      )}
    </div>
  );
};

export default VideoSurface;
