import { useCallback, useEffect, useRef, useState } from 'react';
import { ICE_SERVERS, SIGNALING_URL } from '../lib/env';
import type { ConnectionState, StreamSettings, TelemetryStats } from '../lib/types';

export interface RtcChannels {
  control: RTCDataChannel | null;
  clipboard: RTCDataChannel | null;
}

export interface UseWebRTCResult {
  connectionState: ConnectionState;
  isReady: boolean;
  error: string | null;
  remoteStream: MediaStream | null;
  stats: TelemetryStats;
  channels: RtcChannels;
  relayInput: (payload: unknown) => void;
}

const MAX_RETRIES = 5;

// Prefer modern screen-content codecs (AV1 → HEVC → VP9) over H.264/VP8 when
// both peers support them. AV1's screen-content-coding tools dramatically cut
// the bitrate needed for mostly-static desktop content, freeing headroom for
// higher resolution and refresh. Reordering is safe: negotiation still falls
// back to any codec the peers have in common.
const CODEC_PREFERENCE = ['video/AV1', 'video/H265', 'video/VP9', 'video/VP8', 'video/H264'];

function applyVideoCodecPreferences(pc: RTCPeerConnection) {
  const caps =
    typeof RTCRtpSender !== 'undefined' && RTCRtpSender.getCapabilities
      ? RTCRtpSender.getCapabilities('video')
      : null;
  if (!caps || !caps.codecs.length) return;

  const rank = (mime: string) => {
    const i = CODEC_PREFERENCE.indexOf(mime);
    return i === -1 ? CODEC_PREFERENCE.length : i;
  };
  const ordered = [...caps.codecs].sort((a, b) => rank(a.mimeType) - rank(b.mimeType));

  for (const t of pc.getTransceivers()) {
    if (t.sender.track?.kind === 'video' && typeof t.setCodecPreferences === 'function') {
      try { t.setCodecPreferences(ordered); } catch { /* codec preferences unsupported */ }
    }
  }
}

/**
 * Owns the entire peer session: signaling socket, RTCPeerConnection, data
 * channels, remote media, reconnection and (client-side) telemetry. Host and
 * client share this hook; `isHost` decides who offers and who receives.
 */
