require('dotenv').config({ quiet: true });

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const os = require('os');
const { execFile } = require('child_process');

const RateLimiter = require('./lib/rate-limiter');

const app = express();
// The only client is this app's own fetch(); trusting a forwarded-for header
// would let any caller spoof its identity past the per-IP limiter below.
app.set('trust proxy', false);
app.disable('x-powered-by');

// ---------------------------------------------------------------------------
// Origin allow-list (defends the input-injection / device-control endpoints
// against drive-by requests from arbitrary websites the host user may visit).
// Only same-machine and private-LAN origins are trusted; everything else is
// rejected. Requests without an Origin header (native apps, curl, same-origin
// navigations) are allowed.
// ---------------------------------------------------------------------------
const TRUSTED_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|(?:10|127)\.[\d.]+|192\.168\.[\d.]+|172\.(?:1[6-9]|2\d|3[01])\.[\d.]+)(?::\d+)?$/;

function isTrustedOrigin(origin) {
  if (!origin) return true; // non-browser or same-origin request
  return TRUSTED_ORIGIN.test(origin);
}

app.use(cors({
  origin(origin, callback) {
    // Never throw here — returning `false` simply omits CORS headers so the
    // browser blocks the cross-site response/preflight.
    callback(null, isTrustedOrigin(origin));
  },
  allowedHeaders: ['Content-Type', 'X-Telecastt-Host-Token'],
}));

// CORS alone does NOT stop a request from executing — resolving an untrusted
// origin to `false` merely omits the response headers, so a "simple" cross-site
// POST still reaches the handler and still performs its side effect. Reject
// disallowed origins here, before any route runs. Requests with no Origin at
// all (curl, native clients, same-origin navigations) are still allowed through
// — the allow-list is a CSRF defense, not authentication; the host token on
// /api/vdd and /api/bluetooth is what actually authorizes privileged calls.
app.use((req, res, next) => {
  const origin = req.get('Origin');
  if (origin && !isTrustedOrigin(origin)) {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }
  next();
});

// This process serves a JSON API only — it never returns HTML — so the strictest
// possible policy applies. `frame-ancestors 'none'` (plus X-Frame-Options for
// older agents) keeps responses out of a hostile frame, and `no-store` keeps
// room codes and host tokens out of any intermediary or disk cache.
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), interest-cohort=()',
    'Cache-Control': 'no-store',
  });
  // Only assert HSTS when the response actually travelled over TLS — sending it
  // over plain http is meaningless and pins hosts that have no certificate.
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});

app.use(express.json({ limit: '256kb' }));

// Keyed token-bucket store with idle eviction, so a long-running server does
// not accumulate one limiter per IP it has ever seen.
const RATE_LIMIT_CLEANUP_INTERVAL = 60000;
const RATE_LIMIT_IDLE_MS = 300000;

function createLimiterStore(tokensPerSecond, bucketSize) {
  const entries = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of entries.entries()) {
      if (now - entry.lastUsed > RATE_LIMIT_IDLE_MS) entries.delete(key);
    }
  }, RATE_LIMIT_CLEANUP_INTERVAL).unref();

  return (key) => {
    let entry = entries.get(key);
    if (!entry) {
      entry = { limiter: new RateLimiter(tokensPerSecond, bucketSize), lastUsed: 0 };
      entries.set(key, entry);
    }
    entry.lastUsed = Date.now();
    return entry.limiter;
  };
}

// General per-IP HTTP budget.
const getRateLimiter = createLimiterStore(20, 50);
// Failed room joins are the room-code brute-force path, so they get their own
// deliberately tight budget (~12/min, burst 10) rather than sharing the generous
// HTTP bucket: a legitimate client mistypes a code a handful of times at most,
// while a guessing loop burns through this in seconds and gets its socket cut.
const getJoinFailureLimiter = createLimiterStore(0.2, 10);

// Per-IP Rate Limiter Middleware
app.use((req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const limiter = getRateLimiter(ip);
  if (!limiter.consume(1)) {
    return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  }
  next();
});

