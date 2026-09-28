/* Destaque administrado no ERP. Cache HTTP de 30s; atualização sem rebuild. */
(() => {
  const container = document.getElementById('promo-banner');
  let fetching = false, generation = 0;
  function safeLink(value) {
    if (!value) return null;
    try {
      if (/^\/(?!\/)/.test(value)) return new URL(value, location.origin).href;
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : null;
    } catch (_) { return null; }
  }
  async function refresh() {
    if (fetching) return;
    fetching = true;
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const response = await fetch(`${API_BASE}/api/public/promocoes`, { signal: ctrl.signal });
      if (!response.ok) return;
      const { banner } = await response.json();
      const current = ++generation;
      if (!banner?.ativo) { container.hidden = true; container.replaceChildren(); delete container.dataset.banner; return; }
      if (!/^\/api\/public\/promocoes\/imagem\/[a-zA-Z0-9-]+\.webp$/.test(banner.imagem || '')) return;
      const src = new URL(banner.imagem, API_BASE).href;
      const signature = JSON.stringify([src, banner.textoAlternativo, banner.link, banner.largura, banner.altura]);
      if (container.dataset.banner === signature) return;
      const img = document.createElement('img');
      img.alt = String(banner.textoAlternativo || 'Promoção Lira Fraldas');
      img.decoding = 'async'; img.fetchPriority = 'high';
      if (Number(banner.largura) > 0 && Number(banner.altura) > 0) {
        img.width = Number(banner.largura); img.height = Number(banner.altura);
      }
      img.onload = () => {
        if (current !== generation) return;
        const href = safeLink(banner.link);
        const content = href ? document.createElement('a') : img;
        if (href) { content.href = href; content.append(img); }
        container.replaceChildren(content); container.hidden = false; container.dataset.banner = signature;
      };
      img.onerror = () => { if (current === generation) { container.hidden = true; delete container.dataset.banner; } };
      img.src = src;
    } catch (_) { /* Indisponibilidade temporária preserva o destaque já carregado. */ }
    finally { clearTimeout(timer); fetching = false; }
  }
  refresh();
  setInterval(refresh, 30_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
