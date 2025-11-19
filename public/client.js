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
// (giữ nguyên phần setLocalStream, createPeerConnection, forceRenegotiate,
//  pickDesktopSource, getScreenStreamWithPicker như bạn đã dán – mình không lặp lại nữa cho đỡ dài)
