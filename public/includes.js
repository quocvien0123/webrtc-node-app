(function(){
  async function includeFragments(){
    const nodes = Array.from(document.querySelectorAll('[data-include]'));
    await Promise.all(nodes.map(async node => {
      const path = node.getAttribute('data-include');
      try {
        const res = await fetch(path, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
        const html = await res.text();
        node.outerHTML = html; // replace the placeholder with the content
      } catch (e) {
        console.error(e);
      }
    }));
  }
  const ready = includeFragments();
  // expose a promise to wait for includes completion
  window.__includesReady = ready;
})();