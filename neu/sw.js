// Erzeugt beim Build – nicht von Hand ändern
const VERSION = "f250adcefc";
const CACHE = "haushalt-" + VERSION;
const FILES = ["./","./assets/__vite-browser-external-B8YGsjl0.js","./assets/__vite-browser-external-CrVWMDse.js","./assets/bricolage-grotesque-DLoelf7F.woff2","./assets/ibm-plex-mono-500-DSY6xOcd.woff2","./assets/index-6Nft6nLN.js","./assets/index-DZ57tMWK.css","./assets/initdb-BOrRGPBe.wasm","./assets/nodefs-SdrYzAlo.js","./assets/opfs-ahp-BcECuY3V.js","./assets/pglite-CB2rjG_k.data","./assets/pglite-Djh-vrdJ.wasm","./assets/rolldown-runtime-WkwZ5CU-.js","./assets/worker-CRQmREcz.js","./manifest.webmanifest","./icon-192.png","./icon-512.png","./icon-maskable-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((n) => n.startsWith("haushalt-") && n !== CACHE).map((n) => caches.delete(n)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(req, { ignoreSearch: true, ignoreVary: true }) || (req.mode === "navigate" ? await cache.match("./", { ignoreVary: true }) : null);
    if (hit) return hit;
    const res = await fetch(req).catch(() => null);
    return res || new Response("Offline", { status: 503 });
  }));
});
self.addEventListener("message", (e) => { if (e.data === "skipWaiting") self.skipWaiting(); });
