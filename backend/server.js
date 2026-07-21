const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const cors = require('cors');
const os = require('os');

const RateLimiter = require('./lib/rate-limiter');

const app = express();
app.use(cors());
app.use(express.json());

// Per-IP Rate Limiter Map
const rateLimiters = new Map();
const RATE_LIMIT_CLEANUP_INTERVAL = 60000;

function getRateLimiter(ip) {
  if (!rateLimiters.has(ip)) {
    rateLimiters.set(ip, { limiter: new RateLimiter(20, 50), lastUsed: Date.now() });
  }
  const entry = rateLimiters.get(ip);
  entry.lastUsed = Date.now();
  return entry.limiter;
}

// Cleanup stale per-IP limiters every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimiters.entries()) {
    if (now - entry.lastUsed > 300000) { // 5 min idle
      rateLimiters.delete(ip);
    }
  }
}, RATE_LIMIT_CLEANUP_INTERVAL);

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
const wss = new WebSocketServer({ server });

/**
 * Room Object Structure:
 * {
 *   id: string,
 *   createdAt: number,
 *   expiresAt: number,
 *   status: 'waiting' | 'connected' | 'closed',
 *   clients: Set<WebSocket>,
 *   hostToken: string
 * }
 */
const rooms = new Map();
const ROOM_TTL_MS = 30 * 60 * 1000; // 30 minute room TTL

function generateRoomCode() {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Ambiguity-free charset
  let code = '';
  const randomValues = new Uint8Array(6);
  crypto.webcrypto.getRandomValues(randomValues);
  for (let i = 0; i < 6; i++) {
    code += charset[randomValues[i] % charset.length];
  }
  return code;
}

function generateSecureToken() {
  return crypto.randomBytes(16).toString('hex');
}

// Network Interfaces API — prefer Wi-Fi/Ethernet over virtual adapters
app.get('/api/network-info', asyncHandler((req, res) => {
  const interfaces = os.networkInterfaces();
  let localIp = 'localhost';
  const allIps = [];
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

        allIps.push({ interfaceName: name, address: iface.address, type });

        // Pick the highest-priority adapter
        const priority = typePriority[type] || 99;
        if (priority < bestPriority) {
          localIp = iface.address;
          bestPriority = priority;
        }
      }
    }
  }

  const isBluetoothActive = allIps.some(item => item.type === 'bluetooth');
  res.json({ localIp, allIps, isBluetoothActive });
}));

// Official Room Creation Endpoint
app.get('/api/create-room', asyncHandler((req, res) => {
  const roomId = generateRoomCode();
  const hostToken = generateSecureToken();
  const now = Date.now();

  const room = {
    id: roomId,
    createdAt: now,
    expiresAt: now + ROOM_TTL_MS,
    status: 'waiting',
    clients: new Set(),
    hostToken
  };

  rooms.set(roomId, room);
  res.json({ roomId, hostToken, expiresAt: room.expiresAt });
}));

// Room Validation Endpoint (use standard 404 instead of non-standard 444)
app.get('/api/validate-room/:roomId', asyncHandler((req, res) => {
  const { roomId } = req.params;
  const upperCode = (roomId || '').toUpperCase();
  const room = rooms.get(upperCode);

  if (!room) {
    return res.status(404).json({ valid: false, message: 'Room code does not exist.' });
  }

  if (Date.now() > room.expiresAt) {
    rooms.delete(upperCode);
    return res.status(410).json({ valid: false, message: 'Room code has expired.' });
  }

  if (room.clients.size >= 2) {
    return res.status(409).json({ valid: false, message: 'Room is already full.' });
  }

  res.json({ valid: true, status: room.status, clientCount: room.clients.size });
}));

// --- Controllers ---
const iddController = require('./lib/idd-controller');
const bluetoothController = require('./lib/bluetooth-controller');
const inputController = require('./lib/input-controller');

// --- Input Injection Control API (KVM Remote Control) ---
app.post('/api/input/inject', asyncHandler(async (req, res) => {
  const result = inputController.injectInput(req.body);
  res.json(result);
}));

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

