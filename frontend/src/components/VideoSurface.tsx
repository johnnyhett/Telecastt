import React, { useRef, useEffect } from 'react';

interface VideoSurfaceProps {
  stream: MediaStream | null;
}

// React.memo with a custom comparator that ALWAYS returns true prevents this 
// component from ever re-rendering after the initial mount.
// This is critical to ensure React's render cycle doesn't interfere with the 144Hz playback.
const VideoSurface = React.memo(({ stream }: VideoSurfaceProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Use a side-effect to attach the stream bypassing React's render logic
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        objectFit: 'contain',
        backgroundColor: '#000'
      }}
    />
  );
}, () => true);

export default VideoSurface;
