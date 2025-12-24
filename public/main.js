// main.js - App Entry Point & Initialization

import * as State from './state.js';
import * as Auth from './auth.js';
import * as Media from './media.js';
import * as ScreenShare from './screen-share.js';
import * as Chat from './chat.js';
import * as Reactions from './reactions.js';
import * as Recording from './recording.js';
import { setupSocketHandlers } from './socket-handlers.js';

// ===== Initialize App =====
async function initApp() {
  // Chờ HTML partials load xong
  if (window.__includesReady) {
    await window.__includesReady;
  }

  // Initialize DOM references
  Auth.initAuthDOM();
  Chat.initChatDOM();
  Reactions.initReactionsDOM();
  Recording.initRecordingDOM();

  // Setup room selection
  const roomInput = document.getElementById('room-input');
  const connectButton = document.getElementById('connect-button');

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

  // Setup media controls
  const micBtn = document.getElementById('mic-button');
  const camBtn = document.getElementById('cam-button');
  const leaveBtn = document.getElementById('leave-button');
  const shareScreenBtn = document.getElementById('share-screen-button');
  const stopShareBtn = document.getElementById('stop-share-button');

  micBtn?.addEventListener('click', Media.toggleMicrophone);
  camBtn?.addEventListener('click', Media.toggleCamera);
  leaveBtn?.addEventListener('click', handleLeaveRoom);
  shareScreenBtn?.addEventListener('click', ScreenShare.startScreenShare);
  stopShareBtn?.addEventListener('click', ScreenShare.removeScreenShare);

  // Setup Socket.IO
  window.socket = io();
  setupSocketHandlers(window.socket);

  // Check auth status
  await Auth.checkAuth();
}

function joinRoom(room) {
  console.log('[Join] request', room);
  State.setRoomId(room);

  try {
    const userInfo = {
      roomId: room,
      username: State.currentUser ? State.currentUser.username : 'Anonymous',
      userId: State.currentUser ? State.currentUser._id : null
    };
    window.socket.emit('join', userInfo);
  } catch (e) {
    console.error('[Join] emit failed', e);
    alert('Không thể gửi join: ' + (e.message || e));
    return;
  }

  // Switch to video chat view
  const roomSelectionContainer = document.getElementById('room-selection-container');
  const videoChatContainer = document.getElementById('video-chat-container');
  const chatToggle = document.getElementById('chat-toggle');
  const reactionsPopover = document.getElementById('reactions-popover');

  roomSelectionContainer.style.display = 'none';
  videoChatContainer.style.display = 'block';
  if (chatToggle) chatToggle.style.display = 'inline-flex';
  if (reactionsPopover) reactionsPopover.style.display = 'none';
}

async function handleLeaveRoom() {
  // Close all peer connections
  State.peerConnections.forEach((pc, userId) => {
    const { closePeerConnection } = require('./webrtc.js');
    closePeerConnection(userId);
  });

  // Stop recording if active
  if (State.isRecording) {
    Recording.stopRecording();
  }

  // Stop local stream
  if (State.localStream) {
    State.localStream.getTracks().forEach(t => t.stop());
    State.setLocalStream(null);
  }

  // Notify server
  window.socket.emit('leave', State.roomId);

  // Clear video elements
  const localVideo = document.getElementById('local-video');
  localVideo.srcObject = null;

  // Reload page
  window.location.reload();
}

// ===== Initialize when DOM is ready =====
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
