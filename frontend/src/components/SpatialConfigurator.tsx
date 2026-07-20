import React, { useState, useRef, useEffect } from 'react';

interface Device {
  id: string;
  name: string;
  width: number;
  height: number;
  position: { x: number; y: number };
}

interface SpatialConfiguratorProps {
  devices: Device[];
  onLayoutChange: (layout: Array<{ id: string; position: { x: number; y: number } }>) => void;
}

const SpatialConfigurator: React.FC<SpatialConfiguratorProps> = ({ devices, onLayoutChange }) => {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [localDevices, setLocalDevices] = useState(devices);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalDevices(devices);
  }, [devices]);

  const handlePointerDown = (e: React.PointerEvent, id: string) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setActiveId(id);
  };

  const handlePointerMove = (e: React.PointerEvent, id: string) => {
    if (activeId !== id) return;
    
    setLocalDevices((prev) => 
      prev.map((d) => 
        d.id === id 
          ? { ...d, position: { x: d.position.x + e.movementX, y: d.position.y + e.movementY } } 
          : d
      )
    );
  };

  const handlePointerUp = (e: React.PointerEvent, id: string) => {
    if (activeId === id) {
      setActiveId(null);
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      onLayoutChange(localDevices.map(d => ({ id: d.id, position: d.position })));
    }
  };

  return (
    <div 
      ref={containerRef}
      className="glass-panel" 
      style={{
        width: '100%', 
        height: '400px', 
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: 'var(--color-gray-900)'
      }}
    >
      <div style={{ 
        width: '100%', height: '100%', 
        backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.1) 1px, transparent 1px)',
        backgroundSize: '20px 20px'
      }} />
      
      {localDevices.map(device => (
        <div
          key={device.id}
          onPointerDown={(e) => handlePointerDown(e, device.id)}
          onPointerMove={(e) => handlePointerMove(e, device.id)}
          onPointerUp={(e) => handlePointerUp(e, device.id)}
          style={{
            position: 'absolute',
            left: `${device.position.x}px`,
            top: `${device.position.y}px`,
            width: `${Math.max(100, device.width / 10)}px`,
            height: `${Math.max(60, device.height / 10)}px`,
            border: '2px solid var(--color-accent-cyan)',
            backgroundColor: 'rgba(96, 165, 250, 0.2)',
            cursor: activeId === device.id ? 'grabbing' : 'grab',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            borderRadius: '8px',
            userSelect: 'none',
            touchAction: 'none'
          }}
        >
          <div style={{ fontWeight: 'bold' }}>{device.name}</div>
          <div style={{ fontSize: '12px' }}>{device.width}x{device.height}</div>
        </div>
      ))}
    </div>
  );
};

export default SpatialConfigurator;
