// recording.js - Video recording functionality

// ===== GLOBAL VARIABLES FOR CANVAS RECORDING =====
let recordingCanvas = null;
let recordingContext = null;
let recordingAnimationId = null;
let recordingAudioContext = null;
let recordingAudioDestination = null;

function startRecording() {
  if (isRecording) return;
  
  try {
    console.log('[Recording] Starting canvas-based recording...');
    
    recordingCanvas = document.createElement('canvas');
    recordingCanvas.width = 1920;  // Full HD
    recordingCanvas.height = 1080;
    recordingContext = recordingCanvas.getContext('2d');
    
    const videoElements = [];
    
    const localVideo = document.getElementById('local-video');
    if (localVideo && localVideo.srcObject && localVideo.readyState >= 2) {
      videoElements.push({
        video: localVideo,
        label: 'Bạn',
        type: 'local'
      });
      console.log('[Recording] Added local video (ready)');
    } else {
      console.warn('[Recording] Local video not ready', {
        exists: !!localVideo,
        hasSrc: !!localVideo?.srcObject,
        readyState: localVideo?.readyState
      });
    }
    
    const allVideoTiles = document.querySelectorAll('.video-tile');
    console.log(`[Recording] Found ${allVideoTiles.length} video tiles`);
    
    allVideoTiles.forEach((tile, index) => {
      const video = tile.querySelector('video');
      if (video && video.id !== 'local-video' && video.srcObject && video.readyState >= 2) {
        videoElements.push({
          video: video,
          label: `User ${index}`,
          type: 'remote'
        });
        console.log(`[Recording] Added remote video ${index} (ready)`);
      }
    });
    
    const screenShareTiles = document.querySelectorAll('.screen-share-tile');
    console.log(`[Recording] Found ${screenShareTiles.length} screen share tiles`);
    
    screenShareTiles.forEach((tile, index) => {
      const video = tile.querySelector('video');
      if (video && video.srcObject && video.readyState >= 2) {
        videoElements.push({
          video: video,
          label: `Screen ${index + 1}`,
          type: 'screen'
        });
        console.log(`[Recording] Added screen share ${index} (ready)`);
      }
    });
    
    if (videoElements.length === 0) {
      throw new Error('Không có video nào sẵn sàng để ghi. Hãy đợi video load xong!');
    }
    
    console.log(`[Recording] Total ready videos: ${videoElements.length}`);
    
    // ===== BƯỚC 3: VẼ TẤT CẢ VIDEO LÊN CANVAS =====
    function drawVideosToCanvas() {
      if (!isRecording) return;
      
      try {
        // Clear canvas với màu đen
        recordingContext.fillStyle = '#1a1a1a';
        recordingContext.fillRect(0, 0, recordingCanvas.width, recordingCanvas.height);
        
        const count = videoElements.length;
        
        if (count === 1) {
          // 1 video: Fullscreen
          const { video } = videoElements[0];
          if (video.readyState >= 2) {
            recordingContext.drawImage(video, 0, 0, recordingCanvas.width, recordingCanvas.height);
          }
        } else if (count === 2) {
          // 2 videos: Split vertical
          const w = recordingCanvas.width / 2;
          const h = recordingCanvas.height;
          videoElements.forEach(({ video }, i) => {
            if (video.readyState >= 2) {
              recordingContext.drawImage(video, i * w, 0, w, h);
            }
          });
        } else if (count <= 4) {
          // 3-4 videos: Grid 2x2
          const w = recordingCanvas.width / 2;
          const h = recordingCanvas.height / 2;
          videoElements.forEach(({ video }, i) => {
            if (video.readyState >= 2) {
              const x = (i % 2) * w;
              const y = Math.floor(i / 2) * h;
              recordingContext.drawImage(video, x, y, w, h);
            }
          });
        } else if (count <= 6) {
          // 5-6 videos: Grid 3x2
          const w = recordingCanvas.width / 3;
          const h = recordingCanvas.height / 2;
          videoElements.forEach(({ video }, i) => {
            if (video.readyState >= 2) {
              const x = (i % 3) * w;
              const y = Math.floor(i / 3) * h;
              recordingContext.drawImage(video, x, y, w, h);
            }
          });
        } else {
          // 7+ videos: Grid 3x3
          const w = recordingCanvas.width / 3;
          const h = recordingCanvas.height / 3;
          videoElements.slice(0, 9).forEach(({ video }, i) => {
            if (video.readyState >= 2) {
              const x = (i % 3) * w;
              const y = Math.floor(i / 3) * h;
              recordingContext.drawImage(video, x, y, w, h);
            }
          });
        }
        
        recordingContext.fillStyle = 'rgba(0, 0, 0, 0.7)';
        recordingContext.fillRect(10, 10, 300, 50);
        
        recordingContext.fillStyle = '#FF0000';
        recordingContext.font = 'bold 28px Arial';
        const timeStr = new Date().toLocaleTimeString('vi-VN');
        recordingContext.fillText(`🔴 REC ${timeStr}`, 20, 45);
        
        recordingContext.fillStyle = '#FFFFFF';
        recordingContext.font = '18px Arial';
        recordingContext.fillText(`${count} streams`, recordingCanvas.width - 150, 40);
        
      } catch (err) {
        console.error('[Recording] Draw error:', err);
      }
      
      recordingAnimationId = requestAnimationFrame(drawVideosToCanvas);
    }
    
    setTimeout(() => {
      console.log('[Recording] Starting canvas drawing...');
      drawVideosToCanvas();
    }, 500);
    
    const canvasStream = recordingCanvas.captureStream(30); // 30 FPS
    console.log('[Recording] Canvas stream created');
    
    recordingAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    recordingAudioDestination = recordingAudioContext.createMediaStreamDestination();
    
    let audioCount = 0;
    
    
    if (localStream) {
      const audioTracks = localStream.getAudioTracks();
      if (audioTracks.length > 0) {
        try {
          const source = recordingAudioContext.createMediaStreamSource(new MediaStream(audioTracks));
          source.connect(recordingAudioDestination);
          audioCount++;
          console.log('[Recording] Added local audio');
        } catch (err) {
          console.warn('[Recording] Local audio error:', err);
        }
      }
    }
    
    
    if (remoteStreams && remoteStreams.size > 0) {
      remoteStreams.forEach((stream, userId) => {
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length > 0) {
          try {
            const source = recordingAudioContext.createMediaStreamSource(new MediaStream(audioTracks));
            source.connect(recordingAudioDestination);
            audioCount++;
            console.log(`[Recording] Added audio from ${userId}`);
          } catch (err) {
            console.warn(`[Recording] Audio error from ${userId}:`, err);
          }
        }
      });
    }
    
    console.log(`[Recording] Total audio tracks: ${audioCount}`);
    
    // KẾT HỢP VIDEO VÀ AUDIO =====
    const finalStream = new MediaStream();
    
    // Thêm video track từ canvas
    canvasStream.getVideoTracks().forEach(track => {
      finalStream.addTrack(track);
      console.log('[Recording] Added canvas video track');
    });
    
    // Thêm mixed audio track
    if (audioCount > 0) {
      recordingAudioDestination.stream.getAudioTracks().forEach(track => {
        finalStream.addTrack(track);
        console.log('[Recording] Added mixed audio track');
      });
    } else {
      console.warn('[Recording] No audio tracks available');
    }
    
    const options = { 
      mimeType: 'video/webm;codecs=vp8,opus',
      videoBitsPerSecond: 2500000 // 2.5 Mbps
    };
    
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options.mimeType = 'video/webm';
      console.warn('[Recording] VP8 not supported, using default codec');
    }
    
    console.log(`[Recording] Using codec: ${options.mimeType}`);
    
    mediaRecorder = new MediaRecorder(finalStream, options);
    recordedChunks = [];
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
        const sizeMB = (event.data.size / 1024 / 1024).toFixed(2);
        console.log(`[Recording] Chunk: ${sizeMB} MB`);
      }
    };
    
    mediaRecorder.onstop = () => {
      console.log('[Recording] Processing video...');
      
      // Stop animation
      if (recordingAnimationId) {
        cancelAnimationFrame(recordingAnimationId);
        recordingAnimationId = null;
      }
      
      // Cleanup audio
      if (recordingAudioContext) {
        recordingAudioContext.close();
        recordingAudioContext = null;
      }
      
      if (recordedChunks.length === 0) {
        alert('⚠️ Không có dữ liệu được ghi!\nHãy thử lại và đợi lâu hơn.');
        return;
      }
      
      // Create blob
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const filename = `meeting-${timestamp}.webm`;
      
      // Download
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
      
      const sizeMB = (blob.size / 1024 / 1024).toFixed(2);
      console.log(`[Recording] Saved: ${filename} (${sizeMB} MB)`);
      alert(`✅ Ghi hình thành công!\n\nFile: ${filename}\nKích thước: ${sizeMB} MB\n\nVideo gồm:\n• ${videoElements.length} video streams\n• ${audioCount} audio tracks\n• Layout grid 1920x1080`);
    };
    
    mediaRecorder.onerror = (event) => {
      console.error('[Recording] MediaRecorder error:', event.error);
      alert('❌ Lỗi ghi hình: ' + event.error);
      stopRecording();
    };
    
    // ===== BƯỚC 8: BẮT ĐẦU GHI =====
    mediaRecorder.start(1000); // Thu thập mỗi 1 giây
    isRecording = true;
    
    // ===== CẬP NHẬT UI =====
    recordBtn.style.display = 'none';
    stopRecordBtn.style.display = 'inline-flex';
    recordBtn.classList.add('recording');
    
    const localTile = document.getElementById('local-tile');
    if (localTile && !localTile.querySelector('.recording-indicator')) {
      const indicator = document.createElement('div');
      indicator.className = 'recording-indicator';
      indicator.innerHTML = '🔴 REC';
      localTile.appendChild(indicator);
    }
    
    console.log('[Recording] Started successfully!');
    
    //  Thông báo chi tiết
    const videoDetails = videoElements.map(v => `• ${v.label} (${v.type})`).join('\n');
    alert(`🎥 Bắt đầu ghi hình!\n\n${videoElements.length} video streams:\n${videoDetails}\n\n${audioCount} audio tracks\nĐộ phân giải: 1920x1080\nFPS: 30`);
    
    lucide.createIcons();
    
  } catch (error) {
    console.error('[Recording] Start error:', error);
    alert('❌ Không thể bắt đầu ghi:\n' + error.message);
    stopRecording();
  }
}

function stopRecording() {
  if (!isRecording || !mediaRecorder) return;
  
  console.log('[Recording] Stopping...');
  
  try {
    if (mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    isRecording = false;
    
    // Stop animation
    if (recordingAnimationId) {
      cancelAnimationFrame(recordingAnimationId);
      recordingAnimationId = null;
    }
    
    // Cleanup
    recordingCanvas = null;
    recordingContext = null;
    
    // UI update
    recordBtn.style.display = 'inline-flex';
    stopRecordBtn.style.display = 'none';
    recordBtn.classList.remove('recording');
    
    const indicator = document.querySelector('.recording-indicator');
    if (indicator) {
      indicator.remove();
    }
    
    lucide.createIcons();
    console.log('[Recording] Stopped');
    
  } catch (error) {
    console.error('[Recording] Stop error:', error);
  }
}

// ===== Recording Event Listeners =====
function setupRecordingListeners() {
  recordBtn?.addEventListener('click', startRecording);
  stopRecordBtn?.addEventListener('click', stopRecording);
}
