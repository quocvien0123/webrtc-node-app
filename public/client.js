// public/client.js

// Wait for includes to load before initializing
async function initApp() {
  // Wait for HTML partials to load
  if (window.__includesReady) {
    await window.__includesReady;
  }

// ===== DOM =====
// Auth elements
const authContainer = document.getElementById('auth-container');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const loginError = document.getElementById('login-error');
const registerError = document.getElementById('register-error');
const userInfo = document.getElementById('user-info');
const logoutButton = document.getElementById('logout-button');

// Room selection
const roomSelectionContainer = document.getElementById('room-selection-container');
const roomInput = document.getElementById('room-input');
const connectButton = document.getElementById('connect-button');

// Video elements
const videoChatContainer = document.getElementById('video-chat-container');
const videosContainer = document.getElementById('videos-container');
const localVideo = document.getElementById('local-video');

// Controls
const micBtn = document.getElementById('mic-button');
const camBtn = document.getElementById('cam-button');
const leaveBtn = document.getElementById('leave-button');
const shareScreenBtn = document.getElementById('share-screen-button');
const stopShareBtn = document.getElementById('stop-share-button');
const recordBtn = document.getElementById('record-button');
const stopRecordBtn = document.getElementById('stop-record-button');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');
const chatToggle = document.getElementById('chat-toggle');
const chatModal = document.getElementById('chat-modal');
const chatOverlay = document.getElementById('chat-overlay');
const chatClose = document.getElementById('chat-close');
const reactionsBtn = document.getElementById('reactions-button');
const reactionsPopover = document.getElementById('reactions-popover');
const reactionsLayer = document.getElementById('reactions-layer');

// ===== Auth State =====
let currentUser = null;
let authToken = null;

// ===== Socket.IO =====
const socket = io();

// Kiểm tra xem Electron preload có expose desktopCapturer không
const hasElectronDesktop = Boolean(window.electronAPI?.desktopCapturerAvailable);

// Thêm debug chi tiết cho vấn đề overlay không hiển thị
console.log('[ScreenShare] electronAPI?', window.electronAPI);
if (window.electronAPI?.debugInfo) {
  console.log('[ScreenShare] preload debug:', window.electronAPI.debugInfo());
}

console.log('[DEBUG] hasElectronDesktop =', hasElectronDesktop);
console.log('[DEBUG] window.electronAPI =', window.electronAPI);

// ===== State =====
let localStream;
let roomId;
let isScreenSharing = false;
let currentScreenTrack = null;
let screenShareVideoElement = null; // Video element cho màn hình chia sẻ
let lastReactions = []; // timestamps for rate limiting

// Group call state
const peerConnections = new Map(); // Map<userId, RTCPeerConnection>
const remoteStreams = new Map(); // Map<userId, MediaStream> - camera streams
const screenStreams = new Map(); // Map<userId, MediaStream> - screen share streams
const videoElements = new Map(); // Map<userId, HTMLVideoElement>
const userNames = new Map(); // Map<userId, username>

// Recording state
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

// ===== ICE/STUN config =====
const pcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
  ],
};

// ===== Auth Functions =====
async function checkAuth() {
  const token = localStorage.getItem('authToken');
  if (!token) {
    showAuthContainer();
    return false;
  }

  try {
    const response = await fetch('/api/auth/verify', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.ok) {
      const data = await response.json();
      currentUser = data.user;
      authToken = token;
      showRoomSelection();
      updateUserInfo();
      return true;
    } else {
      localStorage.removeItem('authToken');
      showAuthContainer();
      return false;
    }
  } catch (error) {
    console.error('Auth verification error:', error);
    localStorage.removeItem('authToken');
    showAuthContainer();
    return false;
  }
}

function showAuthContainer() {
  authContainer.style.display = 'block';
  roomSelectionContainer.style.display = 'none';
  videoChatContainer.style.display = 'none';
}

function showRoomSelection() {
  authContainer.style.display = 'none';
  roomSelectionContainer.style.display = 'block';
  videoChatContainer.style.display = 'none';
}

function updateUserInfo() {
  if (currentUser && userInfo && logoutButton) {
    userInfo.textContent = `Xin chào, ${currentUser.username}`;
    userInfo.style.display = 'inline-block';
    logoutButton.style.display = 'inline-block';
  }
}

function logout() {
  localStorage.removeItem('authToken');
  currentUser = null;
  authToken = null;
  
  // Close all peer connections
  peerConnections.forEach((pc, userId) => {
    closePeerConnection(userId);
  });
  peerConnections.clear();
  
  // Stop recording if active
  if (isRecording) {
    stopRecording();
  }
  
  // Stop local stream
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  
  if (roomId) {
    socket.emit('leave', roomId);
  }
  
  window.location.reload();
}

