// ===== Whiteboard Handler =====
// Quản lý whiteboard (bảng trắng) với Canvas API và Socket.IO

(function() {
  'use strict';

  // State
  let canvas, ctx;
  let isDrawing = false;
  let currentTool = 'pen';
  let currentColor = '#000000';
  let currentWidth = 3;
  let lastX = 0;
  let lastY = 0;
  let startX = 0;
  let startY = 0;
  
  // History for undo/redo
  let history = [];
  let historyStep = -1;
  const MAX_HISTORY = 50;

  // Active drawers tracking
  const activeDrawers = new Set();

  // DOM elements
  let container, fab, canvasContainer;
  let toolButtons, colorPicker, colorPresets, lineWidth, lineWidthValue;
  let undoBtn, redoBtn, clearBtn, saveBtn;
  let statusText, usersDrawing;
  let minimizeBtn, closeBtn;

  // Initialize
  function init() {
    // ✅ SỬA: Không cần kiểm tra state, chỉ cần kiểm tra DOM
    console.log('[Whiteboard] Init called');

    // Get DOM elements
    container = document.getElementById('whiteboard-container');
    fab = document.getElementById('whiteboard-toggle');
    canvas = document.getElementById('whiteboard-canvas');
    canvasContainer = canvas?.parentElement;

    if (!container || !fab || !canvas) {
      console.warn('[Whiteboard] DOM elements not found', {
        container: !!container,
        fab: !!fab,
        canvas: !!canvas
      });
      return;
    }

    ctx = canvas.getContext('2d');
    
    // Setup canvas size
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Get other elements
    toolButtons = document.querySelectorAll('.tool-btn');
    colorPicker = document.getElementById('color-picker');
    colorPresets = document.querySelectorAll('.color-preset');
    lineWidth = document.getElementById('line-width');
    lineWidthValue = document.getElementById('line-width-value');
    undoBtn = document.getElementById('wb-undo');
    redoBtn = document.getElementById('wb-redo');
    clearBtn = document.getElementById('wb-clear');
    saveBtn = document.getElementById('wb-save');
    statusText = document.getElementById('wb-status-text');
    usersDrawing = document.getElementById('wb-users-drawing');
    minimizeBtn = document.getElementById('wb-minimize');
    closeBtn = document.getElementById('wb-close');

    // Setup event listeners
    setupEventListeners();
    setupSocketListeners();

    // Show FAB when in room
    if (fab) fab.style.display = 'flex';

    console.log('[Whiteboard] Initialized');
  }

  // Resize canvas
  function resizeCanvas() {
    if (!canvas || !canvasContainer) return;
    
    const rect = canvasContainer.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    
    // Restore canvas state
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  // Setup event listeners
  function setupEventListeners() {
    // FAB toggle
    fab?.addEventListener('click', toggleWhiteboard);

    // Tool selection
    toolButtons?.forEach(btn => {
      btn.addEventListener('click', () => {
        currentTool = btn.dataset.tool;
        toolButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateCanvasCursor();
      });
    });

    // Color picker
    colorPicker?.addEventListener('input', (e) => {
      currentColor = e.target.value;
    });

    // Color presets
    colorPresets?.forEach(btn => {
      btn.addEventListener('click', () => {
        currentColor = btn.dataset.color;
        if (colorPicker) colorPicker.value = currentColor;
      });
    });

    // Line width
    lineWidth?.addEventListener('input', (e) => {
      currentWidth = parseInt(e.target.value);
      if (lineWidthValue) lineWidthValue.textContent = currentWidth;
    });

    // Canvas drawing
    canvas?.addEventListener('mousedown', startDrawing);
    canvas?.addEventListener('mousemove', draw);
    canvas?.addEventListener('mouseup', stopDrawing);
    canvas?.addEventListener('mouseout', stopDrawing);

    // Touch support
    canvas?.addEventListener('touchstart', handleTouchStart);
    canvas?.addEventListener('touchmove', handleTouchMove);
    canvas?.addEventListener('touchend', handleTouchEnd);

    // Actions
    undoBtn?.addEventListener('click', undo);
    redoBtn?.addEventListener('click', redo);
    clearBtn?.addEventListener('click', clearCanvas);
    saveBtn?.addEventListener('click', saveImage);

    // Window controls
    minimizeBtn?.addEventListener('click', minimizeWhiteboard);
    closeBtn?.addEventListener('click', closeWhiteboard);
  }

  // Setup Socket.IO listeners
  function setupSocketListeners() {
    // ✅ SỬA: Lấy socket từ global scope thay vì window.state
    if (!window.socket) {
      console.warn('[Whiteboard] Socket not available');
      return;
    }

    // Receive draw start
    window.socket.on('wb_draw_start', ({ userId, x, y, tool, color, width }) => {
      activeDrawers.add(userId);
      updateActiveDrawers();
    });

    // Receive draw
    window.socket.on('wb_draw', ({ x1, y1, x2, y2, color, width, tool }) => {
      drawLine(x1, y1, x2, y2, color, width, tool === 'eraser');
    });

    // Receive shape
    window.socket.on('wb_shape', ({ type, x1, y1, x2, y2, color, width }) => {
      drawShape(type, x1, y1, x2, y2, color, width);
    });

    // Receive draw end
    window.socket.on('wb_draw_end', ({ userId }) => {
      activeDrawers.delete(userId);
      updateActiveDrawers();
    });

    // Receive clear
    window.socket.on('wb_clear', () => {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      history = [];
      historyStep = -1;
    });

    // Receive undo
    window.socket.on('wb_undo', () => {
      if (historyStep > 0) {
        historyStep--;
        restoreCanvasState();
      }
    });

    // Receive redo
    window.socket.on('wb_redo', () => {
      if (historyStep < history.length - 1) {
        historyStep++;
        restoreCanvasState();
      }
    });
  }

  // Toggle whiteboard visibility
  function toggleWhiteboard() {
    if (!container) return;
    const isVisible = container.style.display === 'flex';
    container.style.display = isVisible ? 'none' : 'flex';
    
    if (!isVisible) {
      resizeCanvas();
      updateStatusText('Đã mở bảng trắng');
    }
  }

  // Minimize whiteboard
  function minimizeWhiteboard() {
    if (container) container.style.display = 'none';
  }

  // Close whiteboard
  function closeWhiteboard() {
    if (container) container.style.display = 'none';
  }

  // Update canvas cursor based on tool
  function updateCanvasCursor() {
    if (!canvasContainer) return;
    canvasContainer.className = `canvas-container tool-${currentTool}`;
  }

  // Get mouse position
  function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  // Start drawing
  function startDrawing(e) {
    e.preventDefault();
    isDrawing = true;
    
    const pos = getMousePos(e);
    lastX = pos.x;
    lastY = pos.y;
    startX = pos.x;
    startY = pos.y;

    // Emit draw start
    emitDrawStart(pos.x, pos.y);
  }

  // Draw
  function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();

    const pos = getMousePos(e);

    if (currentTool === 'pen' || currentTool === 'eraser') {
      const isEraser = currentTool === 'eraser';
      drawLine(lastX, lastY, pos.x, pos.y, currentColor, currentWidth, isEraser);
      
      // Emit to other users
      emitDraw(lastX, lastY, pos.x, pos.y);
      
      lastX = pos.x;
      lastY = pos.y;
    }
  }

  // Stop drawing
  function stopDrawing(e) {
    if (!isDrawing) return;
    e?.preventDefault();

    const pos = getMousePos(e || { clientX: lastX, clientY: lastY });

    // Draw shapes on mouse up
    if (currentTool !== 'pen' && currentTool !== 'eraser') {
      drawShape(currentTool, startX, startY, pos.x, pos.y, currentColor, currentWidth);
      emitShape(currentTool, startX, startY, pos.x, pos.y);
    }

    isDrawing = false;
    saveState();
    emitDrawEnd();
  }

  // Draw line
  function drawLine(x1, y1, x2, y2, color, width, isEraser = false) {
    if (!ctx) return;
    
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = isEraser ? '#ffffff' : color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.closePath();
  }

  // Draw shape
  function drawShape(type, x1, y1, x2, y2, color, width) {
    if (!ctx) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = width;

    switch(type) {
      case 'line':
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        break;
      
      case 'rectangle':
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        break;
      
      case 'circle':
        const radius = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
        ctx.beginPath();
        ctx.arc(x1, y1, radius, 0, 2 * Math.PI);
        ctx.stroke();
        break;
    }
  }

  // Touch handlers
  function handleTouchStart(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousedown', {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    canvas.dispatchEvent(mouseEvent);
  }

  function handleTouchMove(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousemove', {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    canvas.dispatchEvent(mouseEvent);
  }

  function handleTouchEnd(e) {
    e.preventDefault();
    const mouseEvent = new MouseEvent('mouseup', {});
    canvas.dispatchEvent(mouseEvent);
  }

  // Save canvas state for undo/redo
  function saveState() {
    if (!canvas) return;
    
    historyStep++;
    if (historyStep < history.length) {
      history.length = historyStep;
    }
    history.push(canvas.toDataURL());
    
    if (history.length > MAX_HISTORY) {
      history.shift();
      historyStep--;
    }
  }

  // Restore canvas state
  function restoreCanvasState() {
    if (!canvas || historyStep < 0 || historyStep >= history.length) return;
    
    const img = new Image();
    img.src = history[historyStep];
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
  }

  // Undo
  function undo() {
    if (historyStep > 0) {
      historyStep--;
      restoreCanvasState();
      emitUndo();
    }
  }

  // Redo
  function redo() {
    if (historyStep < history.length - 1) {
      historyStep++;
      restoreCanvasState();
      emitRedo();
    }
  }

  // Clear canvas
  function clearCanvas() {
    if (!ctx || !canvas) return;
    
    if (!confirm('Xóa toàn bộ nội dung trên bảng?')) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    history = [];
    historyStep = -1;
    
    emitClear();
    updateStatusText('Đã xóa bảng trắng');
  }

  // Save image
  function saveImage() {
    if (!canvas) return;
    
    const link = document.createElement('a');
    link.download = `whiteboard-${Date.now()}.png`;
    link.href = canvas.toDataURL();
    link.click();
    
    updateStatusText('Đã lưu ảnh');
  }

  // Socket emit functions
  function emitDrawStart(x, y) {
    //  SỬA: Lấy từ global scope
    if (!window.socket || !window.roomId) return;
    
    window.socket.emit('wb_draw_start', {
      roomId: window.roomId,
      x, y,
      tool: currentTool,
      color: currentColor,
      width: currentWidth
    });
  }

  function emitDraw(x1, y1, x2, y2) {
    if (!window.socket || !window.roomId) return;
    
    window.socket.emit('wb_draw', {
      roomId: window.roomId,
      x1, y1, x2, y2,
      color: currentColor,
      width: currentWidth,
      tool: currentTool
    });
  }

  function emitShape(type, x1, y1, x2, y2) {
    if (!window.socket || !window.roomId) return;
    
    window.socket.emit('wb_shape', {
      roomId: window.roomId,
      type, x1, y1, x2, y2,
      color: currentColor,
      width: currentWidth
    });
  }

  function emitDrawEnd() {
    if (!window.socket || !window.roomId) return;
    
    window.socket.emit('wb_draw_end', { roomId: window.roomId });
  }

  function emitClear() {
    if (!window.socket || !window.roomId) return;
    
    window.socket.emit('wb_clear', { roomId: window.roomId });
  }

  function emitUndo() {
    if (!window.socket || !window.roomId) return;
    
    window.socket.emit('wb_undo', { roomId: window.roomId });
  }

  function emitRedo() {
    if (!window.socket || !window.roomId) return;
    
    window.socket.emit('wb_redo', { roomId: window.roomId });
  }

  // Update active drawers count
  function updateActiveDrawers() {
    if (usersDrawing) {
      usersDrawing.textContent = `${activeDrawers.size} người đang vẽ`;
    }
  }

  // Update status text
  function updateStatusText(text) {
    if (statusText) {
      statusText.textContent = text;
      setTimeout(() => {
        statusText.textContent = 'Sẵn sàng';
      }, 2000);
    }
  }

  // Cleanup
  function cleanup() {
    window.removeEventListener('resize', resizeCanvas);
    if (fab) fab.style.display = 'none';
    if (container) container.style.display = 'none';
    activeDrawers.clear();
  }

  // Export functions
  window.whiteboardHandlers = {
    init,
    cleanup,
    toggleWhiteboard
  };

  // Auto-init when in room
  if (window.state?.inRoom) {
    init();
  }

})();
