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
    keySize: 2048,
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

// groups: Map<roomId, Map<groupName, { ownerSocketId: string, members: Set<string> }>>
const groups = new Map();

function getRoomUsers(roomId) {
  if (!roomId) return null;
  return rooms.get(roomId) || null;
}

function getUserInfo(roomId, socketId) {
  const users = getRoomUsers(roomId);
  if (!users) return null;
  return users.get(socketId) || null;
}

function findSocketIdByUsername(roomId, username) {
  if (!username) return null;
  const users = getRoomUsers(roomId);
  if (!users) return null;
  const needle = String(username).trim().toLowerCase();
  if (!needle) return null;
  for (const [sid, info] of users.entries()) {
    const u = (info?.username || '').trim().toLowerCase();
    if (u && u === needle) return sid;
  }
  return null;
}

function sanitizeGroupName(name) {
  const raw = String(name || '').trim();
  if (!raw) return null;
  // Only allow simple group names to avoid room injection / weird chars
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  return cleaned || null;
}

function groupRoomId(roomId, groupName) {
  return `group:${roomId}:${groupName}`;
}

function getRoomGroups(roomId) {
  if (!roomId) return null;
  if (!groups.has(roomId)) groups.set(roomId, new Map());
  return groups.get(roomId);
}

function getSocketIdByUsername(roomId, username) {
  return findSocketIdByUsername(roomId, username);
}

function emitSystemMessage(socket, text) {
  socket.emit('system_message', { text: String(text || ''), ts: Date.now() });
}

