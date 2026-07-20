import { useEffect, useRef, useState } from 'react';

export interface DataChannels {
  critical: RTCDataChannel | null;
  high: RTCDataChannel | null;
  low: RTCDataChannel | null;
}

export function useDataChannels(peerConnection: RTCPeerConnection | null, isHost: boolean) {
  const [channels, setChannels] = useState<DataChannels>({ critical: null, high: null, low: null });
  const criticalRef = useRef<RTCDataChannel | null>(null);
  const highRef = useRef<RTCDataChannel | null>(null);
  const lowRef = useRef<RTCDataChannel | null>(null);

  useEffect(() => {
    if (!peerConnection) return;

    const updateChannels = () => {
      setChannels({
        critical: criticalRef.current,
        high: highRef.current,
        low: lowRef.current
      });
    };

    if (isHost) {
      const critical = peerConnection.createDataChannel('critical', { ordered: true, maxRetransmits: 0 });
      const high = peerConnection.createDataChannel('high', { ordered: false, maxRetransmits: 2 });
      const low = peerConnection.createDataChannel('low', { ordered: true }); // reliable

      criticalRef.current = critical;
      highRef.current = high;
      lowRef.current = low;
      updateChannels();
    } else {
      const handleDataChannel = (event: RTCDataChannelEvent) => {
        const channel = event.channel;
        if (channel.label === 'critical') criticalRef.current = channel;
        if (channel.label === 'high') highRef.current = channel;
        if (channel.label === 'low') lowRef.current = channel;
        updateChannels();
      };

      peerConnection.addEventListener('datachannel', handleDataChannel);

      return () => {
        peerConnection.removeEventListener('datachannel', handleDataChannel);
      };
    }
  }, [peerConnection, isHost]);

  return channels;
}
