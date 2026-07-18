import React, { useState } from 'react';
import { useWebRTC } from './hooks/useWebRTC';
import { useDisplayMedia } from './hooks/useDisplayMedia';
import VideoSurface from './components/VideoSurface';
import './styles/tokens.css';
import './styles/glass.css';

function App() {
  const [mode, setMode] = useState<'selection' | 'host' | 'client'>('selection');
  const [roomIdInput, setRoomIdInput] = useState('');
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);

  const { connectionState, isReady, remoteStream, addLocalStream, error: rtcError } = useWebRTC(activeRoomId, mode === 'host');
  const { startCapture, localStream, error: captureError } = useDisplayMedia();

  const handleStartHosting = async () => {
    // 1. Capture screen first
    const stream = await startCapture();
    if (!stream) return;

    // 2. Fetch a room code from our signaling server API
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

  // If connected, hide the UI completely and just show the stream (or black if hosting)
  if (connectionState === 'connected') {
    return (
      <div style={{ width: '100vw', height: '100vh', background: 'black' }}>
        {mode === 'client' ? (
          <VideoSurface stream={remoteStream} />
        ) : (
          <div style={{ color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: '1.5rem', opacity: 0.5 }}>
            Sharing Virtual Display...
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', padding: '2rem' }}>
      
      <div className="c-glass-card" style={{ textAlign: 'center', maxWidth: '400px', width: '100%' }}>
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
          <div>
            <h2 style={{ fontSize: '2.5rem', margin: '1rem 0', letterSpacing: '2px', color: 'var(--color-accent-cyan)' }}>
              {activeRoomId}
            </h2>
            <p>Waiting for client to connect...</p>
            {isReady && <p style={{ color: '#4ade80' }}>Client found, negotiating stream...</p>}
          </div>
        )}

        {mode === 'client' && activeRoomId && (
          <div>
            <p>Connecting to Room <strong>{activeRoomId}</strong>...</p>
            <p style={{ opacity: 0.5, fontSize: '0.9rem' }}>Status: {connectionState}</p>
          </div>
        )}

        {(rtcError || captureError) && (
          <div style={{ marginTop: '1rem', color: '#ff4d4f', fontSize: '0.9rem' }}>
            {rtcError} {captureError}
          </div>
        )}
      </div>

    </div>
  );
}

export default App;
