// socket-handlers.js - Socket.IO event listeners

function setupSocketHandlers() {
  // ===== Room Events =====
  socket.on('room_joined', async ({ users, roomSize, groups }) => {
    console.log(`[Room] Joined. ${roomSize} users total. Existing users:`, users);
    
    await setLocalStream();
    
    if (!localStream) {
      console.error('[Room] Failed to get localStream, cannot proceed');
      alert('Không thể khởi tạo camera/micro. Vui lòng kiểm tra quyền truy cập.');
      return;
    }
    
    console.log(`[Room] LocalStream ready with ${localStream.getTracks().length} tracks`);
    
    if (users && Array.isArray(users)) {
      users.forEach(user => {
        if (user.socketId && user.username) {
          userNames.set(user.socketId, user.username);
        }
      });
    }
    
    updateUserList();
    updateParticipantCount(); // ← CẬP NHẬT PARTICIPANT COUNT

    if (Array.isArray(groups)) {
      joinedGroups.clear();
      groups.forEach(g => {
        if (typeof g === 'string' && g.trim()) joinedGroups.add(g.trim());
      });
      updateGroupList();
    }
    
    const userIds = Array.isArray(users) ? users.map(u => u.socketId || u) : users;
    for (const userId of userIds) {
      console.log(`[Room] Creating peer connection for existing user ${userId}`);
      const pc = createPeerConnection(userId);
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('webrtc_offer', { roomId, sdp: offer, targetId: userId });
        console.log(`[Offer] Sent to ${userId}`);
      } catch (error) {
        console.error(`[Offer] Error for ${userId}:`, error);
      }
    }
  });

  socket.on('user_joined', async ({ userId, username, roomSize }) => {
    console.log(`[Room] User ${username || userId} joined. Total: ${roomSize}`);
    if (username) {
      userNames.set(userId, username);
    }
    updateUserList();
    updateParticipantCount(); // ← CẬP NHẬT KHI CÓ NGƯỜI JOIN
  });

  socket.on('user_left', ({ userId, roomSize }) => {
    console.log(`[Room] User ${userId} left. Remaining: ${roomSize}`);
    closePeerConnection(userId);
    userNames.delete(userId);
    updateUserList();
    updateParticipantCount(); // ← CẬP NHẬT KHI CÓ NGƯỜI LEAVE
  });

  // ✅ THÊM: Listen for room closed event when owner leaves
  socket.on('room_closed', ({ reason }) => {
    console.log(`[Room] Room closed: ${reason}`);
    alert(`Phòng đã đóng. Lý do: ${reason || 'Người tạo phòng đã rời đi'}`);
    
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
    
    // Clear video
    localVideo.srcObject = null;
    
    // Reload page to go back to room selection
    window.location.reload();
  });

  // ===== WebRTC Signaling Events =====
  socket.on('webrtc_offer', async ({ sdp, fromId }) => {
    console.log(`[Offer] Received from ${fromId}`);
    try {
      if (!localStream) {
        console.error('[Offer] No localStream available yet');
        return;
      }
      
      let pc = peerConnections.get(fromId);
      if (!pc) {
        console.log(`[Offer] Creating new peer connection for ${fromId}`);
        pc = createPeerConnection(fromId);
      }

      console.log(`[Offer] Setting remote description from ${fromId}`);
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      
      // ✅ XỬ LÝ PENDING ICE CANDIDATES NGAY SAU KHI SET REMOTE DESCRIPTION
      const pendingCandidates = pendingIceCandidates.get(fromId);
      if (pendingCandidates && pendingCandidates.length > 0) {
        console.log(`[ICE] Processing ${pendingCandidates.length} queued candidates for ${fromId}`);
        for (const candidate of pendingCandidates) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.warn(`[ICE] Failed to add queued candidate:`, e);
          }
        }
        pendingIceCandidates.delete(fromId); // Clear queue
      }
      
      checkAndRemoveScreenTile(fromId, pc);
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      socket.emit('webrtc_answer', { roomId, sdp: answer, targetId: fromId });
      console.log(`[Answer] Sent to ${fromId}`);
    } catch (error) {
      console.error(`[Offer] Error from ${fromId}:`, error);
    }
  });

  socket.on('webrtc_answer', async ({ sdp, fromId }) => {
    console.log(`[Answer] Received from ${fromId}`);
    try {
      const pc = peerConnections.get(fromId);
      if (!pc) {
        console.error(`[Answer] No peer connection for ${fromId}`);
        return;
      }

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      console.log(`[Answer] Applied from ${fromId}`);
      
      // ✅ XỬ LÝ PENDING ICE CANDIDATES SAU KHI NHẬN ANSWER
      const pendingCandidates = pendingIceCandidates.get(fromId);
      if (pendingCandidates && pendingCandidates.length > 0) {
        console.log(`[ICE] Processing ${pendingCandidates.length} queued candidates for ${fromId}`);
        for (const candidate of pendingCandidates) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.warn(`[ICE] Failed to add queued candidate:`, e);
          }
        }
        pendingIceCandidates.delete(fromId);
      }
      
      checkAndRemoveScreenTile(fromId, pc);
    } catch (error) {
      console.error(`[Answer] Error from ${fromId}:`, error);
    }
  });

  socket.on('webrtc_ice_candidate', async ({ candidate, fromId }) => {
    try {
      const pc = peerConnections.get(fromId);
      if (!pc) {
        console.warn(`[ICE] No peer connection for ${fromId}, ignoring candidate`);
        return;
      }

      if (pc.remoteDescription) {
        // ✅ CÓ REMOTE DESCRIPTION → THÊM NGAY
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        console.log(`[ICE] Added candidate from ${fromId}`);
      } else {
        // ⏳ CHƯA CÓ REMOTE DESCRIPTION → QUEUE LẠI
        if (!pendingIceCandidates.has(fromId)) {
          pendingIceCandidates.set(fromId, []);
        }
        pendingIceCandidates.get(fromId).push(candidate);
        console.log(`[ICE] Queued candidate from ${fromId} (waiting for remote description)`);
      }
    } catch (error) {
      console.error(`[ICE] Error from ${fromId}:`, error);
    }
  });

  // ===== Chat Events =====
  socket.on('chat_message', ({ text, ts, from, username }) => {
    const senderName = username || userNames.get(from) || `User ${String(from).slice(0,6)}`;
    const isSelf = from === socket.id;
    appendChatMessage(text || '', isSelf ? (currentUser?.username || 'Tôi') : senderName, ts || Date.now(), isSelf);
    if (!isChatOpen && !isSelf) {
      unreadCount += 1;
      updateChatBadge();
    }
  });

  socket.on('private_message', ({ text, ts, from, usernameFrom, usernameTo }) => {
    const isSelf = from === socket.id;
    const senderName = isSelf ? (currentUser?.username || 'Tôi') : (usernameFrom || userNames.get(from) || `User ${String(from).slice(0,6)}`);
    
    // ✅ ADD BADGE for received private message
    if (!isSelf) {
      appendChatMessage(text || '', senderName, ts || Date.now(), false, {
        type: 'private',
        icon: 'lock',
        text: 'Riêng tư'
      });
    }
    
    if (!isChatOpen && !isSelf) {
      unreadCount += 1;
      updateChatBadge();
    }
  });

  socket.on('group_message', ({ text, ts, from, group, username }) => {
    const isSelf = from === socket.id;
    const senderName = isSelf ? (currentUser?.username || 'Tôi') : (username || userNames.get(from) || `User ${String(from).slice(0,6)}`);
    
    // ✅ ADD BADGE for group message
    if (!isSelf) {
      appendChatMessage(text || '', senderName, ts || Date.now(), false, {
        type: 'group',
        icon: 'hash',
        text: group || '?'
      });
    }
    
    if (!isChatOpen && !isSelf) {
      unreadCount += 1;
      updateChatBadge();
    }
  });

  socket.on('group_added', ({ group }) => {
    if (typeof group === 'string' && group.trim()) {
      const g = group.trim();
      joinedGroups.add(g);
      updateGroupList();
      if (groupTarget && (chatMode === 'group') && !groupTarget.value) {
        groupTarget.value = g;
      }
      appendSystemMessage(`Bạn đã được thêm vào nhóm: ${g}`);
    }
  });

  socket.on('group_removed', ({ group }) => {
    if (typeof group === 'string' && group.trim()) {
      const g = group.trim();
      joinedGroups.delete(g);
      updateGroupList();
      if (groupTarget && groupTarget.value === g) {
        groupTarget.value = '';
      }
      appendSystemMessage(`Nhóm đã bị xóa / bạn đã rời nhóm: ${g}`);
    }
  });

  socket.on('system_message', ({ text, ts }) => {
    appendSystemMessage(text || '', ts || Date.now());
  });

  // ===== Reactions Events =====
  socket.on('reaction', ({ emoji }) => {
    if (typeof emoji === 'string' && emoji.length <= 4) {
      showReaction(emoji);
    }
  });

  // ===== Screen Share Events =====
  socket.on('screen_share_stopped', ({ userId }) => {
    console.log(`[ScreenShare] ${userId} stopped sharing screen`);
    // ✅ SỬA: Gọi hàm từ webrtc.js thay vì screen-share.handlers.js
    removeRemoteScreenTileFromServer(userId);
  });
}
