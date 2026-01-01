// webrtc.js - WebRTC peer connections, offer/answer, ICE candidates

function createPeerConnection(userId) {
  const pc = new RTCPeerConnection(pcConfig);
  
  // Add local tracks
  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
      console.log(`[Track] Added ${track.kind} track to peer ${userId}`);
    });
  } else {
    console.warn(`[Track] No localStream when creating peer connection for ${userId}`);
  }
  
  // Handle incoming tracks
  pc.ontrack = (event) => {
    console.log(`[Track] Received ${event.track.kind} from ${userId}`);
    const track = event.track;
    const streams = event.streams;
    
    // Kiểm tra có phải screen track không
    const existingStream = remoteStreams.get(userId);
    const hasExistingVideoTrack = existingStream && existingStream.getVideoTracks().length > 0;
    const isScreenTrack = track.kind === 'video' && hasExistingVideoTrack;
    
    if (isScreenTrack) {
      console.log(`[Track] This is a screen share track from ${userId}`);
      
      // ✅ ENABLE SPOTLIGHT MODE FOR REMOTE SCREEN SHARE
      enableSpotlightMode();
      
      let screenStream = screenStreams.get(userId);
      if (!screenStream) {
        screenStream = new MediaStream();
        screenStreams.set(userId, screenStream);
      }
      screenStream.addTrack(track);
      
      // Create screen share tile IN SPOTLIGHT MAIN
      const spotlightMain = document.querySelector('.spotlight-main');
      if (!spotlightMain) {
        console.error('[Track] No spotlight-main container');
        return;
      }
      
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
        video.muted = false;
        video.srcObject = screenStream;
        
        // FORCE PLAY
        video.play().catch(e => {
          console.warn(`[Screen] Autoplay blocked, retrying for ${userId}:`, e);
          setTimeout(() => video.play().catch(console.warn), 100);
        });
        
        // ✅ ADD FULLSCREEN TOGGLE BUTTON
        const fullscreenBtn = document.createElement('button');
        fullscreenBtn.className = 'fullscreen-toggle';
        fullscreenBtn.innerHTML = '<i data-lucide="maximize"></i>';
        fullscreenBtn.onclick = () => toggleSpotlightFullscreen();
        
        tile.appendChild(labelEl);
        tile.appendChild(video);
        tile.appendChild(fullscreenBtn);
        spotlightMain.appendChild(tile);
        
        console.log(`[Track] Created screen share tile for ${userId}`);
        lucide.createIcons();
      } else {
        const video = document.getElementById(`screen-video-${userId}`);
        if (video) {
          video.srcObject = screenStream;
          video.play().catch(console.warn);
        }
      }
      
      track.onended = () => {
        console.log(`[Track] Screen track ended from ${userId}`);
        const tile = document.getElementById(screenTileId);
        if (tile) tile.remove();
        screenStreams.delete(userId);
        
        // ✅ DISABLE SPOTLIGHT MODE IF NO MORE SCREEN SHARES
        const hasScreenShares = document.querySelector('.screen-share-tile');
        if (!hasScreenShares) {
          disableSpotlightMode();
        }
      };
      
      return;
    }
    
    // Xử lý camera/audio tracks
    let stream = remoteStreams.get(userId);
    if (!stream) {
      stream = new MediaStream();
      remoteStreams.set(userId, stream);
      console.log(`[Track] Created new camera stream for ${userId}`);
    }
    
    stream.addTrack(track);
    console.log(`[Track] Camera stream for ${userId} now has ${stream.getTracks().length} tracks`);
    
    // ✅ TẠO CAMERA TILE - KIỂM TRA NẾU ĐANG SPOTLIGHT MODE
    const container = document.getElementById('videos-container');
    const isSpotlightActive = container?.classList.contains('spotlight-mode');
    const targetContainer = isSpotlightActive 
      ? document.getElementById('spotlight-sidebar') 
      : container;
    
    let video = videoElements.get(userId);
    if (!video) {
      const username = userNames.get(userId) || `User ${userId.slice(0, 6)}`;
      video = createVideoTile(userId, stream, username, targetContainer);
    } else {
      video.srcObject = stream;
    }
    
    // FORCE AUTOPLAY với retry
    if (video) {
      video.play().catch(e => {
        console.warn(`[Track] Autoplay blocked for ${userId}, retrying:`, e);
        let retries = 0;
        const retryPlay = () => {
          video.play()
            .then(() => console.log(`[Track] ✅ Video playing for ${userId} after ${retries} retries`))
            .catch(err => {
              retries++;
              if (retries < 3) {
                setTimeout(retryPlay, 200 * retries);
              } else {
                console.error(`[Track] ❌ Failed to autoplay for ${userId} after 3 retries`);
              }
            });
        };
        setTimeout(retryPlay, 100);
      });
    }
  };
  
  // ICE candidates
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      socket.emit('webrtc_ice_candidate', { roomId, candidate, targetId: userId });
      console.log(`[ICE] Sent candidate to ${userId}:`, candidate.candidate.split(' ')[7]); // Log candidate type
    } else {
      console.log(`[ICE] ✅ All candidates sent for ${userId}`);
    }
  };
  
  // ICE connection state
  pc.oniceconnectionstatechange = () => {
    console.log(`[ICE ${userId}]`, pc.iceConnectionState);
    if (pc.iceConnectionState === 'connected') {
      console.log(`[ICE ${userId}] ✅ Connection established!`);
    }
    if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
      console.warn(`[Peer ${userId}] Connection lost`);
    }
  };
  
  pc.onconnectionstatechange = () => {
    console.log(`[PC ${userId}]`, pc.connectionState);
    if (pc.connectionState === 'connected') {
      console.log(`[PC ${userId}] ✅ Peer connection established!`);
    }
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
  
  const stream = remoteStreams.get(userId);
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    remoteStreams.delete(userId);
  }
  
  const screenStream = screenStreams.get(userId);
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStreams.delete(userId);
  }
  
  removeVideoTile(userId);
  
  const screenTile = document.getElementById(`screen-share-tile-${userId}`);
  if (screenTile) {
    screenTile.remove();
  }
  
  console.log(`[Peer ${userId}] Closed and cleaned up`);
}

function createVideoTile(userId, stream, label, targetContainer) {
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
  video.muted = false; // Không mute remote video
  video.srcObject = stream;
  
  // Thêm attributes để bypass autoplay policy
  video.setAttribute('webkit-playsinline', 'true');
  video.setAttribute('playsinline', 'true');
  
  tile.appendChild(labelEl);
  tile.appendChild(video);
  
  // ✅ APPEND TO TARGET CONTAINER (sidebar nếu spotlight mode, container nếu không)
  const container = targetContainer || document.getElementById('videos-container');
  if (container) {
    container.appendChild(tile);
  }
  
  videoElements.set(userId, video);
  
  console.log(`[Video] Created tile for ${userId} in ${container?.id || 'container'}`);
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

function checkAndRemoveScreenTile(userId, pc) {
  const receivers = pc.getReceivers();
  const videoReceivers = receivers.filter(r => r.track && r.track.kind === 'video');
  
  console.log(`[Check] ${userId} has ${videoReceivers.length} video receivers`);
  
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
