import { useState, useEffect } from 'react';

export type OrientationType = 'landscape' | 'portrait';

export const useDeviceOrientation = (): OrientationType => {
  const [orientation, setOrientation] = useState<OrientationType>(
    window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'
  );

  useEffect(() => {
    const handleResize = () => {
      setOrientation(window.innerWidth > window.innerHeight ? 'landscape' : 'portrait');
    };

    const handleOrientationChange = () => {
      setTimeout(handleResize, 100); // Delay for orientation animation
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleOrientationChange);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleOrientationChange);
    };
  }, []);

  return orientation;
};
