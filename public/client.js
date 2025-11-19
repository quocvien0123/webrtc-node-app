// ========== DOM ELEMENTS ==========
const roomSelectionContainer = document.getElementById('room-selection-container');
const roomInput = document.getElementById('room-input');
const connectButton = document.getElementById('connect-button');

const videoChatContainer = document.getElementById('video-chat-container');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');

const micBtn = document.getElementById("mic-button");
const camBtn = document.getElementById("cam-button");
const leaveBtn = document.getElementById("leave-button");
const shareScreenBtn = document.getElementById("share-screen-button");


// ========== VARIABLES ==========
const socket = io("https://192.168.1.3:3000", {
  rejectUnauthorized: false,
  secure: true,
});
// để socket tự theo scheme của trang (http/https)
let localStream;
let remoteStream;
let peerConnection;
let roomId;
let isRoomCreator = false;

// ICE Servers
const config = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
  ]
};

// ========== BUTTON EVENTS ==========
connectButton.addEventListener('click', () => {
  if (!roomInput.value) return alert("Please enter room id");
  joinRoom(roomInput.value);
});

micBtn.addEventListener("click", () => {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;

    micBtn.style.backgroundColor = audioTrack.enabled ? "#333" : "#e53935";

    // đổi icon: mic ↔ mic-off
    const iconName = audioTrack.enabled ? "mic" : "mic-off";
    micBtn.innerHTML = `<i data-lucide="${iconName}"></i>`;
    lucide.createIcons();
  }
});

camBtn.addEventListener("click", () => {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;

    camBtn.style.backgroundColor = videoTrack.enabled ? "#333" : "#e53935";

    // đổi icon: camera ↔ camera-off
    const iconName = videoTrack.enabled ? "camera" : "camera-off";
    camBtn.innerHTML = `<i data-lucide="${iconName}"></i>`;
    lucide.createIcons();
  }
});

leaveBtn.addEventListener("click", () => {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  socket.emit("leave", roomId); // 🔥 báo cho server biết mình thoát

  // Clear local video
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
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    console.log("Screen stream started:", screenStream);

    const screenTrack = screenStream.getVideoTracks()[0];
    const sender = peerConnection.getSenders().find(s => s.track.kind === "video");

    if (!sender) {
      console.error("No video sender found in PeerConnection");
      return;
    }

    // Thay thế track video
    sender.replaceTrack(screenTrack);

    // Hiển thị preview chia sẻ màn hình
    localVideo.srcObject = screenStream;

    // Renegotiation (bắt buộc để remote thấy track mới)
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit("webrtc_offer", { type: "webrtc_offer", sdp: offer, roomId });

    // Khi dừng chia sẻ màn hình, quay lại camera
    screenTrack.onended = async () => {
      console.log("Screen sharing stopped");
      const videoTrack = localStream.getVideoTracks()[0];
      if (sender) {
        sender.replaceTrack(videoTrack);
      }
      localVideo.srcObject = localStream;

      // Renegotiation lại sau khi quay lại camera
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.emit("webrtc_offer", { type: "webrtc_offer", sdp: offer, roomId });
    };

  } catch (err) {
    console.error("Error sharing screen:", err);
  }
});

// ========== SOCKET EVENTS ==========
socket.on("room_created", async () => {
  console.log("Room created");
  await setLocalStream();
  isRoomCreator = true;
});

socket.on("room_joined", async () => {
  console.log("Room joined");
  await setLocalStream();
  socket.emit("start_call", roomId);
});

socket.on("full_room", () => {
  alert("The room is full, please try another one");
});

socket.on("start_call", async () => {
  console.log("Start call");
  if (isRoomCreator) {
    createPeerConnection();
    await createOffer();
  }
});

socket.on("webrtc_offer", async (sdp) => {
  console.log("Got offer");
  try {
    if (!peerConnection) createPeerConnection();
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit("webrtc_answer", { type: "webrtc_answer", sdp: answer, roomId });
  } catch (err) {
    console.error("Error handling offer:", err);
  }
});


socket.on("webrtc_ice_candidate", async ({ candidate }) => {
  console.log("Got ICE candidate");
  try {
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.error("Error adding ice candidate", err);
  }
});


socket.on("webrtc_ice_candidate", async (event) => {
  console.log("Got ICE candidate");
  try {
    const candidate = new RTCIceCandidate({
      sdpMLineIndex: event.label,
      candidate: event.candidate,
    });
    await peerConnection.addIceCandidate(candidate);
  } catch (err) {
    console.error("Error adding ice candidate", err);
  }
});
socket.on("peer_left", () => {
  console.log("Peer disconnected");

  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
    remoteStream = null;
  }

  remoteVideo.srcObject = null; // 🔥 clear hình ảnh bên kia
});


// ========== FUNCTIONS ==========
function joinRoom(room) {
  roomId = room;
  socket.emit("join", room);
  roomSelectionContainer.style.display = "none";
  videoChatContainer.style.display = "block";
}

async function setLocalStream() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1920 },   // độ phân giải mong muốn
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }, // số FPS (khung hình/giây)
      },
      audio: true
    });
    localVideo.srcObject = localStream;
  } catch (error) {
    console.error("Could not get user media", error);
  }
}

function createPeerConnection() {
  peerConnection = new RTCPeerConnection(config);
  // add local tracks
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });
  // remote stream
  peerConnection.ontrack = event => {
    remoteStream = event.streams[0];
    remoteVideo.srcObject = remoteStream;
  };
  // ICE candidate
  peerConnection.onicecandidate = ({ candidate }) => {
  if (candidate) {
    socket.emit("webrtc_ice_candidate", { roomId, candidate });
  }
};

}

async function createOffer() {
  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit("webrtc_offer", { type: "webrtc_offer", sdp: offer, roomId });
  } catch (error) {
    console.error(error);
  }
}

async function createAnswer() {
  try {
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit("webrtc_answer", { type: "webrtc_answer", sdp: answer, roomId });
  } catch (error) {
    console.error(error);
  }
}
