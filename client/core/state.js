// state.js - Global state & DOM elements management

// ===== SOCKET.IO CONNECTION =====
const socket = io();

// ===== ELECTRON DETECTION =====
const hasElectronDesktop = Boolean(window.electronAPI?.desktopCapturerAvailable);

// ===== AUTH STATE =====
let currentUser = null;  // {id, username, email}
let authToken = null;

// ===== WEBRTC STATE =====
let localStream = null;
let roomId = null;
let isScreenSharing = false;
let currentScreenTrack = null;
let screenShareVideoElement = null;
let lastReactions = [];

// ===== GROUP CALL STATE =====
const peerConnections = new Map();
const remoteStreams = new Map();
const screenStreams = new Map();
const videoElements = new Map();
const userNames = new Map();
const pendingIceCandidates = new Map(); // ← THÊM: Queue ICE candidates

// ===== CHAT STATE =====
let chatMode = 'all'; // 'all' | 'private' | 'group'
const joinedGroups = new Set();
let unreadCount = 0;
let isChatOpen = false;

// ===== RECORDING STATE =====
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

// ===== ICE/STUN CONFIG =====
const pcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
  // TỐI ƯU: ICE gathering nhanh hơn
  iceTransportPolicy: 'all', // Cho phép tất cả candidates (relay, srflx, host)
  iceCandidatePoolSize: 10,  // Pre-gather candidates trước khi createOffer
  bundlePolicy: 'max-bundle', // Gộp tất cả media vào 1 connection
  rtcpMuxPolicy: 'require',   // Gộp RTP và RTCP
};

// ===== DOM ELEMENTS =====
// Auth elements
let authContainer, loginForm, registerForm, tabLogin, tabRegister;
let loginError, registerError, userInfo, logoutButton;

// Room selection
let roomSelectionContainer, roomInput, connectButton;

// Video elements
let videoChatContainer, videosContainer, localVideo;

// Controls
let micBtn, camBtn, leaveBtn, shareScreenBtn, stopShareBtn;
let recordBtn, stopRecordBtn;
let chatMessages, chatInput, chatSend, chatToggle, chatModal;
let chatOverlay, chatClose;
let reactionsBtn, reactionsPopover, reactionsLayer;

// Chat mode
let chatModeTabs, privateSelector, groupSelector;
let privateTarget, groupTarget;
let groupManageBtn, groupManagePanel, groupManageClose;
let groupNameInput, groupCreateBtn, groupAddUser, groupAddBtn;
let joinedGroupsList;

// ===== Initialize DOM References =====
async function initDOMElements() {
  // Wait for partials to load
  if (window.__includesReady) {
    await window.__includesReady;
  }

  // Auth
  authContainer = document.getElementById('auth-container');
  loginForm = document.getElementById('login-form');
  registerForm = document.getElementById('register-form');
  tabLogin = document.getElementById('tab-login');
  tabRegister = document.getElementById('tab-register');
  loginError = document.getElementById('login-error');
  registerError = document.getElementById('register-error');
  userInfo = document.getElementById('user-info');
  logoutButton = document.getElementById('logout-button');

  // Room selection
  roomSelectionContainer = document.getElementById('room-selection-container');
  roomInput = document.getElementById('room-input');
  connectButton = document.getElementById('connect-button');

  // Video
  videoChatContainer = document.getElementById('video-chat-container');
  videosContainer = document.getElementById('videos-container');
  localVideo = document.getElementById('local-video');

  // Controls
  micBtn = document.getElementById('mic-button');
  camBtn = document.getElementById('cam-button');
  leaveBtn = document.getElementById('leave-button');
  shareScreenBtn = document.getElementById('share-screen-button');
  stopShareBtn = document.getElementById('stop-share-button');
  recordBtn = document.getElementById('record-button');
  stopRecordBtn = document.getElementById('stop-record-button');

  // Chat
  chatMessages = document.getElementById('chat-messages');
  chatInput = document.getElementById('chat-input');
  chatSend = document.getElementById('chat-send');
  chatToggle = document.getElementById('chat-toggle');
  chatModal = document.getElementById('chat-modal');
  chatOverlay = document.getElementById('chat-overlay');
  chatClose = document.getElementById('chat-close');
  reactionsBtn = document.getElementById('reactions-button');
  reactionsPopover = document.getElementById('reactions-popover');
  reactionsLayer = document.getElementById('reactions-layer');

  // Chat mode
  chatModeTabs = document.querySelectorAll('.chat-mode-tab');
  privateSelector = document.getElementById('private-selector');
  groupSelector = document.getElementById('group-selector');
  privateTarget = document.getElementById('private-target');
  groupTarget = document.getElementById('group-target');
  groupManageBtn = document.getElementById('group-manage-btn');
  groupManagePanel = document.getElementById('group-manage-panel');
  groupManageClose = document.getElementById('group-manage-close');
  groupNameInput = document.getElementById('group-name-input');
  groupCreateBtn = document.getElementById('group-create-btn');
  groupAddUser = document.getElementById('group-add-user');
  groupAddBtn = document.getElementById('group-add-btn');
  joinedGroupsList = document.getElementById('joined-groups-list');

  console.log('[State] DOM elements initialized');
}

// ===== UI Visibility Functions =====
function showAuthContainer() {
  authContainer.style.display = 'block';
  roomSelectionContainer.style.display = 'none';
  videoChatContainer.style.display = 'none';
  
  // Show header
  const header = document.querySelector('.app-header');
  if (header) header.style.display = 'flex';
}

function showRoomSelection() {
  authContainer.style.display = 'none';
  roomSelectionContainer.style.display = 'block';
  videoChatContainer.style.display = 'none';
  
  // Show header
  const header = document.querySelector('.app-header');
  if (header) header.style.display = 'flex';
}

function showVideoChat() {
  authContainer.style.display = 'none';
  roomSelectionContainer.style.display = 'none';
  videoChatContainer.style.display = 'block';
  
  // Hide header for fullscreen video experience
  const header = document.querySelector('.app-header');
  if (header) header.style.display = 'none';
  
  // Show app-shell as fullscreen
  const appShell = document.querySelector('.app-shell');
  if (appShell) {
    appShell.style.padding = '0';
    appShell.style.gap = '0';
  }
  
  if (chatToggle) chatToggle.style.display = 'inline-flex';
  if (reactionsPopover) reactionsPopover.style.display = 'none';
  
  // Show participant counter
  updateParticipantCount();
}

// Update participant count badge
function updateParticipantCount() {
  const participantCountEl = document.getElementById('participant-count');
  const participantCountText = document.getElementById('participant-count-text');
  
  if (!participantCountEl || !participantCountText) return;
  
  // Count: 1 (you) + remote peers
  const totalCount = 1 + peerConnections.size;
  
  participantCountText.textContent = totalCount === 1 
    ? '1 người' 
    : `${totalCount} người`;
  
  // Show badge if in video call
  if (videoChatContainer && videoChatContainer.style.display !== 'none') {
    participantCountEl.style.display = 'flex';
  }
}
