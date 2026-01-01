// auth.js - Authentication (login, register, logout)

async function checkAuth() {
  const token = localStorage.getItem('authToken');
  if (!token) {
    showAuthContainer();
    return false;
  }

  try {
    const response = await fetch('/api/auth/verify', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (response.ok) {
      const data = await response.json();
      currentUser = data.user;
      authToken = token;
      showRoomSelection();
      updateUserInfo();
      return true;
    } else {
      localStorage.removeItem('authToken');
      showAuthContainer();
      return false;
    }
  } catch (error) {
    console.error('Auth verification error:', error);
    localStorage.removeItem('authToken');
    showAuthContainer();
    return false;
  }
}

function updateUserInfo() {
  if (currentUser && userInfo && logoutButton) {
    userInfo.textContent = `Xin chào, ${currentUser.username}`;
    userInfo.style.display = 'inline-block';
    logoutButton.style.display = 'inline-block';
  }
}

function logout() {
  localStorage.removeItem('authToken');
  currentUser = null;
  authToken = null;
  
  // Close peer connections
  peerConnections.forEach((pc, userId) => {
    closePeerConnection(userId);
  });
  peerConnections.clear();
  
  // Stop recording
  if (isRecording) {
    stopRecording();
  }
  
  // Stop local stream
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  
  if (roomId) {
    socket.emit('leave', roomId);
  }
  
  window.location.reload();
}

// ===== Auth Event Listeners =====
function setupAuthListeners() {
  tabLogin?.addEventListener('click', () => {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    loginForm.style.display = 'block';
    registerForm.style.display = 'none';
    loginError.textContent = '';
    registerError.textContent = '';
  });

  tabRegister?.addEventListener('click', () => {
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    registerForm.style.display = 'block';
    loginForm.style.display = 'none';
    loginError.textContent = '';
    registerError.textContent = '';
  });

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    
    if (!username || !password) {
      loginError.textContent = 'Vui lòng điền đầy đủ thông tin';
      return;
    }

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (response.ok) {
        localStorage.setItem('authToken', data.token);
        currentUser = data.user;
        authToken = data.token;
        showRoomSelection();
        updateUserInfo();
        loginForm.reset();
      } else {
        loginError.textContent = data.message || 'Đăng nhập thất bại';
      }
    } catch (error) {
      console.error('Login error:', error);
      loginError.textContent = 'Lỗi kết nối server';
    }
  });

  registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    registerError.textContent = '';
    
    const username = document.getElementById('register-username').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;
    const confirmPassword = document.getElementById('register-confirm-password').value;

    if (!username || !email || !password || !confirmPassword) {
      registerError.textContent = 'Vui lòng điền đầy đủ thông tin';
      return;
    }

    if (password !== confirmPassword) {
      registerError.textContent = 'Mật khẩu xác nhận không khớp';
      return;
    }

    if (password.length < 6) {
      registerError.textContent = 'Mật khẩu phải có ít nhất 6 ký tự';
      return;
    }

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password })
      });

      const data = await response.json();

      if (response.ok) {
        localStorage.setItem('authToken', data.token);
        currentUser = data.user;
        authToken = data.token;
        showRoomSelection();
        updateUserInfo();
        registerForm.reset();
      } else {
        registerError.textContent = data.message || 'Đăng ký thất bại';
      }
    } catch (error) {
      console.error('Register error:', error);
      registerError.textContent = 'Lỗi kết nối server';
    }
  });

  logoutButton?.addEventListener('click', logout);
}
