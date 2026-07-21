import { useState } from 'react';
import { MonitorUp } from 'lucide-react';
import { ROOM_CODE_LENGTH } from '../lib/env';

interface LandingViewProps {
  busy: boolean;
  error: string | null;
  onHost: () => void;
  onJoin: (code: string) => void;
}

export default function LandingView({ busy, error, onHost, onJoin }: LandingViewProps) {
  const [code, setCode] = useState('');
  const canJoin = code.trim().length === ROOM_CODE_LENGTH && !busy;

  return (
    <div className="screen center">
      <div className="card landing">
        <div className="landing-glow" />

        <img className="landing-logo" src="/assets/logo.png" alt="Telecastt" />
        <h1 className="landing-title">Telecastt</h1>
        <p className="landing-tagline">
          Screens unchained — turn any glass into your extended horizon.
        </p>

        <div className="landing-actions">
          <button className="btn btn-primary" onClick={onHost} disabled={busy} type="button">
            <MonitorUp size={18} />
            {busy ? 'Preparing…' : 'Start hosting'}
          </button>

          <div className="divider">
            <span>or join as an extended display</span>
          </div>

          <form
            className="join-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (canJoin) onJoin(code);
            }}
          >
            <input
              className="input mono"
              placeholder="ROOM CODE"
              maxLength={ROOM_CODE_LENGTH}
              value={code}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              aria-label="Room code"
            />
            <button className="btn btn-secondary" type="submit" disabled={!canJoin}>
              Connect
            </button>
          </form>

          {error && <p className="error-text">{error}</p>}
        </div>
      </div>
    </div>
  );
}