export function useWebRTC(
  roomId: string | null,
  isHost: boolean,
  localStream: MediaStream | null,
  streamSettings: StreamSettings | null,
  hostToken: string | null = null
): UseWebRTCResult {
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [channels, setChannels] = useState<RtcChannels>({ control: null, clipboard: null });
  const [stats, setStats] = useState<TelemetryStats>({ fps: 0, bitrateMbps: '0.00', jitterMs: '0.0' });

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const retryCount = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closing = useRef(false);

  // Refs mirror the latest props so the long-lived socket/pc callbacks never
  // read stale values.
  const isHostRef = useRef(isHost);
  const localStreamRef = useRef(localStream);
  const roomIdRef = useRef(roomId);
  const hostTokenRef = useRef(hostToken);
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);
  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);
  useEffect(() => { hostTokenRef.current = hostToken; }, [hostToken]);

  const sendSignal = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const relayInput = useCallback(
    (payload: unknown) => sendSignal({ type: 'input-inject', payload }),
    [sendSignal]
  );

  const createPeerConnection = useCallback(() => {
    if (pcRef.current) {
      try { pcRef.current.close(); } catch { /* ignore */ }
    }
    pendingCandidates.current = [];
    setChannels({ control: null, clipboard: null });

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 4 });
    const incoming = new MediaStream();
    setRemoteStream(incoming);

    if (isHostRef.current) {
      const stream = localStreamRef.current;
      if (stream) stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      applyVideoCodecPreferences(pc);
      // Reliable, ordered channels: input and clipboard must never be dropped.
      const control = pc.createDataChannel('control', { ordered: true });
      const clipboard = pc.createDataChannel('clipboard', { ordered: true });
      setChannels({ control, clipboard });
    } else {
      pc.ondatachannel = (event) => {
        const ch = event.channel;
        setChannels((prev) => ({
          ...prev,
          [ch.label === 'clipboard' ? 'clipboard' : 'control']: ch,
        }));
      };
    }

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      const tracks = stream ? stream.getTracks() : [event.track];
      tracks.forEach((t) => {
        if (!incoming.getTracks().includes(t)) incoming.addTrack(t);
      });
      // Prefer freshness over smoothness — this is an interactive display.
      pc.getReceivers().forEach((r) => {
        if ('playoutDelayHint' in r) (r as unknown as { playoutDelayHint: number }).playoutDelayHint = 0;
        if ('jitterBufferTarget' in r) (r as unknown as { jitterBufferTarget: number }).jitterBufferTarget = 0;
      });
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) sendSignal({ type: 'ice-candidate', candidate: event.candidate });
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') {
        retryCount.current = 0;
        setConnectionState('connected');
      } else if (s === 'connecting') {
        setConnectionState('connecting');
      } else if (s === 'disconnected') {
        setConnectionState('disconnected');
      } else if (s === 'failed') {
        setConnectionState('failed');
        if (isHostRef.current) {
          pc.createOffer({ iceRestart: true })
            .then((o) => pc.setLocalDescription(o))
            .then(() => sendSignal({ type: 'offer', offer: pc.localDescription }))
            .catch(() => { /* ignore */ });
        }
      }
    };

    pcRef.current = pc;
    return pc;
  }, [sendSignal]);

  const handleSignal = useCallback(
    async (data: { type?: string; message?: string; offer?: RTCSessionDescriptionInit; answer?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) => {
      const pc = pcRef.current;
      if (!pc) return;

      switch (data.type) {
        case 'error':
          setError(data.message || 'Signaling error.');
          break;

        case 'ready':
          setError(null);
          setIsReady(true);
          if (isHostRef.current) {
            try {
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              sendSignal({ type: 'offer', offer });
            } catch (e) {
              console.error('Failed to create offer', e);
            }
          }
          break;

        case 'offer':
          if (isHostRef.current || !data.offer) break;
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            for (const c of pendingCandidates.current) {
              await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
            }
            pendingCandidates.current = [];
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendSignal({ type: 'answer', answer });
          } catch (e) {
            console.error('Failed to handle offer', e);
          }
          break;

        case 'answer':
          if (!isHostRef.current || !data.answer) break;
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            for (const c of pendingCandidates.current) {
              await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
            }
            pendingCandidates.current = [];
          } catch (e) {
            console.error('Failed to apply answer', e);
          }
          break;

        case 'ice-candidate':
          if (!data.candidate) break;
          try {
            if (pc.remoteDescription && pc.remoteDescription.type) {
              await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } else {
              pendingCandidates.current.push(data.candidate);
            }
          } catch (e) {
            console.error('Failed to add ICE candidate', e);
          }
          break;

        case 'peer-disconnected':
          setIsReady(false);
          setConnectionState('disconnected');
          // Rebuild a clean PC so the room can accept a fresh peer.
          createPeerConnection();
          break;
      }
    },
    [sendSignal, createPeerConnection]
  );

  const connectSignaling = useCallback(() => {
    const rid = roomIdRef.current;
    if (!rid || closing.current) return;

    setConnectionState('connecting');
    const ws = new WebSocket(SIGNALING_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      retryCount.current = 0;
      // Authenticate the host by presenting its room token; clients join plain.
      ws.send(JSON.stringify({
        type: 'join',
        roomId: rid,
        role: isHostRef.current ? 'host' : 'client',
        ...(isHostRef.current && hostTokenRef.current ? { hostToken: hostTokenRef.current } : {}),
      }));
    };

    ws.onmessage = (ev) => {
      let data;
      try { data = JSON.parse(ev.data); } catch { return; }
      handleSignal(data);
    };

    ws.onerror = () => { /* close handler drives reconnection */ };

    ws.onclose = (ev) => {
      if (closing.current || ev.wasClean) return;
      if (retryCount.current >= MAX_RETRIES) {
        setError('Connection lost. Please refresh to try again.');
        setConnectionState('failed');
        return;
      }
      const delay = Math.min(2 ** retryCount.current * 1000, 16000);
      retryCount.current += 1;
      setConnectionState('reconnecting');
      retryTimer.current = setTimeout(() => {
        if (!closing.current) connectSignaling();
      }, delay);
    };
  }, [handleSignal]);

  // Session lifecycle — keyed on roomId.
  useEffect(() => {
    if (!roomId) return;
    closing.current = false;
    setError(null);
    setIsReady(false);
    createPeerConnection();
    connectSignaling();

    return () => {
      closing.current = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      const ws = wsRef.current;
      if (ws) {
        try { ws.close(1000, 'cleanup'); } catch { /* ignore */ }
        wsRef.current = null;
      }
      const pc = pcRef.current;
      if (pc) {
        try { pc.close(); } catch { /* ignore */ }
        pcRef.current = null;
      }
      setChannels({ control: null, clipboard: null });
      setRemoteStream(null);
      setConnectionState('idle');
    };
  }, [roomId, createPeerConnection, connectSignaling]);

  // Host: react to the local capture stream arriving/changing after the PC
  // exists (renegotiate so the client gets the new tracks).
  useEffect(() => {
    const pc = pcRef.current;
    if (!pc || !isHost || !localStream) return;
    const senders = pc.getSenders();
    let added = false;
    localStream.getTracks().forEach((track) => {
      const existing = senders.find((s) => s.track?.kind === track.kind);
      if (existing) existing.replaceTrack(track).catch(() => {});
      else { pc.addTrack(track, localStream); added = true; }
    });
    if (added) applyVideoCodecPreferences(pc);
    if (added && isReady) {
      pc.createOffer()
        .then((o) => pc.setLocalDescription(o))
        .then(() => sendSignal({ type: 'offer', offer: pc.localDescription }))
        .catch(() => { /* ignore */ });
    }
  }, [localStream, isHost, isReady, sendSignal]);

  // Host: apply bitrate/framerate caps to the video sender.
  useEffect(() => {
    const pc = pcRef.current;
    if (!pc || !streamSettings) return;
    const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    params.encodings[0].maxBitrate = streamSettings.bitrateMbps * 1_000_000;
    params.encodings[0].maxFramerate = streamSettings.fps;
    sender.setParameters(params).catch(() => { /* ignore */ });
  }, [streamSettings]);

  // Client: telemetry polling.
  const lastBytes = useRef(0);
  const lastTs = useRef(0);
  useEffect(() => {
    if (connectionState !== 'connected' || isHost) return;
    const id = setInterval(async () => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        const report = await pc.getStats();
        let fps = 0;
        let bytes = 0;
        let jbDelay = 0;
        let jbCount = 1;
        report.forEach((r) => {
          if (r.type === 'inbound-rtp' && r.kind === 'video') {
            fps = r.framesPerSecond || 0;
            bytes = r.bytesReceived || 0;
            jbDelay = r.jitterBufferDelay || 0;
            jbCount = r.jitterBufferEmittedCount || 1;
          }
        });
        const now = performance.now();
        let bitrate = '0.00';
        if (lastTs.current && bytes >= lastBytes.current) {
          const dt = (now - lastTs.current) / 1000;
          if (dt > 0) bitrate = (((bytes - lastBytes.current) * 8) / dt / 1_000_000).toFixed(2);
        }
        lastBytes.current = bytes;
        lastTs.current = now;
        setStats({ fps, bitrateMbps: bitrate, jitterMs: ((jbDelay / jbCount) * 1000).toFixed(1) });
      } catch {
        /* stats unavailable */
      }
    }, 1000);
    return () => clearInterval(id);
  }, [connectionState, isHost]);

  return { connectionState, isReady, error, remoteStream, stats, channels, relayInput };
}
