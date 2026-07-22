import type { TelemetryStats } from '../lib/types';

interface TelemetryProps {
  stats: TelemetryStats;
}

export default function Telemetry({ stats }: TelemetryProps) {
  const jitter = Number(stats.jitterMs);
  return (
    <div className="telemetry">
      <div className="telemetry-item">
        <span className="telemetry-label">FPS</span>
        <span className="telemetry-value" style={{ color: stats.fps >= 50 ? 'var(--cyan)' : 'var(--foreground)' }}>
          {stats.fps}
        </span>
      </div>
      <div className="telemetry-item">
        <span className="telemetry-label">Bitrate</span>
        <span className="telemetry-value">
          {stats.bitrateMbps}
          <small> Mbps</small>
        </span>
      </div>
      <div className="telemetry-item">
        <span className="telemetry-label">Jitter</span>
        <span className="telemetry-value" style={{ color: jitter < 10 ? 'var(--emerald)' : 'var(--rose)' }}>
          {stats.jitterMs}
          <small> ms</small>
        </span>
      </div>
      <div className="telemetry-item">
        <span className="telemetry-label">Latency</span>
        <span className="telemetry-value" style={{ color: Number(stats.rttMs) < 40 ? 'var(--emerald)' : 'var(--rose)' }}>
          {stats.rttMs}
          <small> ms</small>
        </span>
      </div>
    </div>
  );
}
