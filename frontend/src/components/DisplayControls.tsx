import { useCallback, useEffect, useState } from 'react';
import { LayoutDashboard, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import SpatialConfigurator from './SpatialConfigurator';

type DisplayMode = 'extend' | 'duplicate' | 'secondonly';

/**
 * Host controls for the "extend your display" mechanism: install/enable the
 * virtual display driver and choose the Windows topology. The display mode is
 * sent symbolically; the backend maps it to the correct displayswitch flag.
 */
export default function DisplayControls() {
  const [installed, setInstalled] = useState(false);
  const [present, setPresent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<DisplayMode>('extend');
  const [note, setNote] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await api.vddStatus();
      if (res.success && res.data) {
        setInstalled(!!res.data.Installed);
        setPresent(!!res.data.Present);
      }
    } catch {
      /* backend not reachable / non-Windows host */
    }
  }, []);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  const install = async () => {
    setBusy(true);
    setNote(null);
    try {
      await api.vddInstall();
      setNote('Virtual display driver initialized.');
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Install failed.');
    } finally {
      setBusy(false);
      void refreshStatus();
    }
  };

  const toggleDisplay = async () => {
    setBusy(true);
    setNote(null);
    try {
      if (present) await api.vddDisable();
      else await api.vddEnable();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Toggle failed.');
    } finally {
      setBusy(false);
      void refreshStatus();
    }
  };

  const changeMode = async (next: DisplayMode) => {
    setMode(next);
    try {
      await api.vddConfigure({ displayMode: next });
    } catch {
      /* best-effort topology switch */
    }
  };

  const statusText = busy
    ? 'Working…'
    : present
      ? 'Active — extended display on'
      : installed
        ? 'Driver installed (inactive)'
        : 'Not installed';

  return (
    <section className="panel">
      <header className="panel-head">
        <LayoutDashboard size={18} />
        <h3>Display Topology</h3>
      </header>

      <p className="panel-desc">
        A <em>true</em> second monitor needs a Windows virtual display driver. This can't be
        fully automated: the unsigned sample driver requires Windows <strong>test-signing mode</strong>
        (or a properly signed driver). If it doesn't take, the buttons below will now say so
        instead of pretending it worked. Without a driver, use plain mirroring on the secondary.
      </p>

      <label className="field">
        <span className="field-label">Display mode</span>
        <select className="select" value={mode} onChange={(e) => void changeMode(e.target.value as DisplayMode)}>
          <option value="extend">Extend desktop (true second monitor)</option>
          <option value="duplicate">Duplicate / mirror primary</option>
          <option value="secondonly">Second screen only</option>
        </select>
      </label>

      <div className={`vdd-card ${present ? 'is-on' : ''}`}>
        <div className="vdd-card-head">
          <span className="vdd-card-title">
            <MonitorSmartphone size={15} /> Virtual Display Driver
          </span>
          <span className={`dot ${present ? 'dot-on' : 'dot-off'}`} />
        </div>
        <p className="vdd-card-status">{statusText}</p>
        <div className="vdd-card-actions">
          {!installed ? (
            <button className="btn btn-ghost" onClick={install} disabled={busy} type="button">
              {busy ? 'Installing…' : 'Install driver'}
            </button>
          ) : (
            <button className="btn btn-ghost" onClick={toggleDisplay} disabled={busy} type="button">
              {present ? 'Disable virtual display' : 'Enable virtual display'}
            </button>
          )}
        </div>
        {note && <p className="vdd-card-note">{note}</p>}
      </div>

      <SpatialConfigurator
        devices={[
          { id: 'primary', name: 'Host PC', width: 1920, height: 1080, position: { x: 24, y: 46 }, isPrimary: true },
          { id: 'client', name: 'Extended', width: 1920, height: 1080, position: { x: 170, y: 46 } },
        ]}
      />

      <a className="win-link" href="ms-settings:display">
        <ShieldCheck size={14} /> Open Windows Display Settings
      </a>
    </section>
  );
}
