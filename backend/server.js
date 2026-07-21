const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const cors = require('cors');
const os = require('os');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Map: roomId -> Set of WebSocket clients
const rooms = new Map();

// Generate a secure 6-character room code
function generateRoomCode() {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No ambiguous chars
  let code = '';
  const randomValues = new Uint8Array(6);
  crypto.webcrypto.getRandomValues(randomValues);
  for (let i = 0; i < 6; i++) {
    code += charset[randomValues[i] % charset.length];
  }
  return code;
}

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

        allIps.push({
          interfaceName: name,
          address: iface.address,
          type
        });

        if (localIp === 'localhost') {
          localIp = iface.address;
        }
      }
    }
  }

  const isBluetoothActive = allIps.some(item => item.type === 'bluetooth');
  res.json({ localIp, allIps, isBluetoothActive });
});

app.get('/api/create-room', (req, res) => {
  const roomId = generateRoomCode();
  rooms.set(roomId, new Set());
  res.json({ roomId });
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

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('error', console.error);
  ws.on('pong', () => { ws.isAlive = true; });
  let currentRoom = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'join') {
        const { roomId } = data;
        if (!rooms.has(roomId)) {
          rooms.set(roomId, new Set());
        }
        const room = rooms.get(roomId);
        if (room.size >= 2) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room is full' }));
          return;
        }
        room.add(ws);
        currentRoom = roomId;
        
        // If there are 2 people, notify them they can connect
        if (room.size === 2) {
          room.forEach(client => {
            client.send(JSON.stringify({ type: 'ready' }));
          });
        }
      } 
      else if (['offer', 'answer', 'ice-candidate'].includes(data.type)) {
        // Forward signaling messages to the other peer in the room
        if (currentRoom && rooms.has(currentRoom)) {
          const room = rooms.get(currentRoom);
          room.forEach(client => {
            if (client !== ws && client.readyState === ws.OPEN) {
              client.send(JSON.stringify(data));
            }
          });
        }
      }
    } catch (e) {
      console.error('Invalid message received', e);
    }
  });

  ws.on('close', () => {
    if (currentRoom && rooms.has(currentRoom)) {
      const room = rooms.get(currentRoom);
      room.delete(ws);
      if (room.size === 0) {
        rooms.delete(currentRoom);
      } else {
        // Notify remaining peer that the other disconnected
        room.forEach(client => {
          client.send(JSON.stringify({ type: 'peer-disconnected' }));
        });
      }
    }
  });
});

const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Signaling Server running on port ${PORT}`);
});
