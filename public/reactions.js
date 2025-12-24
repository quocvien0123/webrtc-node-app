// reactions.js - Emoji reactions

function toggleReactionsPopover() {
  if (!reactionsPopover) return;
  const visible = reactionsPopover.style.display !== 'none';
  reactionsPopover.style.display = visible ? 'none' : 'flex';
}

function rateLimitReaction() {
  const now = Date.now();
  lastReactions = lastReactions.filter(t => now - t < 3000);
  if (lastReactions.length >= 5) return false;
  lastReactions.push(now);
  return true;
}

function showReaction(emoji) {
  if (!reactionsLayer) return;
  const el = document.createElement('div');
  el.className = 'reaction-float';
  el.textContent = emoji;
  const left = 15 + Math.random() * 70;
  el.style.left = left + '%';
  const rotate = (Math.random() * 20 - 10).toFixed(0);
  el.style.transform = `translateY(0) rotate(${rotate}deg)`;
  reactionsLayer.appendChild(el);
  
  const cleanup = () => { 
    if (el.parentNode) el.parentNode.removeChild(el); 
  };
  el.addEventListener('animationend', cleanup);
  setTimeout(cleanup, 2000);
}

function emitReaction(emoji) {
  if (!roomId) return;
  if (!rateLimitReaction()) return;
  showReaction(emoji);
  socket.emit('reaction', { roomId, emoji, ts: Date.now() });
}

// ===== Reactions Event Listeners =====
function setupReactionsListeners() {
  reactionsBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleReactionsPopover();
  });

  reactionsPopover?.addEventListener('click', (e) => {
    const target = e.target;
    if (target && target.classList.contains('rxn')) {
      const emoji = target.textContent.trim();
      emitReaction(emoji);
      reactionsPopover.style.display = 'none';
    }
  });

  document.addEventListener('click', (e) => {
    if (!reactionsPopover || reactionsPopover.style.display === 'none') return;
    const within = reactionsPopover.contains(e.target) || reactionsBtn?.contains(e.target);
    if (!within) reactionsPopover.style.display = 'none';
  });
}
