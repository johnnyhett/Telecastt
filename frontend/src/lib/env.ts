// Central runtime configuration. All server URLs are derived from the page's
// own origin so the app works whether it is served over http (LAN dev) or
// https (behind TLS), without any hardcoded protocol.

const secure = window.location.protocol === 'https:';
const host = window.location.hostname || 'localhost';
const SIGNAL_PORT = 3001;

export const API_BASE = `${secure ? 'https' : 'http'}://${host}:${SIGNAL_PORT}`;
export const SIGNALING_URL = `${secure ? 'wss' : 'ws'}://${host}:${SIGNAL_PORT}`;

export const ICE_SERVERS: RTCIceServer[] = [
  {
    urls: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302',
    ],
  },
];

export const ROOM_CODE_LENGTH = 6;
// Matches the server's ambiguity-free charset (no O/0/I/1).
export const ROOM_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

// URL a client scans/opens to join. Built from the host page's own protocol
// and port, substituting the LAN-reachable IP for the hostname.
export function buildClientUrl(localIp: string, roomId: string): string {
  const proto = window.location.protocol;
  const port = window.location.port ? `:${window.location.port}` : '';
  return `${proto}//${localIp}${port}/?room=${roomId}`;
}
