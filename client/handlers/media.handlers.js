// media.js - Media controls (camera, microphone)

async function setLocalStream() {
  if (!navigator.mediaDevices) {
    alert('navigator.mediaDevices không tồn tại (context không an toàn?). Kiểm tra HTTPS server hoạt động.');
    return;
  }
  const errors = [];
  async function tryGet(constraints, label) {
    try {
      console.log('[getUserMedia attempt]', label, constraints);
      const s = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('[getUserMedia success]', label);
      return s;
    } catch (e) {
      console.warn('[getUserMedia failed]', label, e.name, e.message);
      errors.push(label + ': ' + e.name + ' - ' + e.message);
      return null;
    }
  }
  const attempts = [
    { label: 'high', c: { video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: true } },
    { label: 'medium', c: { video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } }, audio: true } },
    { label: 'low', c: { video: { width: 640, height: 480 }, audio: true } },
    { label: 'minimal', c: { video: true, audio: true } },
  ];
  for (const a of attempts) {
    const s = await tryGet(a.c, a.label);
    if (s) { localStream = s; break; }
  }
  if (!localStream) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videos = devices.filter(d => d.kind === 'videoinput');
      console.log('[enumerateDevices] videoinput count:', videos.length);
      for (const v of videos) {
        const s = await tryGet({ video: { deviceId: { exact: v.deviceId } }, audio: true }, 'device:' + (v.label || v.deviceId));
        if (s) { localStream = s; break; }
      }
    } catch (e) {
      console.warn('[enumerateDevices failed]', e);
      errors.push('enumerateDevices: ' + e.name + ' - ' + e.message);
    }
  }
  if (localStream) {
    localVideo.srcObject = localStream;
    return;
  }
  
  const isPermissionDenied = errors.every(e => e.includes('NotAllowedError') || e.includes('Permission denied'));
  
  if (isPermissionDenied) {
    alert(
      '🚫 QUYỀN TRUY CẬP BỊ TỪ CHỐI\n\n' +
      '❌ Trình duyệt đã chặn quyền Camera/Microphone.\n\n' +
      '📱 CÁCH SỬA:\n\n' +
      '1️⃣ Trên thanh địa chỉ, tìm icon 🔒 hoặc ⓘ\n' +
      '2️⃣ Nhấn vào icon → Cài đặt trang web\n' +
      '3️⃣ Đặt Camera và Microphone thành "Cho phép"\n' +
      '4️⃣ Làm mới trang (F5) và thử lại\n\n' +
      '💡 Trên Android/iOS:\n' +
      '• Vào Settings → Apps → Browser → Permissions\n' +
      '• Bật Camera và Microphone\n\n' +
      '⚠️ Lưu ý:\n' +
      '• Phải dùng HTTPS (https://...)\n' +
      '• Một số trình duyệt mobile cần cài đặt riêng\n\n' +
      'Nếu vẫn lỗi, thử trình duyệt Chrome hoặc Edge.'
    );
  } else {
    alert([
      '❌ Không thể truy cập camera/micro.\n',
      '📋 Chi tiết lỗi:',
      ...errors.slice(0, 4),
      '',
      '💡 Hãy thử:',
      '• Đóng các app đang dùng camera (Zoom, Teams...)',
      '• Kiểm tra camera/micro có hoạt động không',
      '• Thử trình duyệt khác',
    ].join('\n'));
  }
}

// ===== Media Control Event Listeners =====
function setupMediaListeners() {
  micBtn?.addEventListener('click', () => {
    if (!localStream) return;
    const audio = localStream.getAudioTracks()[0];
    if (!audio) return;
    audio.enabled = !audio.enabled;
    micBtn.style.backgroundColor = audio.enabled ? '#333' : '#e53935';
    micBtn.innerHTML = `<i data-lucide="${audio.enabled ? 'mic' : 'mic-off'}"></i>`;
    lucide.createIcons();
  });

  camBtn?.addEventListener('click', () => {
    if (!localStream) return;
    const video = localStream.getVideoTracks()[0];
    if (!video) return;
    video.enabled = !video.enabled;
    camBtn.style.backgroundColor = video.enabled ? '#333' : '#e53935';
    camBtn.innerHTML = `<i data-lucide="${video.enabled ? 'camera' : 'camera-off'}"></i>`;
    lucide.createIcons();
  });
}

async function restoreCameraForAllPeers() {
  console.log('[RestoreCamera] Starting restore...');

  let camTrack = localStream?.getVideoTracks?.()[0];
  if (!camTrack || camTrack.readyState !== 'live') {
    try {
      const newCam = await navigator.mediaDevices.getUserMedia({ video: true });
      camTrack = newCam.getVideoTracks()[0];
      console.log('[RestoreCamera] Acquired new camera track');
    } catch (e) {
      console.error('[RestoreCamera] Failed to acquire camera', e);
      alert('Không thể khôi phục camera. Vui lòng kiểm tra quyền truy cập.');
      return;
    }
  }

  const tasks = [];
  peerConnections.forEach((pc, userId) => {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) {
      tasks.push(sender.replaceTrack(camTrack).then(() => {
        console.log(`[RestoreCamera] Restored track for ${userId}`);
      }).catch(err => {
        console.error(`[RestoreCamera] Replace failed for ${userId}`, err);
      }));
    }
  });
  await Promise.all(tasks);

  if (localStream) {
    const audioTracks = localStream.getAudioTracks();
    const videoTracks = [camTrack];
    const combined = new MediaStream([...audioTracks, ...videoTracks]);
    localVideo.srcObject = combined;
    console.log('[RestoreCamera] Local video set to combined stream');
  } else {
    localVideo.srcObject = new MediaStream([camTrack]);
    console.log('[RestoreCamera] Local video set to camera-only stream');
  }
}
