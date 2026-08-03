/* Service Worker — Lira Fraldas (loja PWA)
   Estratégia anti-vazamento:
   - Cache VERSIONADO (bump CACHE ao publicar) + limpeza de versões antigas no activate.
   - HTML e produtos.js = network-first  -> nunca fica preso numa versão velha.
   - Imagens/ícones/estáticos = cache-first -> rápido e offline.
   - SÓ intercepta same-origin  -> não toca em wa.me / instagram / terceiros.
   - Não cacheia POST nem query de navegação externa.
*/
const CACHE = 'lira-loja-v3';
const CORE = [
  // A loja é a raiz (index.html). Até 03/08/26 este pré-cache e o fallback offline
  // abaixo ainda apontavam para '/02-loja-pratica.html', uma versão anterior da
  // loja: quem ficasse offline caía numa página que não é mais a oficial.
  '/',
  '/produtos.js',
  '/logo.png',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // só GET
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // só same-origin (sem vazamento p/ WhatsApp/externos)

  const isHTML = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  const isData = url.pathname.endsWith('produtos.js');

  if (isHTML || isData) {
    // network-first: sempre tenta o fresco; cai no cache só offline
    e.respondWith(
      fetch(req)
        .then((r) => {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return r;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/')))
    );
  } else {
    // cache-first: estáticos (fotos, logo, ícones)
    e.respondWith(
      caches.match(req).then((cached) =>
        cached ||
        fetch(req).then((r) => {
          if (r.ok && r.type === 'basic') {
            const copy = r.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return r;
        }).catch(() => cached)
      )
    );
  }
});
