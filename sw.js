// Service Worker: hält die App offline verfügbar.
// Bei jeder neuen Version VERSION erhöhen, dann lädt das Handy die neuen Dateien.
const VERSION = "v1";
const CACHE = "kasse-" + VERSION;
const DATEIEN = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(DATEIEN)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", ev => {
  ev.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith("kasse-") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Zuerst aus dem Speicher (sofort, auch offline), im Hintergrund aktualisieren.
self.addEventListener("fetch", ev => {
  const req = ev.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  ev.respondWith(caches.open(CACHE).then(async cache => {
    const gespeichert = await cache.match(req, { ignoreSearch: true }) || (req.mode === "navigate" ? await cache.match("./index.html") : null);
    const netz = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    if (gespeichert) { ev.waitUntil(netz); return gespeichert; }
    const res = await netz;
    return res || new Response("Offline und noch nicht gespeichert.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }));
});
