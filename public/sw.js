// Service worker de l'application installée (PWA) : la page s'ouvre même hors ligne avec son dernier état, les
// données (/api) viennent toujours du réseau et ne sont jamais gardées (elles changent toutes les minutes).
const CACHE = "snowchase-v1", SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/favicon-32.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting() });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== CACHE).map(n => caches.delete(n)))).then(() => self.clients.claim())) });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/")) return;
  // réseau d'abord (le site change à chaque push), le cache seulement hors ligne
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)) } return r })
    .catch(() => caches.match(e.request).then(r => r || caches.match("/"))));
});
