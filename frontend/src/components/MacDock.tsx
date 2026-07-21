import React from 'react';
import { PictureInPicture, Maximize2, Minimize2, Power } from 'lucide-react';

interface MacDockProps {
  onDisconnect: () => void;
  onFullscreen: () => void;
  isFullscreen: boolean;
  onTogglePiP?: () => void;
  isPiPSupported?: boolean;
}

const MacDock: React.FC<MacDockProps> = ({ 
  onDisconnect, 
  onFullscreen, 
  isFullscreen,
  onTogglePiP,
  isPiPSupported = false 
}) => {
  return (
    <div 
      style={{
        position: 'absolute',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.6rem 1.25rem',
        background: 'rgba(2, 4, 10, 0.75)',
        backdropFilter: 'blur(30px) saturate(180%)',
        WebkitBackdropFilter: 'blur(30px) saturate(180%)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '30px',
        boxShadow: '0 15px 40px rgba(0, 0, 0, 0.8), 0 0 1px rgba(255, 255, 255, 0.2)'
      }}
    >
      {onTogglePiP && isPiPSupported && (
        <button 
          onClick={onTogglePiP} 
          title="Picture in Picture Mode"
          style={{
            background: 'rgba(255, 255, 255, 0.06)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '50%',
            width: '40px',
            height: '40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#38bdf8',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
        >
          <PictureInPicture size={18} />
        </button>
      )}

      <button 
        onClick={onFullscreen} 
        title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
        style={{
          background: 'rgba(255, 255, 255, 0.06)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '50%',
          width: '40px',
          height: '40px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#ffffff',
          cursor: 'pointer',
          transition: 'all 0.2s ease'
        }}
      >
        {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
      </button>

      <div style={{ width: '1px', height: '20px', background: 'rgba(255, 255, 255, 0.15)' }} />

      <button 
        onClick={onDisconnect} 
        title="Disconnect Session"
        style={{
          background: 'rgba(244, 63, 94, 0.2)',
          border: '1px solid rgba(244, 63, 94, 0.4)',
          borderRadius: '50%',
          width: '40px',
          height: '40px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fb7185',
          cursor: 'pointer',
          transition: 'all 0.2s ease'
        }}
      >
        <Power size={18} />
      </button>
    </div>
  );
};

export default MacDock;
