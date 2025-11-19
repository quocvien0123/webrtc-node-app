const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

app.use('/', express.static('public'));

io.on('connection', (socket) => {
  socket.on('join', (roomId) => {
    const selectedRoom = io.sockets.adapter.rooms.get(roomId)
    const numberOfClients = selectedRoom ? selectedRoom.size : 0

    if (numberOfClients === 0) {
      console.log(`Creating room ${roomId} and emitting room_created socket event`)
      socket.join(roomId)
      socket.emit('room_created', roomId)
    } else if (numberOfClients === 1) {
      console.log(`Joining room ${roomId} and emitting room_joined socket event`)
      socket.join(roomId)
      socket.emit('room_joined', roomId)
    } else {
      console.log(`Can't join room ${roomId}, emitting full_room socket event`)
      socket.emit('full_room', roomId)
    }
  })

  // These events are emitted to all the sockets connected to the same room except the sender.
  socket.on('start_call', (roomId) => {
    console.log(`Broadcasting start_call event to peers in room ${roomId}`)
    socket.to(roomId).emit('start_call')
  })

  socket.on('webrtc_offer', (event) => {
    console.log(`Broadcasting webrtc_offer event to peers in room ${event.roomId}`)
    socket.to(event.roomId).emit('webrtc_offer', event.sdp)
  })

  socket.on('webrtc_answer', (event) => {
    console.log(`Broadcasting webrtc_answer event to peers in room ${event.roomId}`)
    socket.to(event.roomId).emit('webrtc_answer', event.sdp)
  })

  socket.on('webrtc_ice_candidate', (event) => {
    console.log(`Broadcasting webrtc_ice_candidate event to peers in room ${event.roomId}`)
    socket.to(event.roomId).emit('webrtc_ice_candidate', event)
  })
  socket.on("leave", (roomId) => {
    console.log(`User left room ${roomId}`);
    socket.leave(roomId);
    socket.to(roomId).emit("peer_left"); // 🔥 báo cho peer khác
  });

})

// START THE SERVER =================================================================
const port = process.env.PORT || 3000
httpsServer.listen(port, () => {
  console.log(`Server running at ${port}`)
})
