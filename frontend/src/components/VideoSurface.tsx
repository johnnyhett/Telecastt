import React, { useRef, useEffect } from 'react';

interface VideoSurfaceProps {
  stream: MediaStream | null;
}

const VideoSurface: React.FC<VideoSurfaceProps> = ({ stream }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;
    
    const playVideo = () => {
      video.play().catch(err => {
        console.warn("Video playback requires interaction or muted autoplay:", err);
      });
    };

    playVideo();

    const handleTrackAdded = () => {
      video.srcObject = stream;
      playVideo();
    };

    stream.addEventListener('addtrack', handleTrackAdded);
    return () => {
      stream.removeEventListener('addtrack', handleTrackAdded);
    };
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
};

export default VideoSurface;
