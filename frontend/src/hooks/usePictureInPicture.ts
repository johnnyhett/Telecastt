import { useState, useEffect, useCallback } from 'react';
import type { RefObject } from 'react';

export function usePictureInPicture(videoRef: RefObject<HTMLVideoElement | null>) {
  const [isPiP, setIsPiP] = useState(false);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    setIsSupported(document.pictureInPictureEnabled);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleEnterPiP = () => setIsPiP(true);
    const handleLeavePiP = () => setIsPiP(false);

    video.addEventListener('enterpictureinpicture', handleEnterPiP);
    video.addEventListener('leavepictureinpicture', handleLeavePiP);

    return () => {
      video.removeEventListener('enterpictureinpicture', handleEnterPiP);
      video.removeEventListener('leavepictureinpicture', handleLeavePiP);
    };
  }, [videoRef]);

  const togglePiP = useCallback(async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (videoRef.current && document.pictureInPictureEnabled) {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (error) {
      console.error('Failed to toggle PiP', error);
    }
  }, [videoRef]);

  return { isPiP, togglePiP, isSupported };
}
