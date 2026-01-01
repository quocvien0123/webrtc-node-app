// recording.js - Video recording functionality

function startRecording() {
  if (isRecording) return;
  
  try {
    const tracks = [];
    if (localStream) {
      localStream.getTracks().forEach(track => tracks.push(track));
    }
    
    const recordStream = new MediaStream(tracks);
    const options = { mimeType: 'video/webm;codecs=vp9,opus' };
    
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options.mimeType = 'video/webm;codecs=vp8,opus';
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'video/webm';
      }
    }
    
    mediaRecorder = new MediaRecorder(recordStream, options);
    recordedChunks = [];
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };
    
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `recording-${Date.now()}.webm`;
      document.body.appendChild(a);
      a.click();
      
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
      
      console.log('[Recording] Saved');
    };
    
    mediaRecorder.start(1000);
    isRecording = true;
    
    recordBtn.style.display = 'none';
    stopRecordBtn.style.display = 'inline-flex';
    recordBtn.classList.add('recording');
    
    const localTile = document.getElementById('local-tile');
    if (localTile && !localTile.querySelector('.recording-indicator')) {
      const indicator = document.createElement('div');
      indicator.className = 'recording-indicator';
      indicator.textContent = 'REC';
      localTile.appendChild(indicator);
    }
    
    lucide.createIcons();
    console.log('[Recording] Started');
  } catch (error) {
    console.error('[Recording] Start error:', error);
    alert('Không thể bắt đầu ghi: ' + error.message);
  }
}

function stopRecording() {
  if (!isRecording || !mediaRecorder) return;
  
  mediaRecorder.stop();
  isRecording = false;
  
  recordBtn.style.display = 'inline-flex';
  stopRecordBtn.style.display = 'none';
  recordBtn.classList.remove('recording');
  
  const indicator = document.querySelector('.recording-indicator');
  if (indicator) {
    indicator.remove();
  }
  
  lucide.createIcons();
  console.log('[Recording] Stopped');
}

// ===== Recording Event Listeners =====
function setupRecordingListeners() {
  recordBtn?.addEventListener('click', startRecording);
  stopRecordBtn?.addEventListener('click', stopRecording);
}
