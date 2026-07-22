import { useCallback, useEffect, useRef, useState } from 'react';

import { useWebRTC } from './hooks/useWebRTC';
import { useDisplayCapture } from './hooks/useDisplayCapture';
import { usePointerCapture } from './hooks/usePointerCapture';
import { useClipboardSync } from './hooks/useClipboardSync';
import { useBatteryAware } from './hooks/useBatteryAware';
import { useWakeLock } from './hooks/useWakeLock';
import { usePictureInPicture } from './hooks/usePictureInPicture';
import { useFullscreen } from './hooks/useFullscreen';

import { api, setHostToken as setApiHostToken } from './lib/api';
import { ROOM_CODE_PATTERN } from './lib/env';
import type { AppMode, InputMessage, StreamSettings } from './lib/types';

import LandingView from './components/LandingView';
import HostView from './components/HostView';
import ClientView from './components/ClientView';

export default function App() {
  const [mode, setMode] = useState<AppMode>('landing');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [hostToken, setHostToken] = useState<string | null>(null);
  const [localIp, setLocalIp] = useState('localhost');
  const [busy, setBusy] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [settings, setSettings] = useState<StreamSettings>({ fps: 60, bitrateMbps: 50, resolution: '4K' });

  const isHost = mode === 'host';

  const { localStream, startCapture, stopCapture } = useDisplayCapture();
  const { connectionState, isReady, error, remoteStream, stats, channels, peerCount, region } = useWebRTC(
    roomId,
    isHost,
    localStream,
    isHost ? settings : null,
    hostToken
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const clientLive = mode === 'client' && connectionState === 'connected';

  // Adapt quality to battery. As host, degrade our own encoder for all peers.
  // As a client (secondary), ask the host to degrade just this stream — with
  // the mesh each secondary has its own sender, so it's independent per screen.
  const battery = useBatteryAware(0.15);
  useEffect(() => {
    if (isHost && battery.shouldDegrade) {
      setSettings((s) => ({ ...s, fps: 30, bitrateMbps: 10 }));
    }
  }, [isHost, battery.shouldDegrade]);

  // Network-sensing adaptation (777 VI.1): watch this client's live telemetry
  // and, with hysteresis to avoid flapping, decide whether to ask for degraded
  // quality — enter on clearly poor conditions, leave only when comfortably good.
  const [netLow, setNetLow] = useState(false);
  useEffect(() => {
    if (mode !== 'client') { setNetLow(false); return; }
    const rtt = Number(stats.rttMs) || 0;
    const jit = Number(stats.jitterMs) || 0;
    // Only degrade on genuinely severe links — WebRTC's own congestion control
    // already scales bitrate to fit the pipe, so capping the ceiling too eagerly
    // just makes good/decent links look worse. Conservative thresholds + wide
    // hysteresis keep the cap out of the way unless the link is truly bad.
    setNetLow((prev) =>
      prev
        ? !(rtt < 220 && jit < 60)     // recover once the link is usable again
        : rtt > 450 || jit > 130       // degrade only when it's genuinely severe
    );
  }, [mode, stats.rttMs, stats.jitterMs]);

  // Ask the host to degrade this secondary's stream on low battery OR poor
  // network; restore to 'auto' when both are healthy again.
  const wantLow = battery.shouldDegrade || netLow;
  useEffect(() => {
    if (mode !== 'client') return;
    const ch = channels.control;
    if (!ch) return;
    const req = () => {
      try { ch.send(JSON.stringify({ t: 'q', level: wantLow ? 'low' : 'auto' })); } catch { /* not ready */ }
    };
    if (ch.readyState === 'open') req();
    else ch.addEventListener('open', req, { once: true });
    return () => ch.removeEventListener('open', req);
  }, [mode, channels.control, wantLow]);

  useWakeLock(clientLive);

  const seqRef = useRef(0);
  const sendInput = useCallback(
    (msg: InputMessage) => {
      // Map this secondary's local coordinates into its assigned region of the
      // host surface, so control lands at the right absolute position in extend
      // mode (identity when the region is the full frame).
      const out: InputMessage =
        msg.t === 'p'
          ? { ...msg, x: region.x + msg.x * region.w, y: region.y + msg.y * region.h }
          : msg;
      const control = channels.control;
      const cursor = channels.cursor;
      // Pointer moves prefer the low-latency unreliable lane; clicks and keys
      // prefer the reliable lane. Crucially, ALWAYS fall back to whichever
      // channel is actually open — so a click is never silently dropped just
      // because one channel isn't ready yet (the "mouse moves but won't click"
      // bug when the control channel lagged behind the cursor channel).
      if (out.t === 'p' && out.phase === 'move' && out.pt !== 'touch') {
        if (cursor && cursor.readyState === 'open') {
          cursor.send(JSON.stringify({ ...out, s: ++seqRef.current }));
          return;
        }
        if (control && control.readyState === 'open') control.send(JSON.stringify(out));
        return;
      }
      if (control && control.readyState === 'open') { control.send(JSON.stringify(out)); return; }
      if (cursor && cursor.readyState === 'open') cursor.send(JSON.stringify(out));
    },
    [channels.control, channels.cursor, region]
  );

  // Client sends its input over the control channel; the host relays each
  // secondary's input to the injector internally (see useWebRTC). Clipboard sync
  // on the client is symmetric; the host fans clipboard out to all secondaries
  // internally.
  usePointerCapture(containerRef, clientLive, sendInput);
  useClipboardSync(channels.clipboard, mode === 'client');

  const { togglePiP, isSupported: pipSupported } = usePictureInPicture(videoRef);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();

  // Auto-join from a scanned QR link (?room=CODE).
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('room');
    if (raw && ROOM_CODE_PATTERN.test(raw.toUpperCase())) {
      setRoomId(raw.toUpperCase());
      setMode('client');
    }
  }, []);

  // Keep the live surface focused so keyboard input is captured.
  useEffect(() => {
    if (clientLive) containerRef.current?.focus();
  }, [clientLive]);

  const handleHost = useCallback(async () => {
    setBusy(true);
    setUiError(null);
    try {
      const stream = await startCapture();
      if (!stream) return; // user dismissed the picker
      const [net, room] = await Promise.all([
        api.networkInfo().catch(() => null),
        api.createRoom(),
      ]);
      setLocalIp(net?.localIp || window.location.hostname);
      setRoomId(room.roomId);
      setHostToken(room.hostToken);
      setApiHostToken(room.hostToken);
      setMode('host');
    } catch (e) {
      setUiError(e instanceof Error ? e.message : 'Could not start host session.');
      stopCapture();
    } finally {
      setBusy(false);
    }
  }, [startCapture, stopCapture]);

  const handleJoin = useCallback(async (raw: string) => {
    const code = raw.trim().toUpperCase();
    if (!ROOM_CODE_PATTERN.test(code)) {
      setUiError('Enter a valid 6-character room code.');
      return;
    }
    setBusy(true);
    setUiError(null);
    try {
      await api.validateRoom(code);
      setRoomId(code);
      setMode('client');
    } catch (e) {
      setUiError(e instanceof Error ? e.message : 'Invalid or expired room code.');
    } finally {
      setBusy(false);
    }
  }, []);

  const handleDisconnect = useCallback(() => {
    stopCapture();
    setRoomId(null);
    setHostToken(null);
    setApiHostToken(null);
    setMode('landing');
    setUiError(null);
    if (window.location.search) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [stopCapture]);

  if (mode === 'client') {
    return (
      <ClientView
        connectionState={connectionState}
        error={error || uiError}
        roomId={roomId}
        remoteStream={remoteStream}
        stats={stats}
        region={region}
        containerRef={containerRef}
        videoRef={videoRef}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        onTogglePiP={togglePiP}
        pipSupported={pipSupported}
        onDisconnect={handleDisconnect}
      />
    );
  }

  if (mode === 'host' && roomId) {
    return (
      <HostView
        roomId={roomId}
        localIp={localIp}
        isReady={isReady}
        peerCount={peerCount}
        connectionState={connectionState}
        onSettingsChange={setSettings}
        onDisconnect={handleDisconnect}
      />
    );
  }

  return <LandingView busy={busy} error={uiError} onHost={handleHost} onJoin={handleJoin} />;
}
