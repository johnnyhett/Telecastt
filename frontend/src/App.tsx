import { useState, useEffect, useRef, useCallback } from 'react';
import { useWebRTC } from './hooks/useWebRTC';
import { useDisplayMedia } from './hooks/useDisplayMedia';
import { useWakeLock } from './hooks/useWakeLock';
import { useDataChannels } from './hooks/useDataChannels';
import { useInputCapture } from './hooks/useInputCapture';
import { useClipboardSync } from './hooks/useClipboardSync';
import type { InputEventData } from './hooks/useInputCapture';

import VideoSurface from './components/VideoSurface';
import TelemetryOverlay from './components/TelemetryOverlay';
import MacDock from './components/MacDock';
import CommandCenter from './components/CommandCenter';

import './styles/tokens.css';
import './styles/glass.css';
import './styles/glass-extensions.css';

function App() {
  const [mode, setMode] = useState<'selection' | 'host' | 'client'>('selection');
  const [roomIdInput, setRoomIdInput] = useState('');
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [localIp, setLocalIp] = useState<string>('localhost');

  const [streamSettings, setStreamSettings] = useState({ fps: '60', bitrate: '50', resolution: '4K' });

  const { startCapture, stopCapture, localStream } = useDisplayMedia();
  const { connectionState, isReady, remoteStream, stats, peerConnection, signalingSocket } = useWebRTC(activeRoomId, mode === 'host', localStream, streamSettings);

  // Data Channels setup
  const channels = useDataChannels(peerConnection, mode === 'host');

  // Video container ref for client input capture
  const videoContainerRef = useRef<HTMLDivElement | null>(null);

  // Auto wake lock during active streaming on client
  useWakeLock(mode === 'client' && connectionState === 'connected');

  // ---------- CLIENT SIDE: Touch/Mouse capture → data channel ----------
  // Throttle mouse moves to max ~60 events/sec to avoid flooding
  const lastSentTime = useRef(0);

  const handleClientInput = useCallback((eventData: InputEventData) => {
    if (!channels.critical || channels.critical.readyState !== 'open') return;

    // Throttle 'move' and 'drag' events to ~16ms intervals (60fps)
    if (eventData.type === 'mouse' && (eventData.data as any).state === 'move') {
      const now = performance.now();
      if (now - lastSentTime.current < 16) return;
      lastSentTime.current = now;
    }
    if (eventData.type === 'touch' && (eventData.data as any).gesture === 'drag') {
      const now = performance.now();
      if (now - lastSentTime.current < 16) return;
      lastSentTime.current = now;
    }

    channels.critical.send(JSON.stringify(eventData));
  }, [channels.critical]);

  useInputCapture(
    videoContainerRef,
    mode === 'client' && connectionState === 'connected',
    handleClientInput
  );

  // ---------- HOST SIDE: Receive data channel input → inject via WebSocket ----------
  useEffect(() => {
    if (mode !== 'host' || !channels.critical) return;

    const handleMessage = (e: MessageEvent) => {
      try {
        const eventData = JSON.parse(e.data);
        let payload: Record<string, unknown> | null = null;

        if (eventData.type === 'mouse') {
          const d = eventData.data;
          payload = {
            action: d.state === 'move' ? 'move' : d.state === 'down' ? 'mousedown' : d.state === 'up' ? 'mouseup' : 'click',
            normalizedX: d.normalizedX,
            normalizedY: d.normalizedY,
            button: d.button
          };
        } else if (eventData.type === 'touch') {
          const d = eventData.data;
          if (d.touches && d.touches.length > 0) {
            const t = d.touches[0];
            payload = {
              action: 'touch',
              phase: d.gesture === 'tap' ? 'down' : 'move',
              normalizedX: t.normalizedX,
              normalizedY: t.normalizedY,
              touchId: t.identifier || 1
            };
          } else if (d.gesture === 'release') {
            payload = {
              action: 'touch',
              phase: 'up',
              normalizedX: 0,
              normalizedY: 0,
              touchId: 1
            };
          }
        } else if (eventData.type === 'wheel') {
          payload = { action: 'wheel', deltaY: eventData.data.deltaY };
        } else if (eventData.type === 'key') {
          const d = eventData.data;
          payload = {
            action: d.down ? 'keydown' : 'keyup',
            key: d.key || d.code || ''
          };
        }

        // Send via existing WebSocket (NOT via HTTP fetch — that was the bug)
        if (payload && signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
          signalingSocket.send(JSON.stringify({
            type: 'input-inject',
            payload
          }));
        }
      } catch {
        // Silently discard malformed input
      }
    };

    channels.critical.addEventListener('message', handleMessage);
    return () => {
      channels.critical?.removeEventListener('message', handleMessage);
    };
  }, [mode, channels.critical, signalingSocket]);

  // Clipboard sync between host and client via the low-priority data channel
  useClipboardSync(channels.low || null, mode === 'client' || mode === 'host');

  // Auto-join via Query Parameter (e.g., from QR Code scan)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam && roomParam.length === 6) {
      setRoomIdInput(roomParam.toUpperCase());
      setActiveRoomId(roomParam.toUpperCase());
      setMode('client');
    }
  }, []);

  const handleStartHosting = async () => {
    try {
      await startCapture();
      
      const ipRes = await fetch(`http://${window.location.hostname}:3001/api/network-info`);
      const ipData = await ipRes.json();
      
      const roomRes = await fetch(`http://${window.location.hostname}:3001/api/create-room`);
      const data = await roomRes.json();
      
      setLocalIp(ipData.localIp);
      setActiveRoomId(data.roomId);
      setMode('host');
    } catch (e) {
      console.error("Could not fetch resources or access media", e);
      stopCapture();
    }
  };

  const handleJoinClient = async () => {
    const code = roomIdInput.trim().toUpperCase();
    if (code.length !== 6) return;

    try {
      const res = await fetch(`http://${window.location.hostname}:3001/api/validate-room/${code}`);
      const data = await res.json();
      
      if (!data.valid) {
        alert(data.message || 'Invalid or expired room code. Please try again.');
        return;
      }

      setActiveRoomId(code);
      setMode('client');
    } catch (e) {
      console.warn("Could not validate room code with server", e);
      setActiveRoomId(code);
      setMode('client');
    }
  };

  const handleDisconnect = () => {
    stopCapture();
    setActiveRoomId(null);
    setMode('selection');
    window.location.href = window.location.pathname;
  };

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      // Silently handle — fullscreen requires user gesture context
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // ---------------------------------------------------------
  // LIVE STREAM VIEW (CLIENT)
  // ---------------------------------------------------------
  if (connectionState === 'connected' && mode === 'client') {
    return (
      <div 
        ref={(el) => {
          videoContainerRef.current = el;
          // Auto-focus so keyboard events are captured immediately
          if (el) el.focus();
        }}
        className="app-container" 
        style={{ width: '100vw', height: '100vh', background: 'black', position: 'relative', overflow: 'hidden', touchAction: 'none', outline: 'none' }}
        tabIndex={0}
      >
        <VideoSurface stream={remoteStream} />
        <TelemetryOverlay stats={stats} />
        <MacDock 
          onDisconnect={handleDisconnect} 
          onFullscreen={toggleFullscreen} 
          isFullscreen={isFullscreen} 
        />
      </div>
    );
  }

  // ---------------------------------------------------------
  // HOST COMMAND CENTER
  // ---------------------------------------------------------
  if (mode === 'host' && activeRoomId) {
    return (
      <div className="app-container" style={{ width: '100vw', height: '100vh', overflowY: 'auto' }}>
        <CommandCenter 
          activeRoomId={activeRoomId} 
          localIp={localIp}
          isReady={isReady}
          onDisconnect={handleDisconnect}
          onSettingsChange={setStreamSettings}
        />
      </div>
    );
  }

  // ---------------------------------------------------------
  // CLIENT CONNECTING STATE VIEW
  // ---------------------------------------------------------
  if (mode === 'client' && activeRoomId) {
    return (
      <div className="app-container fade-enter-active" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', width: '100vw' }}>
        <div className="c-glass-card" style={{ maxWidth: 450, width: '90%', textAlign: 'center', padding: '3rem 2rem' }}>
          <img src="/assets/logo.png" alt="Telecastt" style={{ width: 80, height: 80, marginBottom: '1.5rem', filter: 'drop-shadow(0 0 15px var(--accent-glow))' }} />
          <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.75rem', marginBottom: '0.5rem', color: '#ffffff' }}>
            {connectionState === 'connecting' ? 'Establishing Handshake...' : connectionState === 'reconnecting' ? 'Reconnecting Session...' : 'Connecting to Host'}
          </h2>
          <p style={{ color: 'var(--foreground-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
            Session Code: <span className="mono" style={{ color: 'var(--cyan)', fontWeight: 700 }}>{activeRoomId}</span>
          </p>

          <div style={{ display: 'flex', justifyContent: 'center', margin: '2rem 0' }}>
            <div className="cc-badge cc-badge-active" style={{ padding: '0.75rem 1.5rem', fontSize: '1rem' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#34d399', display: 'inline-block' }} />
              {connectionState.toUpperCase()}
            </div>
          </div>

          <button className="c-button c-button-secondary" onClick={handleDisconnect} style={{ marginTop: '1rem' }}>
            Cancel Connection
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------
  // SELECTION VIEW (HERO SELECTION MATRIX)
  // ---------------------------------------------------------
  return (
    <div className="app-container fade-enter-active" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', width: '100vw', padding: '2rem' }}>
      <div className="c-glass-card" style={{ maxWidth: 540, width: '100%', textAlign: 'center', position: 'relative' }}>
        
        {/* Glow Halo */}
        <div style={{
          position: 'absolute',
          top: '-80px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '260px',
          height: '260px',
          background: 'radial-gradient(circle, var(--cyan-glow) 0%, var(--accent-glow) 50%, transparent 80%)',
          pointerEvents: 'none',
          filter: 'blur(30px)'
        }} />

        <img 
          src="/assets/logo.png" 
          alt="Telecastt Logo" 
          style={{ width: 96, height: 96, margin: '0 auto 1.5rem auto', filter: 'drop-shadow(0 12px 30px rgba(56, 189, 248, 0.45))' }} 
        />
        
        <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: '2.75rem', fontWeight: 900, letterSpacing: '-0.5px', color: '#ffffff', marginBottom: '0.5rem' }}>
          Telecastt
        </h1>
        <p style={{ color: 'var(--foreground-muted)', fontSize: '0.95rem', marginBottom: '2rem', lineHeight: '1.6' }}>
          Cross-Ecosystem Wireless Display Matrix & Remote KVM Control. Seamlessly turn any iPhone, Android, iPad, or Tablet into a high-fps extended monitor.
        </p>

        {/* Cross-Ecosystem Support Badges */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.6rem', marginBottom: '2.25rem', flexWrap: 'wrap' }}>
          <span className="cc-badge">📱 iPhone / Android</span>
          <span className="cc-badge">💻 Mac / Windows</span>
          <span className="cc-badge">📱 iPad / Tablets</span>
          <span className="cc-badge cc-badge-active">⚡ &lt;5ms Native Touch</span>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <button className="c-button" onClick={handleStartHosting}>
            Initialize Host Matrix
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', margin: '0.5rem 0' }}>
            <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--foreground-dim)', fontWeight: 700 }}>or join as extended display</span>
            <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
          </div>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <input 
              type="text" 
              className="c-input" 
              placeholder="ROOM CODE" 
              maxLength={6}
              value={roomIdInput}
              onChange={(e) => setRoomIdInput(e.target.value.toUpperCase())}
            />
            <button 
              className="c-button c-button-secondary" 
              style={{ width: 'auto', padding: '0 1.75rem', flexShrink: 0 }}
              disabled={roomIdInput.trim().length !== 6}
              onClick={handleJoinClient}
            >
              Connect
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

export default App;
