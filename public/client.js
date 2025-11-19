// public/client.js

// ===== DOM =====
const roomSelectionContainer = document.getElementById('room-selection-container');
const roomInput = document.getElementById('room-input');
const connectButton = document.getElementById('connect-button');

const videoChatContainer = document.getElementById('video-chat-container');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');

const micBtn = document.getElementById('mic-button');
const camBtn = document.getElementById('cam-button');
const leaveBtn = document.getElementById('leave-button');
const shareScreenBtn = document.getElementById('share-screen-button');

// ===== Socket.IO =====
const socket = io();

// Kiểm tra xem Electron preload có expose desktopCapturer không
const hasElectronDesktop = Boolean(window.electronAPI?.desktopCapturerAvailable);

console.log('[DEBUG] hasElectronDesktop =', hasElectronDesktop);
console.log('[DEBUG] window.electronAPI =', window.electronAPI);

// ===== State =====
let localStream;
let remoteStream;
let peerConnection;
let roomId;
let isRoomCreator = false;
let pendingCandidates = [];
let makingOffer = false;

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

// ===== UI events =====
connectButton.addEventListener('click', () => {
  const id = roomInput.value.trim();
  if (!id) return alert('Please enter room id');
  joinRoom(id);
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
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  socket.emit('leave', roomId);
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  window.location.reload();
});

shareScreenBtn.addEventListener('click', async () => {
  console.log('[Share] clicked');
  try {
    if (!peerConnection) {
      console.error('PeerConnection not initialized');
      return;
    }

    const screenStream = await getScreenStreamWithPicker();
    const screenTrack = screenStream.getVideoTracks()[0];
    try { screenTrack.contentHint = 'detail'; } catch {}

    // Tìm sender video hiện tại
    let sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
    if (!sender) {
      const trx = peerConnection.addTransceiver('video', { direction: 'sendrecv' });
      sender = trx.sender;
      console.log('[Share] created new video transceiver');
    }

    await sender.replaceTrack(screenTrack);
    localVideo.srcObject = screenStream;
    console.log('[Share] replaced camera with screen');

    // Nếu onnegotiationneeded không bắn, mình ép renegotiate
    setTimeout(() => {
      if (peerConnection && peerConnection.signalingState === 'stable') {
        console.log('[Share] forcing renegotiate after screen share');
        forceRenegotiate();
      }
    }, 600);

    screenTrack.onended = async () => {
      console.log('[Share] ended, restoring camera');
      const camTrack = localStream?.getVideoTracks?.()[0];
      if (!camTrack) return;
      await sender.replaceTrack(camTrack);
      localVideo.srcObject = localStream;
      forceRenegotiate();
    };
  } catch (err) {
    console.error('Share screen error:', err);
    alert(
      'Không thể chia sẻ màn hình.\n' +
      '- Nếu dùng Electron: kiểm tra preload.js & quyền display-capture.\n' +
      '- Nếu dùng trình duyệt: cần chạy trên HTTPS.\n\n' +
      (err.message || err.name || '')
    );
  }
});

// ===== Socket events =====
socket.on('room_created', async () => {
  console.log('Room created');
  isRoomCreator = true;
  await setLocalStream();
});

socket.on('room_joined', async () => {
  console.log('Room joined');
  await setLocalStream();
  socket.emit('start_call', roomId);
});

socket.on('full_room', () => alert('The room is full, try another id'));

socket.on('start_call', async () => {
  console.log('Start call');
  if (isRoomCreator) {
    createPeerConnection();
    await createOffer();
  }
});

socket.on('webrtc_offer', async (sdp) => {
  console.log('Got offer');
  try {
    if (!peerConnection) createPeerConnection();

    const offerCollision = makingOffer || peerConnection.signalingState !== 'stable';
    const polite = !isRoomCreator; // room creator = impolite, joiner = polite

    if (offerCollision) {
      console.warn('[Offer] collision, polite =', polite);
      if (!polite) {
        console.warn('[Offer] ignoring (impolite side)');
        return;
      }
      // polite side rollback
      await Promise.all([
        peerConnection.setLocalDescription({ type: 'rollback' }),
        peerConnection.setRemoteDescription(new RTCSessionDescription(sdp)),
      ]);
    } else {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    }

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('webrtc_answer', { roomId, sdp: answer });

    if (pendingCandidates.length) {
      console.log('Applying', pendingCandidates.length, 'pending ICE (after offer set)');
      for (const c of pendingCandidates) {
        try { await peerConnection.addIceCandidate(new RTCIceCandidate(c)); }
        catch (e) { console.error('Add pending ICE failed', e); }
      }
      pendingCandidates = [];
    }
  } catch (err) {
    console.error('Offer handling error', err);
  }
});

socket.on('webrtc_answer', async (sdp) => {
  console.log('Got answer');
  try {
    if (!peerConnection) createPeerConnection();
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));

    if (pendingCandidates.length) {
      console.log('Applying', pendingCandidates.length, 'pending ICE (after answer set)');
      for (const c of pendingCandidates) {
        try { await peerConnection.addIceCandidate(new RTCIceCandidate(c)); }
        catch (e) { console.error('Add pending ICE failed', e); }
      }
      pendingCandidates = [];
    }
  } catch (err) {
    console.error('Answer handling error', err);
  }
});

