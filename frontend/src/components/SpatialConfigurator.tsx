import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

export interface DisplayNode {
  id: string;
  name: string;
  width: number;
  height: number;
  position: { x: number; y: number };
  isPrimary?: boolean;
}

interface SpatialConfiguratorProps {
  devices: DisplayNode[];
  onLayoutChange?: (layout: Array<{ id: string; position: { x: number; y: number } }>) => void;
}

const BOUNDS = { minX: 8, maxX: 320, minY: 8, maxY: 150 };

/**
 * Drag-to-arrange 2D layout of the host + secondary displays. Self-contained
 * styling; the primary display is fixed while secondaries can be positioned.
 */
export default function SpatialConfigurator({ devices, onLayoutChange }: SpatialConfiguratorProps) {
  const [nodes, setNodes] = useState<DisplayNode[]>(devices);
  const [activeId, setActiveId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setNodes(devices); }, [devices]);

  const onPointerDown = (e: ReactPointerEvent, node: DisplayNode) => {
    if (node.isPrimary) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setActiveId(node.id);
  };

  const onPointerMove = (e: ReactPointerEvent, id: string) => {
    if (activeId !== id) return;
    setNodes((prev) =>
      prev.map((n) =>
        n.id === id
          ? {
              ...n,
              position: {
                x: Math.max(BOUNDS.minX, Math.min(BOUNDS.maxX, n.position.x + e.movementX)),
                y: Math.max(BOUNDS.minY, Math.min(BOUNDS.maxY, n.position.y + e.movementY)),
              },
            }
          : n
      )
    );
  };

  const onPointerUp = (e: ReactPointerEvent, id: string) => {
    if (activeId !== id) return;
    setActiveId(null);
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    onLayoutChange?.(nodes.map((n) => ({ id: n.id, position: n.position })));
  };

  return (
    <div className="spatial">
      <span className="field-label">Spatial layout (drag to arrange)</span>
      <div className="spatial-canvas" ref={containerRef}>
        {nodes.map((node) => (
          <div
            key={node.id}
            className={`spatial-node ${node.isPrimary ? 'is-primary' : ''} ${activeId === node.id ? 'is-active' : ''}`}
            style={{
              left: `${node.position.x}px`,
              top: `${node.position.y}px`,
              width: `${Math.max(96, node.width / 18)}px`,
              height: `${Math.max(60, node.height / 18)}px`,
            }}
            onPointerDown={(e) => onPointerDown(e, node)}
            onPointerMove={(e) => onPointerMove(e, node.id)}
            onPointerUp={(e) => onPointerUp(e, node.id)}
          >
            <span className="spatial-node-name">{node.name}</span>
            <span className="spatial-node-meta">
              {node.isPrimary ? 'Primary' : `${node.width}×${node.height}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
