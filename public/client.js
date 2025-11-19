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
// Khi trang được phục vụ bởi server (https://<IP>:3000), dùng cùng origin là chắc chắn nhất:
const socket = io();

// ===== State =====
let localStream;
let remoteStream;
let peerConnection;
let roomId;
let isRoomCreator = false;
let pendingCandidates = [];

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
  if (!roomInput.value) return alert('Please enter room id');
  joinRoom(roomInput.value.trim());
});

micBtn.addEventListener('click', () => {
  if (!localStream) return;
  const audio = localStream.getAudioTracks()[0];
  if (audio) {
    audio.enabled = !audio.enabled;
    micBtn.style.backgroundColor = audio.enabled ? '#333' : '#e53935';
    micBtn.innerHTML = `<i data-lucide="${audio.enabled ? 'mic' : 'mic-off'}"></i>`;
    lucide.createIcons();
  }
});

camBtn.addEventListener('click', () => {
  if (!localStream) return;
  const video = localStream.getVideoTracks()[0];
  if (video) {
    video.enabled = !video.enabled;
    camBtn.style.backgroundColor = video.enabled ? '#333' : '#e53935';
    camBtn.innerHTML = `<i data-lucide="${video.enabled ? 'camera' : 'camera-off'}"></i>`;
    lucide.createIcons();
  }
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

shareScreenBtn.addEventListener("click", async () => {
  console.log("Share Screen button clicked");
  try {
    if (!peerConnection) {
      console.error("PeerConnection is not initialized");
      return;
    }

    // Lấy màn hình
    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always' }  // tùy chọn, hiển thị con trỏ
      // audio: true // nếu muốn chia sẻ audio hệ thống (tùy OS & Chromium)
    });
    const screenTrack = screenStream.getVideoTracks()[0];
    if (!screenTrack) {
      console.error("No screen video track");
      return;
    }

    // Gợi ý cho encoder: màn hình là detail (giúp nét text)
    try { screenTrack.contentHint = 'detail'; } catch {}

    // Tìm sender video hiện có
    let sender = peerConnection.getSenders().find(s => s.track && s.track.kind === "video");

    if (sender) {
      console.log("Replacing camera track with screen track");
      await sender.replaceTrack(screenTrack);
    } else {
      console.log("No video sender found, adding a new transceiver for screen");
      // Nếu chưa có sender (ví dụ PC vừa tạo nhưng chưa addTrack)
      const transceiver = peerConnection.addTransceiver(screenTrack, { direction: 'sendonly' });
      sender = transceiver.sender;
    }

    // Local preview
    localVideo.srcObject = screenStream;

    // Renegotiation (manual fallback – giữ lại để chắc chắn)
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit("webrtc_offer", { roomId, sdp: offer });

    // Khi dừng share màn hình → quay lại camera
    screenTrack.onended = async () => {
      console.log("Screen sharing stopped");
      const camTrack = localStream?.getVideoTracks?.()[0];
      if (camTrack && sender) {
        await sender.replaceTrack(camTrack);
        localVideo.srcObject = localStream;

        const offer2 = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer2);
        socket.emit("webrtc_offer", { roomId, sdp: offer2 });
      }
    };

  } catch (err) {
    // Lỗi hay gặp: NotAllowedError (user bấm Cancel), NotFoundError, SecurityError…
    console.error("Error sharing screen:", err && err.name, err && err.message, err);
    alert(
      "Không thể chia sẻ màn hình.\n" +
      "- Hãy chắc chắn bạn bấm Chọn cửa sổ/Màn hình và bấm Share.\n" +
      "- Kiểm tra Electron có cấp quyền 'display-capture'.\n" +
      "- Trang phải chạy https:// hoặc trong Electron đã bật ignore-certificate-errors."
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
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('webrtc_answer', { roomId, sdp: answer });

    // flush pending candidates (answerer side)
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

// ✅ FIX cốt tử: handler cho ANSWER (offerer sẽ setRemoteDescription)
socket.on('webrtc_answer', async (sdp) => {
  console.log('Got answer');
  try {
    if (!peerConnection) createPeerConnection();
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));

    // flush pending candidates (offerer side)
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

  // Tự động renegotiate khi track bị thay đổi (hoặc transceiver thay đổi)
peerConnection.onnegotiationneeded = async () => {
  try {
    console.log('[negotiationneeded] creating offer');
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('webrtc_offer', { roomId, sdp: offer });
  } catch (e) {
    console.error('[negotiationneeded] failed:', e);
  }
  };

  // remote stream
  peerConnection.ontrack = (ev) => {
    console.log('ontrack', ev.streams?.[0]);
    remoteStream = ev.streams[0];
    remoteVideo.srcObject = remoteStream;
  };

  // ICE candidate outbound
  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('webrtc_ice_candidate', { roomId, candidate });
  };

  // logs
  peerConnection.oniceconnectionstatechange = () => console.log('[ICE]', peerConnection.iceConnectionState);
  peerConnection.onconnectionstatechange = () => console.log('[PC]', peerConnection.connectionState);
  peerConnection.onicegatheringstatechange = () => console.log('[ICE gathering]', peerConnection.iceGatheringState);
}

async function createOffer() {
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  socket.emit('webrtc_offer', { roomId, sdp: offer });
}