// ===== Auth Event Listeners =====
tabLogin?.addEventListener('click', () => {
  tabLogin.classList.add('active');
  tabRegister.classList.remove('active');
  loginForm.style.display = 'block';
  registerForm.style.display = 'none';
  loginError.textContent = '';
  registerError.textContent = '';
});

tabRegister?.addEventListener('click', () => {
  tabRegister.classList.add('active');
  tabLogin.classList.remove('active');
  registerForm.style.display = 'block';
  loginForm.style.display = 'none';
  loginError.textContent = '';
  registerError.textContent = '';
});

loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  if (!username || !password) {
    loginError.textContent = 'Vui lòng điền đầy đủ thông tin';
    return;
  }

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (response.ok) {
      localStorage.setItem('authToken', data.token);
      currentUser = data.user;
      authToken = data.token;
      showRoomSelection();
      updateUserInfo();
      loginForm.reset();
    } else {
      loginError.textContent = data.message || 'Đăng nhập thất bại';
    }
  } catch (error) {
    console.error('Login error:', error);
    loginError.textContent = 'Lỗi kết nối server';
  }
});

registerForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  registerError.textContent = '';
  
  const username = document.getElementById('register-username').value.trim();
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
  const confirmPassword = document.getElementById('register-confirm-password').value;

  if (!username || !email || !password || !confirmPassword) {
    registerError.textContent = 'Vui lòng điền đầy đủ thông tin';
    return;
  }

  if (password !== confirmPassword) {
    registerError.textContent = 'Mật khẩu xác nhận không khớp';
    return;
  }

  if (password.length < 6) {
    registerError.textContent = 'Mật khẩu phải có ít nhất 6 ký tự';
    return;
  }

  try {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });

    const data = await response.json();

    if (response.ok) {
      localStorage.setItem('authToken', data.token);
      currentUser = data.user;
      authToken = data.token;
      showRoomSelection();
      updateUserInfo();
      registerForm.reset();
    } else {
      registerError.textContent = data.message || 'Đăng ký thất bại';
    }
  } catch (error) {
    console.error('Register error:', error);
    registerError.textContent = 'Lỗi kết nối server';
  }
});

logoutButton?.addEventListener('click', logout);

// Kiểm tra auth khi trang load
checkAuth();

// ===== UI events =====
connectButton.addEventListener('click', () => {
  const id = roomInput.value.trim();
  if (!id) return alert('Please enter room id');
  joinRoom(id);
});

roomInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    connectButton.click();
  }
});

micBtn.addEventListener('click', () => {
  if (!localStream) return;
  const audio = localStream.getAudioTracks()[0];
  if (!audio) return;
  audio.enabled = !audio.enabled;
  micBtn.style.backgroundColor = audio.enabled ? '#333' : '#e53935';
  micBtn.innerHTML = `<i data-lucide="${audio.enabled ? 'mic' : 'mic-off'}"></i>`;
  lucide.createIcons();
});

camBtn.addEventListener('click', () => {
  if (!localStream) return;
  const video = localStream.getVideoTracks()[0];
  if (!video) return;
  video.enabled = !video.enabled;
  camBtn.style.backgroundColor = video.enabled ? '#333' : '#e53935';
  camBtn.innerHTML = `<i data-lucide="${video.enabled ? 'camera' : 'camera-off'}"></i>`;
  lucide.createIcons();
});

leaveBtn.addEventListener('click', () => {
  // Close all peer connections
  peerConnections.forEach((pc, userId) => {
    closePeerConnection(userId);
  });
  
  // Stop recording if active
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
  
  // Clear video elements
  localVideo.srcObject = null;
  
  // Reload page to reset state
  window.location.reload();
});

async function restoreCameraTrack(sender) {
  // Lấy lại track camera, nếu thiếu thì gọi lại getUserMedia video
  let camTrack = localStream?.getVideoTracks?.()[0];
  if (!camTrack || camTrack.readyState !== 'live') {
    try {
      console.log('[RestoreCamera] reacquiring camera');
      const newStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (localStream) {
        // Thay thế video track cũ trong localStream
        localStream.getVideoTracks().forEach(t => t.stop());
        newStream.getVideoTracks().forEach(t => localStream.addTrack(t));
      } else {
        localStream = newStream;
      }
      camTrack = localStream.getVideoTracks()[0];
    } catch (e) {
      console.error('[RestoreCamera] failed getUserMedia', e);
      return;
    }
  }
  try {
    await sender.replaceTrack(camTrack);
    localVideo.srcObject = localStream;
  } catch (e) {
    console.error('[RestoreCamera] replaceTrack error', e);
  }
}

