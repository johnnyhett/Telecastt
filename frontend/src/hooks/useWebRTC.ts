import { useState, useRef, useEffect, useCallback } from 'react';

const SIGNALING_SERVER = `ws://${window.location.hostname}:3001`;

export interface TelemetryStats {
  fps: number;
  bitrateMbps: string;
  jitterMs: string;
}

export interface StreamSettings {
  fps: string;
  bitrate: string;
  resolution: string;
}

export const useWebRTC = (
  roomId: string | null,
  isHost: boolean,
  localStream: MediaStream | null = null,
  streamSettings?: StreamSettings
) => {
  const [connectionState, setConnectionState] = useState<string>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [stats, setStats] = useState<TelemetryStats>({ fps: 0, bitrateMbps: '0.00', jitterMs: '0.0' });

  const lastBytesReceived = useRef<number>(0);
  const lastTimestamp = useRef<number>(0);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const remoteStream = useRef<MediaStream>(new MediaStream());
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const retryCount = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCleaningUp = useRef(false);

  // Store latest values in refs to avoid stale closures
  const isHostRef = useRef(isHost);
  const localStreamRef = useRef(localStream);
  const roomIdRef = useRef(roomId);

  useEffect(() => { isHostRef.current = isHost; }, [isHost]);
  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

  const createPeerConnection = useCallback(() => {
    if (peerConnection.current) {
      peerConnection.current.close();
    }
    pendingCandidates.current = [];

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
      ],
      iceCandidatePoolSize: 10,
    });

    // Add local stream tracks for host
    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });
    }

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      setConnectionState(state);
      if (state === 'failed') {
        // Attempt ICE restart
        if (isHostRef.current && ws.current?.readyState === WebSocket.OPEN) {
          pc.createOffer({ iceRestart: true }).then(offer => {
            pc.setLocalDescription(offer);
            ws.current?.send(JSON.stringify({ type: 'offer', offer }));
          }).catch(console.error);
        }
      }
    };

    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      console.log('ICE connection state:', iceState);
      if (iceState === 'disconnected') {
        // Brief disconnection — wait for recovery
        setTimeout(() => {
          if (pc.iceConnectionState === 'disconnected') {
            setConnectionState('disconnected');
          }
        }, 3000);
      }
    };

    pc.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach(track => {
        remoteStream.current.addTrack(track);
      });

      // Zero latency configuration
      pc.getReceivers().forEach(receiver => {
        if ('playoutDelayHint' in receiver) {
          (receiver as any).playoutDelayHint = 0;
        }
        if ('jitterBufferTarget' in receiver) {
          (receiver as any).jitterBufferTarget = 0;
        }
      });
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({
          type: 'ice-candidate',
          candidate: event.candidate
        }));
      }
    };

    peerConnection.current = pc;
    return pc;
  }, []);

  const connectSignaling = useCallback(() => {
    const currentRoomId = roomIdRef.current;
    if (!currentRoomId) return;
    if (isCleaningUp.current) return;

    const socket = new WebSocket(SIGNALING_SERVER);
    ws.current = socket;

    socket.onopen = () => {
      retryCount.current = 0;
      socket.send(JSON.stringify({ type: 'join', roomId: currentRoomId }));
    };

    socket.onerror = (e) => {
      console.error('WebSocket error:', e);
    };

    socket.onclose = (event) => {
      if (isCleaningUp.current || event.wasClean) return;
      if (retryCount.current >= 5) {
        setError('Connection lost. Please refresh to try again.');
        return;
      }
      const delay = Math.min(Math.pow(2, retryCount.current) * 1000, 16000);
      retryCount.current += 1;
      console.log(`WebSocket closed. Retrying in ${delay}ms (attempt ${retryCount.current}/5)...`);
      retryTimer.current = setTimeout(() => {
        if (!isCleaningUp.current) {
          connectSignaling();
        }
      }, delay);
    };

    socket.onmessage = async (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      const pc = peerConnection.current;
      if (!pc) return;

      switch (data.type) {
        case 'error':
          setError(data.message);
          break;

        case 'ready':
          setIsReady(true);
          if (isHostRef.current) {
            try {
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              socket.send(JSON.stringify({ type: 'offer', offer }));
            } catch (err) {
              console.error('Failed to create offer:', err);
            }
          }
          break;

        case 'offer':
          if (!isHostRef.current) {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
              // Flush buffered ICE candidates
              for (const c of pendingCandidates.current) {
                await pc.addIceCandidate(new RTCIceCandidate(c));
              }
              pendingCandidates.current = [];

              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              socket.send(JSON.stringify({ type: 'answer', answer }));
            } catch (err) {
              console.error('Failed to handle offer:', err);
            }
          }
          break;

        case 'answer':
          if (isHostRef.current) {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
              for (const c of pendingCandidates.current) {
                await pc.addIceCandidate(new RTCIceCandidate(c));
              }
              pendingCandidates.current = [];
            } catch (err) {
              console.error('Failed to handle answer:', err);
            }
          }
          break;

        case 'ice-candidate':
          try {
            if (pc.remoteDescription) {
              await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } else {
              pendingCandidates.current.push(data.candidate);
            }
          } catch (err) {
            console.error('Failed to add ICE candidate:', err);
          }
          break;

        case 'peer-disconnected':
          setConnectionState('disconnected');
          setIsReady(false);
          // Recreate peer connection to accept a new client
          createPeerConnection();
          if (isHostRef.current) {
            setIsReady(true);
          }
          break;
      }
    };
  }, [createPeerConnection]);

  // Main lifecycle
  useEffect(() => {
    if (!roomId) return;
    isCleaningUp.current = false;

    createPeerConnection();
    connectSignaling();

    return () => {
      isCleaningUp.current = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      if (ws.current) {
        ws.current.close(1000, 'cleanup');
        ws.current = null;
      }
      if (peerConnection.current) {
        peerConnection.current.close();
        peerConnection.current = null;
      }
    };
  }, [roomId, createPeerConnection, connectSignaling]);

  // Dynamically attach localStream tracks to peerConnection when stream is acquired
  useEffect(() => {
    const pc = peerConnection.current;
    if (!pc || !localStream || !isHost) return;

    const currentSenders = pc.getSenders();
    let trackAdded = false;

    localStream.getTracks().forEach(track => {
      const existingSender = currentSenders.find(s => s.track?.kind === track.kind);
      if (existingSender) {
        existingSender.replaceTrack(track).catch(console.error);
      } else {
        pc.addTrack(track, localStream);
        trackAdded = true;
      }
    });

    if (trackAdded && ws.current?.readyState === WebSocket.OPEN && isReady) {
      pc.createOffer().then(offer => {
        return pc.setLocalDescription(offer).then(() => offer);
      }).then(offer => {
        ws.current?.send(JSON.stringify({ type: 'offer', offer }));
      }).catch(console.error);
    }
  }, [localStream, isHost, isReady]);

  // Apply stream settings to sender
  useEffect(() => {
    if (!peerConnection.current || !streamSettings) return;
    const senders = peerConnection.current.getSenders();
    const videoSender = senders.find(s => s.track?.kind === 'video');
    if (!videoSender) return;

    const params = videoSender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    params.encodings[0].maxBitrate = parseInt(streamSettings.bitrate, 10) * 1_000_000;
    params.encodings[0].maxFramerate = parseInt(streamSettings.fps, 10);
    videoSender.setParameters(params).catch(console.error);
  }, [streamSettings]);

  // Telemetry polling
  useEffect(() => {
    if (connectionState !== 'connected' || isHost) return;

    const interval = setInterval(async () => {
      if (!peerConnection.current) return;
      try {
        const statsReport = await peerConnection.current.getStats();
        let fps = 0;
        let bytesReceived = 0;
        let jitterBufferDelay = 0;
        let jitterBufferEmittedCount = 0;
        const timestamp = performance.now();

        statsReport.forEach(report => {
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            fps = report.framesPerSecond || 0;
            bytesReceived = report.bytesReceived || 0;
            jitterBufferDelay = report.jitterBufferDelay || 0;
            jitterBufferEmittedCount = report.jitterBufferEmittedCount || 1;
          }
        });

        let bitrateMbps = '0.00';
        if (lastTimestamp.current && lastBytesReceived.current) {
          const timeDelta = (timestamp - lastTimestamp.current) / 1000;
          const bytesDelta = bytesReceived - lastBytesReceived.current;
          bitrateMbps = ((bytesDelta * 8) / timeDelta / 1_000_000).toFixed(2);
        }
        lastBytesReceived.current = bytesReceived;
        lastTimestamp.current = timestamp;

        const jitterMs = ((jitterBufferDelay / jitterBufferEmittedCount) * 1000).toFixed(1);
        setStats({ fps, bitrateMbps, jitterMs });
      } catch {
        // Ignore stats errors
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [connectionState, isHost]);

  return {
    connectionState,
    error,
    isReady,
    remoteStream: remoteStream.current,
    stats,
    peerConnection: peerConnection.current,
    signalingSocket: ws.current
  };
};
