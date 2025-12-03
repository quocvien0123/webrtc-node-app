// includes.js
// ==========================================
// HTML PARTIAL LOADER
// ==========================================
// Tải các HTML fragments từ thư mục partials/
// và inject vào DOM tại vị trí có attribute data-include
// 
// Cách sử dụng trong HTML:
// <div data-include="partials/header.html"></div>
// 
// Script này chạy ngay khi load và expose promise
// window.__includesReady để các script khác đợi
// ==========================================

(function(){
  // ===== FUNCTION: INCLUDE FRAGMENTS =====
  // Tìm tất cả elements có data-include và load HTML từ path
  async function includeFragments(){
    // Lấy tất cả nodes có attribute data-include
    const nodes = Array.from(document.querySelectorAll('[data-include]'));
    
    // Load tất cả fragments song song (parallel)
    await Promise.all(nodes.map(async node => {
      // Lấy đường dẫn từ attribute
      const path = node.getAttribute('data-include');
      
      try {
        // Fetch HTML content từ server
        const res = await fetch(path, { cache: 'no-cache' }); // Không cache để dev dễ dàng
        
        if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
        
        // Lấy HTML text từ response
        const html = await res.text();
        
        // Thay thế placeholder node bằng HTML content
        node.outerHTML = html;
      } catch (e) {
        console.error('[Includes] Error loading partial:', e);
      }
    }));
  }
  
  // ===== EXPOSE PROMISE =====
  // Chạy includeFragments và lưu Promise vào window
  // Các script khác có thể await window.__includesReady
  const ready = includeFragments();
  window.__includesReady = ready;
})();