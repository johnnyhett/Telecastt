export type AppMode = 'landing' | 'host' | 'client';

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'failed';

export interface StreamSettings {
  fps: number;
  bitrateMbps: number;
  resolution: string;
}

export interface TelemetryStats {
  fps: number;
  bitrateMbps: string;
  jitterMs: string;
  rttMs: string;
}

export type PointerKind = 'mouse' | 'touch' | 'pen';
export type PointerPhase = 'down' | 'move' | 'up';

// A normalized sub-rectangle (0..1) of the host's shared surface. In "extend"
// mode each secondary is assigned a distinct region and shows only that slice,
// so N secondaries tile the desktop into one wall. The default full frame
// (0,0,1,1) is a plain mirror.
export interface DisplayRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_REGION: DisplayRegion = { x: 0, y: 0, w: 1, h: 1 };

// Wire format sent client -> host over the reliable "control" data channel.
// Pointer events unify mouse/touch/pen and carry a stable id, so multi-touch
// and precise down/move/up transitions survive the trip.
export type InputMessage =
  // `s` is a monotonic sequence number stamped on moves sent over the unreliable
  // "cursor" lane, so the host can drop a stale out-of-order move (last wins).
  | { t: 'p'; phase: PointerPhase; pt: PointerKind; id: number; x: number; y: number; button: number; s?: number }
  | { t: 'wheel'; dy: number }
  | { t: 'key'; phase: 'down' | 'up'; key: string };

// Payload the host forwards to the backend injector.
export interface InjectPayload {
  action: 'move' | 'mousedown' | 'mouseup' | 'touch' | 'wheel' | 'keydown' | 'keyup';
  normalizedX?: number;
  normalizedY?: number;
  button?: number;
  deltaY?: number;
  key?: string;
  phase?: PointerPhase;
  touchId?: number;
}
