// room.js - Room management (join, leave)

function joinRoom(room) {
  console.log('[Join] request', room);
  roomId = room;
  
  try {
    const userInfo = {
      roomId: room,
      username: currentUser ? currentUser.username : 'Anonymous',
      userId: currentUser ? currentUser._id : null
    };
    socket.emit('join', userInfo);
  } catch (e) {
    console.error('[Join] emit failed', e);
    alert('Không thể gửi join: ' + (e.message || e));
    return;
  }
  
  showVideoChat();
}

// ===== Room UI Events =====
function setupRoomListeners() {
  connectButton?.addEventListener('click', () => {
    const id = roomInput.value.trim();
    if (!id) return alert('Please enter room id');
    joinRoom(id);
  });

  roomInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      connectButton?.click();
    }
  });

  leaveBtn?.addEventListener('click', () => {
    // Close all peer connections
    peerConnections.forEach((pc, userId) => {
      closePeerConnection(userId);
    });
    
    // Stop recording
    if (isRecording) {
      stopRecording();
    }
    
    // Stop local stream
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }
    
    // Notify server
    socket.emit('leave', roomId);
    
    // Clear video
    localVideo.srcObject = null;
    
    // Reload page
    window.location.reload();
  });
}
