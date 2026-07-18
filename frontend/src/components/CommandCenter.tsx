import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Monitor, Radio, Power, LayoutDashboard, ShieldCheck, Activity } from 'lucide-react';
import '../styles/command-center.css';

interface CommandCenterProps {
  localIp: string;
  activeRoomId: string;
  isReady: boolean;
  onDisconnect: () => void;
}

const CommandCenter: React.FC<CommandCenterProps> = ({ localIp, activeRoomId, isReady, onDisconnect }) => {
  const [fps, setFps] = useState('144');
  const [bitrate, setBitrate] = useState('50');
  const [res, setRes] = useState('4K');

  const openDisplaySettings = () => {
    window.location.href = 'ms-settings:display';
  };

  return (
    <div style={{ maxWidth: '1200px', width: '100%', margin: '0 auto', padding: '2rem' }}>
      
      {/* HEADER WITH LOGO */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2rem', marginBottom: '3rem' }}>
        <img src="/assets/logo.png" alt="Telecastt Logo" style={{ width: '80px', height: '80px', objectFit: 'contain', filter: 'drop-shadow(0 0 20px rgba(0, 240, 255, 0.4))' }} />
        <div>
          <h1 style={{ fontSize: '3rem', margin: '0', letterSpacing: '4px', textTransform: 'uppercase', color: 'white', textShadow: '0 0 30px rgba(0, 240, 255, 0.4)' }}>
            Telecastt
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.6)', letterSpacing: '3px', marginTop: '0.25rem', fontSize: '0.9rem', textTransform: 'uppercase' }}>
            Enterprise Stream Control Protocol
          </p>
        </div>
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
              <div className="cc-qr-container" style={{ marginBottom: '1.5rem', transition: 'all 0.3s' }}>
                <QRCodeSVG value={`http://${localIp}:5173?room=${activeRoomId}`} size={160} level="L" />
              </div>
              <p className="cc-value-sub" style={{ marginBottom: '0.5rem' }}>Secure Session ID</p>
              <h2 className="cc-value-display" style={{ fontSize: '3rem', marginBottom: '1.5rem', color: isReady ? '#4ade80' : 'var(--color-accent-cyan)' }}>
                {activeRoomId}
              </h2>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <p style={{ opacity: 0.8, fontSize: '0.85rem', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Local Network Gateway</p>
                <p style={{ fontWeight: 600, color: 'white', letterSpacing: '0.5px', fontFamily: 'monospace', fontSize: '1.1rem' }}>
                  http://{localIp}:5173
                </p>
              </div>
            </div>
          </div>

          <div className="cc-glass-panel">
            <div className="cc-panel-header">
              <LayoutDashboard className="cc-icon" style={{ color: '#7B61FF' }} />
              <h3 className="cc-panel-title">Display Layout Topology</h3>
            </div>
            <p style={{ opacity: 0.6, fontSize: '0.9rem', lineHeight: '1.6', marginBottom: '1.5rem' }}>
              Configure the spatial relationship between your primary and extended display to ensure seamless cursor transition.
            </p>
            <div className="cc-dropdown-group" style={{ marginBottom: '1rem' }}>
              <div className="cc-dropdown-wrapper">
                <label className="cc-dropdown-label">Relative Position</label>
                <select className="cc-dropdown-select" defaultValue="Right">
                  <option value="Right">Right of Primary</option>
                  <option value="Left">Left of Primary</option>
                  <option value="Top">Top of Primary</option>
                  <option value="Bottom">Bottom of Primary</option>
                </select>
              </div>
            </div>
            <button className="cc-action-btn" onClick={openDisplaySettings}>
              Open Windows Display Manager
            </button>
          </div>

        </div>

        {/* RIGHT MAIN: Hardware Constraints */}
        <div className="cc-main">
          
          <div className="cc-glass-panel">
            <div className="cc-panel-header">
              <Monitor className="cc-icon" />
              <h3 className="cc-panel-title">Capture Matrix Engine</h3>
            </div>
            
            <div className="cc-dropdown-group">
              <div className="cc-dropdown-wrapper">
                <label className="cc-dropdown-label">Hardware Resolution</label>
                <select className="cc-dropdown-select" value={res} onChange={e => setRes(e.target.value)}>
                  <option value="1080p">1080p</option>
                  <option value="1440p">1440p</option>
                  <option value="4K">4K Native</option>
                </select>
                <p className="cc-dropdown-desc">Enforces strict driver-level EDID resolution parameters.</p>
              </div>

              <div className="cc-dropdown-wrapper">
                <label className="cc-dropdown-label">Refresh Rate Governor</label>
                <select className="cc-dropdown-select" value={fps} onChange={e => setFps(e.target.value)}>
                  <option value="60">60 Hz</option>
                  <option value="120">120 Hz</option>
                  <option value="144">144 Hz</option>
                </select>
                <p className="cc-dropdown-desc">Overrides native browser capture frequencies to lock frame pacing.</p>
              </div>

              <div className="cc-dropdown-wrapper">
                <label className="cc-dropdown-label">Target Bitrate Throttling</label>
                <select className="cc-dropdown-select" value={bitrate} onChange={e => setBitrate(e.target.value)}>
                  <option value="10">10 Mbps</option>
                  <option value="25">25 Mbps</option>
                  <option value="50">50 Mbps</option>
                  <option value="100">100 Mbps</option>
                </select>
                <p className="cc-dropdown-desc">Manipulates the WebRTC RTCRtpSender to govern network congestion.</p>
              </div>
            </div>
          </div>

          <div className="cc-glass-panel" style={{ background: 'linear-gradient(90deg, rgba(15,15,20,0.65) 0%, rgba(123,97,255,0.1) 100%)' }}>
            <div className="cc-panel-header" style={{ borderBottom: 'none', margin: 0, padding: 0 }}>
              <ShieldCheck className="cc-icon" style={{ color: '#4ade80' }} />
              <h3 className="cc-panel-title" style={{ color: '#4ade80' }}>System Integrity Verified</h3>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: 0.6 }}>
                <Activity size={16} /> <span style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>Heartbeat Active</span>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'flex-end' }}>
            <button className="cc-action-btn" style={{ background: 'rgba(255,0,0,0.2)', borderColor: 'rgba(255,0,0,0.5)', width: 'auto', padding: '1rem 3rem' }} onClick={onDisconnect}>
              <Power size={20} /> Terminate Secure Stream
            </button>
          </div>

        </div>

      </div>
    </div>
  );
};

export default CommandCenter;