// VDD Configure — supports display mode switching (extend/duplicate/secondonly)
app.post('/api/vdd/configure', asyncHandler(async (req, res) => {
  const { width, height, refreshRate, displayMode, flag } = req.body || {};
  
  // If displayMode is specified, use Windows displayswitch.exe
  if (displayMode && flag) {
    const { exec } = require('child_process');
    exec(`displayswitch.exe ${flag}`, (err) => {
      if (err) {
        return res.json({ success: false, error: err.message });
      }
      res.json({ success: true, displayMode });
    });
    return;
  }

  const result = await iddController.configureDisplay(
    width || 1920, 
    height || 1080, 
    refreshRate || 60
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

// WebSocket Signaling Server
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('error', console.error);
  ws.on('pong', () => { ws.isAlive = true; });
  let currentRoomId = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'join') {
        const { roomId } = data;
        const upperRoomId = (roomId || '').toUpperCase();
        
        // Strict Validation: Room MUST be officially created via API
        if (!rooms.has(upperRoomId)) {
          ws.send(JSON.stringify({ 
            type: 'error', 
            message: 'Room code does not exist. Please check the code or initialize a new host session.' 
          }));
          return;
        }

        const room = rooms.get(upperRoomId);

        if (Date.now() > room.expiresAt) {
          rooms.delete(upperRoomId);
          ws.send(JSON.stringify({ type: 'error', message: 'Room session has expired.' }));
          return;
        }

        if (room.clients.size >= 2) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room capacity reached (max 2 peers).' }));
          return;
        }

        room.clients.add(ws);
        currentRoomId = upperRoomId;
        
        // Update room status
        if (room.clients.size === 2) {
          room.status = 'connected';
          room.clients.forEach(client => {
            try {
              if (client.readyState === ws.OPEN) {
                client.send(JSON.stringify({ type: 'ready', status: 'connected' }));
              }
            } catch { /* guard against send errors */ }
          });
        }
      } 
      else if (['offer', 'answer', 'ice-candidate'].includes(data.type)) {
        if (currentRoomId && rooms.has(currentRoomId)) {
          const room = rooms.get(currentRoomId);
          room.clients.forEach(client => {
            try {
              if (client !== ws && client.readyState === ws.OPEN) {
                client.send(JSON.stringify(data));
              }
            } catch { /* guard against send errors */ }
          });
        }
      }
      // Input injection via WebSocket (much faster than HTTP per-event)
      else if (data.type === 'input-inject') {
        inputController.injectInput(data.payload);
      }
    } catch (e) {
      console.error('Invalid message format received', e);
    }
  });

  ws.on('close', () => {
    if (currentRoomId && rooms.has(currentRoomId)) {
      const room = rooms.get(currentRoomId);
      room.clients.delete(ws);
      
      if (room.clients.size === 0) {
        rooms.delete(currentRoomId);
      } else {
        room.status = 'waiting';
        room.clients.forEach(client => {
          try {
            if (client.readyState === ws.OPEN) {
              client.send(JSON.stringify({ type: 'peer-disconnected' }));
            }
          } catch { /* guard against send errors */ }
        });
      }
    }
  });
});

// Periodic Sweeper: Keep-alive ping & Expired Room Cleanup
const pingInterval = setInterval(() => {
  const now = Date.now();
  
  // Clean expired rooms
  for (const [roomId, room] of rooms.entries()) {
    if (now > room.expiresAt || (room.clients.size === 0 && now - room.createdAt > 5 * 60 * 1000)) {
      rooms.delete(roomId);
    }
  }

  // Ping clients
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(pingInterval);
  inputController.killInjector();
});

// Graceful shutdown — kill injector process to prevent orphans
function gracefulShutdown(signal) {
  console.log(`[Server] Received ${signal}. Shutting down gracefully...`);
  inputController.killInjector();
  wss.close();
  server.close(() => {
    process.exit(0);
  });
  // Force exit after 3 seconds if graceful shutdown hangs
  setTimeout(() => process.exit(1), 3000);
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