// Async error handler wrapper for Express routes
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const server = http.createServer(app);
const wss = new WebSocketServer({
  server,
  maxPayload: 256 * 1024,
  // Reject cross-site WebSocket connections from untrusted origins so a
  // malicious page cannot open a signaling socket and drive input injection.
  verifyClient: (info) => isTrustedOrigin(info.origin)
});

const { RoomRegistry } = require('./lib/room-registry');

// A session is one **host** PC plus up to (MAX_PEERS_PER_ROOM - 1) **secondary**
// PCs, each secondary acting as an extended-display surface. The registry owns
// room lifecycle, host authentication and signaling routing (see
// lib/room-registry.js), and is unit-tested in isolation.
const MAX_PEERS_PER_ROOM = Number(process.env.MAX_PEERS_PER_ROOM) || 8;
const registry = new RoomRegistry({
  ttlMs: 30 * 60 * 1000, // 30 minute room TTL
  maxRooms: 500,         // hard cap to bound memory / abuse
  maxPeersPerRoom: MAX_PEERS_PER_ROOM,
});

// Network Interfaces API — prefer Wi-Fi/Ethernet over virtual adapters.
// Returns ONLY the single address the QR/join flow needs plus a Bluetooth-PAN
// flag. The full interface inventory (every address, adapter name and type) was
// an unauthenticated map of the host's network topology for any LAN client, and
// nothing in the app ever consumed it.
app.get('/api/network-info', asyncHandler((req, res) => {
  const interfaces = os.networkInterfaces();
  let localIp = 'localhost';
  const seen = [];
  let bestPriority = 99;

  const typePriority = { wifi: 1, ethernet: 2, bluetooth: 3, other: 4 };

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const lowerName = name.toLowerCase();
        let type = 'other';

        // Skip virtual adapters (VirtualBox, vEthernet, Hyper-V, etc.)
        if (lowerName.includes('virtual') || lowerName.includes('vethernet') ||
            lowerName.includes('vmware') || lowerName.includes('vbox')) {
          continue;
        }

        if (lowerName.includes('wi-fi') || lowerName.includes('wlan') || lowerName.includes('wireless')) {
          type = 'wifi';
        } else if (lowerName.includes('bluetooth') || lowerName.includes('pan') || lowerName.includes('bnep')) {
          type = 'bluetooth';
        } else if (lowerName.includes('ethernet') || lowerName.includes('eth') || lowerName.includes('lan')) {
          type = 'ethernet';
        }

        seen.push(type);

        // Pick the highest-priority adapter
        const priority = typePriority[type] || 99;
        if (priority < bestPriority) {
          localIp = iface.address;
          bestPriority = priority;
        }
      }
    }
  }

  const isBluetoothActive = seen.includes('bluetooth');
  res.json({ localIp, isBluetoothActive });
}));

// Official Room Creation Endpoint
app.get('/api/create-room', asyncHandler((req, res) => {
  const result = registry.createRoom();
  if (result.error === 'capacity') {
    return res.status(503).json({ error: 'Server at capacity. Please try again shortly.' });
  }
  res.json(result); // { roomId, hostToken, expiresAt }
}));

// Room Validation Endpoint
app.get('/api/validate-room/:roomId', asyncHandler((req, res) => {
  const result = registry.validateRoom(req.params.roomId);
  if (!result.valid) {
    return res.status(result.code).json({ valid: false, message: result.message });
  }
  res.json({ valid: true, status: result.status, clientCount: result.peerCount });
}));

// --- Controllers ---
const iddController = require('./lib/idd-controller');
const bluetoothController = require('./lib/bluetooth-controller');
const inputController = require('./lib/input-controller');

// Device-control endpoints (virtual display, Bluetooth) perform privileged —
// even UAC-elevated — actions. Require the caller to present a live room's host
// token so the request is authenticated as coming from the genuine host. This
// blocks drive-by CSRF and unauthenticated LAN clients; the CORS allow-list
// only strips response headers, it does not stop the request from executing.
function requireHostToken(req, res, next) {
  const token = req.get('X-Telecastt-Host-Token') || (req.query && req.query.hostToken);
  if (!registry.isHostToken(token)) {
    return res.status(403).json({ success: false, error: 'Host authentication required.' });
  }
  next();
}
app.use('/api/vdd', requireHostToken);
app.use('/api/bluetooth', requireHostToken);

