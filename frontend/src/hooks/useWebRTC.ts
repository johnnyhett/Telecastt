import { useState, useRef, useEffect, useCallback } from 'react';

const SIGNALING_SERVER = 'ws://localhost:3001';

export const useWebRTC = (roomId: string | null, isHost: boolean) => {
  const [connectionState, setConnectionState] = useState<string>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const remoteStream = useRef<MediaStream | null>(null);

  const initWebRTC = useCallback(() => {
    // Force WebRTC configuration
    peerConnection.current = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    peerConnection.current.onconnectionstatechange = () => {
      if (peerConnection.current) {
        setConnectionState(peerConnection.current.connectionState);
      }
    };

    peerConnection.current.ontrack = (event) => {
      // Receive track from host
      if (!remoteStream.current) {
        remoteStream.current = new MediaStream();
      }
      remoteStream.current.addTrack(event.track);

      // CRITICAL FOR ZERO LATENCY
      // Override the playoutDelayHint to 0 to destroy the jitter buffer
      const receivers = peerConnection.current?.getReceivers() || [];
      receivers.forEach(receiver => {
        // Typecasting since standard typescript dom types might not have it yet
        if ('playoutDelayHint' in receiver) {
          (receiver as any).playoutDelayHint = 0;
        }
        if ('jitterBufferTarget' in receiver) {
          (receiver as any).jitterBufferTarget = 0;
        }
      });
    };

    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate && ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({
          type: 'ice-candidate',
          candidate: event.candidate
        }));
      }
    };
  }, []);

  const connectSignaling = useCallback(() => {
    if (!roomId) return;

    ws.current = new WebSocket(SIGNALING_SERVER);

    ws.current.onopen = () => {
      ws.current?.send(JSON.stringify({ type: 'join', roomId }));
    };

    ws.current.onmessage = async (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'error':
          setError(data.message);
          break;
        case 'ready':
          setIsReady(true);
          // If host, create offer
          if (isHost && peerConnection.current) {
            try {
              const offer = await peerConnection.current.createOffer();
              await peerConnection.current.setLocalDescription(offer);
              ws.current?.send(JSON.stringify({ type: 'offer', offer }));
            } catch (err) {
              console.error(err);
            }
          }
          break;
        case 'offer':
          if (!isHost && peerConnection.current) {
            try {
              await peerConnection.current.setRemoteDescription(new RTCSessionDescription(data.offer));
              const answer = await peerConnection.current.createAnswer();
              await peerConnection.current.setLocalDescription(answer);
              ws.current?.send(JSON.stringify({ type: 'answer', answer }));
            } catch (err) {
              console.error(err);
            }
          }
          break;
        case 'answer':
          if (isHost && peerConnection.current) {
            try {
              await peerConnection.current.setRemoteDescription(new RTCSessionDescription(data.answer));
            } catch (err) {
              console.error(err);
            }
          }
          break;
        case 'ice-candidate':
          if (peerConnection.current) {
            try {
              await peerConnection.current.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (err) {
              console.error(err);
            }
          }
          break;
        case 'peer-disconnected':
          setConnectionState('disconnected');
          setIsReady(false);
          break;
      }
    };
  }, [roomId, isHost]);

  useEffect(() => {
    if (roomId) {
      initWebRTC();
      connectSignaling();
    }

    return () => {
      if (ws.current) ws.current.close();
      if (peerConnection.current) peerConnection.current.close();
    };
  }, [roomId, initWebRTC, connectSignaling]);

  const addLocalStream = useCallback((stream: MediaStream) => {
    if (peerConnection.current) {
      stream.getTracks().forEach(track => {
        peerConnection.current?.addTrack(track, stream);
      });
    }
  }, []);

  return {
    connectionState,
    error,
    isReady,
    remoteStream: remoteStream.current,
    addLocalStream
  };
};
