import { useCallback, useEffect, useRef, useState } from 'react';

import { useWebRTC } from './hooks/useWebRTC';
import { useDisplayCapture } from './hooks/useDisplayCapture';
import { usePointerCapture } from './hooks/usePointerCapture';
import { useHostInputRelay } from './hooks/useHostInputRelay';
import { useClipboardSync } from './hooks/useClipboardSync';
import { useBatteryAware } from './hooks/useBatteryAware';
import { useWakeLock } from './hooks/useWakeLock';
import { usePictureInPicture } from './hooks/usePictureInPicture';
import { useFullscreen } from './hooks/useFullscreen';

import { api } from './lib/api';
import { ROOM_CODE_PATTERN } from './lib/env';
import type { AppMode, InputMessage, StreamSettings } from './lib/types';

import LandingView from './components/LandingView';
import HostView from './components/HostView';
import ClientView from './components/ClientView';

export default function App() {
  const [mode, setMode] = useState<AppMode>('landing');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [localIp, setLocalIp] = useState('localhost');
  const [busy, setBusy] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [settings, setSettings] = useState<StreamSettings>({ fps: 60, bitrateMbps: 50, resolution: '4K' });

  const isHost = mode === 'host';

  const { localStream, startCapture, stopCapture } = useDisplayCapture();
  const { connectionState, isReady, error, remoteStream, stats, channels, relayInput } = useWebRTC(
    roomId,
    isHost,
    localStream,
    isHost ? settings : null
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const clientLive = mode === 'client' && connectionState === 'connected';

  // Degrade stream on low client battery.
  const battery = useBatteryAware(0.15);
  useEffect(() => {
    if (battery.shouldDegrade) {
      setSettings((s) => ({ ...s, fps: 30, bitrateMbps: 10 }));
    }
  }, [battery.shouldDegrade]);

  useWakeLock(clientLive);

  const sendInput = useCallback(
    (msg: InputMessage) => {
      const ch = channels.control;
      if (ch && ch.readyState === 'open') ch.send(JSON.stringify(msg));
    },
    [channels.control]
  );

  usePointerCapture(containerRef, clientLive, sendInput);
  useHostInputRelay(channels.control, relayInput, isHost);
  useClipboardSync(channels.clipboard, mode !== 'landing');

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
        connectionState={connectionState}
        onSettingsChange={setSettings}
        onDisconnect={handleDisconnect}
      />
    );
  }

  return <LandingView busy={busy} error={uiError} onHost={handleHost} onJoin={handleJoin} />;
}
