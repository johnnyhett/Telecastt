import { useState, useEffect, useRef } from 'react';

export type ContentType = 'static' | 'dynamic';

export interface AdaptiveQualityState {
  contentType: ContentType;
  recommendedFps: number;
  recommendedBitrate: number;
}

export function useAdaptiveQuality(peerConnection: RTCPeerConnection | null) {
  const [state, setState] = useState<AdaptiveQualityState>({
    contentType: 'dynamic',
    recommendedFps: 30,
    recommendedBitrate: 2500000
  });

  const lastFramesRef = useRef(0);
  const lastTimeRef = useRef(0);

  useEffect(() => {
    if (!peerConnection) return;

    const monitorStats = async () => {
      try {
        const stats = await peerConnection.getStats();
        stats.forEach((report) => {
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            const framesDecoded = report.framesDecoded || 0;
            const now = performance.now();
            
            if (lastTimeRef.current > 0) {
              const timeDelta = (now - lastTimeRef.current) / 1000;
              const frameDelta = framesDecoded - lastFramesRef.current;
              const fps = frameDelta / timeDelta;

              let newType: ContentType = 'dynamic';
              if (fps < 15) {
                newType = 'static';
              }
              
              setState({
                contentType: newType,
                recommendedFps: newType === 'static' ? 5 : 60,
                recommendedBitrate: newType === 'static' ? 5000000 : 2500000
              });
            }
            
            lastFramesRef.current = framesDecoded;
            lastTimeRef.current = now;
          }
        });
      } catch (e) {
        console.warn('Failed to get stats:', e);
      }
    };

    const interval = setInterval(monitorStats, 2000);
    return () => clearInterval(interval);
  }, [peerConnection]);

  return state;
}
