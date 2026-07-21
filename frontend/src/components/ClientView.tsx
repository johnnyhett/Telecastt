import type { RefObject } from 'react';
import type { ConnectionState, TelemetryStats } from '../lib/types';
import VideoStage from './VideoStage';
import Telemetry from './Telemetry';
import ControlDock from './ControlDock';

interface ClientViewProps {
  connectionState: ConnectionState;
  error: string | null;
  roomId: string | null;
  remoteStream: MediaStream | null;
  stats: TelemetryStats;
  containerRef: RefObject<HTMLDivElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onTogglePiP: () => void;
  pipSupported: boolean;
  onDisconnect: () => void;
}

export default function ClientView({
  connectionState,
  error,
  roomId,
  remoteStream,
  stats,
  containerRef,
  videoRef,
  isFullscreen,
  onToggleFullscreen,
  onTogglePiP,
  pipSupported,
  onDisconnect,
}: ClientViewProps) {
  if (connectionState === 'connected') {
    return (
      <div className="client-live" ref={containerRef} tabIndex={0}>
        <VideoStage stream={remoteStream} videoRef={videoRef} />
        <Telemetry stats={stats} />
        <ControlDock
          isFullscreen={isFullscreen}
          onToggleFullscreen={onToggleFullscreen}
          onTogglePiP={onTogglePiP}
          pipSupported={pipSupported}
          onDisconnect={onDisconnect}
        />
      </div>
    );
  }

  const heading =
    connectionState === 'reconnecting'
      ? 'Reconnecting…'
      : connectionState === 'failed'
        ? 'Connection failed'
        : 'Connecting to host';

  return (
    <div className="screen center">
      <div className="card connecting">
        <img className="landing-logo" src="/assets/logo.png" alt="Telecastt" />
        <h2 className="connecting-title">{heading}</h2>
        <p className="connecting-sub">
          Session code <span className="mono session-code-inline">{roomId}</span>
        </p>

        <div className="connecting-status">
          <span className={`dot ${connectionState === 'failed' ? 'dot-off' : 'dot-on'}`} />
          {connectionState.toUpperCase()}
        </div>

        {error && <p className="error-text">{error}</p>}

        <button className="btn btn-secondary" onClick={onDisconnect} type="button">
          Cancel
        </button>
      </div>
    </div>
  );
}
