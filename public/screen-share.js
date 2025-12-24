// screen-share.js - Screen sharing functionality

async function pickDesktopSource() {
  if (!hasElectronDesktop) throw new Error('desktopCapturer bridge missing');
  const sources = await window.electronAPI.getDesktopSources({ 
    types: ['screen','window'], 
    thumbnailSize: { width: 400, height: 250 } 
  });
  if (!sources.length) throw new Error('No desktop sources');
  
  return new Promise((resolve, reject) => {
    const overlay = document.createElement('div');
    overlay.className = 'picker-overlay';
    overlay.innerHTML = '<div class="picker-modal"><h3>Chọn màn hình/cửa sổ</h3><div class="picker-grid"></div><div class="picker-actions"><button class="picker-cancel">Hủy</button></div></div>';
    const grid = overlay.querySelector('.picker-grid');
    
    sources.forEach(src => {
      const btn = document.createElement('button');
      btn.className = 'picker-item';
      btn.title = src.name;
      btn.innerHTML = `<img src="${src.thumbnail || ''}" /><div class="picker-label">${src.name}</div>`;
      btn.onclick = () => {
        document.body.removeChild(overlay);
        resolve(src);
      };
      grid.appendChild(btn);
    });
    
    overlay.querySelector('.picker-cancel').onclick = () => {
      document.body.removeChild(overlay);
      reject(new Error('User cancelled'));
    };
    
    document.body.appendChild(overlay);
    console.log('[Picker] overlay appended, sources count =', sources.length);
  });
}

async function getScreenStreamWithPicker() {
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
          maxFrameRate: 30
        }
      }
    });
    console.log('[Share] desktopCapturer OK', src.name);
    return stream;
  }
  
  if (!window.isSecureContext) throw new Error('Screen sharing cần HTTPS');
  console.log('[Share] using browser getDisplayMedia fallback');
  if (!navigator.mediaDevices.getDisplayMedia) throw new Error('Trình duyệt không hỗ trợ getDisplayMedia');
  
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { cursor: 'always', frameRate: 30 },
    audio: false
  });
  console.log('[Share] getDisplayMedia OK');
  return stream;
}

async function startScreenShare() {
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

    // Create screen share tile
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

    // Add screen track to all peers
    for (const [userId, pc] of peerConnections.entries()) {
      try {
        pc.addTrack(screenTrack, screenStream);
        console.log(`[Share] Added screen track for ${userId}`);
        
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
    
    stopShareBtn.style.display = 'inline-flex';
    stopShareBtn.style.backgroundColor = '#e53935';
    shareScreenBtn.style.display = 'none';
    lucide.createIcons();

    screenTrack.onended = () => {
      console.log('[Share] Track ended, removing screen share');
      stopScreenShare();
    };
  } catch (err) {
    console.error('Share screen error:', err);
    alert('Không thể chia sẻ màn hình: ' + (err.message || err.name || ''));
  }
}

function stopScreenShare() {
  console.log('[Share] Removing screen share tile');
  
  const tile = document.getElementById('screen-share-tile');
  if (tile) {
    tile.remove();
  }
  
  if (currentScreenTrack) {
    currentScreenTrack.stop();
  }
  
  if (currentScreenTrack) {
    peerConnections.forEach(async (pc, userId) => {
      const senders = pc.getSenders();
      for (const sender of senders) {
        if (sender.track === currentScreenTrack) {
          pc.removeTrack(sender);
          console.log(`[Share] Removed screen track from ${userId}`);
          
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
  
  isScreenSharing = false;
  currentScreenTrack = null;
  screenShareVideoElement = null;
  stopShareBtn.style.display = 'none';
  stopShareBtn.style.backgroundColor = '#333';
  shareScreenBtn.style.display = 'inline-flex';
  lucide.createIcons();

  if (roomId) {
    socket.emit('screen_share_stopped', { roomId });
  }
  
  console.log('[Share] Screen share removed, camera still active');
}

// ===== Screen Share Event Listeners =====
function setupScreenShareListeners() {
  shareScreenBtn?.addEventListener('click', startScreenShare);
  stopShareBtn?.addEventListener('click', stopScreenShare);
}
