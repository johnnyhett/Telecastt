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
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIp = iface.address;
        break; // take the first valid one
      }
    }
  }
  res.json({ localIp });
});

app.get('/api/create-room', (req, res) => {
  const roomId = generateRoomCode();
  rooms.set(roomId, new Set());
  res.json({ roomId });
});

wss.on('connection', (ws, req) => {
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

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Signaling Server running on port ${PORT}`);
});
