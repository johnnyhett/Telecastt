import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Monitor, Cpu, Radio, Settings, Power, LayoutDashboard } from 'lucide-react';
import '../styles/command-center.css';

interface CommandCenterProps {
  localIp: string;
  activeRoomId: string;
  isReady: boolean;
  onDisconnect: () => void;
}

const CommandCenter: React.FC<CommandCenterProps> = ({ localIp, activeRoomId, isReady, onDisconnect }) => {
  const [fps, setFps] = useState(144);
  const [bitrate, setBitrate] = useState(50);
  const [res, setRes] = useState('4K');

  const openDisplaySettings = () => {
    window.location.href = 'ms-settings:display';
  };

  return (
    <div style={{ maxWidth: '1200px', width: '100%', margin: '0 auto', padding: '2rem' }}>
      
      <div style={{ marginBottom: '3rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '3rem', margin: '0', letterSpacing: '4px', textTransform: 'uppercase', textShadow: '0 0 30px rgba(0, 240, 255, 0.4)' }}>
          Telecastt Engine
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.5)', letterSpacing: '2px', marginTop: '0.5rem' }}>Hardware Stream Configuration Protocol</p>
      </div>

      <div className="command-center-container fade-enter-active">
        
        {/* LEFT SIDEBAR: Connection & Topology */}
        <div className="cc-sidebar">
          
          <div className={`cc-glass-panel ${isReady ? 'glow-cyan' : 'glow-purple'}`}>
            <div className="cc-panel-header">
              <Radio className="cc-icon" />
              <h3 className="cc-panel-title">Signaling Node</h3>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div className="cc-qr-container" style={{ marginBottom: '1.5rem' }}>
                <QRCodeSVG value={`http://${localIp}:5173?room=${activeRoomId}`} size={160} level="L" />
              </div>
              <p className="cc-value-sub" style={{ marginBottom: '0.5rem' }}>Room Identifier</p>
              <h2 className="cc-value-display" style={{ fontSize: '3rem', marginBottom: '1.5rem', color: isReady ? '#4ade80' : 'var(--color-accent-cyan)' }}>
                {activeRoomId}
              </h2>
              <p style={{ opacity: 0.8, fontSize: '0.9rem', marginBottom: '0.5rem' }}>Scan to connect instantly, or visit:</p>
              <p style={{ fontWeight: 600, color: 'white', letterSpacing: '0.5px' }}>http://{localIp}:5173</p>
            </div>
          </div>

          <div className="cc-glass-panel">
            <div className="cc-panel-header">
              <LayoutDashboard className="cc-icon" style={{ color: '#7B61FF' }} />
              <h3 className="cc-panel-title">Physical Topology</h3>
            </div>
            <p style={{ opacity: 0.6, fontSize: '0.9rem', lineHeight: '1.5', marginBottom: '1.5rem' }}>
              Virtual displays default to the right side of your primary monitor. If your client device is physically on your left, you must arrange it in Windows Settings.
            </p>
            <button className="cc-action-btn" onClick={openDisplaySettings}>
              Open Windows Display Layout
            </button>
          </div>

        </div>

        {/* RIGHT MAIN: Hardware Constraints */}
        <div className="cc-main">
          
          <div className="cc-glass-panel">
            <div className="cc-panel-header">
              <Monitor className="cc-icon" />
              <h3 className="cc-panel-title">Capture Resolution</h3>
            </div>
            <div className="cc-toggle-group">
              {['1080p', '1440p', '4K'].map(r => (
                <button 
                  key={r} 
                  className={`cc-toggle-btn ${res === r ? 'active' : ''}`}
                  onClick={() => setRes(r)}
                >
                  {r} {r === '4K' && '(Uncapped)'}
                </button>
              ))}
            </div>
          </div>

          <div className="cc-glass-panel">
            <div className="cc-panel-header">
              <Cpu className="cc-icon" style={{ color: '#ff4d4f' }} />
              <h3 className="cc-panel-title">Engine Throttling</h3>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '1rem' }}>
              <div>
                <p className="cc-value-sub">Max Refresh Rate</p>
                <h3 className="cc-value-display">{fps} <span style={{ fontSize: '1rem' }}>Hz</span></h3>
              </div>
            </div>
            <input 
              type="range" 
              className="cc-slider" 
              min="30" max="144" step="1" 
              value={fps} 
              onChange={e => setFps(parseInt(e.target.value))} 
            />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '2rem' }}>
              <div>
                <p className="cc-value-sub">Target Bitrate</p>
                <h3 className="cc-value-display" style={{ color: '#7B61FF', textShadow: '0 0 20px rgba(123, 97, 255, 0.4)' }}>
                  {bitrate} <span style={{ fontSize: '1rem' }}>Mbps</span>
                </h3>
              </div>
            </div>
            <input 
              type="range" 
              className="cc-slider" 
              style={{ background: 'rgba(123, 97, 255, 0.2)' }}
              min="5" max="100" step="5" 
              value={bitrate} 
              onChange={e => setBitrate(parseInt(e.target.value))} 
            />
          </div>

          <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'flex-end' }}>
            <button className="cc-action-btn" style={{ background: 'rgba(255,0,0,0.2)', borderColor: 'rgba(255,0,0,0.5)', width: 'auto', padding: '1rem 3rem' }} onClick={onDisconnect}>
              <Power size={20} /> Terminate Stream
            </button>
          </div>

        </div>

      </div>
    </div>
  );
};

export default CommandCenter;
