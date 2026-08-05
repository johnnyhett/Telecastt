// Central runtime configuration. All server URLs are derived from the page's
// own origin so the app works whether it is served over http (LAN dev) or
// https (behind TLS), without any hardcoded protocol.

const secure = window.location.protocol === 'https:';
const host = window.location.hostname || 'localhost';
const SIGNAL_PORT = 3001;

export const API_BASE = `${secure ? 'https' : 'http'}://${host}:${SIGNAL_PORT}`;
export const SIGNALING_URL = `${secure ? 'wss' : 'ws'}://${host}:${SIGNAL_PORT}`;

const STUN_SERVER: RTCIceServer = {
  urls: [
    'stun:stun.l.google.com:19302',
    'stun:stun1.l.google.com:19302',
    'stun:stun2.l.google.com:19302',
  ],
};

/**
 * ICE servers. STUN alone cannot traverse symmetric NAT — the common case on
 * phone hotspots and many corporate networks — so those sessions never connect
 * without a TURN relay. There is no free public TURN worth depending on, so the
 * relay is configuration rather than a default:
 *
 *   VITE_TURN_URLS=turn:relay.example.net:3478,turns:relay.example.net:5349
 *   VITE_TURN_USERNAME=…
 *   VITE_TURN_CREDENTIAL=…
 *
 * or replace the list wholesale with VITE_ICE_SERVERS (a JSON RTCIceServer[]).
 * On a plain LAN, STUN-only is sufficient and remains the default.
 */
function buildIceServers(): RTCIceServer[] {
  const raw = import.meta.env.VITE_ICE_SERVERS;
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as RTCIceServer[];
      console.warn('VITE_ICE_SERVERS is not a non-empty array; falling back to defaults.');
    } catch {
      console.warn('VITE_ICE_SERVERS is not valid JSON; falling back to defaults.');
    }
  }

  const servers: RTCIceServer[] = [STUN_SERVER];
  const turnUrls = (import.meta.env.VITE_TURN_URLS || '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  if (turnUrls.length > 0) {
    servers.push({
      urls: turnUrls,
      username: import.meta.env.VITE_TURN_USERNAME,
      credential: import.meta.env.VITE_TURN_CREDENTIAL,
    });
  }
  return servers;
}

export const ICE_SERVERS: RTCIceServer[] = buildIceServers();
/** True when a relay is configured — sessions across symmetric NAT need one. */
export const HAS_TURN = ICE_SERVERS.some((s) =>
  (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => String(u).startsWith('turn'))
);

// Must match the server's room-code length (backend/lib/room-registry.js).
export const ROOM_CODE_LENGTH = 8;
// Matches the server's ambiguity-free charset (no O/0/I/1).
export const ROOM_CODE_PATTERN = new RegExp(`^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{${ROOM_CODE_LENGTH}}$`);

// URL a client scans/opens to join. Built from the host page's own protocol
// and port, substituting the LAN-reachable IP for the hostname.
export function buildClientUrl(localIp: string, roomId: string): string {
  const proto = window.location.protocol;
  const port = window.location.port ? `:${window.location.port}` : '';
  return `${proto}//${localIp}${port}/?room=${roomId}`;
}
