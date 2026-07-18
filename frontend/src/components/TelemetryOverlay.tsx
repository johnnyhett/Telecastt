import React from 'react';
import { TelemetryStats } from '../hooks/useWebRTC';

interface TelemetryOverlayProps {
  stats: TelemetryStats;
}

const TelemetryOverlay: React.FC<TelemetryOverlayProps> = ({ stats }) => {
  return (
    <div className="c-telemetry-overlay">
      <div className="telemetry-item">
        <span className="telemetry-label">FPS</span>
        <span className="telemetry-value" style={{ color: stats.fps > 60 ? 'var(--color-accent-cyan)' : 'var(--text-primary)' }}>
          {stats.fps}
        </span>
      </div>
      <div className="telemetry-item">
        <span className="telemetry-label">Bitrate</span>
        <span className="telemetry-value">{stats.bitrateMbps} <span style={{fontSize: '0.6rem'}}>Mbps</span></span>
      </div>
      <div className="telemetry-item">
        <span className="telemetry-label">Jitter</span>
        <span className="telemetry-value" style={{ color: Number(stats.jitterMs) < 10 ? '#4ade80' : '#f87171' }}>
          {stats.jitterMs} <span style={{fontSize: '0.6rem'}}>ms</span>
        </span>
      </div>
    </div>
  );
};

export default TelemetryOverlay;
