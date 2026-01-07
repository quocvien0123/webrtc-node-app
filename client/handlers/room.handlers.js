// room.js - Room management (join, leave)

//  Generate random room ID
function generateRoomId() {
  const adjectives = ['happy', 'sunny', 'clever', 'brave', 'calm', 'bright', 'swift', 'cool', 'wise', 'kind'];
  const nouns = ['tiger', 'eagle', 'dolphin', 'panda', 'wolf', 'lion', 'hawk', 'bear', 'fox', 'owl'];
  const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
  const randomNum = Math.floor(Math.random() * 1000);
  return `${randomAdj}-${randomNoun}-${randomNum}`;
}

// Get invite link
function getInviteLink(roomId) {
  const baseUrl = window.location.origin;
  return `${baseUrl}/?room=${encodeURIComponent(roomId)}`;
}

// Show toast notification
function showToast(message, duration = 3000) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Copy to clipboard
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  }
}

function joinRoom(room) {
  console.log('[Join] request', room);
  roomId = room;
  // Export roomId ra global scope để whiteboard sử dụng
  window.roomId = room;
  
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

// Check URL for room parameter on page load
function checkRoomFromURL() {
  const urlParams = new URLSearchParams(window.location.search);
  const roomFromURL = urlParams.get('room');
  
  if (roomFromURL) {
    console.log('[URL] Auto-joining room:', roomFromURL);
    // Auto-fill room input
    if (roomInput) {
      roomInput.value = roomFromURL;
    }
    // Optional: Auto-join immediately
    // joinRoom(roomFromURL);
  }
}

// ===== Room UI Events =====
function setupRoomListeners() {
  const roomTabButtons = document.querySelectorAll('.room-tab');
  const tabContents = document.querySelectorAll('.room-tab-content');
  
  roomTabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      
      roomTabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      tabContents.forEach(content => {
        if (content.id === `${targetTab}-room-tab`) {
          content.classList.add('active');
        } else {
          content.classList.remove('active');
        }
      });
      
      lucide.createIcons();
    });
  });

  const optionCards = document.querySelectorAll('.option-card');
  const customInputGroup = document.getElementById('custom-room-input-group');
  const newRoomInput = document.getElementById('new-room-input');
  
  let selectedMode = 'quick'; // default
  
  optionCards.forEach(card => {
    card.addEventListener('click', () => {
      const mode = card.getAttribute('data-mode');
      selectedMode = mode;
      
      optionCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      
      if (mode === 'custom') {
        customInputGroup.style.display = 'flex';
        newRoomInput.focus();
      } else {
        customInputGroup.style.display = 'none';
      }
      
      optionCards.forEach(c => {
        const checkIcon = c.querySelector('.option-check i');
        if (c === card) {
          checkIcon.setAttribute('data-lucide', 'check-circle');
        } else {
          checkIcon.setAttribute('data-lucide', 'circle');
        }
      });
      
      lucide.createIcons();
    });
  });

  const createRoomButton = document.getElementById('create-room-button');
  const inviteLinkSection = document.getElementById('invite-link-section');
  const inviteLinkInput = document.getElementById('invite-link');
  const copyLinkButton = document.getElementById('copy-link-button');
  const joinCreatedRoomButton = document.getElementById('join-created-room-button');
  const createAnotherButton = document.getElementById('create-another-button');
  
  let createdRoomId = null;
  
  createRoomButton?.addEventListener('click', () => {
    let roomId;
    
    if (selectedMode === 'custom') {
      const customName = newRoomInput.value.trim();
      if (!customName) {
        showToast('⚠️ Vui lòng nhập tên phòng');
        newRoomInput.focus();
        return;
      }
      roomId = customName;
    } else {
      roomId = generateRoomId();
    }
    
    createdRoomId = roomId;
    const inviteLink = getInviteLink(roomId);
    
    // Show invite link section
    inviteLinkInput.value = inviteLink;
    inviteLinkSection.style.display = 'block';
    
    // Hide create button and options
    createRoomButton.style.display = 'none';
    optionCards.forEach(card => card.style.display = 'none');
    customInputGroup.style.display = 'none';
    
    console.log('[Create] Room created:', roomId);
    
    lucide.createIcons();
  });
  
  copyLinkButton?.addEventListener('click', async () => {
    const link = inviteLinkInput.value;
    const success = await copyToClipboard(link);
    
    if (success) {
      copyLinkButton.classList.add('copied');
      const originalHTML = copyLinkButton.innerHTML;
      copyLinkButton.innerHTML = '<i data-lucide="check"></i><span>Đã sao chép!</span>';
      showToast('📋 Đã sao chép link vào clipboard!');
      
      setTimeout(() => {
        copyLinkButton.classList.remove('copied');
        copyLinkButton.innerHTML = originalHTML;
        lucide.createIcons();
      }, 2000);
    } else {
      showToast('❌ Không thể sao chép link');
    }
    
    lucide.createIcons();
  });
  
  joinCreatedRoomButton?.addEventListener('click', () => {
    if (createdRoomId) {
      joinRoom(createdRoomId);
    }
  });
  
  createAnotherButton?.addEventListener('click', () => {
    // Reset UI
    inviteLinkSection.style.display = 'none';
    createRoomButton.style.display = 'flex';
    optionCards.forEach(card => card.style.display = 'flex');
    newRoomInput.value = '';
    customInputGroup.style.display = 'none';
    
    // Reset to quick mode
    selectedMode = 'quick';
    optionCards.forEach((card, index) => {
      if (index === 0) {
        card.classList.add('active');
        card.querySelector('.option-check i').setAttribute('data-lucide', 'check-circle');
      } else {
        card.classList.remove('active');
        card.querySelector('.option-check i').setAttribute('data-lucide', 'circle');
      }
    });
    
    createdRoomId = null;
    lucide.createIcons();
  });

  connectButton?.addEventListener('click', () => {
    const id = roomInput.value.trim();
    if (!id) {
      showToast('⚠️ Vui lòng nhập mã phòng');
      return;
    }
    joinRoom(id);
  });

  roomInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      connectButton?.click();
    }
  });
  
  newRoomInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      createRoomButton?.click();
    }
  });

  leaveBtn?.addEventListener('click', () => {
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
    
    socket.emit('leave', roomId);
    
    localVideo.srcObject = null;
    
    window.location.reload();
  });
  
  checkRoomFromURL();
}
