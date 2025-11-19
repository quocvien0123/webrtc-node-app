// server.js
const fs = require("fs");
const path = require("path");
const express = require("express");
const { Server } = require("socket.io");
const https = require("https");
const selfsigned = require("selfsigned");

const app = express();
app.use("/", express.static(path.join(__dirname, "public")));

// ----- HTTPS: generate self-signed cert if missing -----
const keyPath = path.join(__dirname, "key.pem");
const certPath = path.join(__dirname, "cert.pem");

if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  console.log("[HTTPS] Generating self-signed certificate (key.pem, cert.pem)");
  const attrs = [{ name: "commonName", value: process.env.HOST || "localhost" }];
  const pems = selfsigned.generate(attrs, {
    days: 365,
    algorithm: "sha256",
  });
  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
}

const key = fs.readFileSync(keyPath);
const cert = fs.readFileSync(certPath);
const server = https.createServer({ key, cert }, app);
const proto = "https";

const io = new Server(server, {
  cors: { origin: "*" },
});

// ----- Socket.IO signalling -----
io.on("connection", (socket) => {
  socket.on("join", (roomId) => {
    const room = io.sockets.adapter.rooms.get(roomId);
    const count = room ? room.size : 0;

    if (count === 0) {
      socket.join(roomId);
      socket.emit("room_created");
    } else if (count === 1) {
      socket.join(roomId);
      socket.emit("room_joined");
    } else {
      socket.emit("full_room");
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

  // Chat message: chuyển tiếp cho các client khác trong phòng
  socket.on('chat_message', ({ roomId, text, ts }) => {
    try {
      if (typeof text !== 'string') return;
      const safe = text.slice(0, 2000); // giới hạn độ dài
      socket.to(roomId).emit('chat_message', { text: safe, ts: ts || Date.now(), from: socket.id });
    } catch (e) {
      console.error('chat_message error', e);
    }
  });

  // Reactions: chuyển tiếp emoji ngắn gọn
  socket.on('reaction', ({ roomId, emoji, ts }) => {
    try {
      if (typeof emoji !== 'string') return;
      const trimmed = emoji.trim();
      if (!trimmed || trimmed.length > 4) return; // basic sanity
      socket.to(roomId).emit('reaction', { emoji: trimmed, ts: ts || Date.now(), from: socket.id });
    } catch (e) {
      console.error('reaction error', e);
    }
  });

  socket.on("leave", (roomId) => {
    socket.leave(roomId);
    socket.to(roomId).emit("peer_left");
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on ${proto}://0.0.0.0:${PORT}`);
  console.log(`Open from LAN peers: ${proto}://<SERVER_IP>:${PORT}`);
});
