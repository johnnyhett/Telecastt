import { useState, useCallback } from 'react';

export const useDisplayMedia = () => {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startCapture = useCallback(async () => {
    try {
      const constraints = {
        video: {
          displaySurface: "monitor",
          resizeMode: "none",
          frameRate: { ideal: 144, max: 240 }, // Ask for high-hertz capability
          width: { ideal: 3840, max: 3840 },
          height: { ideal: 2160, max: 2160 }
        },
        // Disable audio completely to avoid processing delays if not strictly needed
        audio: false 
      };

      const stream = await navigator.mediaDevices.getDisplayMedia(constraints as any);
      
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && 'contentHint' in videoTrack) {
        // Hint to encoder: Prioritize sharpness/resolution over frame drops under pressure
        videoTrack.contentHint = "detail";
      }

      setLocalStream(stream);
      return stream;
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        console.log("User cancelled display media selection.");
        return null;
      }
      console.error("Error accessing display media.", err);
      setError(err.message || "Could not access display media.");
      return null;
    }
  }, []);

  const stopCapture = useCallback(() => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
  }, [localStream]);

  return { localStream, startCapture, stopCapture, error };
};