socket.on('webrtc_ice_candidate', async ({ candidate }) => {
  try {
    if (peerConnection?.remoteDescription?.type) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      console.log('ICE candidate added');
    } else {
      pendingCandidates.push(candidate);
      console.log('ICE queued (no remoteDescription yet)');
    }
  } catch (err) {
    console.error('Error adding ICE', err);
  }
});

socket.on('peer_left', () => {
  console.log('Peer left');
  if (remoteStream) {
    remoteStream.getTracks().forEach(t => t.stop());
    remoteStream = null;
  }
  remoteVideo.srcObject = null;
});

// ===== Functions =====
function joinRoom(room) {
  roomId = room;
  socket.emit('join', room);
  roomSelectionContainer.style.display = 'none';
  videoChatContainer.style.display = 'block';
}

async function setLocalStream() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: true,
    });
    localVideo.srcObject = localStream;
  } catch (err) {
    console.warn('getUserMedia high constraints failed:', err);
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } },
        audio: true,
      });
      localVideo.srcObject = localStream;
    } catch (err2) {
      console.error('getUserMedia fallback failed:', err2);
      alert('Không thể truy cập camera/micro. Hãy đóng các app dùng camera (Zoom/Teams/Discord/Chrome), bật quyền Camera trong Windows Settings và thử lại.');
    }
  }
}

function createPeerConnection() {
  peerConnection = new RTCPeerConnection(pcConfig);

  // add local tracks
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

  // renegotiation (screen share vv.)
  peerConnection.onnegotiationneeded = async () => {
    if (!peerConnection) return;
    try {
      makingOffer = true;
      console.log('[negotiationneeded] createOffer');
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.emit('webrtc_offer', { roomId, sdp: offer });
      console.log('[negotiationneeded] offer sent');
    } catch (e) {
      console.error('[negotiationneeded] failed:', e);
    } finally {
      makingOffer = false;
    }
  };

  // remote stream
  peerConnection.ontrack = (ev) => {
    console.log('ontrack', ev.streams?.[0]);
    remoteStream = ev.streams[0];
    remoteVideo.srcObject = remoteStream;
  };

  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('webrtc_ice_candidate', { roomId, candidate });
  };

  peerConnection.oniceconnectionstatechange = () => console.log('[ICE]', peerConnection.iceConnectionState);
  peerConnection.onconnectionstatechange = () => console.log('[PC]', peerConnection.connectionState);
  peerConnection.onicegatheringstatechange = () => console.log('[ICE gathering]', peerConnection.iceGatheringState);
}

async function createOffer() {
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  socket.emit('webrtc_offer', { roomId, sdp: offer });
}

function forceRenegotiate() {
  if (!peerConnection) return;
  if (peerConnection.signalingState !== 'stable') {
    console.log('[forceRenegotiate] signaling not stable, skip');
    return;
  }
  makingOffer = true;
  peerConnection.createOffer()
    .then(offer => peerConnection.setLocalDescription(offer))
    .then(() => {
      socket.emit('webrtc_offer', { roomId, sdp: peerConnection.localDescription });
      console.log('[forceRenegotiate] offer sent');
    })
    .catch(e => console.error('[forceRenegotiate] failed', e))
    .finally(() => { makingOffer = false; });
}

// ===== Screen share helpers (Electron + Browser) =====

async function pickDesktopSource() {
  if (!hasElectronDesktop) {
    throw new Error('desktopCapturer bridge is missing (check preload.js)');
  }

  const sources = await window.electronAPI.getDesktopSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 400, height: 250 },
  });
  if (!sources.length) throw new Error('No desktop sources found');

  return new Promise((resolve, reject) => {
    const overlay = document.createElement('div');
    overlay.className = 'picker-overlay';
    overlay.innerHTML = `
      <div class="picker-modal">
        <h3>Chọn màn hình/cửa sổ để chia sẻ</h3>
        <div class="picker-grid"></div>
        <div class="picker-actions">
          <button class="picker-cancel">Hủy</button>
        </div>
      </div>
    `;

    const grid = overlay.querySelector('.picker-grid');
    sources.forEach((src) => {
      const btn = document.createElement('button');
      btn.className = 'picker-item';
      btn.title = src.name;
      btn.innerHTML = `
        <img src="${src.thumbnail || ''}" alt="${src.name}" />
        <div class="picker-label">${src.name}</div>
      `;
      btn.onclick = () => { document.body.removeChild(overlay); resolve(src); };
      grid.appendChild(btn);
    });

    overlay.querySelector('.picker-cancel').onclick = () => {
      document.body.removeChild(overlay);
      reject(new Error('User cancelled'));
    };

    document.body.appendChild(overlay);
  });
}

async function getScreenStreamWithPicker() {
  // Ưu tiên Electron (desktopCapturer)
  if (hasElectronDesktop) {
    const src = await pickDesktopSource();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: src.id,
          maxWidth: 1920,
          maxHeight: 1080,
          maxFrameRate: 30,
        },
      },
    });
    console.log('[Share] desktopCapturer OK:', src.name);
    return stream;
  }

  // Fallback: trình duyệt (phải HTTPS)
  if (!window.isSecureContext) {
    throw new Error('Screen sharing cần HTTPS hoặc Electron. Hiện tại trang không chạy trên HTTPS.');
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Trình duyệt không hỗ trợ getDisplayMedia');
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { cursor: 'always', frameRate: 30 },
    audio: false,
  });
  console.log('[Share] getDisplayMedia OK');
  return stream;
}
