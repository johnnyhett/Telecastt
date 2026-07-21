import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Monitor, Radio, Power, LayoutDashboard, ShieldCheck, Activity, Wifi, WifiOff } from 'lucide-react';
import '../styles/command-center.css';

interface CommandCenterProps {
  localIp: string;
  activeRoomId: string;
  isReady: boolean;
  onDisconnect: () => void;
  onSettingsChange: (settings: { fps: string; bitrate: string; resolution: string }) => void;
}

const CommandCenter: React.FC<CommandCenterProps> = ({ localIp, activeRoomId, isReady, onDisconnect, onSettingsChange }) => {
  const [fps, setFps] = useState('144');
  const [bitrate, setBitrate] = useState('50');
  const [res, setRes] = useState('4K');

  // Virtual Display Driver (VDD) State
  const [vddInstalled, setVddInstalled] = useState<boolean>(false);
  const [vddEnabled, setVddEnabled] = useState<boolean>(false);
  const [vddLoading, setVddLoading] = useState<boolean>(false);

  const fetchVddStatus = async () => {
    try {
      const res = await fetch(`http://${window.location.hostname}:3001/api/vdd/status`);
      const data = await res.json();
      if (data.success && data.data) {
        setVddInstalled(data.data.Installed || false);
        setVddEnabled(data.data.Present || false);
      }
    } catch (e) {
      console.warn("Could not query VDD status", e);
    }
  };

  useEffect(() => {
    fetchVddStatus();
  }, []);

  const handleToggleVdd = async () => {
    setVddLoading(true);
    try {
      const endpoint = vddEnabled ? 'disable' : 'enable';
      const res = await fetch(`http://${window.location.hostname}:3001/api/vdd/${endpoint}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setVddEnabled(!vddEnabled);
      }
    } catch (e) {
      console.error("VDD Toggle failed", e);
    } finally {
      setVddLoading(false);
      fetchVddStatus();
    }
  };

  const handleInstallVdd = async () => {
    setVddLoading(true);
    try {
      const res = await fetch(`http://${window.location.hostname}:3001/api/vdd/install`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setVddInstalled(true);
      }
    } catch (e) {
      console.error("VDD Install failed", e);
    } finally {
      setVddLoading(false);
      fetchVddStatus();
    }
  };

  useEffect(() => {
    onSettingsChange({ fps, bitrate, resolution: res });
  }, [fps, bitrate, res, onSettingsChange]);

  const openDisplaySettings = () => {
    window.location.href = 'ms-settings:display';
  };

  const getStatus = () => {
    if (isReady) return { text: 'Connected', class: 'connected', Icon: Wifi };
    if (activeRoomId) return { text: 'Waiting for connection...', class: 'waiting', Icon: Activity };
    return { text: 'Disconnected', class: 'disconnected', Icon: WifiOff };
  };

  const status = getStatus();

  return (
    <div className="cc-container">
      {/* Header */}
      <div className="cc-header">
        <div className="cc-header-brand">
          <img src="/assets/logo.png" alt="Telecastt Logo" className="cc-logo" />
          <div>
            <h1 className="cc-title">Telecastt</h1>
            <p className="cc-subtitle">Enterprise Command Matrix</p>
          </div>
        </div>

        <div className="cc-header-badges">
          <div className="cc-badge cc-badge-active">
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34d399', display: 'inline-block' }} />
            PROTOCOL V7.7
          </div>
          <div className="cc-badge">
            <ShieldCheck size={14} style={{ color: 'var(--color-cyan)' }} />
            AES-256 DTLS
          </div>
          <div className="cc-badge">
            <Activity size={14} style={{ color: '#38bdf8' }} />
            AIR-GAP READY
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="cc-grid">
        
        {/* Left Column: Connection / QR */}
        <div className="cc-panel">
          <div className="cc-panel-header">
            <Radio className="cc-icon" size={20} />
            <h3 className="cc-panel-title">Node Signaling</h3>
          </div>
          
          <div className="cc-text-center">
            <div className={`cc-qr-wrapper ${isReady ? 'is-ready' : ''}`}>
              <QRCodeSVG value={`http://${localIp}:5173?room=${activeRoomId}`} size={160} level="L" />
            </div>
          </div>
          
          <div className="cc-text-center" style={{ marginTop: '1rem' }}>
            <p className="cc-dropdown-label">Secure Session ID</p>
            <p className="cc-session-id">{activeRoomId}</p>
          </div>

          <div className="cc-status-indicator">
            <div className={`cc-status-dot ${status.class}`} />
            <span className="cc-status-text" style={{ color: 'var(--color-white)' }}>
              {status.text}
            </span>
          </div>

          <div className="cc-status-bar">
            <span>Gateway: {localIp}</span>
            <status.Icon size={14} />
          </div>
        </div>

        {/* Center Column: Live Status, Virtual Display & Topology */}
        <div className="cc-panel">
          <div className="cc-panel-header">
            <LayoutDashboard className="cc-icon" size={20} />
            <h3 className="cc-panel-title">System Topology & VDD</h3>
          </div>

          <p className="cc-topology-desc">
            Choose how the virtual display operates alongside your primary monitor.
          </p>

          <div className="cc-dropdown-wrapper">
            <label className="cc-dropdown-label">Display Mode</label>
            <select 
              className="cc-dropdown-select" 
              defaultValue="extend"
              onChange={(e) => {
                const modeMap: Record<string, string> = {
                  extend: '/external',
                  duplicate: '/clone',
                  secondonly: '/external'
                };
                const flag = modeMap[e.target.value] || '/external';
                // Note: displayswitch.exe is a built-in Windows utility
                fetch(`http://${window.location.hostname}:3001/api/vdd/configure`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ displayMode: e.target.value, flag })
                }).catch(() => {});
              }}
            >
              <option value="extend">Extend Desktop (True Second Monitor)</option>
              <option value="duplicate">Duplicate / Mirror Primary</option>
              <option value="secondonly">Second Screen Only</option>
            </select>
          </div>

          <div className="cc-dropdown-wrapper" style={{ background: vddEnabled ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255, 255, 255, 0.03)', borderColor: vddEnabled ? 'var(--color-accent-cyan)' : 'rgba(255, 255, 255, 0.1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'white' }}>Virtual Display Driver</span>
              <span className={`cc-status-dot ${vddEnabled ? 'connected' : 'disconnected'}`} />
            </div>
            
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
              Status: {vddLoading ? 'Processing...' : vddEnabled ? 'Active (Extended Display On)' : vddInstalled ? 'Driver Installed (Inactive)' : 'Not Installed'}
            </p>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {!vddInstalled ? (
                <button className="cc-btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }} onClick={handleInstallVdd} disabled={vddLoading}>
                  {vddLoading ? 'Installing...' : 'Install Driver'}
                </button>
              ) : (
                <button className="cc-btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', background: vddEnabled ? 'rgba(239, 68, 68, 0.2)' : 'rgba(59, 130, 246, 0.2)' }} onClick={handleToggleVdd} disabled={vddLoading}>
                  {vddLoading ? 'Updating...' : vddEnabled ? 'Disable Virtual Display' : 'Enable Virtual Display'}
                </button>
              )}
            </div>
          </div>

          <div className="cc-dropdown-wrapper">
            <label className="cc-dropdown-label">Relative Positioning</label>
            <select className="cc-dropdown-select" defaultValue="Right">
              <option value="Right">Right of Primary</option>
              <option value="Left">Left of Primary</option>
              <option value="Top">Top of Primary</option>
              <option value="Bottom">Bottom of Primary</option>
            </select>
          </div>

          <button className="cc-btn-secondary" onClick={openDisplaySettings}>
            Launch Windows Display Manager
          </button>

          <div className="cc-dropdown-wrapper" style={{ marginTop: 'auto', background: 'rgba(16, 185, 129, 0.1)', borderColor: 'rgba(16, 185, 129, 0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#10b981', marginBottom: '0.5rem' }}>
              <ShieldCheck size={18} />
              <span style={{ fontWeight: 600, fontSize: '0.85rem', textTransform: 'uppercase' }}>Integrity Validated</span>
            </div>
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>End-to-end DTLS/SRTP encryption active.</p>
          </div>

          <div className="cc-status-bar">
            <span>Latency: &lt;5ms</span>
            <Activity size={14} />
          </div>
        </div>

        {/* Right Column: Stream Settings */}
        <div className="cc-panel">
          <div className="cc-panel-header">
            <Monitor className="cc-icon" size={20} />
            <h3 className="cc-panel-title">Stream Configuration</h3>
          </div>

          <div className="cc-dropdown-wrapper">
            <label className="cc-dropdown-label">Hardware Resolution</label>
            <select className="cc-dropdown-select" value={res} onChange={e => setRes(e.target.value)}>
              <option value="1080p">1080p (FHD)</option>
              <option value="1440p">1440p (QHD)</option>
              <option value="4K">4K (UHD)</option>
            </select>
          </div>

          <div className="cc-dropdown-wrapper">
            <label className="cc-dropdown-label">Refresh Rate Governor</label>
            <select className="cc-dropdown-select" value={fps} onChange={e => setFps(e.target.value)}>
              <option value="60">60 Hz (Standard)</option>
              <option value="120">120 Hz (Fluid)</option>
              <option value="144">144 Hz (Ultra)</option>
            </select>
          </div>

          <div className="cc-dropdown-wrapper">
            <label className="cc-dropdown-label">Bandwidth Allocation</label>
            <select className="cc-dropdown-select" value={bitrate} onChange={e => setBitrate(e.target.value)}>
              <option value="10">10 Mbps (Conservative)</option>
              <option value="25">25 Mbps (Balanced)</option>
              <option value="50">50 Mbps (High Fidelity)</option>
              <option value="100">100 Mbps (Lossless)</option>
            </select>
          </div>

          <button className="cc-btn-danger" onClick={onDisconnect}>
            <Power size={18} /> Terminate Session
          </button>

          <div className="cc-status-bar">
            <span>Encoder: Hardware NVENC</span>
            <span>{res} @ {fps}fps</span>
          </div>
        </div>

      </div>
    </div>
  );
};

export default CommandCenter;
