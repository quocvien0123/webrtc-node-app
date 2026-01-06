// chat.js - Chat functionality (broadcast, private, group)

// ===== Utility Functions =====
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
}

// Generate avatar initials from name
function getAvatarInitials(name) {
  if (!name) return '?';
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

// Format timestamp
function formatTime(ts) {
  const date = new Date(ts);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

// REDESIGNED: Append chat message with avatar and header
function appendChatMessage(text, senderName, ts = Date.now(), isSelf = false, badge = null) {
  const line = document.createElement('div');
  line.className = `msg ${isSelf ? 'me' : 'peer'}`;

  // Message header (avatar + sender + time)
  const header = document.createElement('div');
  header.className = 'msg-header';
  
  // Avatar
  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = getAvatarInitials(senderName);
  
  // Sender name
  const sender = document.createElement('span');
  sender.className = 'msg-sender';
  sender.textContent = senderName || 'Người khác';
  
  // Time
  const time = document.createElement('span');
  time.className = 'msg-time';
  time.textContent = formatTime(ts);
  
  header.appendChild(avatar);
  header.appendChild(sender);
  header.appendChild(time);
  line.appendChild(header);
  
  // Badge (for private/group messages)
  if (badge) {
    const badgeEl = document.createElement('div');
    badgeEl.className = `msg-badge ${badge.type}`;
    if (badge.icon) {
      badgeEl.innerHTML = `<i data-lucide="${badge.icon}"></i><span>${escapeHtml(badge.text)}</span>`;
    } else {
      badgeEl.textContent = badge.text;
    }
    line.appendChild(badgeEl);
  }

  // Message bubble
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text; // Use textContent to avoid XSS
  line.appendChild(bubble);
  
  chatMessages.appendChild(line);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  
  // Re-render lucide icons for badge
  if (badge && window.lucide) {
    window.lucide.createIcons();
  }
}

// REDESIGNED: System message
function appendSystemMessage(text, ts = Date.now()) {
  const line = document.createElement('div');
  line.className = 'msg system';
  
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  
  line.appendChild(bubble);
  chatMessages.appendChild(line);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ===== Send Chat Message =====
function sendChat() {
  const text = (chatInput.value || '').trim();
  if (!text || !roomId) return;

  const ts = Date.now();
  const myName = currentUser?.username || 'Tôi';

  if (chatMode === 'all') {
    const payload = { roomId, text, ts };
    appendChatMessage(text, myName, ts, true); // No badge for "all" mode
    socket.emit('chat_message', payload);
    chatInput.value = '';
    return;
  }

  if (chatMode === 'private') {
    const toUsername = privateTarget.value;
    if (!toUsername) {
      appendSystemMessage('Vui lòng chọn người nhận trước khi gửi tin nhắn riêng.');
      return;
    }
    //  ADD BADGE for private message
    appendChatMessage(text, myName, ts, true, {
      type: 'private',
      icon: 'lock',
      text: `Riêng tư → ${toUsername}`
    });
    socket.emit('private_send', { roomId, toUsername, text, ts }, (res) => {
      if (!res?.ok) {
        appendSystemMessage(`Gửi tin nhắn riêng thất bại: ${res?.error || 'UNKNOWN_ERROR'}`);
      }
    });
    chatInput.value = '';
    return;
  }

  if (chatMode === 'group') {
    const group = groupTarget.value;
    if (!group) {
      appendSystemMessage('Vui lòng chọn nhóm trước khi gửi tin nhắn nhóm.');
      return;
    }
    //  ADD BADGE for group message
    appendChatMessage(text, myName, ts, true, {
      type: 'group',
      icon: 'hash',
      text: group
    });
    socket.emit('group_send', { roomId, group, text, ts }, (res) => {
      if (!res?.ok) {
        appendSystemMessage(`Gửi tin nhắn nhóm thất bại: ${res?.error || 'UNKNOWN_ERROR'}`);
      }
    });
    chatInput.value = '';
    return;
  }
}

// ===== Chat Modal =====
function openChat() {
  if (chatOverlay) chatOverlay.style.display = 'block';
  if (chatModal) chatModal.style.display = 'flex';
  setTimeout(() => { chatInput?.focus(); }, 50);
  isChatOpen = true;
  unreadCount = 0;
  updateChatBadge();
}

function closeChat() {
  if (chatOverlay) chatOverlay.style.display = 'none';
  if (chatModal) chatModal.style.display = 'none';
  isChatOpen = false;
}

// ===== Chat Mode Switching =====
function switchChatMode(mode) {
  chatMode = mode;
  
  chatModeTabs.forEach(tab => {
    if (tab.dataset.mode === mode) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });
  
  if (mode === 'all') {
    privateSelector.style.display = 'none';
    groupSelector.style.display = 'none';
  } else if (mode === 'private') {
    privateSelector.style.display = 'flex';
    groupSelector.style.display = 'none';
  } else if (mode === 'group') {
    privateSelector.style.display = 'none';
    groupSelector.style.display = 'flex';
  }
}

// ===== User List for Private Chat =====
function updateUserList() {
  if (!privateTarget) return;
  
  privateTarget.innerHTML = '<option value="">-- Chọn người --</option>';
  
  userNames.forEach((username, userId) => {
    if (userId !== socket.id) {
      const option = document.createElement('option');
      option.value = username;
      option.textContent = username;
      privateTarget.appendChild(option);
    }
  });

  if (groupAddUser) {
    groupAddUser.innerHTML = '<option value="">-- Chọn người để thêm --</option>';
    userNames.forEach((username, userId) => {
      if (userId !== socket.id) {
        const option = document.createElement('option');
        option.value = username;
        option.textContent = username;
        groupAddUser.appendChild(option);
      }
    });
  }
}

// ===== Group Management =====
function updateGroupList() {
  if (!groupTarget || !joinedGroupsList) return;
  
  groupTarget.innerHTML = '<option value="">-- Chọn nhóm --</option>';
  joinedGroups.forEach(group => {
    const option = document.createElement('option');
    option.value = group;
    option.textContent = group;
    groupTarget.appendChild(option);
  });
  
  joinedGroupsList.innerHTML = '';
  joinedGroups.forEach(group => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(group)}</span>`;
    const leaveBtn = document.createElement('button');
    leaveBtn.textContent = 'Rời';
    leaveBtn.addEventListener('click', () => leaveGroup(group));
    li.appendChild(leaveBtn);
    joinedGroupsList.appendChild(li);
  });
  
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function createGroup(groupName) {
  const sanitized = String(groupName || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  if (!sanitized) {
    appendSystemMessage('Tên nhóm không hợp lệ. Chỉ cho phép chữ, số, _, -');
    return;
  }

  socket.emit('group_create', { roomId, group: sanitized }, (res) => {
    if (res?.ok) {
      joinedGroups.add(res.group);
      updateGroupList();
      groupTarget.value = res.group;
      appendSystemMessage(`Đã tạo nhóm: ${res.group}`);
    } else {
      appendSystemMessage(`Tạo nhóm thất bại: ${res?.error || 'UNKNOWN_ERROR'}`);
    }
  });
}

function addMemberToGroup(groupName, username) {
  const g = String(groupName || '').trim();
  const u = String(username || '').trim();
  if (!g) {
    appendSystemMessage('Vui lòng chọn nhóm để thêm người.');
    return;
  }
  if (!u) {
    appendSystemMessage('Vui lòng chọn người để thêm vào nhóm.');
    return;
  }

  socket.emit('group_add_members', { roomId, group: g, usernames: [u] }, (res) => {
    if (res?.ok) {
      appendSystemMessage(`Đã thêm ${u} vào nhóm ${g}`);
    } else {
      appendSystemMessage(`Thêm người thất bại: ${res?.error || 'UNKNOWN_ERROR'}`);
    }
  });
}

function leaveGroup(groupName) {
  socket.emit('group_leave', { roomId, group: groupName }, (res) => {
    if (res?.ok) {
      joinedGroups.delete(res.group);
      updateGroupList();
      appendSystemMessage(`Đã rời nhóm: ${res.group}`);
    } else {
      appendSystemMessage(`Rời nhóm thất bại: ${res?.error || 'UNKNOWN_ERROR'}`);
    }
  });
}

// ===== Chat Badge =====
function updateChatBadge() {
  if (!chatToggle) return;
  let badge = chatToggle.querySelector('.chat-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'chat-badge';
    badge.style.display = 'none';
    badge.style.position = 'absolute';
    badge.style.top = '-6px';
    badge.style.right = '-6px';
    badge.style.background = '#ef4444';
    badge.style.color = '#fff';
    badge.style.borderRadius = '999px';
    badge.style.padding = '2px 6px';
    badge.style.fontSize = '12px';
    badge.style.lineHeight = '16px';
    badge.style.border = '1px solid rgba(255,255,255,0.4)';
    chatToggle.appendChild(badge);
  }
  if (unreadCount > 0) {
    badge.textContent = String(unreadCount);
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

// ===== Chat Event Listeners =====
function setupChatListeners() {
  chatSend?.addEventListener('click', sendChat);
  chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { 
      e.preventDefault(); 
      sendChat(); 
    }
  });

  chatToggle?.addEventListener('click', openChat);
  chatClose?.addEventListener('click', closeChat);
  chatOverlay?.addEventListener('click', closeChat);
  window.addEventListener('keydown', (e) => { 
    if (e.key === 'Escape') closeChat(); 
  });

  chatModeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      switchChatMode(tab.dataset.mode);
    });
  });

  groupManageBtn?.addEventListener('click', () => {
    if (groupManagePanel) {
      groupManagePanel.style.display = groupManagePanel.style.display === 'none' ? 'block' : 'none';
    }
  });

  groupManageClose?.addEventListener('click', () => {
    if (groupManagePanel) {
      groupManagePanel.style.display = 'none';
    }
  });

  groupCreateBtn?.addEventListener('click', () => {
    const groupName = groupNameInput?.value?.trim();
    if (groupName) {
      createGroup(groupName);
      groupNameInput.value = '';
    }
  });

  groupNameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const groupName = groupNameInput.value.trim();
      if (groupName) {
        createGroup(groupName);
        groupNameInput.value = '';
      }
    }
  });

  groupAddBtn?.addEventListener('click', () => {
    const groupName = groupTarget?.value;
    const username = groupAddUser?.value;
    addMemberToGroup(groupName, username);
    if (groupAddUser) groupAddUser.value = '';
  });

  groupAddUser?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const groupName = groupTarget?.value;
      const username = groupAddUser?.value;
      addMemberToGroup(groupName, username);
      if (groupAddUser) groupAddUser.value = '';
    }
  });
}
