// server.js
// ==========================================
// SERVER CHÍNH - QUẢN LÝ WEBRTC VIDEO CALL
// ==========================================
// File này xử lý:
// 1. Tạo HTTPS server với self-signed certificate
// 2. Kết nối MongoDB để lưu user data
// 3. Xử lý Socket.IO signaling cho WebRTC
// 4. Quản lý rooms và users trong video call
// ==========================================

// Load biến môi trường từ file .env
require('dotenv').config();

// Import các module cần thiết
const fs = require("fs");
const path = require("path");
const express = require("express");
const { Server } = require("socket.io");
const https = require("https");
const selfsigned = require("selfsigned");
const mongoose = require("mongoose");

const app = express();

// ===== MIDDLEWARE SETUP =====
// Parse JSON request body
app.use(express.json());
// Parse URL-encoded request body
app.use(express.urlencoded({ extended: true }));
// Serve static files từ thư mục public (HTML, CSS, JS, images...)
app.use("/", express.static(path.join(__dirname, "public")));

// ===== KẾT NỐI MONGODB =====
// Lấy connection string từ .env, fallback về localhost nếu không có
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/webrtc-meet';

// Kết nối tới MongoDB Atlas/Local
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,      // Parse connection string theo chuẩn mới
  useUnifiedTopology: true    // Sử dụng engine topology mới
})
.then(() => console.log('[MongoDB] Kết nối thành công'))
.catch(err => console.error('[MongoDB] Lỗi kết nối:', err));

// ===== AUTH ROUTES =====
// Mount auth routes vào /api/auth endpoint
// Xử lý: /api/auth/register, /api/auth/login, /api/auth/verify
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// ===== HTTPS SETUP =====
// WebRTC yêu cầu HTTPS để truy cập camera/mic (getUserMedia)
// Tự động tạo self-signed certificate nếu chưa có
const keyPath = path.join(__dirname, "key.pem");   // Private key
const certPath = path.join(__dirname, "cert.pem"); // Certificate

// Kiểm tra xem đã có certificate chưa
if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  console.log("[HTTPS] Generating self-signed certificate (key.pem, cert.pem)");
  
  // Tạo certificate với commonName là HOST từ .env hoặc localhost
  const attrs = [{ name: "commonName", value: process.env.HOST || "localhost" }];
  const pems = selfsigned.generate(attrs, {
    days: 365,           // Hết hạn sau 1 năm
    algorithm: "sha256", // Thuật toán mã hóa
  });
  
  // Ghi key và cert ra file
  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
}

// Đọc key và cert từ file
const key = fs.readFileSync(keyPath);
const cert = fs.readFileSync(certPath);

// Tạo HTTPS server với Express app
const server = https.createServer({ key, cert }, app);
const proto = "https";

// ===== SOCKET.IO SETUP =====
// Khởi tạo Socket.IO server để xử lý realtime signaling
const io = new Server(server, {
  cors: { origin: "*" }, // Cho phép mọi origin kết nối (dev only, nên giới hạn trong production)
});

// ===== ROOM MANAGEMENT =====
// Lưu trữ thông tin rooms và users
// Cấu trúc: Map<roomId, Map<socketId, {username, userId}>>
// Ví dụ: rooms.get('room1').get('socket123') = {username: 'John', userId: 'abc'}
const rooms = new Map();