shareScreenBtn.addEventListener('click', async () => {
  console.log('[Share] clicked');
  try {
    if (isScreenSharing) {
      console.log('[Share] Already sharing');
      return;
    }
    
    let screenStream;
    try {
      screenStream = await getScreenStreamWithPicker();
    } catch (e) {
      if (/User cancelled/i.test(e.message)) {
        console.log('[Share] user cancelled picker');
        return;
      }
      throw e;
    }
    
    const screenTrack = screenStream.getVideoTracks()[0];
    try { screenTrack.contentHint = 'detail'; } catch {}

    // Tạo video tile mới cho màn hình chia sẻ
    const tile = document.createElement('div');
    tile.className = 'video-tile screen-share-tile';
    tile.id = 'screen-share-tile';
    
    const labelEl = document.createElement('span');
    labelEl.className = 'video-label';
    labelEl.textContent = '🖥️ Màn hình của bạn';
    
    const video = document.createElement('video');
    video.id = 'screen-share-video';
    video.autoplay = true;
    video.playsinline = true;
    video.srcObject = screenStream;
    
    tile.appendChild(labelEl);
    tile.appendChild(video);
    videosContainer.appendChild(tile);
    screenShareVideoElement = video;
    
    console.log('[Share] Created screen share video tile');

    // Gửi screen track cho tất cả peers (thêm track mới, không replace)
    for (const [userId, pc] of peerConnections.entries()) {
      try {
        pc.addTrack(screenTrack, screenStream);
        console.log(`[Share] Added screen track for ${userId}`);
        
        // Tạo offer mới để renegotiate
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('webrtc_offer', { roomId, sdp: offer, targetId: userId });
        console.log(`[Share] Sent new offer with screen track to ${userId}`);
      } catch (e) {
        console.error(`[Share] Failed to add screen track for ${userId}:`, e);
      }
    }

    isScreenSharing = true;
    currentScreenTrack = screenTrack;
    
    // Hiển thị nút stop với màu đỏ
    stopShareBtn.style.display = 'inline-flex';
    stopShareBtn.style.backgroundColor = '#e53935';
    shareScreenBtn.style.display = 'none';
    lucide.createIcons();

    screenTrack.onended = () => {
      console.log('[Share] Track ended, removing screen share');
      removeScreenShare();
    };
  } catch (err) {
    console.error('Share screen error:', err);
    alert('Không thể chia sẻ màn hình: ' + (err.message || err.name || ''));
  }
});

function removeScreenShare() {
  console.log('[Share] Removing screen share tile');
  
  // Xóa video tile màn hình chia sẻ
  const tile = document.getElementById('screen-share-tile');
  if (tile) {
    tile.remove();
  }
  
  // Stop screen track
  if (currentScreenTrack) {
    currentScreenTrack.stop();
  }
  
  // Xóa screen track khỏi các peer connections và renegotiate
  if (currentScreenTrack) {
    peerConnections.forEach(async (pc, userId) => {
      const senders = pc.getSenders();
      for (const sender of senders) {
        if (sender.track === currentScreenTrack) {
          pc.removeTrack(sender);
          console.log(`[Share] Removed screen track from ${userId}`);
          
          // Tạo offer mới sau khi remove track
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('webrtc_offer', { roomId, sdp: offer, targetId: userId });
            console.log(`[Share] Sent offer after removing screen track to ${userId}`);
          } catch (e) {
            console.error(`[Share] Failed to renegotiate after remove for ${userId}:`, e);
          }
        }
      }
    });
  }
  
  // Reset state
  isScreenSharing = false;
  currentScreenTrack = null;
  screenShareVideoElement = null;
  stopShareBtn.style.display = 'none';
  stopShareBtn.style.backgroundColor = '#333';
  shareScreenBtn.style.display = 'inline-flex';
  lucide.createIcons();

  // Thông báo cho các peer rằng mình đã dừng chia sẻ
  if (roomId) {
    socket.emit('screen_share_stopped', { roomId });
  }
  
  console.log('[Share] Screen share removed, camera still active');
}

