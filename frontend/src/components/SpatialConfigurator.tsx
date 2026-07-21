import React, { useState, useRef, useEffect } from 'react';

export interface Device {
  id: string;
  name: string;
  width: number;
  height: number;
  position: { x: number; y: number };
  isPrimary?: boolean;
}

interface SpatialConfiguratorProps {
  devices: Device[];
  onLayoutChange: (layout: Array<{ id: string; position: { x: number; y: number } }>) => void;
}

const SpatialConfigurator: React.FC<SpatialConfiguratorProps> = ({ devices, onLayoutChange }) => {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [localDevices, setLocalDevices] = useState<Device[]>(devices);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalDevices(devices);
  }, [devices]);

  const handlePointerDown = (e: React.PointerEvent, id: string, isPrimary?: boolean) => {
    if (isPrimary) return; // Primary monitor is fixed
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setActiveId(id);
  };

  const handlePointerMove = (e: React.PointerEvent, id: string) => {
    if (activeId !== id) return;
    
    setLocalDevices((prev) => 
      prev.map((d) => 
        d.id === id 
          ? { 
              ...d, 
              position: { 
                x: Math.max(10, Math.min(380, d.position.x + e.movementX)), 
                y: Math.max(10, Math.min(180, d.position.y + e.movementY)) 
              } 
            } 
          : d
      )
    );
  };

  const handlePointerUp = (e: React.PointerEvent, id: string) => {
    if (activeId === id) {
      setActiveId(null);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch { /* ignore */ }
      onLayoutChange(localDevices.map(d => ({ id: d.id, position: d.position })));
    }
  };

  return (
    <div className="cc-dropdown-wrapper" style={{ padding: '1rem' }}>
      <label className="cc-dropdown-label" style={{ marginBottom: '0.75rem' }}>
        Spatial Layout Manager (Drag to Arrange)
      </label>
      <div 
        ref={containerRef}
        style={{
          width: '100%', 
          height: '220px', 
          position: 'relative',
          overflow: 'hidden',
          backgroundColor: 'rgba(2, 4, 10, 0.85)',
          borderRadius: '14px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          backgroundImage: 'radial-gradient(rgba(56, 189, 248, 0.15) 1px, transparent 1px)',
          backgroundSize: '16px 16px'
        }}
      >
        {localDevices.map(device => (
          <div
            key={device.id}
            onPointerDown={(e) => handlePointerDown(e, device.id, device.isPrimary)}
            onPointerMove={(e) => handlePointerMove(e, device.id)}
            onPointerUp={(e) => handlePointerUp(e, device.id)}
            style={{
              position: 'absolute',
              left: `${device.position.x}px`,
              top: `${device.position.y}px`,
              width: `${Math.max(110, device.width / 16)}px`,
              height: `${Math.max(70, device.height / 16)}px`,
              border: device.isPrimary 
                ? '2px solid rgba(255, 255, 255, 0.25)' 
                : '2px solid var(--cyan)',
              backgroundColor: device.isPrimary 
                ? 'rgba(255, 255, 255, 0.05)' 
                : 'rgba(56, 189, 248, 0.18)',
              cursor: device.isPrimary ? 'default' : activeId === device.id ? 'grabbing' : 'grab',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              borderRadius: '10px',
              userSelect: 'none',
              touchAction: 'none',
              boxShadow: device.isPrimary ? 'none' : '0 0 20px rgba(56, 189, 248, 0.3)',
              transition: activeId === device.id ? 'none' : 'all 0.2s ease'
            }}
          >
            <div style={{ fontWeight: 700, fontSize: '0.8rem', letterSpacing: '0.5px' }}>{device.name}</div>
            <div style={{ fontSize: '0.68rem', color: 'var(--foreground-muted)', marginTop: '2px' }}>
              {device.isPrimary ? 'Primary Host' : `${device.width}x${device.height}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SpatialConfigurator;
