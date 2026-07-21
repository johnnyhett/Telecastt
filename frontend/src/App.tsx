import { useState, useEffect } from 'react';
import { useWebRTC } from './hooks/useWebRTC';
import { useDisplayMedia } from './hooks/useDisplayMedia';
import { useWakeLock } from './hooks/useWakeLock';
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

  const { startCapture, stopCapture, localStream, error: captureError } = useDisplayMedia();
  const { connectionState, isReady, remoteStream, error: rtcError, stats } = useWebRTC(activeRoomId, mode === 'host', localStream, streamSettings);

  // Auto wake lock during active streaming on client
  useWakeLock(mode === 'client' && connectionState === 'connected');

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
      const stream = await startCapture();
      if (!stream) return;

      const res = await fetch(`http://${window.location.hostname}:3001/api/create-room`);
      const data = await res.json();
      
      const ipRes = await fetch(`http://${window.location.hostname}:3001/api/network-info`);
      const ipData = await ipRes.json();
      
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
      // Fallback: attempt join anyway
      setActiveRoomId(code);
      setMode('client');
    }
  };

  const handleDisconnect = () => {
    stopCapture();
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
    } catch (err) {
      console.error("Fullscreen error:", err);
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
      <div className="app-container" style={{ width: '100vw', height: '100vh', background: 'black', position: 'relative', overflow: 'hidden' }}>
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '2rem' }}>
        <CommandCenter 
          localIp={localIp}
          activeRoomId={activeRoomId}
          isReady={isReady || connectionState === 'connected'}
          onDisconnect={handleDisconnect}
          onSettingsChange={setStreamSettings}
        />
        {(rtcError || captureError) && (
          <div style={{ position: 'fixed', bottom: 20, right: 20, background: 'rgba(255,0,0,0.8)', color: 'white', padding: '1rem', borderRadius: '8px' }}>
            {rtcError} {captureError}
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------
  // SELECTION & NEGOTIATION VIEWS
  // ---------------------------------------------------------
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '2rem', position: 'relative' }}>
      
      <div className="c-glass-card fade-enter-active" style={{ textAlign: 'center', maxWidth: '440px', width: '100%', position: 'relative', zIndex: 2 }}>
        
        {mode === 'selection' && (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '2.5rem', position: 'relative' }}>
              <div style={{ position: 'relative', marginBottom: '1.25rem' }}>
                <div style={{ position: 'absolute', top: -10, left: -10, right: -10, bottom: -10, borderRadius: '50%', background: 'var(--color-cyan-glow)', filter: 'blur(20px)', zIndex: 0 }} />
                <img src="/assets/logo.png" alt="Telecastt" style={{ width: '80px', height: '80px', objectFit: 'contain', position: 'relative', zIndex: 1, filter: 'drop-shadow(0 0 15px rgba(56, 189, 248, 0.6))' }} />
              </div>
              
              <h1 style={{ margin: '0 0 0.4rem 0', fontWeight: '800', letterSpacing: '3px', textTransform: 'uppercase', fontSize: '2.25rem', background: 'linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                Telecastt
              </h1>
              <p style={{ margin: 0, color: 'var(--color-cyan)', letterSpacing: '2px', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>
                Enterprise Display Protocol
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <button className="c-button" onClick={handleStartHosting}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                Initialize Host Node
              </button>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', margin: '0.5rem 0' }}>
                <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
                <span style={{ fontSize: '0.7rem', color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 600 }}>OR LINK AS DISPLAY</span>
                <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <input 
                  className="c-input" 
                  placeholder="ENTER SESSION CODE" 
                  value={roomIdInput} 
                  onChange={e => setRoomIdInput(e.target.value.toUpperCase())}
                  maxLength={6}
                />
                <button className="c-button c-button-secondary" onClick={handleJoinClient} disabled={roomIdInput.length !== 6}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                  Connect to Host
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '2.5rem', paddingTop: '1.25rem', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: '0.7rem', color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: '1px' }}>
              <span>🔒 DTLS 1.3</span>
              <span>⚡ &lt;5ms Latency</span>
              <span>🖥️ 4K 144Hz</span>
            </div>
          </div>
        )}

        {mode === 'client' && activeRoomId && (
          <div className="fade-enter-active">
            <div style={{ margin: '2.5rem 0' }}>
              <div style={{ width: '48px', height: '48px', border: '3px solid rgba(255,255,255,0.08)', borderTopColor: 'var(--color-cyan)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto', boxShadow: '0 0 20px var(--color-cyan-glow)' }} />
            </div>
            <h3 style={{ margin: '0 0 0.5rem 0', fontFamily: 'var(--font-display)', fontSize: '1.25rem', color: 'white' }}>Connecting to Host Node</h3>
            <p className="mono-font" style={{ fontSize: '1.75rem', color: 'var(--color-cyan)', letterSpacing: '4px', margin: '0.5rem 0' }}>{activeRoomId}</p>
            <p style={{ opacity: 0.6, fontSize: '0.85rem', marginTop: '0.5rem', textTransform: 'capitalize' }}>Handshake State: {connectionState}</p>
            <button className="c-button c-button-secondary" style={{ marginTop: '2rem' }} onClick={handleDisconnect}>Cancel Connection</button>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {(rtcError || captureError) && (
          <div style={{ marginTop: '1.25rem', color: '#f43f5e', fontSize: '0.85rem', background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)', padding: '0.75rem', borderRadius: '12px' }}>
            {rtcError} {captureError}
          </div>
        )}
      </div>

    </div>
  );
}

export default App;
