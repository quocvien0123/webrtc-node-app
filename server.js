// server.js
const https = require('https');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');

const app = express();

// HTTPS certificate
const options = {
  key: fs.readFileSync(path.join(__dirname, 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
};

// Serve static files
app.use('/', express.static(path.join(__dirname, 'public')));

// Create HTTPS server
const httpsServer = https.createServer(options, app);

// Socket.IO
const io = new Server(httpsServer, {
  cors: { origin: "*" }
});

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

// Start server on LAN
const PORT = 3000;
const HOST = "192.168.1.3";

httpsServer.listen(PORT, HOST, () => {
  console.log(`HTTPS server running at: https://${HOST}:${PORT}`);
});
