const socket = io();

// Elements
const roomInput = document.getElementById("room-input");
const connectBtn = document.getElementById("connect-button");
const roomSelectionContainer = document.getElementById("room-selection-container");
const videoChatContainer = document.getElementById("video-chat-container");

const localVideo = document.getElementById("local-video");
const remoteVideo = document.getElementById("remote-video");

const micBtn = document.getElementById("mic-button");
const camBtn = document.getElementById("cam-button");
const leaveBtn = document.getElementById("leave-button");

let localStream;
let peerConnection;

// ICE servers (STUN/TURN)
const config = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

// Khi nhấn Connect
connectBtn.addEventListener("click", async () => {
  const roomId = roomInput.value;
  if (!roomId) return alert("Please enter room id");

  roomSelectionContainer.style.display = "none";
  videoChatContainer.style.display = "block";

  // Lấy video/audio từ user
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;

  // Tạo PeerConnection
  peerConnection = new RTCPeerConnection(config);

  // Add tracks
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  // Remote stream
  peerConnection.ontrack = event => {
    remoteVideo.srcObject = event.streams[0];
  };

  // ICE Candidate
  peerConnection.onicecandidate = event => {
    if (event.candidate) {
      socket.emit("candidate", { candidate: event.candidate, room: roomId });
    }
  };

  // Tham gia room
  socket.emit("join", roomId);

  // Offer/Answer
  socket.on("offer", async (offer) => {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit("answer", { answer, room: roomId });
  });

  socket.on("answer", async (answer) => {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  });

  socket.on("candidate", async (candidate) => {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error("Error adding candidate:", err);
    }
  });

  // Nếu là người tạo phòng thì tạo Offer
  socket.on("created", async () => {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit("offer", { offer, room: roomId });
  });
});

// Nút bật/tắt micro
micBtn.addEventListener("click", () => {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    micBtn.style.backgroundColor = audioTrack.enabled ? "#333" : "#e53935";
    micBtn.textContent = audioTrack.enabled ? "🎤" : "🔇";
  }
});

// Nút bật/tắt camera
camBtn.addEventListener("click", () => {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    camBtn.style.backgroundColor = videoTrack.enabled ? "#333" : "#e53935";
    camBtn.textContent = videoTrack.enabled ? "📷" : "🚫";
  }
});

// Nút rời phòng
leaveBtn.addEventListener("click", () => {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  window.location.reload(); // reload để quay lại màn hình chọn phòng
});
