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
  const { connectionState, isReady, error, remoteStream, stats, channels, peerCount } = useWebRTC(
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

  useEffect(() => {
    if (mode !== 'client') return;
    const ch = channels.control;
    if (!ch) return;
    const req = () => {
      try {
        ch.send(JSON.stringify({ t: 'q', level: battery.shouldDegrade ? 'low' : 'auto' }));
      } catch { /* channel not ready */ }
    };
    if (ch.readyState === 'open') req();
    else ch.addEventListener('open', req, { once: true });
    return () => ch.removeEventListener('open', req);
  }, [mode, channels.control, battery.shouldDegrade]);

  useWakeLock(clientLive);

  const seqRef = useRef(0);
  const sendInput = useCallback(
    (msg: InputMessage) => {
      // Pointer moves take the unreliable "cursor" lane (no head-of-line
      // blocking under loss); a sequence number lets the host drop stale
      // reorders. Everything else stays on the reliable control lane.
      if (msg.t === 'p' && msg.phase === 'move' && msg.pt !== 'touch') {
        const fast = channels.cursor;
        if (fast && fast.readyState === 'open') {
          fast.send(JSON.stringify({ ...msg, s: ++seqRef.current }));
          return;
        }
      }
      const ch = channels.control;
      if (ch && ch.readyState === 'open') ch.send(JSON.stringify(msg));
    },
    [channels.control, channels.cursor]
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
