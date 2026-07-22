import { useCallback, useEffect, useRef, useState } from 'react';
import { ICE_SERVERS, SIGNALING_URL } from '../lib/env';
import type { ConnectionState, StreamSettings, TelemetryStats, DisplayRegion } from '../lib/types';
import { FULL_REGION } from '../lib/types';
import { attachHostInput, attachClipboardReceiver } from '../lib/peer-io';

export interface RtcChannels {
  control: RTCDataChannel | null;
  clipboard: RTCDataChannel | null;
  cursor: RTCDataChannel | null;
}

export interface UseWebRTCResult {
  connectionState: ConnectionState;
  isReady: boolean;
  error: string | null;
  remoteStream: MediaStream | null;
  stats: TelemetryStats;
  channels: RtcChannels;
  relayInput: (payload: unknown) => void;
  /** Host only: number of secondary PCs currently connected. */
  peerCount: number;
  /** Client only: the region of the host surface this secondary should show. */
  region: DisplayRegion;
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

// Cap a single peer's video encoder (bitrate + framerate). Applied globally from
// the host's Stream Configuration UI, and per-secondary in response to a
// client's quality request (see the 'q' control message).
function setEncoderCaps(pc: RTCPeerConnection, bitrateMbps: number, fps: number) {
  const sender = pc.getSenders().find((x) => x.track?.kind === 'video');
  if (!sender) return;
  const params = sender.getParameters();
  if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
  params.encodings[0].maxBitrate = bitrateMbps * 1_000_000;
  params.encodings[0].maxFramerate = fps;
  sender.setParameters(params).catch(() => { /* ignore */ });
}

// Bitrate (Mbps) / framerate a secondary drops to when it requests degraded
// quality (low battery, constrained link).
const DEGRADED_BITRATE_MBPS = 8;
const DEGRADED_FPS = 30;
// A single secondary is never squeezed below this, however many are connected.
const BANDWIDTH_FLOOR_MBPS = 4;

interface HostPeer {
  pc: RTCPeerConnection;
  control: RTCDataChannel;
  clipboard: RTCDataChannel;
  cursor: RTCDataChannel;
  level: 'auto' | 'low';
  pending: RTCIceCandidateInit[];
  dispose: () => void;
}

/**
 * Owns the entire peer session. Two roles share one hook:
 *  - **Host**: manages a `Map<peerId, HostPeer>` — one RTCPeerConnection per
 *    secondary PC — offering to each (addressed via `to`), routing answers/ICE
 *    by `from`, and tearing down per-peer on `peer-left`. Input relay and
 *    clipboard are wired per secondary internally.
 *  - **Client**: a single connection to the host; renders the remote stream and
 *    reports telemetry.
 *
 * The single-secondary case is exactly the N=1 slice of the host map, so it
 * behaves identically to a straightforward one-to-one session.
 */
export function useWebRTC(
  roomId: string | null,
  isHost: boolean,
  localStream: MediaStream | null,
  streamSettings: StreamSettings | null,
  hostToken: string | null = null,
  extend = false
): UseWebRTCResult {
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [channels, setChannels] = useState<RtcChannels>({ control: null, clipboard: null, cursor: null });
  const [stats, setStats] = useState<TelemetryStats>({ fps: 0, bitrateMbps: '0.00', jitterMs: '0.0', rttMs: '0' });
  const [peerCount, setPeerCount] = useState(0);
  const [region, setRegion] = useState<DisplayRegion>(FULL_REGION);

  const wsRef = useRef<WebSocket | null>(null);
  const retryCount = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closing = useRef(false);

  // Client-side connection state.
  const clientPcRef = useRef<RTCPeerConnection | null>(null);
  const clientPending = useRef<RTCIceCandidateInit[]>([]);
  const hostIdRef = useRef<string | null>(null);

  // Host-side: one entry per connected secondary PC.
  const peersRef = useRef<Map<string, HostPeer>>(new Map());

  // Refs mirror the latest props so the long-lived socket callbacks never read
  // stale values.
  const isHostRef = useRef(isHost);
  const localStreamRef = useRef(localStream);
  const roomIdRef = useRef(roomId);
  const hostTokenRef = useRef(hostToken);
  const settingsRef = useRef(streamSettings);
  const extendRef = useRef(extend);
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);
  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);
  useEffect(() => { hostTokenRef.current = hostToken; }, [hostToken]);
  useEffect(() => { settingsRef.current = streamSettings; }, [streamSettings]);
  useEffect(() => { extendRef.current = extend; }, [extend]);

  const sendSignal = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const relayInput = useCallback(
    (payload: unknown) => sendSignal({ type: 'input-inject', payload }),
    [sendSignal]
  );

  // ---- Host: aggregate connection state across all secondaries ----
  const refreshHostState = useCallback(() => {
    let connected = 0;
    for (const { pc } of peersRef.current.values()) {
      if (pc.connectionState === 'connected') connected++;
    }
    setPeerCount(connected);
    setIsReady(connected > 0);
    setConnectionState(peersRef.current.size === 0 ? 'connecting' : connected > 0 ? 'connected' : 'connecting');
  }, []);

  // Fair-share the host's configured bitrate across all connected secondaries,
  // re-dividing as they join/leave, honoring each peer's degrade level. Keeps
  // the host uplink from being oversubscribed by N screens.
  const redistributeBandwidth = useCallback(() => {
    const s = settingsRef.current;
    if (!s) return;
    const n = peersRef.current.size || 1;
    const fairShare = Math.max(BANDWIDTH_FLOOR_MBPS, s.bitrateMbps / n);
    peersRef.current.forEach((entry) => {
      if (entry.level === 'low') {
        setEncoderCaps(entry.pc, Math.min(DEGRADED_BITRATE_MBPS, fairShare), DEGRADED_FPS);
      } else {
        setEncoderCaps(entry.pc, fairShare, s.fps);
      }
    });
  }, []);

  // Host: assign each secondary a region of the shared surface. In extend mode,
  // tile into equal vertical columns by join order; otherwise every secondary
  // mirrors the full frame. Delivered over each secondary's control channel.
  const assignRegions = useCallback(() => {
    const peers = [...peersRef.current.values()];
    const n = peers.length;
    peers.forEach((entry, i) => {
      const region: DisplayRegion =
        extendRef.current && n > 0 ? { x: i / n, y: 0, w: 1 / n, h: 1 } : FULL_REGION;
      if (entry.control.readyState === 'open') {
        try { entry.control.send(JSON.stringify({ t: 'region', ...region })); } catch { /* ignore */ }
      }
    });
  }, []);

  // ---- Host: create (or replace) a connection to one secondary PC ----
  const createHostPeer = useCallback((peerId: string) => {
    const existing = peersRef.current.get(peerId);
    if (existing) { existing.dispose(); peersRef.current.delete(peerId); }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 4 });
    const stream = localStreamRef.current;
    if (stream) stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    applyVideoCodecPreferences(pc);

    const control = pc.createDataChannel('control', { ordered: true });
    const clipboard = pc.createDataChannel('clipboard', { ordered: true });
    // Unreliable, unordered lane for high-frequency pointer moves — avoids the
    // head-of-line blocking a reliable channel suffers under packet loss.
    const cursor = pc.createDataChannel('cursor', { ordered: false, maxRetransmits: 0 });
    const disposeInput = attachHostInput(control, relayInput);
    const disposeCursor = attachHostInput(cursor, relayInput, { dropStale: true });
    const disposeClip = attachClipboardReceiver(clipboard);

    // A secondary can ask the host to adapt *its* encoder (low battery / weak
    // link). Each secondary has its own sender, so this is per-peer.
    // A secondary can ask the host to adapt *its* stream (low battery / weak
    // link). Record the level and re-share bandwidth across all secondaries.
    const onQuality = (e: MessageEvent) => {
      let m: { t?: string; level?: string };
      try { m = JSON.parse(e.data); } catch { return; }
      if (!m || m.t !== 'q') return;
      const self = peersRef.current.get(peerId);
      if (self) self.level = m.level === 'low' ? 'low' : 'auto';
      redistributeBandwidth();
    };
    control.addEventListener('message', onQuality);
    // Send this secondary its region once its control channel is open.
    const onControlOpen = () => assignRegions();
    control.addEventListener('open', onControlOpen);

    const entry: HostPeer = {
      pc, control, clipboard, cursor, level: 'auto', pending: [],
      dispose: () => {
        disposeInput(); disposeCursor(); disposeClip();
        control.removeEventListener('message', onQuality);
        control.removeEventListener('open', onControlOpen);
        try { pc.close(); } catch { /* ignore */ }
      },
    };
    peersRef.current.set(peerId, entry);

    pc.onicecandidate = (e) => {
      if (e.candidate) sendSignal({ type: 'ice-candidate', to: peerId, candidate: e.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        redistributeBandwidth();
        assignRegions(); // resend once fully connected — the client's listener is attached by now
      }
      refreshHostState();
    };

    pc.createOffer()
      .then((o) => pc.setLocalDescription(o))
      .then(() => sendSignal({ type: 'offer', to: peerId, offer: pc.localDescription }))
      .catch(() => { /* ignore */ });

    redistributeBandwidth();
    refreshHostState();
  }, [relayInput, sendSignal, redistributeBandwidth, assignRegions, refreshHostState]);

  const removeHostPeer = useCallback((peerId: string) => {
    const entry = peersRef.current.get(peerId);
    if (!entry) return;
    entry.dispose();
    peersRef.current.delete(peerId);
    redistributeBandwidth(); // remaining secondaries reclaim the freed budget
    assignRegions();         // and re-tile so the columns stay contiguous
    refreshHostState();
  }, [redistributeBandwidth, assignRegions, refreshHostState]);

  // ---- Client: single connection to the host ----
  const createClientPeer = useCallback(() => {
    if (clientPcRef.current) { try { clientPcRef.current.close(); } catch { /* ignore */ } }
    clientPending.current = [];
    setChannels({ control: null, clipboard: null, cursor: null });

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 4 });
    const incoming = new MediaStream();
    setRemoteStream(incoming);

    pc.ondatachannel = (event) => {
      const ch = event.channel;
      const key = ch.label === 'clipboard' ? 'clipboard' : ch.label === 'cursor' ? 'cursor' : 'control';
      setChannels((prev) => ({ ...prev, [key]: ch }));
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      const tracks = stream ? stream.getTracks() : [event.track];
      tracks.forEach((t) => { if (!incoming.getTracks().includes(t)) incoming.addTrack(t); });
      // Prefer freshness over smoothness — this is an interactive display.
      pc.getReceivers().forEach((r) => {
        if ('playoutDelayHint' in r) (r as unknown as { playoutDelayHint: number }).playoutDelayHint = 0;
        if ('jitterBufferTarget' in r) (r as unknown as { jitterBufferTarget: number }).jitterBufferTarget = 0;
      });
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && hostIdRef.current) {
        sendSignal({ type: 'ice-candidate', to: hostIdRef.current, candidate: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') { retryCount.current = 0; setConnectionState('connected'); }
      else if (s === 'connecting') setConnectionState('connecting');
      else if (s === 'disconnected') setConnectionState('disconnected');
      else if (s === 'failed') setConnectionState('failed');
    };

    clientPcRef.current = pc;
    return pc;
  }, [sendSignal]);

  const handleSignal = useCallback(
    async (data: {
      type?: string; message?: string; from?: string; peerId?: string; role?: string;
      peers?: Array<{ id: string; role: string }>;
      offer?: RTCSessionDescriptionInit; answer?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit;
    }) => {
      switch (data.type) {
        case 'error':
          setError(data.message || 'Signaling error.');
          break;

        case 'joined':
          setError(null);
          if (isHostRef.current) {
            // Offer to any secondaries already waiting in the room. `isReady`
            // then reflects a genuinely connected secondary (via refreshHostState).
            (data.peers || []).filter((p) => p.role === 'client').forEach((p) => createHostPeer(p.id));
          } else {
            setIsReady(true);
            // Fresh connection on every join (covers reconnection cleanly).
            createClientPeer();
            const host = (data.peers || []).find((p) => p.role === 'host');
            if (host) hostIdRef.current = host.id;
            setConnectionState('connecting');
          }
          break;

        case 'peer-joined':
          if (isHostRef.current && data.role === 'client' && data.peerId) createHostPeer(data.peerId);
          break;

        case 'peer-left':
          if (isHostRef.current && data.peerId) removeHostPeer(data.peerId);
          else if (!isHostRef.current && data.peerId === hostIdRef.current) {
            setConnectionState('disconnected');
            setIsReady(false);
          }
          break;

        case 'peer-disconnected':
          // Legacy signal — only meaningful to a client (its host went away).
          if (!isHostRef.current) { setConnectionState('disconnected'); setIsReady(false); }
          break;

        case 'offer': {
          if (isHostRef.current || !data.offer) break;
          const pc = clientPcRef.current;
          if (!pc) break;
          if (data.from) hostIdRef.current = data.from;
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            for (const c of clientPending.current) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
            clientPending.current = [];
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendSignal({ type: 'answer', to: hostIdRef.current, answer });
          } catch (e) { console.error('Failed to handle offer', e); }
          break;
        }

        case 'answer': {
          if (!isHostRef.current || !data.answer || !data.from) break;
          const entry = peersRef.current.get(data.from);
          if (!entry) break;
          try {
            await entry.pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            for (const c of entry.pending) await entry.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
            entry.pending = [];
          } catch (e) { console.error('Failed to apply answer', e); }
          break;
        }

        case 'ice-candidate': {
          if (!data.candidate) break;
          if (isHostRef.current) {
            const entry = data.from ? peersRef.current.get(data.from) : null;
            if (!entry) break;
            try {
              if (entry.pc.remoteDescription && entry.pc.remoteDescription.type) {
                await entry.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
              } else entry.pending.push(data.candidate);
            } catch (e) { console.error('Failed to add ICE candidate', e); }
          } else {
            const pc = clientPcRef.current;
            if (!pc) break;
            try {
              if (pc.remoteDescription && pc.remoteDescription.type) {
                await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
              } else clientPending.current.push(data.candidate);
            } catch (e) { console.error('Failed to add ICE candidate', e); }
          }
          break;
        }
      }
    },
    [createHostPeer, removeHostPeer, sendSignal, createClientPeer]
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
      retryTimer.current = setTimeout(() => { if (!closing.current) connectSignaling(); }, delay);
    };
  }, [handleSignal]);

  // Session lifecycle — keyed on roomId.
  useEffect(() => {
    if (!roomId) return;
    closing.current = false;
    setError(null);
    setIsReady(false);
    setPeerCount(0);
    setRegion(FULL_REGION);
    hostIdRef.current = null;
    connectSignaling();

    const peers = peersRef.current;
    return () => {
      closing.current = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      const ws = wsRef.current;
      if (ws) { try { ws.close(1000, 'cleanup'); } catch { /* ignore */ } wsRef.current = null; }
      peers.forEach((entry) => entry.dispose());
      peers.clear();
      const cpc = clientPcRef.current;
      if (cpc) { try { cpc.close(); } catch { /* ignore */ } clientPcRef.current = null; }
      setChannels({ control: null, clipboard: null, cursor: null });
      setRemoteStream(null);
      setConnectionState('idle');
      setPeerCount(0);
    };
  }, [roomId, connectSignaling]);

  // Host: broadcast local clipboard copies to every connected secondary.
  useEffect(() => {
    if (!isHost || !roomId) return;
    const onCopy = async () => {
      if (document.hidden) return;
      let text = '';
      try { text = await navigator.clipboard.readText(); } catch { return; }
      if (!text) return;
      const msg = JSON.stringify({ type: 'clipboard', text, ts: Date.now() });
      peersRef.current.forEach(({ clipboard }) => {
        if (clipboard.readyState === 'open') { try { clipboard.send(msg); } catch { /* ignore */ } }
      });
    };
    window.addEventListener('copy', onCopy);
    return () => window.removeEventListener('copy', onCopy);
  }, [isHost, roomId]);

  // Host: when the capture stream changes, replace the video track on every
  // secondary connection (no full renegotiation needed for a track swap).
  useEffect(() => {
    if (!isHost || !localStream) return;
    const video = localStream.getVideoTracks()[0];
    if (!video) return;
    peersRef.current.forEach(({ pc }) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(video).catch(() => {});
    });
  }, [localStream, isHost]);

  // Host: re-share the bitrate budget across secondaries when settings change.
  useEffect(() => {
    if (!isHost) return;
    redistributeBandwidth();
  }, [streamSettings, isHost, redistributeBandwidth]);

  // Host: re-assign regions whenever mirror/extend mode toggles.
  useEffect(() => {
    if (!isHost) return;
    assignRegions();
  }, [extend, isHost, assignRegions]);

  // Client: receive the region this secondary should display, from the host,
  // over the control channel.
  useEffect(() => {
    if (isHost) return;
    const ch = channels.control;
    if (!ch) return;
    const onMsg = (e: MessageEvent) => {
      let m: { t?: string; x?: number; y?: number; w?: number; h?: number };
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t !== 'region') return;
      if (typeof m.x === 'number' && typeof m.y === 'number' && typeof m.w === 'number' && typeof m.h === 'number') {
        setRegion({ x: m.x, y: m.y, w: m.w, h: m.h });
      }
    };
    ch.addEventListener('message', onMsg);
    return () => ch.removeEventListener('message', onMsg);
  }, [isHost, channels.control]);

  // Client: telemetry polling.
  const lastBytes = useRef(0);
  const lastTs = useRef(0);
  useEffect(() => {
    if (connectionState !== 'connected' || isHost) return;
    const id = setInterval(async () => {
      const pc = clientPcRef.current;
      if (!pc) return;
      try {
        const report = await pc.getStats();
        let fps = 0; let bytes = 0; let jbDelay = 0; let jbCount = 1; let rtt = 0;
        report.forEach((r) => {
          if (r.type === 'inbound-rtp' && r.kind === 'video') {
            fps = r.framesPerSecond || 0;
            bytes = r.bytesReceived || 0;
            jbDelay = r.jitterBufferDelay || 0;
            jbCount = r.jitterBufferEmittedCount || 1;
          } else if (r.type === 'candidate-pair' && r.nominated && typeof r.currentRoundTripTime === 'number') {
            rtt = r.currentRoundTripTime; // seconds
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
        setStats({
          fps,
          bitrateMbps: bitrate,
          jitterMs: ((jbDelay / jbCount) * 1000).toFixed(1),
          rttMs: (rtt * 1000).toFixed(0),
        });
      } catch { /* stats unavailable */ }
    }, 1000);
    return () => clearInterval(id);
  }, [connectionState, isHost]);

  return { connectionState, isReady, error, remoteStream, stats, channels, relayInput, peerCount, region };
}
