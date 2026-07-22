import { useEffect, useState } from 'react';
import { Activity, Monitor, Power, Radio, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import type { ConnectionState, StreamSettings } from '../lib/types';
import QRPanel from './QRPanel';
import DisplayControls from './DisplayControls';

interface HostViewProps {
  roomId: string;
  localIp: string;
  isReady: boolean;
  peerCount: number;
  extend: boolean;
  onToggleExtend: (v: boolean) => void;
  connectionState: ConnectionState;
  onSettingsChange: (settings: StreamSettings) => void;
  onDisconnect: () => void;
}

const FPS_OPTIONS = ['60', '120', '144'];
const BITRATE_OPTIONS = ['10', '25', '50', '100'];
const RES_OPTIONS = ['1080p', '1440p', '4K'];

export default function HostView({
  roomId,
  localIp,
  isReady,
  peerCount,
  extend,
  onToggleExtend,
  connectionState,
  onSettingsChange,
  onDisconnect,
}: HostViewProps) {
  const [fps, setFps] = useState('60');
  const [bitrate, setBitrate] = useState('50');
  const [resolution, setResolution] = useState('4K');

  useEffect(() => {
    onSettingsChange({ fps: Number(fps), bitrateMbps: Number(bitrate), resolution });
  }, [fps, bitrate, resolution, onSettingsChange]);

  const status = isReady
    ? {
        text: peerCount > 1 ? `Connected · ${peerCount} screens` : 'Connected',
        cls: 'ok',
        Icon: Wifi,
      }
    : connectionState === 'reconnecting'
      ? { text: 'Reconnecting…', cls: 'warn', Icon: Activity }
      : { text: 'Waiting for a device…', cls: 'warn', Icon: WifiOff };

  return (
    <div className="screen host-screen">
      <header className="host-header">
        <div className="host-brand">
          <img src="/assets/logo.png" alt="Telecastt" className="host-logo" />
          <div>
            <h1>Telecastt</h1>
            <p>Unified Display Matrix</p>
          </div>
        </div>
        <div className="badges">
          <span className={`badge badge-${status.cls}`}>
            <status.Icon size={13} /> {status.text}
          </span>
          <span className="badge">
            <ShieldCheck size={13} /> DTLS / SRTP
          </span>
        </div>
      </header>

      <div className="host-grid">
        <section className="panel">
          <header className="panel-head">
            <Radio size={18} />
            <h3>Node Signaling</h3>
          </header>
          <QRPanel localIp={localIp} roomId={roomId} ready={isReady} />
          <div className="session-id">
            <span className="field-label">Session ID</span>
            <p className="mono session-code">{roomId}</p>
          </div>
          <div className="gateway">
            <span>Gateway: {localIp}</span>
            <status.Icon size={14} />
          </div>
        </section>

        <DisplayControls />

        <section className="panel">
          <header className="panel-head">
            <Monitor size={18} />
            <h3>Stream Configuration</h3>
          </header>

          <div className="field">
            <span className="field-label">Display mode</span>
            <div className="seg">
              <button
                className={`seg-btn${!extend ? ' is-active' : ''}`}
                onClick={() => onToggleExtend(false)}
                type="button"
              >
                Mirror
              </button>
              <button
                className={`seg-btn${extend ? ' is-active' : ''}`}
                onClick={() => onToggleExtend(true)}
                type="button"
              >
                Extend
              </button>
            </div>
            {extend && (
              <p className="vdd-card-note">
                {peerCount > 1
                  ? `Desktop tiled across ${peerCount} screens.`
                  : 'Add a second screen to tile the desktop.'}
              </p>
            )}
          </div>

          <label className="field">
            <span className="field-label">Resolution</span>
            <select className="select" value={resolution} onChange={(e) => setResolution(e.target.value)}>
              {RES_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">Refresh rate</span>
            <select className="select" value={fps} onChange={(e) => setFps(e.target.value)}>
              {FPS_OPTIONS.map((f) => (
                <option key={f} value={f}>{f} Hz</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">Bandwidth</span>
            <select className="select" value={bitrate} onChange={(e) => setBitrate(e.target.value)}>
              {BITRATE_OPTIONS.map((b) => (
                <option key={b} value={b}>{b} Mbps</option>
              ))}
            </select>
          </label>

          <button className="btn btn-danger" onClick={onDisconnect} type="button">
            <Power size={18} /> Terminate session
          </button>

          <div className="gateway">
            <span>Encoder: hardware</span>
            <span>{resolution} · {fps}fps</span>
          </div>
        </section>
      </div>
    </div>
  );
}
