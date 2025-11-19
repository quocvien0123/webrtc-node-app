// server.js
const https = require('https');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');

const app = express();

// Serve static files
app.use('/', express.static(path.join(__dirname, 'public')));

// Decide whether to use HTTPS or fallback to HTTP.
// Set environment variable USE_HTTP=1 to force HTTP (useful for LAN/dev).
let server;
let io;
const PORT = process.env.PORT || 3000;
const USE_HTTP = process.env.USE_HTTP === '1' || process.env.FORCE_HTTP === '1';

if (!USE_HTTP) {
  try {
    // Try to read cert files; fall back to HTTP if reading fails
    const options = {
      key: fs.readFileSync(path.join(__dirname, 'key.pem')),
      cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
    };
    server = https.createServer(options, app);
    io = new Server(server, { cors: { origin: '*' } });
    console.log('Using HTTPS server');
  } catch (err) {
    console.warn('Could not start HTTPS server (missing/invalid cert). Falling back to HTTP.\n', err.message);
    server = require('http').createServer(app);
    io = new Server(server, { cors: { origin: '*' } });
  }
} else {
  server = require('http').createServer(app);
  io = new Server(server, { cors: { origin: '*' } });
  console.log('Using HTTP server (forced by USE_HTTP=1)');
}

// =============================================
//            SOCKET.IO EVENTS
// =============================================
io.on('connection', (socket) => {
  console.log("User connected:", socket.id);

  socket.on('join', (roomId) => {
    const room = io.sockets.adapter.rooms.get(roomId);
    const count = room ? room.size : 0;

    if (count === 0) {
      socket.join(roomId);
      socket.emit("room_created", roomId);
    } else if (count === 1) {
      socket.join(roomId);
      socket.emit("room_joined", roomId);
    } else {
      socket.emit("full_room", roomId);
    }
  });

  socket.on("start_call", (roomId) => {
    socket.to(roomId).emit("start_call");
  });

  socket.on("webrtc_offer", ({ roomId, sdp }) => {
    socket.to(roomId).emit("webrtc_offer", sdp);
  });

  socket.on("webrtc_answer", ({ roomId, sdp }) => {
    socket.to(roomId).emit("webrtc_answer", sdp);
  });

  socket.on("webrtc_ice_candidate", ({ roomId, candidate }) => {
    socket.to(roomId).emit("webrtc_ice_candidate", { candidate });
  });

  socket.on("leave", (roomId) => {
    socket.leave(roomId);
    socket.to(roomId).emit("peer_left");
  });
});

// Start server on all interfaces so LAN peers can connect
server.listen(PORT, '0.0.0.0', () => {
  const proto = server instanceof https.Server ? 'https' : 'http';
  console.log(`Server running on ${proto}://0.0.0.0:${PORT}`);
  console.log('If connecting from another machine, open:', `${proto}://<SERVER_IP>:${PORT}`);
});
