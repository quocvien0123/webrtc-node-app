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
  });

  socket.on('user_left', ({ userId, roomSize }) => {
    console.log(`[Room] User ${userId} left. Remaining: ${roomSize}`);
    closePeerConnection(userId);
    userNames.delete(userId);
    updateUserList();
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
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        console.log(`[ICE] Added candidate from ${fromId}`);
      } else {
        console.log(`[ICE] Queued candidate from ${fromId} (no remote description yet)`);
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
    const prefix = isSelf ? `[PM -> ${usernameTo || '...'}] ` : '[PM] ';
    if (!isSelf) {
      appendChatMessage(`${prefix}${text || ''}`, senderName, ts || Date.now(), false);
    }
    if (!isChatOpen && !isSelf) {
      unreadCount += 1;
      updateChatBadge();
    }
  });

  socket.on('group_message', ({ text, ts, from, group, username }) => {
    const isSelf = from === socket.id;
    const senderName = isSelf ? (currentUser?.username || 'Tôi') : (username || userNames.get(from) || `User ${String(from).slice(0,6)}`);
    if (!isSelf) {
      appendChatMessage(`[Group:${group || '?'}] ${text || ''}`, senderName, ts || Date.now(), false);
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
    const screenTileId = `screen-share-tile-${userId}`;
    const screenTile = document.getElementById(screenTileId);
    if (screenTile) {
      console.log(`[Remote] ${userId} stopped sharing, removing screen tile`);
      screenTile.remove();
    }
    if (screenStreams.has(userId)) {
      screenStreams.delete(userId);
    }
  });
}
