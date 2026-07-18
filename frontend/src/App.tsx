import React, { useState, useEffect } from 'react';
import { useWebRTC } from './hooks/useWebRTC';
import { useDisplayMedia } from './hooks/useDisplayMedia';
import VideoSurface from './components/VideoSurface';
import TelemetryOverlay from './components/TelemetryOverlay';
import MacDock from './components/MacDock';

import './styles/tokens.css';
import './styles/glass.css';
import './styles/glass-extensions.css';

function App() {
  const [mode, setMode] = useState<'selection' | 'host' | 'client'>('selection');
  const [roomIdInput, setRoomIdInput] = useState('');
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const { connectionState, isReady, remoteStream, addLocalStream, error: rtcError, stats } = useWebRTC(activeRoomId, mode === 'host');
  const { startCapture, stopCapture, localStream, error: captureError } = useDisplayMedia();

  const handleStartHosting = async () => {
    const stream = await startCapture();
    if (!stream) return;

    try {
      const res = await fetch('http://localhost:3001/api/create-room');
      const data = await res.json();
      setActiveRoomId(data.roomId);
      setMode('host');
      addLocalStream(stream);
    } catch (e) {
      console.error("Could not fetch room code", e);
    }
  };

  const handleJoinClient = () => {
    if (roomIdInput.trim().length === 6) {
      setActiveRoomId(roomIdInput.trim().toUpperCase());
      setMode('client');
    }
  };

  const handleDisconnect = () => {
    stopCapture();
    window.location.reload(); // Hard reset state for MVP
  };

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen().catch(err => console.error(err));
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen().catch(err => console.error(err));
      setIsFullscreen(false);
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
  // LIVE STREAM VIEW (HOST)
  // ---------------------------------------------------------
  if (connectionState === 'connected' && mode === 'host') {
    return (
      <div className="app-container" style={{ width: '100vw', height: '100vh', background: 'black', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--color-accent-cyan)', textAlign: 'center' }}>
          <h2 style={{ letterSpacing: '2px', marginBottom: '1rem' }}>Casting Live</h2>
          <p style={{ opacity: 0.5 }}>Your screen is being shared securely via WebRTC.</p>
        </div>
        <MacDock 
          onDisconnect={handleDisconnect} 
          onFullscreen={toggleFullscreen} 
          isFullscreen={isFullscreen} 
        />
      </div>
    );
  }

  // ---------------------------------------------------------
  // SELECTION & NEGOTIATION VIEWS
  // ---------------------------------------------------------
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', padding: '2rem' }}>
      
      <div className="c-glass-card fade-enter-active" style={{ textAlign: 'center', maxWidth: '400px', width: '100%' }}>
        <h1 style={{ margin: '0 0 1rem 0', fontWeight: '800', letterSpacing: '-0.5px' }}>Telecastt</h1>
        <p style={{ margin: '0 0 2rem 0', opacity: 0.7 }}>144Hz Zero-Latency Second Monitor</p>

        {mode === 'selection' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <button className="c-button" onClick={handleStartHosting}>
              Share Display (Host)
            </button>
            <div style={{ margin: '1rem 0', opacity: 0.5, fontSize: '0.8rem' }}>OR</div>
            <input 
              className="c-input" 
              placeholder="Enter Room Code" 
              value={roomIdInput} 
              onChange={e => setRoomIdInput(e.target.value.toUpperCase())}
              maxLength={6}
            />
            <button className="c-button" onClick={handleJoinClient} disabled={roomIdInput.length !== 6}>
              Join Display (Client)
            </button>
          </div>
        )}

        {mode === 'host' && activeRoomId && (
          <div className="fade-enter-active">
            <h2 style={{ fontSize: '3rem', margin: '1.5rem 0', letterSpacing: '4px', color: 'var(--color-accent-cyan)' }}>
              {activeRoomId}
            </h2>
            <p>Waiting for client to connect...</p>
            {isReady && <p style={{ color: '#4ade80', marginTop: '1rem' }}>Client found, negotiating stream...</p>}
            <button className="c-button" style={{ marginTop: '2rem', background: 'rgba(255,255,255,0.1)' }} onClick={handleDisconnect}>Cancel</button>
          </div>
        )}

        {mode === 'client' && activeRoomId && (
          <div className="fade-enter-active">
            <div style={{ margin: '2rem 0' }}>
              <div className="spinner" style={{ width: '40px', height: '40px', border: '3px solid rgba(255,255,255,0.1)', borderTopColor: 'var(--color-accent-cyan)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto' }} />
            </div>
            <p>Connecting to <strong>{activeRoomId}</strong>...</p>
            <p style={{ opacity: 0.5, fontSize: '0.9rem', marginTop: '0.5rem', textTransform: 'capitalize' }}>State: {connectionState}</p>
            <button className="c-button" style={{ marginTop: '2rem', background: 'rgba(255,255,255,0.1)' }} onClick={handleDisconnect}>Cancel</button>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {(rtcError || captureError) && (
          <div style={{ marginTop: '1rem', color: '#ff4d4f', fontSize: '0.9rem', background: 'rgba(255,0,0,0.1)', padding: '0.5rem', borderRadius: '8px' }}>
            {rtcError} {captureError}
          </div>
        )}
      </div>

    </div>
  );
}

export default App;
