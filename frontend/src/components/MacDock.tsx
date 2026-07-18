import React from 'react';

interface MacDockProps {
  onDisconnect: () => void;
  onFullscreen: () => void;
  isFullscreen: boolean;
}

const MacDock: React.FC<MacDockProps> = ({ onDisconnect, onFullscreen, isFullscreen }) => {
  return (
    <div className="c-mac-dock-container">
      <div className="c-mac-dock">
        <button className="dock-icon disconnect" onClick={onDisconnect} title="Disconnect">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <button className="dock-icon fullscreen" onClick={onFullscreen} title="Toggle Fullscreen">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {isFullscreen ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            )}
          </svg>
        </button>
      </div>
    </div>
  );
};

export default MacDock;
