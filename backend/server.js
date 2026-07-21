const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const cors = require('cors');
const os = require('os');

const RateLimiter = require('./lib/rate-limiter');
const RateLimiterInstance = new RateLimiter(20, 50); // 20 req/sec, capacity 50

const app = express();
app.use(cors());
app.use(express.json());

// Basic Rate Limiter Middleware
app.use((req, res, next) => {
  if (!RateLimiterInstance.consume(1)) {
    return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  }
  next();
});

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

// Network Interfaces API
app.get('/api/network-info', (req, res) => {
  const interfaces = os.networkInterfaces();
  let localIp = 'localhost';
  const allIps = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const lowerName = name.toLowerCase();
        let type = 'other';
        if (lowerName.includes('wi-fi') || lowerName.includes('wlan') || lowerName.includes('wireless')) {
          type = 'wifi';
        } else if (lowerName.includes('bluetooth') || lowerName.includes('pan') || lowerName.includes('bnep')) {
          type = 'bluetooth';
        } else if (lowerName.includes('ethernet') || lowerName.includes('eth') || lowerName.includes('lan')) {
          type = 'ethernet';
        }

        allIps.push({ interfaceName: name, address: iface.address, type });

        if (localIp === 'localhost') {
          localIp = iface.address;
        }
      }
    }
  }

  const isBluetoothActive = allIps.some(item => item.type === 'bluetooth');
  res.json({ localIp, allIps, isBluetoothActive });
});

// Official Room Creation Endpoint
app.get('/api/create-room', (req, res) => {
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
});

// Room Validation Endpoint
app.get('/api/validate-room/:roomId', (req, res) => {
  const { roomId } = req.params;
  const upperCode = (roomId || '').toUpperCase();
  const room = rooms.get(upperCode);

  if (!room) {
    return res.status(444).json({ valid: false, message: 'Room code does not exist.' });
  }

  if (Date.now() > room.expiresAt) {
    rooms.delete(upperCode);
    return res.status(410).json({ valid: false, message: 'Room code has expired.' });
  }

  if (room.clients.size >= 2) {
    return res.status(409).json({ valid: false, message: 'Room is already full.' });
  }

  res.json({ valid: true, status: room.status, clientCount: room.clients.size });
});

// --- Virtual Display Driver (VDD) Control APIs ---
const iddController = require('./lib/idd-controller');
const bluetoothController = require('./lib/bluetooth-controller');

app.get('/api/vdd/status', async (req, res) => {
  const result = await iddController.getStatus();
  res.json(result);
});

app.post('/api/vdd/install', async (req, res) => {
  const result = await iddController.installDriver();
  res.json(result);
});

app.post('/api/vdd/enable', async (req, res) => {
  const result = await iddController.enableDisplay();
  res.json(result);
});

app.post('/api/vdd/disable', async (req, res) => {
  const result = await iddController.disableDisplay();
  res.json(result);
});

app.post('/api/vdd/configure', async (req, res) => {
  const { width, height, refreshRate } = req.body || {};
  const result = await iddController.configureDisplay(width || 1920, height || 1080, refreshRate || 60);
  res.json(result);
});

// --- Bluetooth PAN Control APIs ---
app.get('/api/bluetooth/status', async (req, res) => {
  const result = await bluetoothController.getBluetoothStatus();
  res.json(result);
});

app.post('/api/bluetooth/enable', async (req, res) => {
  const result = await bluetoothController.enableBluetooth();
  res.json(result);
});

app.post('/api/bluetooth/disable', async (req, res) => {
  const result = await bluetoothController.disableBluetooth();
  res.json(result);
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
            if (client.readyState === ws.OPEN) {
              client.send(JSON.stringify({ type: 'ready', status: 'connected' }));
            }
          });
        }
      } 
      else if (['offer', 'answer', 'ice-candidate'].includes(data.type)) {
        if (currentRoomId && rooms.has(currentRoomId)) {
          const room = rooms.get(currentRoomId);
          room.clients.forEach(client => {
            if (client !== ws && client.readyState === ws.OPEN) {
              client.send(JSON.stringify(data));
            }
          });
        }
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
          if (client.readyState === ws.OPEN) {
            client.send(JSON.stringify({ type: 'peer-disconnected' }));
          }
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
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Signaling Server running on port ${PORT}`);
});