async function restoreCameraForAllPeers() {
  console.log('[RestoreCamera] Starting restore...');

  // Ưu tiên dùng originalCameraTrack
  let camTrack = (originalCameraTrack && originalCameraTrack.readyState === 'live')
    ? originalCameraTrack
    : null;

  // Nếu chưa có, thử lấy từ originalLocalStream
  if (!camTrack && originalLocalStream) {
    const t = originalLocalStream.getVideoTracks()[0];
    if (t && t.readyState === 'live') {
      camTrack = t;
      console.log('[RestoreCamera] Using video track from originalLocalStream');
    }
  }

  // Nếu vẫn chưa có, thử lấy từ localStream
  if (!camTrack && localStream) {
    const t = localStream.getVideoTracks()[0];
    if (t && t.readyState === 'live') {
      camTrack = t;
      console.log('[RestoreCamera] Using existing localStream video track');
    }
  }

  // Nếu vẫn không có -> xin lại camera
  if (!camTrack) {
    try {
      const newCam = await navigator.mediaDevices.getUserMedia({ video: true });
      camTrack = newCam.getVideoTracks()[0];
      console.log('[RestoreCamera] Acquired new camera track');
    } catch (e) {
      console.error('[RestoreCamera] Failed to acquire camera', e);
      alert('Không thể khôi phục camera. Vui lòng kiểm tra quyền truy cập.');
      return;
    }
  }

  // Replace video sender cho mọi peer
  const tasks = [];
  peerConnections.forEach((pc, userId) => {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) {
      tasks.push(sender.replaceTrack(camTrack).then(() => {
        console.log(`[RestoreCamera] Restored track for ${userId}`);
      }).catch(err => {
        console.error(`[RestoreCamera] Replace failed for ${userId}`, err);
      }));
    }
  });
  await Promise.all(tasks);

  // Khôi phục local video với stream gốc nếu có
  if (originalLocalStream) {
    localVideo.srcObject = originalLocalStream;
    console.log('[RestoreCamera] Local video set to originalLocalStream');
  } else if (localStream) {
    // Gộp audio + video hiện tại
    const audioTracks = localStream.getAudioTracks();
    const videoTracks = [camTrack];
    const combined = new MediaStream([...audioTracks, ...videoTracks]);
    localVideo.srcObject = combined;
    console.log('[RestoreCamera] Local video set to combined stream');
  } else {
    // Tạo stream mới chỉ với camTrack
    localVideo.srcObject = new MediaStream([camTrack]);
    console.log('[RestoreCamera] Local video set to camera-only stream');
  }
}

async function restoreCameraTrack(sender) {
  // Legacy function for compatibility
  await restoreCameraForAllPeers();
}

// Nút dừng chia sẻ màn hình thủ công
stopShareBtn.addEventListener('click', () => {
  if (!isScreenSharing) return;
  console.log('[StopShare] clicked');
  removeScreenShare();
});

