const fs = require("fs");
const path = require("path");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
app.use("/", express.static(path.join(__dirname, "public")));

let server = require("http").createServer(app);
let proto = "http";

const io = new Server(server, {
  cors: { origin: "*" }
});

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

  socket.on("leave", (roomId) => {
    socket.leave(roomId);
    socket.to(roomId).emit("peer_left");
  });
});

const PORT = 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on ${proto}://0.0.0.0:${PORT}`);
});