// ===== SOCKET.IO CONNECTION HANDLER =====
// Xử lý khi có client kết nối
io.on("connection", (socket) => {
  console.log('[Socket] User connected:', socket.id);

  // ===== EVENT: JOIN ROOM =====
  // Client gửi request join phòng với roomId, username, userId
  socket.on("join", (data) => {
    // Parse data: có thể là string (legacy) hoặc object (mới)
    const roomId = typeof data === 'string' ? data : data.roomId;
    const username = typeof data === 'object' ? data.username : 'Anonymous';
    const userId = typeof data === 'object' ? data.userId : null;
    
    // Kiểm tra số người trong phòng hiện tại
    const room = io.sockets.adapter.rooms.get(roomId);
    const count = room ? room.size : 0;
    
    // Join socket vào room (Socket.IO room mechanism)
    // Hỗ trợ group call - không giới hạn số người
    socket.join(roomId);
    
    // Lưu thông tin user vào room tracking Map
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map()); // Tạo Map mới cho room nếu chưa tồn tại
    }
    rooms.get(roomId).set(socket.id, { username, userId });
    
    // Tạo danh sách users đã có trong phòng (trừ chính mình)
    // Gửi kèm username để client hiển thị tên
    const usersInRoom = Array.from(rooms.get(roomId).entries())
      .filter(([sid]) => sid !== socket.id)  // Loại bỏ chính mình
      .map(([sid, info]) => ({
        socketId: sid,
        username: info.username,
        userId: info.userId
      }));
    
    // Gửi event "room_joined" cho user vừa join
    // Chứa danh sách users và tổng số người
    socket.emit("room_joined", { 
      users: usersInRoom,
      roomSize: rooms.get(roomId).size
    });
    
    // Broadcast event "user_joined" cho các user khác trong phòng
    // Thông báo có người mới vào
    socket.to(roomId).emit("user_joined", { 
      userId: socket.id,
      username: username,
      roomSize: rooms.get(roomId).size
    });
    
    console.log(`[Room ${roomId}] User ${username} (${socket.id}) joined. Total users: ${rooms.get(roomId).size}`);
  });

  // ===== EVENT: START CALL =====
  // Legacy event - có thể không dùng nữa trong group call
  socket.on("start_call", (roomId) => {
    socket.to(roomId).emit("start_call");
  });

  // ===== WEBRTC SIGNALING EVENTS =====
  // Relay SDP offer từ peer A sang peer B
  // SDP (Session Description Protocol) chứa thông tin media/codec
  socket.on("webrtc_offer", ({ roomId, sdp, targetId }) => {
    console.log(`[Offer] From ${socket.id} to ${targetId}`);
    io.to(targetId).emit("webrtc_offer", { sdp, fromId: socket.id });
  });

  // Relay SDP answer từ peer B về peer A
  // Answer là phản hồi cho offer để thiết lập connection
  socket.on("webrtc_answer", ({ roomId, sdp, targetId }) => {
    console.log(`[Answer] From ${socket.id} to ${targetId}`);
    io.to(targetId).emit("webrtc_answer", { sdp, fromId: socket.id });
  });

  // Relay ICE candidate giữa các peers
  // ICE candidates chứa thông tin network path để kết nối P2P
  socket.on("webrtc_ice_candidate", ({ roomId, candidate, targetId }) => {
    io.to(targetId).emit("webrtc_ice_candidate", { candidate, fromId: socket.id });
  });

  // ===== EVENT: CHAT MESSAGE =====
  // Relay tin nhắn chat từ 1 user tới các user khác trong phòng
  socket.on('chat_message', ({ roomId, text, ts }) => {
    try {
      // Validate: phải là string
      if (typeof text !== 'string') return;
      
      // Giới hạn độ dài tin nhắn (2000 ký tự) để tránh spam
      const safe = text.slice(0, 2000);
      
      // Lấy username từ rooms Map để gửi kèm với tin nhắn
      let username = 'Unknown';
      const room = rooms.get(roomId);
      if (room && room.has(socket.id)) {
        username = room.get(socket.id).username || username;
      }
      
      // Broadcast tin nhắn cho các user khác (không gửi lại cho người gửi)
      socket.to(roomId).emit('chat_message', { 
        text: safe, 
        ts: ts || Date.now(), 
        from: socket.id, 
        username 
      });
    } catch (e) {
      console.error('chat_message error', e);
    }
  });

  // ===== EVENT: REACTION =====
  // Relay reaction emoji (👍❤️😂...) giữa các users
  socket.on('reaction', ({ roomId, emoji, ts }) => {
    try {
      // Validate: phải là string
      if (typeof emoji !== 'string') return;
      
      const trimmed = emoji.trim();
      
      // Giới hạn độ dài emoji (max 4 ký tự) để tránh spam
      if (!trimmed || trimmed.length > 4) return;
      
      // Broadcast reaction cho các user khác
      socket.to(roomId).emit('reaction', { 
        emoji: trimmed, 
        ts: ts || Date.now(), 
        from: socket.id 
      });
    } catch (e) {
      console.error('reaction error', e);
    }
  });

  // ===== EVENT: SCREEN SHARE STOPPED =====
  // Thông báo cho các peers khi user dừng chia sẻ màn hình
  // Peers sẽ xóa screen share tile của user này
  socket.on('screen_share_stopped', ({ roomId }) => {
    try {
      socket.to(roomId).emit('screen_share_stopped', { 
        userId: socket.id, 
        ts: Date.now() 
      });
      console.log(`[ScreenShare] ${socket.id} stopped in room ${roomId}`);
    } catch (e) {
      console.error('screen_share_stopped error', e);
    }
  });

  // ===== EVENT: LEAVE ROOM =====
  // User chủ động rời phòng (click nút Leave)
  socket.on("leave", (roomId) => {
    handleUserLeave(socket, roomId);
  });

  // ===== EVENT: DISCONNECT =====
  // User ngắt kết nối (đóng tab, mất mạng...)
  socket.on("disconnect", () => {
    console.log('[Socket] User disconnected:', socket.id);
    
    // Tìm tất cả rooms mà user đang tham gia và xóa khỏi đó
    rooms.forEach((users, roomId) => {
      if (users.has(socket.id)) {
        handleUserLeave(socket, roomId);
      }
    });
  });
});

// ===== HELPER FUNCTION: HANDLE USER LEAVE =====
// Xử lý khi user rời phòng (chủ động hoặc disconnect)
function handleUserLeave(socket, roomId) {
  // Xóa socket khỏi Socket.IO room
  socket.leave(roomId);
  
  // Xóa user khỏi room tracking Map
  if (rooms.has(roomId)) {
    rooms.get(roomId).delete(socket.id);
    const roomSize = rooms.get(roomId).size;
    
    // Nếu phòng trống → xóa luôn room khỏi Map
    if (roomSize === 0) {
      rooms.delete(roomId);
      console.log(`[Room ${roomId}] Empty, deleted`);
    }
    
    // Broadcast event "user_left" cho các user còn lại
    // Để họ đóng peer connection và xóa video tile
    socket.to(roomId).emit("user_left", { 
      userId: socket.id,
      roomSize: roomSize
    });
    
    console.log(`[Room ${roomId}] User ${socket.id} left. Remaining: ${roomSize}`);
  }
}

// ===== START SERVER =====
// Lấy PORT từ .env hoặc mặc định 3000
const PORT = process.env.PORT || 3000;

// Listen trên tất cả network interfaces (0.0.0.0)
// Cho phép truy cập từ LAN, không chỉ localhost
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on ${proto}://0.0.0.0:${PORT}`);
  console.log(`Open from LAN peers: ${proto}://<SERVER_IP>:${PORT}`);
});
