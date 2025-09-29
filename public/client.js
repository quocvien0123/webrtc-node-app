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

// ========== VARIABLES ==========
const socket = io({ secure: true }); // kết nối wss
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
    micBtn.textContent = audioTrack.enabled ? "🎤" : "🔇";
  }
});

camBtn.addEventListener("click", () => {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    camBtn.style.backgroundColor = videoTrack.enabled ? "#333" : "#e53935";
    camBtn.textContent = videoTrack.enabled ? "📷" : "🚫";
  }
});

leaveBtn.addEventListener("click", () => {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  window.location.reload();
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
  if (!isRoomCreator) {
    createPeerConnection();
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    await createAnswer();
  }
});

socket.on("webrtc_answer", async (sdp) => {
  console.log("Got answer");
  await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
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

// ========== FUNCTIONS ==========
function joinRoom(room) {
  roomId = room;
  socket.emit("join", room);
  roomSelectionContainer.style.display = "none";
  videoChatContainer.style.display = "block";
}

async function setLocalStream() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
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
  peerConnection.onicecandidate = event => {
    if (event.candidate) {
      socket.emit("webrtc_ice_candidate", {
        roomId,
        label: event.candidate.sdpMLineIndex,
        candidate: event.candidate.candidate,
      });
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
