// server.js
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');

const app = express();

// ----- Logging (tùy chọn) -----
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'activity.log');
fs.mkdirSync(LOG_DIR, { recursive: true });
function writeLog(entry) {
  const line = `[${new Date().toISOString()}] ${entry}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
}
app.use((req, res, next) => {
  writeLog(`HTTP ${req.method} ${req.url} from ${req.ip || req.connection?.remoteAddress}`);
  next();
});

// ----- Static -----
app.use('/', express.static(path.join(__dirname, 'public')));

// ----- HTTPS or HTTP (fallback) -----
const USE_HTTP = process.env.USE_HTTP === '1' || process.env.FORCE_HTTP === '1';
let server, io, proto;

if (!USE_HTTP) {
  const https = require('https');
  try {
    const options = {
      key: fs.readFileSync(path.join(__dirname, 'key.pem')),
      cert: fs.readFileSync(path.join(__dirname, 'cert.pem')),
    };
    server = https.createServer(options, app);
    proto = 'https';
  } catch (err) {
    console.warn('Could not start HTTPS (missing/invalid cert). Fallback to HTTP.', err.message);
    const http = require('http');
    server = http.createServer(app);
    proto = 'http';
  }
} else {
  const http = require('http');
  server = http.createServer(app);
  proto = 'http';
}

// ----- Socket.IO -----
io = new Server(server, { cors: { origin: '*' } });

io.on('connection', (socket) => {
  const remote = socket.handshake.address || socket.request.connection.remoteAddress || 'unknown';
  console.log('User connected:', socket.id, remote);
  writeLog(`CONNECT socket=${socket.id} from=${remote}`);

  socket.on('join', (roomId) => {
    const room = io.sockets.adapter.rooms.get(roomId);
    const count = room ? room.size : 0;
    writeLog(`JOIN socket=${socket.id} room=${roomId} current=${count}`);

    if (count === 0) {
      socket.join(roomId);
      socket.emit('room_created', roomId);
      writeLog(`ROOM_CREATED socket=${socket.id} room=${roomId}`);
    } else if (count === 1) {
      socket.join(roomId);
      socket.emit('room_joined', roomId);
      writeLog(`ROOM_JOINED socket=${socket.id} room=${roomId}`);
    } else {
      socket.emit('full_room', roomId);
      writeLog(`ROOM_FULL socket=${socket.id} room=${roomId}`);
    }
  });

  socket.on('start_call', (roomId) => {
    socket.to(roomId).emit('start_call');
  });

  socket.on('webrtc_offer', ({ roomId, sdp }) => {
    socket.to(roomId).emit('webrtc_offer', sdp);
  });

  socket.on('webrtc_answer', ({ roomId, sdp }) => {
    socket.to(roomId).emit('webrtc_answer', sdp);
  });

  socket.on('webrtc_ice_candidate', ({ roomId, candidate }) => {
    socket.to(roomId).emit('webrtc_ice_candidate', { candidate });
  });

  socket.on('leave', (roomId) => {
    socket.leave(roomId);
    socket.to(roomId).emit('peer_left');
    writeLog(`LEAVE socket=${socket.id} room=${roomId}`);
  });

  socket.on('disconnect', (reason) => {
    writeLog(`DISCONNECT socket=${socket.id} reason=${reason}`);
    console.log('User disconnected:', socket.id, reason);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on ${proto}://0.0.0.0:${PORT}`);
  console.log(`Open from LAN peers: ${proto}://<SERVER_IP>:${PORT}`);
});