// --- Virtual Display Driver (VDD) Control APIs ---
app.get('/api/vdd/status', asyncHandler(async (req, res) => {
  const result = await iddController.getStatus();
  res.json(result);
}));

app.post('/api/vdd/install', asyncHandler(async (req, res) => {
  const result = await iddController.installDriver();
  res.json(result);
}));

app.post('/api/vdd/enable', asyncHandler(async (req, res) => {
  const result = await iddController.enableDisplay();
  res.json(result);
}));

app.post('/api/vdd/disable', asyncHandler(async (req, res) => {
  const result = await iddController.disableDisplay();
  res.json(result);
}));

// Windows displayswitch.exe topology flags. The client only sends a symbolic
// `displayMode`; the flag is resolved server-side against this allow-list so
// no client-controlled string ever reaches the process arguments.
const DISPLAY_SWITCH_FLAGS = {
  extend: '/extend',       // true second monitor (the "extend your display" path)
  duplicate: '/clone',     // mirror the primary
  secondonly: '/external', // project only to the secondary display
  internal: '/internal'    // primary display only
};

function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// VDD Configure — supports display mode switching (extend/duplicate/secondonly)
app.post('/api/vdd/configure', asyncHandler(async (req, res) => {
  const { width, height, refreshRate, displayMode } = req.body || {};

  // If a displayMode is specified, switch topology via the built-in Windows
  // utility. `execFile` (no shell) + an allow-listed flag prevents injection.
  if (displayMode) {
    const flag = DISPLAY_SWITCH_FLAGS[String(displayMode)];
    if (!flag) {
      return res.status(400).json({ success: false, error: 'Unsupported display mode.' });
    }
    execFile('displayswitch.exe', [flag], { windowsHide: true }, (err) => {
      if (err) {
        return res.json({ success: false, error: err.message });
      }
      res.json({ success: true, displayMode });
    });
    return;
  }

  // Otherwise persist a resolution profile. Dimensions are coerced to bounded
  // integers before they are ever passed to the PowerShell layer.
  const result = await iddController.configureDisplay(
    clampInt(width, 1920, 640, 7680),
    clampInt(height, 1080, 480, 4320),
    clampInt(refreshRate, 60, 24, 240)
  );
  res.json(result);
}));

// --- Bluetooth PAN Control APIs ---
app.get('/api/bluetooth/status', asyncHandler(async (req, res) => {
  const result = await bluetoothController.getBluetoothStatus();
  res.json(result);
}));

app.post('/api/bluetooth/enable', asyncHandler(async (req, res) => {
  const result = await bluetoothController.enableBluetooth();
  res.json(result);
}));

app.post('/api/bluetooth/disable', asyncHandler(async (req, res) => {
  const result = await bluetoothController.disableBluetooth();
  res.json(result);
}));

