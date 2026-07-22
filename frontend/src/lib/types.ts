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