// ===== Chat =====
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
}
function appendChatMessage(text, senderName, ts = Date.now(), isSelf = false) {
  const line = document.createElement('div');
  line.className = `msg ${isSelf ? 'me' : 'peer'}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = escapeHtml(text);

  // Chỉ hiển thị tên phía trên cho tin nhắn từ người khác
  if (!isSelf) {
    const senderLabel = document.createElement('div');
    senderLabel.className = 'msg-sender';
    senderLabel.textContent = senderName || 'Người khác';
    line.appendChild(senderLabel);
  }

  line.appendChild(bubble);
  chatMessages.appendChild(line);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}
function sendChat() {
  const text = (chatInput.value || '').trim();
  if (!text || !roomId) return;
  const payload = { roomId, text, ts: Date.now() };
  const myName = currentUser?.username || 'Tôi';
  appendChatMessage(text, myName, payload.ts, true);
  socket.emit('chat_message', payload);
  chatInput.value = '';
}
chatSend?.addEventListener('click', sendChat);
chatInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
});

// ===== Chat modal open/close =====
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
chatToggle?.addEventListener('click', openChat);
chatClose?.addEventListener('click', closeChat);
chatOverlay?.addEventListener('click', closeChat);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeChat(); });

// ===== Chat badge for unread =====
function updateChatBadge() {
  if (!chatToggle) return;
  // Tạo hoặc cập nhật badge hiển thị số tin nhắn mới
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

// ===== Reactions =====
function toggleReactionsPopover() {
  if (!reactionsPopover) return;
  const visible = reactionsPopover.style.display !== 'none';
  reactionsPopover.style.display = visible ? 'none' : 'flex';
}

function rateLimitReaction() {
  const now = Date.now();
  lastReactions = lastReactions.filter(t => now - t < 3000);
  if (lastReactions.length >= 5) return false; // max 5 per 3s
  lastReactions.push(now);
  return true;
}

function showReaction(emoji) {
  if (!reactionsLayer) return;
  const el = document.createElement('div');
  el.className = 'reaction-float';
  el.textContent = emoji;
  const left = 15 + Math.random() * 70; // 15%..85%
  el.style.left = left + '%';
  const rotate = (Math.random() * 20 - 10).toFixed(0);
  el.style.transform = `translateY(0) rotate(${rotate}deg)`;
  reactionsLayer.appendChild(el);
  const cleanup = () => { if (el.parentNode) el.parentNode.removeChild(el); };
  el.addEventListener('animationend', cleanup);
  setTimeout(cleanup, 2000);
}

function emitReaction(emoji) {
  if (!roomId) return;
  if (!rateLimitReaction()) return;
  showReaction(emoji);
  socket.emit('reaction', { roomId, emoji, ts: Date.now() });
}

reactionsBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleReactionsPopover();
});

reactionsPopover?.addEventListener('click', (e) => {
  const target = e.target;
  if (target && target.classList.contains('rxn')) {
    const emoji = target.textContent.trim();
    emitReaction(emoji);
    reactionsPopover.style.display = 'none';
  }
});

document.addEventListener('click', (e) => {
  if (!reactionsPopover || reactionsPopover.style.display === 'none') return;
  const within = reactionsPopover.contains(e.target) || reactionsBtn?.contains(e.target);
  if (!within) reactionsPopover.style.display = 'none';
});

// ===== Socket events for Group Call =====
socket.on('room_joined', async ({ users, roomSize }) => {
  console.log(`[Room] Joined. ${roomSize} users total. Existing users:`, users);
  await setLocalStream();
  
  if (!localStream) {
    console.error('[Room] Failed to get localStream, cannot proceed');
    alert('Không thể khởi tạo camera/micro. Vui lòng kiểm tra quyền truy cập.');
    return;
  }
  
  console.log(`[Room] LocalStream ready with ${localStream.getTracks().length} tracks:`, 
    localStream.getTracks().map(t => `${t.kind}:${t.enabled}`));
  
  // Save usernames
  if (users && Array.isArray(users)) {
    users.forEach(user => {
      if (user.socketId && user.username) {
        userNames.set(user.socketId, user.username);
      }
    });
  }
  
  // Create peer connections for all existing users
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
  // New user joined, they will send us an offer, we just wait
});

socket.on('user_left', ({ userId, roomSize }) => {
  console.log(`[Room] User ${userId} left. Remaining: ${roomSize}`);
  closePeerConnection(userId);
});

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
    
    // Kiểm tra xem còn screen track không
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
    
    // Kiểm tra xem còn screen track không
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

// Show incoming reactions
socket.on('reaction', ({ emoji }) => {
  if (typeof emoji === 'string' && emoji.length <= 4) {
    showReaction(emoji);
  }
});

// ===== Helper function to check and remove screen tile =====
function checkAndRemoveScreenTile(userId, pc) {
  // Kiểm tra xem peer connection còn nhận screen track không
  const receivers = pc.getReceivers();
  const videoReceivers = receivers.filter(r => r.track && r.track.kind === 'video');
  
  console.log(`[Check] ${userId} has ${videoReceivers.length} video receivers`);
  
  // Nếu chỉ còn 1 video track hoặc không có -> xóa screen tile
  if (videoReceivers.length <= 1) {
    const screenTileId = `screen-share-tile-${userId}`;
    const screenTile = document.getElementById(screenTileId);
    if (screenTile) {
      console.log(`[Check] Removing screen tile for ${userId} (no longer sharing)`);
      screenTile.remove();
      screenStreams.delete(userId);
    }
  }
}

// Nhận thông báo dừng chia sẻ màn hình từ peer
socket.on('screen_share_stopped', ({ userId }) => {
  const screenTileId = `screen-share-tile-${userId}`;
  const screenTile = document.getElementById(screenTileId);
  if (screenTile) {
    console.log(`[Remote] ${userId} stopped sharing, removing screen tile`);
    screenTile.remove();
  }
  // Xóa screen stream lưu trữ
  if (screenStreams.has(userId)) {
    screenStreams.delete(userId);
  }
});

// ===== Functions =====
// (giữ nguyên phần setLocalStream, createPeerConnection, forceRenegotiate,
//  pickDesktopSource, getScreenStreamWithPicker như bạn đã dán – mình không lặp lại nữa cho đỡ dài)
// Nhận tin nhắn chat từ người kia
let unreadCount = 0;
let isChatOpen = false;
socket.on('chat_message', ({ text, ts, from, username }) => {
  const senderName = username || userNames.get(from) || `User ${String(from).slice(0,6)}`;
  const isSelf = from === socket.id;
  appendChatMessage(text || '', isSelf ? (currentUser?.username || 'Tôi') : senderName, ts || Date.now(), isSelf);
  // Badge nếu chat đang đóng và tin nhắn không phải của mình
  if (!isChatOpen && !isSelf) {
    unreadCount += 1;
    updateChatBadge();
  }
});
function joinRoom(room) {
  console.log('[Join] request', room);
  roomId = room;
  try {
    // Gửi kèm thông tin user
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
  roomSelectionContainer.style.display = 'none';
  videoChatContainer.style.display = 'block';
  if (chatToggle) chatToggle.style.display = 'inline-flex';
  // ensure reactions popover hidden on enter
  if (reactionsPopover) reactionsPopover.style.display = 'none';
}

async function setLocalStream() {
  if (!navigator.mediaDevices) {
    alert('navigator.mediaDevices không tồn tại (context không an toàn?). Kiểm tra HTTPS server hoạt động.');
    return;
  }
  const errors = [];
  async function tryGet(constraints, label) {
    try {
      console.log('[getUserMedia attempt]', label, constraints);
      const s = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('[getUserMedia success]', label);
      return s;
    } catch (e) {
      console.warn('[getUserMedia failed]', label, e.name, e.message);
      errors.push(label + ': ' + e.name + ' - ' + e.message);
      return null;
    }
  }
  const attempts = [
    { label: 'high', c: { video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: true } },
    { label: 'medium', c: { video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } }, audio: true } },
    { label: 'low', c: { video: { width: 640, height: 480 }, audio: true } },
    { label: 'minimal', c: { video: true, audio: true } },
  ];
  for (const a of attempts) {
    const s = await tryGet(a.c, a.label);
    if (s) { localStream = s; break; }
  }
  if (!localStream) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videos = devices.filter(d => d.kind === 'videoinput');
      console.log('[enumerateDevices] videoinput count:', videos.length);
      for (const v of videos) {
        const s = await tryGet({ video: { deviceId: { exact: v.deviceId } }, audio: true }, 'device:' + (v.label || v.deviceId));
        if (s) { localStream = s; break; }
      }
    } catch (e) {
      console.warn('[enumerateDevices failed]', e);
      errors.push('enumerateDevices: ' + e.name + ' - ' + e.message);
    }
  }
  if (localStream) {
    localVideo.srcObject = localStream;
    return;
  }
  
  // Check if all errors are permission denied
  const isPermissionDenied = errors.every(e => e.includes('NotAllowedError') || e.includes('Permission denied'));
  
  if (isPermissionDenied) {
    alert(
      '🚫 QUYỀN TRUY CẬP BỊ TỪ CHỐI\n\n' +
      '❌ Trình duyệt đã chặn quyền Camera/Microphone.\n\n' +
      '📱 CÁCH SỬA:\n\n' +
      '1️⃣ Trên thanh địa chỉ, tìm icon 🔒 hoặc ⓘ\n' +
      '2️⃣ Nhấn vào icon → Cài đặt trang web\n' +
      '3️⃣ Đặt Camera và Microphone thành "Cho phép"\n' +
      '4️⃣ Làm mới trang (F5) và thử lại\n\n' +
      '💡 Trên Android/iOS:\n' +
      '• Vào Settings → Apps → Browser → Permissions\n' +
      '• Bật Camera và Microphone\n\n' +
      '⚠️ Lưu ý:\n' +
      '• Phải dùng HTTPS (https://...)\n' +
      '• Một số trình duyệt mobile cần cài đặt riêng\n\n' +
      'Nếu vẫn lỗi, thử trình duyệt Chrome hoặc Edge.'
    );
  } else {
    alert([
      '❌ Không thể truy cập camera/micro.\n',
      '📋 Chi tiết lỗi:',
      ...errors.slice(0, 4),
      '',
      '💡 Hãy thử:',
      '• Đóng các app đang dùng camera (Zoom, Teams...)',
      '• Kiểm tra camera/micro có hoạt động không',
      '• Thử trình duyệt khác',
    ].join('\n'));
  }
}

// Legacy functions removed - using new group call functions above


async function pickDesktopSource() {
  if (!hasElectronDesktop) throw new Error('desktopCapturer bridge missing');
  const sources = await window.electronAPI.getDesktopSources({ types: ['screen','window'], thumbnailSize: { width: 400, height: 250 } });
  if (!sources.length) throw new Error('No desktop sources');
  return new Promise((resolve, reject) => {
    const overlay = document.createElement('div');
    overlay.className = 'picker-overlay';
    overlay.innerHTML = '<div class="picker-modal"><h3>Chọn màn hình/cửa sổ</h3><div class="picker-grid"></div><div class="picker-actions"><button class="picker-cancel">Hủy</button></div></div>';
    const grid = overlay.querySelector('.picker-grid');
    sources.forEach(src => { const btn = document.createElement('button'); btn.className='picker-item'; btn.title=src.name; btn.innerHTML = `<img src="${src.thumbnail || ''}" /><div class="picker-label">${src.name}</div>`; btn.onclick=()=>{ document.body.removeChild(overlay); resolve(src); }; grid.appendChild(btn); });
    overlay.querySelector('.picker-cancel').onclick = () => { document.body.removeChild(overlay); reject(new Error('User cancelled')); };
    document.body.appendChild(overlay);
    console.log('[Picker] overlay appended, sources count =', sources.length);
  });
}

async function getScreenStreamWithPicker() {
  if (hasElectronDesktop) {
    const src = await pickDesktopSource();
    const stream = await navigator.mediaDevices.getUserMedia({ audio:false, video:{ mandatory:{ chromeMediaSource:'desktop', chromeMediaSourceId: src.id, maxWidth:1920, maxHeight:1080, maxFrameRate:30 } } });
    console.log('[Share] desktopCapturer OK', src.name); return stream;
  }
  if (!window.isSecureContext) throw new Error('Screen sharing cần HTTPS');
  console.log('[Share] using browser getDisplayMedia fallback');
  if (!navigator.mediaDevices.getDisplayMedia) throw new Error('Trình duyệt không hỗ trợ getDisplayMedia');
  const stream = await navigator.mediaDevices.getDisplayMedia({ video:{ cursor:'always', frameRate:30 }, audio:false });
  console.log('[Share] getDisplayMedia OK'); return stream;
}

// ===== GROUP CALL FUNCTIONS =====
function createVideoTile(userId, stream, label) {
  const tile = document.createElement('div');
  tile.className = 'video-tile';
  tile.id = `video-tile-${userId}`;
  
  const labelEl = document.createElement('span');
  labelEl.className = 'video-label';
  labelEl.textContent = label || `User ${userId.slice(0, 6)}`;
  
  const video = document.createElement('video');
  video.id = `video-${userId}`;
  video.autoplay = true;
  video.playsinline = true;
  video.srcObject = stream;
  
  tile.appendChild(labelEl);
  tile.appendChild(video);
  videosContainer.appendChild(tile);
  videoElements.set(userId, video);
  
  console.log(`[Video] Created tile for ${userId}`);
  lucide.createIcons();
  return video;
}

function removeVideoTile(userId) {
  const tile = document.getElementById(`video-tile-${userId}`);
  if (tile) {
    tile.remove();
    videoElements.delete(userId);
    console.log(`[Video] Removed tile for ${userId}`);
  }
}

function createPeerConnection(userId) {
  const pc = new RTCPeerConnection(pcConfig);
  
  // Add local stream tracks
  if (localStream) {
    localStream.getTracks().forEach(track => {
      const sender = pc.addTrack(track, localStream);
      console.log(`[Track] Added ${track.kind} track to peer ${userId}`);
    });
  } else {
    console.warn(`[Track] No localStream when creating peer connection for ${userId}`);
  }
  
  // Handle incoming tracks
  pc.ontrack = (event) => {
    console.log(`[Track] Received ${event.track.kind} from ${userId}, track.id: ${event.track.id}`);
    const track = event.track;
    
    // Phân biệt camera track và screen track bằng track label hoặc stream
    // Nếu là video track và đã có camera stream -> đây là screen track
    const isScreenTrack = track.kind === 'video' && remoteStreams.has(userId) && 
                          remoteStreams.get(userId).getVideoTracks().length > 0;
    
    if (isScreenTrack) {
      console.log(`[Track] This is a screen share track from ${userId}`);
      
      // Tạo hoặc cập nhật screen stream
      let screenStream = screenStreams.get(userId);
      if (!screenStream) {
        screenStream = new MediaStream();
        screenStreams.set(userId, screenStream);
      }
      screenStream.addTrack(track);
      
      // Tạo screen share tile
      const screenTileId = `screen-share-tile-${userId}`;
      let screenTile = document.getElementById(screenTileId);
      
      if (!screenTile) {
        const tile = document.createElement('div');
        tile.className = 'video-tile screen-share-tile';
        tile.id = screenTileId;
        
        const labelEl = document.createElement('span');
        labelEl.className = 'video-label';
        const username = userNames.get(userId) || `User ${userId.slice(0, 6)}`;
        labelEl.textContent = `🖥️ ${username} - Màn hình`;
        
        const video = document.createElement('video');
        video.id = `screen-video-${userId}`;
        video.autoplay = true;
        video.playsinline = true;
        video.srcObject = screenStream;
        
        tile.appendChild(labelEl);
        tile.appendChild(video);
        videosContainer.appendChild(tile);
        
        console.log(`[Track] Created screen share tile for ${userId}`);
        lucide.createIcons();
      } else {
        // Cập nhật video nếu tile đã tồn tại
        const video = document.getElementById(`screen-video-${userId}`);
        if (video) {
          video.srcObject = screenStream;
        }
      }
      
      // Lắng nghe khi screen track kết thúc
      track.onended = () => {
        console.log(`[Track] Screen track ended from ${userId}`);
        const tile = document.getElementById(screenTileId);
        if (tile) {
          tile.remove();
        }
        screenStreams.delete(userId);
      };
      
      return; // Không xử lý thêm cho screen track
    }
    
    // Xử lý camera/audio tracks (bình thường)
    let stream = remoteStreams.get(userId);
    if (!stream) {
      stream = new MediaStream();
      remoteStreams.set(userId, stream);
      console.log(`[Track] Created new camera stream for ${userId}`);
    }
    
    stream.addTrack(track);
    console.log(`[Track] Camera stream for ${userId} now has ${stream.getTracks().length} tracks`);
    
    // Tạo hoặc cập nhật camera tile
    let video = videoElements.get(userId);
    if (!video) {
      const username = userNames.get(userId) || `User ${userId.slice(0, 6)}`;
      video = createVideoTile(userId, stream, username);
    } else {
      // Cập nhật srcObject nếu cần
      if (video.srcObject !== stream) {
        video.srcObject = stream;
      }
    }
  };
  
  // Handle ICE candidates
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      socket.emit('webrtc_ice_candidate', { roomId, candidate, targetId: userId });
    }
  };
  
  // Connection state monitoring
  pc.oniceconnectionstatechange = () => {
    console.log(`[ICE ${userId}]`, pc.iceConnectionState);
    if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
      console.warn(`[Peer ${userId}] Connection lost`);
    }
  };
  
  pc.onconnectionstatechange = () => {
    console.log(`[PC ${userId}]`, pc.connectionState);
  };
  
  peerConnections.set(userId, pc);
  return pc;
}

function closePeerConnection(userId) {
  const pc = peerConnections.get(userId);
  if (pc) {
    pc.close();
    peerConnections.delete(userId);
  }
  
  // Clean camera stream
  const stream = remoteStreams.get(userId);
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    remoteStreams.delete(userId);
  }
  
  // Clean screen stream
  const screenStream = screenStreams.get(userId);
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStreams.delete(userId);
  }
  
  // Remove camera tile
  removeVideoTile(userId);
  
  // Remove screen share tile
  const screenTile = document.getElementById(`screen-share-tile-${userId}`);
  if (screenTile) {
    screenTile.remove();
  }
  
  console.log(`[Peer ${userId}] Closed and cleaned up`);
}

// ===== RECORDING FUNCTIONS =====
function startRecording() {
  if (isRecording) return;
  
  try {
    // Combine local stream with audio
    const tracks = [];
    if (localStream) {
      localStream.getTracks().forEach(track => tracks.push(track));
    }
    
    const recordStream = new MediaStream(tracks);
    
    // Create MediaRecorder
    const options = { mimeType: 'video/webm;codecs=vp9,opus' };
    
    // Fallback for different browsers
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options.mimeType = 'video/webm;codecs=vp8,opus';
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'video/webm';
      }
    }
    
    mediaRecorder = new MediaRecorder(recordStream, options);
    recordedChunks = [];
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };
    
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      
      // Download automatically
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `recording-${Date.now()}.webm`;
      document.body.appendChild(a);
      a.click();
      
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
      
      console.log('[Recording] Saved');
    };
    
    mediaRecorder.start(1000); // Collect data every second
    isRecording = true;
    
    // Update UI
    recordBtn.style.display = 'none';
    stopRecordBtn.style.display = 'inline-flex';
    recordBtn.classList.add('recording');
    
    // Add recording indicator
    const localTile = document.getElementById('local-tile');
    if (localTile && !localTile.querySelector('.recording-indicator')) {
      const indicator = document.createElement('div');
      indicator.className = 'recording-indicator';
      indicator.textContent = 'REC';
      localTile.appendChild(indicator);
    }
    
    lucide.createIcons();
    console.log('[Recording] Started');
  } catch (error) {
    console.error('[Recording] Start error:', error);
    alert('Không thể bắt đầu ghi: ' + error.message);
  }
}

function stopRecording() {
  if (!isRecording || !mediaRecorder) return;
  
  mediaRecorder.stop();
  isRecording = false;
  
  // Update UI
  recordBtn.style.display = 'inline-flex';
  stopRecordBtn.style.display = 'none';
  recordBtn.classList.remove('recording');
  
  // Remove recording indicator
  const indicator = document.querySelector('.recording-indicator');
  if (indicator) {
    indicator.remove();
  }
  
  lucide.createIcons();
  console.log('[Recording] Stopped');
}

// Recording button events
recordBtn?.addEventListener('click', startRecording);
stopRecordBtn?.addEventListener('click', stopRecording);

} // End of initApp function

// Initialize the app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
