import { Maximize2, Minimize2, PictureInPicture, Power } from 'lucide-react';

interface ControlDockProps {
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onTogglePiP: () => void;
  pipSupported: boolean;
  onDisconnect: () => void;
}

/**
 * Floating control bar shown over the live client stream.
 */
export default function ControlDock({
  isFullscreen,
  onToggleFullscreen,
  onTogglePiP,
  pipSupported,
  onDisconnect,
}: ControlDockProps) {
  return (
    <div className="dock">
      {pipSupported && (
        <button className="dock-btn" onClick={onTogglePiP} title="Picture in Picture" type="button">
          <PictureInPicture size={18} />
        </button>
      )}
      <button
        className="dock-btn"
        onClick={onToggleFullscreen}
        title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
        type="button"
      >
        {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
      </button>
      <div className="dock-divider" />
      <button className="dock-btn dock-btn-danger" onClick={onDisconnect} title="Disconnect" type="button">
        <Power size={18} />
      </button>
    </div>
  );
}
