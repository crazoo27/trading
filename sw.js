/* Service worker TradeDesk: simpan fail app (HTML, JS, CSS, ikon) dalam peranti supaya app terbuka
 * serta-merta dan masih boleh dibuka bila internet lemah. Data harga TIDAK disentuh — ia sentiasa live. */
const CACHE = 'tradedesk-shell-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API exchange: biar terus ke rangkaian

  // Halaman: rangkaian dulu (sentiasa versi terbaru bila online), cache bila offline / lambat
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 4000);
        const res = await fetch(req.url, { cache: 'no-store', signal: ctl.signal });
        clearTimeout(timer);
        if (res.ok) cache.put('./', res.clone());
        return res;
      } catch {
        return (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    const refresh = async () => {
      const res = await fetch(req);
      if (res.ok) {
        // buang versi lama fail yang sama (cth app.js?v=5 bila ?v=6 masuk)
        if (url.search) for (const k of await cache.keys()) { const u = new URL(k.url); if (u.pathname === url.pathname && u.search !== url.search) await cache.delete(k); }
        await cache.put(req, res.clone());
      }
      return res;
    };
    // Fail berversi (?v=N) tak pernah berubah: terus dari cache.
    if (hit && url.search.includes('v=')) return hit;
    // Lain-lain: guna cache serta-merta, segarkan di belakang tabir.
    if (hit) { e.waitUntil(refresh().catch(() => {})); return hit; }
    return refresh();
  })());
});