// Global Express error handler (catches all asyncHandler errors)
app.use((err, req, res, _next) => {
  console.error('[Express Error]', err.message || err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// `maxPayload` bounds a single frame but nothing bounded how MANY sockets one
// client may hold open. Cap them globally and per source IP so a loop of
// connections can't exhaust file descriptors or memory.
const MAX_WS_CLIENTS = Number(process.env.MAX_WS_CLIENTS) || 200;
const MAX_WS_CLIENTS_PER_IP = Number(process.env.MAX_WS_CLIENTS_PER_IP) || 24;
const socketsByIp = new Map();

// WebSocket Signaling Server
wss.on('connection', (ws, req) => {
  const clientIp = (req && req.socket && req.socket.remoteAddress) || 'unknown';
  const openForIp = socketsByIp.get(clientIp) || 0;
  if (wss.clients.size > MAX_WS_CLIENTS || openForIp >= MAX_WS_CLIENTS_PER_IP) {
    try { ws.close(1013, 'Too many connections'); } catch { /* already gone */ }
    return;
  }
  socketsByIp.set(clientIp, openForIp + 1);

  ws.isAlive = true;
  ws.on('error', console.error);
  ws.on('pong', () => { ws.isAlive = true; });

  // Bounds raw WebSocket flooding while comfortably allowing bursty pointer
  // input (~100+/s). Independent of the per-IP HTTP limiter above.
  const msgLimiter = new RateLimiter(300, 500);

  // Registry-facing peer adapter — a thin object the registry addresses via
  // `send()` without knowing anything about WebSockets. The registry stamps it
  // with `.id`, `.role` and `._roomId` on a successful join.
  const peer = {
    send(obj) {
      if (ws.readyState === ws.OPEN) {
        try { ws.send(JSON.stringify(obj)); } catch { /* guard against send errors */ }
      }
    },
  };

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (e) {
      console.error('Invalid message format received', e.message);
      return;
    }
    if (!data || typeof data.type !== 'string') return;
    if (!msgLimiter.consume(1)) return; // drop floods

    try {
      if (data.type === 'join') {
        // A socket may not re-join; otherwise one connection could cycle through
        // guessed codes forever while holding a single slot.
        if (peer.id) return;
        const result = registry.join(data.roomId, peer, { role: data.role, hostToken: data.hostToken });
        if (!result.ok) {
          // Charge only FAILED joins against the brute-force budget, and drop the
          // socket once it is exhausted so each further guess costs a full
          // reconnect (itself capped per IP).
          if (!getJoinFailureLimiter(clientIp).consume(1)) {
            peer.send({ type: 'error', message: 'Too many failed attempts. Please slow down.' });
            try { ws.close(1008, 'Too many failed join attempts'); } catch { /* already closing */ }
            return;
          }
          peer.send({ type: 'error', message: result.message });
          return;
        }

        const room = result.room;
        // Tell the newcomer who it is and who is already present.
        peer.send({
          type: 'joined',
          peerId: result.peerId,
          role: result.role,
          peers: registry.othersOf(room, peer).map((p) => ({ id: p.id, role: p.role })),
        });
        // Announce the newcomer to the peers already in the room.
        registry.othersOf(room, peer).forEach((p) => {
          p.send({ type: 'peer-joined', peerId: result.peerId, role: result.role });
        });
      }
      // Signaling relay — targeted (data.to) or broadcast to the room, stamped
      // with the sender's id so a host can tell which secondary PC replied.
      else if (data.type === 'offer' || data.type === 'answer' || data.type === 'ice-candidate') {
        registry.relay(peer, data);
      }
      // Input injection via WebSocket. Legitimate client input arrives P2P over
      // the host's control data channel and is relayed by the host, so only the
      // authenticated **host** peer should ever drive OS input over the
      // signaling socket. Client peers are rejected here even if joined.
      else if (data.type === 'input-inject') {
        if (peer.role === 'host' && registry.canInject(peer)) {
          inputController.injectInput(data.payload);
        }
      }
    } catch (e) {
      console.error('Error handling signaling message:', e.message);
    }
  });

  ws.on('close', () => {
    const remaining = (socketsByIp.get(clientIp) || 1) - 1;
    if (remaining > 0) socketsByIp.set(clientIp, remaining);
    else socketsByIp.delete(clientIp);

    const { room, removed } = registry.leave(peer);
    if (room && !removed) {
      registry.peersOf(room).forEach((p) => {
        p.send({ type: 'peer-disconnected' });
        p.send({ type: 'peer-left', peerId: peer.id });
      });
    }
  });
});

// Periodic Sweeper: Keep-alive ping & Expired Room Cleanup
const pingInterval = setInterval(() => {
  // Reap expired / long-idle empty rooms.
  registry.sweep();

  // Ping clients; terminate the unresponsive.
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
pingInterval.unref();

wss.on('close', () => {
  clearInterval(pingInterval);
  inputController.killInjector();
});

// Graceful shutdown — kill injector process to prevent orphans
let shuttingDown = false;
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Server] Received ${signal}. Shutting down gracefully...`);
  inputController.killInjector();
  wss.close();
  server.close(() => {
    process.exit(0);
  });
  // Force exit after 3 seconds if graceful shutdown hangs
  setTimeout(() => process.exit(1), 3000).unref();
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Catch unhandled errors to prevent orphaned PowerShell processes
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
  inputController.killInjector();
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled Promise Rejection:', reason);
  inputController.killInjector();
  process.exit(1);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Signaling Server running on port ${PORT}`);
});

module.exports = { app, server };
