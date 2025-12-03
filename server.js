// server.js
require('dotenv').config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const { Server } = require("socket.io");
const https = require("https");
const selfsigned = require("selfsigned");
const mongoose = require("mongoose");

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/", express.static(path.join(__dirname, "public")));

// Kết nối MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/webrtc-meet';
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('[MongoDB] Kết nối thành công'))
.catch(err => console.error('[MongoDB] Lỗi kết nối:', err));

// Auth routes
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

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
// Lưu thông tin các rooms và users
// rooms: Map<roomId, Map<socketId, {username, userId}>>
const rooms = new Map();

io.on("connection", (socket) => {
  console.log('[Socket] User connected:', socket.id);

  socket.on("join", (data) => {
    // data có thể là string (roomId) hoặc object {roomId, username, userId}
    const roomId = typeof data === 'string' ? data : data.roomId;
    const username = typeof data === 'object' ? data.username : 'Anonymous';
    const userId = typeof data === 'object' ? data.userId : null;
    
    const room = io.sockets.adapter.rooms.get(roomId);
    const count = room ? room.size : 0;
    
    // Cho phép nhiều người join (không giới hạn 2 người)
    socket.join(roomId);
    
    // Lưu thông tin room với username
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }
    rooms.get(roomId).set(socket.id, { username, userId });
    
    // Gửi danh sách users hiện tại trong phòng (bao gồm username)
    const usersInRoom = Array.from(rooms.get(roomId).entries())
      .filter(([sid]) => sid !== socket.id)
      .map(([sid, info]) => ({
        socketId: sid,
        username: info.username,
        userId: info.userId
      }));
    
    socket.emit("room_joined", { 
      users: usersInRoom,
      roomSize: rooms.get(roomId).size
    });
    
    // Thông báo cho các user khác có người mới join
    socket.to(roomId).emit("user_joined", { 
      userId: socket.id,
      username: username,
      roomSize: rooms.get(roomId).size
    });
    
    console.log(`[Room ${roomId}] User ${username} (${socket.id}) joined. Total users: ${rooms.get(roomId).size}`);
  });

  socket.on("start_call", (roomId) => {
    socket.to(roomId).emit("start_call");
  });

  // Gửi offer đến specific user
  socket.on("webrtc_offer", ({ roomId, sdp, targetId }) => {
    console.log(`[Offer] From ${socket.id} to ${targetId}`);
    io.to(targetId).emit("webrtc_offer", { sdp, fromId: socket.id });
  });

  // Gửi answer đến specific user
  socket.on("webrtc_answer", ({ roomId, sdp, targetId }) => {
    console.log(`[Answer] From ${socket.id} to ${targetId}`);
    io.to(targetId).emit("webrtc_answer", { sdp, fromId: socket.id });
  });

  // Gửi ICE candidate đến specific user
  socket.on("webrtc_ice_candidate", ({ roomId, candidate, targetId }) => {
    io.to(targetId).emit("webrtc_ice_candidate", { candidate, fromId: socket.id });
  });

  // Chat message: chuyển tiếp cho các client khác trong phòng
  socket.on('chat_message', ({ roomId, text, ts }) => {
    try {
      if (typeof text !== 'string') return;
      const safe = text.slice(0, 2000); // giới hạn độ dài
      // Lấy username từ rooms map
      let username = 'Unknown';
      const room = rooms.get(roomId);
      if (room && room.has(socket.id)) {
        username = room.get(socket.id).username || username;
      }
      socket.to(roomId).emit('chat_message', { text: safe, ts: ts || Date.now(), from: socket.id, username });
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

  // Thông báo dừng chia sẻ màn hình: chuyển tiếp cho các client khác trong phòng
  socket.on('screen_share_stopped', ({ roomId }) => {
    try {
      socket.to(roomId).emit('screen_share_stopped', { userId: socket.id, ts: Date.now() });
      console.log(`[ScreenShare] ${socket.id} stopped in room ${roomId}`);
    } catch (e) {
      console.error('screen_share_stopped error', e);
    }
  });

  socket.on("leave", (roomId) => {
    handleUserLeave(socket, roomId);
  });

  socket.on("disconnect", () => {
    console.log('[Socket] User disconnected:', socket.id);
    // Tìm và xóa user khỏi tất cả rooms
    rooms.forEach((users, roomId) => {
      if (users.has(socket.id)) {
        handleUserLeave(socket, roomId);
      }
    });
  });
});

function handleUserLeave(socket, roomId) {
  socket.leave(roomId);
  
  // Xóa user khỏi room tracking
  if (rooms.has(roomId)) {
    rooms.get(roomId).delete(socket.id);
    const roomSize = rooms.get(roomId).size;
    
    // Xóa room nếu không còn ai
    if (roomSize === 0) {
      rooms.delete(roomId);
      console.log(`[Room ${roomId}] Empty, deleted`);
    }
    
    // Thông báo cho các user còn lại
    socket.to(roomId).emit("user_left", { 
      userId: socket.id,
      roomSize: roomSize
    });
    
    console.log(`[Room ${roomId}] User ${socket.id} left. Remaining: ${roomSize}`);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on ${proto}://0.0.0.0:${PORT}`);
  console.log(`Open from LAN peers: ${proto}://<SERVER_IP>:${PORT}`);
});
