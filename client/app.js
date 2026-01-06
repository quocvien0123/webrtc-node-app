// client.js - Main entry point
// Tất cả các module đã được tách ra vào các file riêng
// File này chỉ điều phối các module khác
async function initApp() {
  console.log('[Init] Starting application...');
  
  // 1. Khởi tạo DOM elements
  await initDOMElements();
  console.log('[Init] DOM elements initialized');
  
  // 2. Setup event listeners cho tất cả modules
  setupAuthListeners();
  setupRoomListeners();
  setupMediaListeners();
  setupScreenShareListeners();
  setupChatListeners();
  setupReactionsListeners();
  setupRecordingListeners();
  
  console.log('[Init] All event listeners setup');
  
  // 3. Setup Socket.IO handlers
  setupSocketHandlers();
  console.log('[Init] Socket.IO handlers setup');
  
  // 4. Check auth status
  await checkAuth();
  console.log('[Init] Application ready');
}

// ===== Initialize whiteboard when joining room =====
function initWhiteboardOnJoin() {
  if (window.whiteboardHandlers && typeof window.whiteboardHandlers.init === 'function') {
    window.whiteboardHandlers.init();
    console.log('[Whiteboard] Initialized on room join');
  }
}

// ===== Cleanup whiteboard when leaving room =====
function cleanupWhiteboardOnLeave() {
  if (window.whiteboardHandlers && typeof window.whiteboardHandlers.cleanup === 'function') {
    window.whiteboardHandlers.cleanup();
    console.log('[Whiteboard] Cleaned up on room leave');
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