io.on("connection", (socket) => {
  console.log('[Socket] User connected:', socket.id);

  socket.on("join", (data) => {
    // data có thể là string (roomId) hoặc object {roomId, username, userId}
    const roomId = typeof data === 'string' ? data : data.roomId;
    const username = typeof data === 'object' ? data.username : 'Anonymous';
    const userId = typeof data === 'object' ? data.userId : null;
    
    const room = io.sockets.adapter.rooms.get(roomId);
    const count = room ? room.size : 0;
    
    // Cho phép nhiều người join
    socket.join(roomId);

    // Track roomId on socket for validation
    socket.data.roomId = roomId;
    
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
    
    // Also send groups that this socket is already a member of (if any)
    const roomGroups = getRoomGroups(roomId);
    const myGroups = [];
    if (roomGroups) {
      for (const [gName, g] of roomGroups.entries()) {
        if (g?.members && g.members.has(socket.id)) {
          myGroups.push(gName);
          // Ensure socket is joined to the Socket.IO room (in case of reconnect)
          socket.join(groupRoomId(roomId, gName));
        }
      }
    }

    socket.emit("room_joined", {
      users: usersInRoom,
      roomSize: rooms.get(roomId).size,
      groups: myGroups
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

  // Gửi offer đến user cụ thể
  socket.on("webrtc_offer", ({ roomId, sdp, targetId }) => {
    console.log(`[Offer] From ${socket.id} to ${targetId}`);
    io.to(targetId).emit("webrtc_offer", { sdp, fromId: socket.id });
  });

  // Gửi answer đến user cụ thể
  socket.on("webrtc_answer", ({ roomId, sdp, targetId }) => {
    console.log(`[Answer] From ${socket.id} to ${targetId}`);
    io.to(targetId).emit("webrtc_answer", { sdp, fromId: socket.id });
  });

  // Gửi ICE candidate đến user cụ thể
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

  // ===== Private message (unicast) =====
  // payload: { roomId, toUsername, text, ts }
  socket.on('private_send', ({ roomId, toUsername, text, ts }, ack) => {
    try {
      const cb = typeof ack === 'function' ? ack : null;
      if (!roomId || socket.data.roomId !== roomId) {
        cb?.({ ok: false, error: 'NOT_IN_ROOM' });
        return;
      }
      if (typeof text !== 'string') {
        cb?.({ ok: false, error: 'INVALID_TEXT' });
        return;
      }
      const safe = text.slice(0, 2000);
      const toName = String(toUsername || '').trim();
      if (!toName) {
        cb?.({ ok: false, error: 'MISSING_TARGET' });
        return;
      }

      const targetSocketId = findSocketIdByUsername(roomId, toName);
      if (!targetSocketId) {
        cb?.({ ok: false, error: 'USER_NOT_FOUND' });
        return;
      }

      const senderInfo = getUserInfo(roomId, socket.id);
      const usernameFrom = senderInfo?.username || 'Unknown';
      const usernameTo = getUserInfo(roomId, targetSocketId)?.username || toName;
      const payload = {
        text: safe,
        ts: ts || Date.now(),
        from: socket.id,
        to: targetSocketId,
        usernameFrom,
        usernameTo,
      };

      // Unicast to target only (sender already renders locally)
      io.to(targetSocketId).emit('private_message', payload);

      cb?.({ ok: true });
    } catch (e) {
      console.error('private_send error', e);
      if (typeof ack === 'function') ack({ ok: false, error: 'SERVER_ERROR' });
    }
  });

  // ===== Group messaging (multicast via Socket.IO rooms) =====
  // New flow:
  // - group_create: creator creates group and becomes owner/member
  // - group_add_members: owner adds users to group; server auto-joins them
  // Members do not self-join.

  socket.on('group_create', ({ roomId, group }, ack) => {
    try {
      const cb = typeof ack === 'function' ? ack : null;
      if (!roomId || socket.data.roomId !== roomId) {
        cb?.({ ok: false, error: 'NOT_IN_ROOM' });
        return;
      }
      const g = sanitizeGroupName(group);
      if (!g) {
        cb?.({ ok: false, error: 'INVALID_GROUP' });
        return;
      }
      const roomGroups = getRoomGroups(roomId);
      if (roomGroups.has(g)) {
        cb?.({ ok: false, error: 'GROUP_EXISTS' });
        return;
      }

      roomGroups.set(g, { ownerSocketId: socket.id, members: new Set([socket.id]) });
      socket.join(groupRoomId(roomId, g));
      socket.emit('group_added', { roomId, group: g, addedBy: socket.id });
      cb?.({ ok: true, group: g });
    } catch (e) {
      console.error('group_create error', e);
      if (typeof ack === 'function') ack({ ok: false, error: 'SERVER_ERROR' });
    }
  });

  socket.on('group_add_members', ({ roomId, group, usernames }, ack) => {
    try {
      const cb = typeof ack === 'function' ? ack : null;
      if (!roomId || socket.data.roomId !== roomId) {
        cb?.({ ok: false, error: 'NOT_IN_ROOM' });
        return;
      }
      const g = sanitizeGroupName(group);
      if (!g) {
        cb?.({ ok: false, error: 'INVALID_GROUP' });
        return;
      }
      const roomGroups = getRoomGroups(roomId);
      const groupInfo = roomGroups.get(g);
      if (!groupInfo) {
        cb?.({ ok: false, error: 'GROUP_NOT_FOUND' });
        return;
      }
      if (groupInfo.ownerSocketId !== socket.id) {
        cb?.({ ok: false, error: 'NOT_GROUP_OWNER' });
        return;
      }
      if (!Array.isArray(usernames) || usernames.length === 0) {
        cb?.({ ok: false, error: 'EMPTY_MEMBERS' });
        return;
      }

      const added = [];
      for (const uname of usernames) {
        const sid = getSocketIdByUsername(roomId, uname);
        if (!sid) continue;
        if (groupInfo.members.has(sid)) continue;
        groupInfo.members.add(sid);
        const targetSocket = io.sockets.sockets.get(sid);
        if (targetSocket) {
          targetSocket.join(groupRoomId(roomId, g));
          targetSocket.emit('group_added', { roomId, group: g, addedBy: socket.id });
          added.push(sid);
        }
      }

      cb?.({ ok: true, group: g, addedCount: added.length });
    } catch (e) {
      console.error('group_add_members error', e);
      if (typeof ack === 'function') ack({ ok: false, error: 'SERVER_ERROR' });
    }
  });

  socket.on('group_leave', ({ roomId, group }, ack) => {
    try {
      const cb = typeof ack === 'function' ? ack : null;
      if (!roomId || socket.data.roomId !== roomId) {
        cb?.({ ok: false, error: 'NOT_IN_ROOM' });
        return;
      }
      const g = sanitizeGroupName(group);
      if (!g) {
        cb?.({ ok: false, error: 'INVALID_GROUP' });
        return;
      }
      const roomGroups = getRoomGroups(roomId);
      const groupInfo = roomGroups.get(g);
      if (!groupInfo) {
        cb?.({ ok: false, error: 'GROUP_NOT_FOUND' });
        return;
      }

      // Owner leaving deletes group (simplest behavior)
      if (groupInfo.ownerSocketId === socket.id) {
        roomGroups.delete(g);
        // Notify remaining members to remove group
        io.to(groupRoomId(roomId, g)).emit('group_removed', { roomId, group: g });
        // Remove all sockets from that Socket.IO room by making them leave on next join; we still leave current socket
        socket.leave(groupRoomId(roomId, g));
        cb?.({ ok: true, group: g, deleted: true });
        return;
      }

      groupInfo.members.delete(socket.id);
      socket.leave(groupRoomId(roomId, g));
      socket.emit('group_removed', { roomId, group: g });
      cb?.({ ok: true, group: g });
    } catch (e) {
      console.error('group_leave error', e);
      if (typeof ack === 'function') ack({ ok: false, error: 'SERVER_ERROR' });
    }
  });

  // payload: { roomId, group, text, ts }
  socket.on('group_send', ({ roomId, group, text, ts }, ack) => {
    try {
      const cb = typeof ack === 'function' ? ack : null;
      if (!roomId || socket.data.roomId !== roomId) {
        cb?.({ ok: false, error: 'NOT_IN_ROOM' });
        return;
      }
      if (typeof text !== 'string') {
        cb?.({ ok: false, error: 'INVALID_TEXT' });
        return;
      }
      const g = sanitizeGroupName(group);
      if (!g) {
        cb?.({ ok: false, error: 'INVALID_GROUP' });
        return;
      }
      const safe = text.slice(0, 2000);
      const senderInfo = getUserInfo(roomId, socket.id);
      const username = senderInfo?.username || 'Unknown';
      const payload = {
        text: safe,
        ts: ts || Date.now(),
        from: socket.id,
        group: g,
        username,
      };

      // Multicast to group room excluding sender (sender already renders locally)
      socket.to(groupRoomId(roomId, g)).emit('group_message', payload);

      cb?.({ ok: true, group: g });
    } catch (e) {
      console.error('group_send error', e);
      if (typeof ack === 'function') ack({ ok: false, error: 'SERVER_ERROR' });
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
  if (socket?.data?.roomId === roomId) {
    socket.data.roomId = null;
  }

  // Remove user from group memberships in this room
  const roomGroups = groups.get(roomId);
  if (roomGroups) {
    for (const [gName, g] of roomGroups.entries()) {
      if (!g?.members) continue;
      if (!g.members.has(socket.id)) continue;
      // If owner leaves, delete group and notify
      if (g.ownerSocketId === socket.id) {
        roomGroups.delete(gName);
        io.to(groupRoomId(roomId, gName)).emit('group_removed', { roomId, group: gName });
      } else {
        g.members.delete(socket.id);
      }
      socket.leave(groupRoomId(roomId, gName));
      socket.emit('group_removed', { roomId, group: gName });
    }
    if (roomGroups.size === 0) {
      groups.delete(roomId);
    }
  }
  
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
