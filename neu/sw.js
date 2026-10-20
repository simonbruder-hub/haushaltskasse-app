// Erzeugt beim Build – nicht von Hand ändern
const VERSION = "a5d1250b3f";
const CACHE = "haushalt-" + VERSION;
const OCR_CACHE = "kasse-ocr-1";   // bleibt bei Updates erhalten (beginnt nicht mit «haushalt-»)
const FILES = ["./","./assets/__vite-browser-external-B8YGsjl0.js","./assets/__vite-browser-external-BMVrXnjC.js","./assets/bricolage-grotesque-DLoelf7F.woff2","./assets/error-BTdmRKoB.js","./assets/ibm-plex-mono-500-DSY6xOcd.woff2","./assets/index-BncuyQ_2.css","./assets/index-J5mPxxv9.js","./assets/initdb-BOrRGPBe.wasm","./assets/kanten.worker-CVayq6Ey.js","./assets/node.browser-BO-bfa86.js","./assets/node.browser-HQ5SKBOf.js","./assets/nodefs-DX8NxcEU.js","./assets/opfs-ahp-Dh6VxJGr.js","./assets/pglite-CB2rjG_k.data","./assets/pglite-Djh-vrdJ.wasm","./assets/ponyfill-DUnUwklG.js","./assets/rolldown-runtime-WkwZ5CU-.js","./assets/sdk-CxmnK7ss.js","./assets/worker-B6gDKoWE.js","./assets/zxing_reader-BxB2YfIY.wasm","./assets/zxing_reader-Wtw9a0oR.js","./manifest.webmanifest","./icon-192.png","./icon-512.png","./icon-maskable-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((n) => n.startsWith("haushalt-") && n !== CACHE).map((n) => caches.delete(n)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(req, { ignoreSearch: true, ignoreVary: true }) || (req.mode === "navigate" ? await cache.match("./", { ignoreVary: true }) : null);
    if (hit) return hit;
    // Texterkennung der alten App (../ocr/, ../bon.js): beim ersten Gebrauch in einen eigenen, dauerhaften Speicher
    const ocr = (url.pathname.includes("/ocr/") || url.pathname.endsWith("/bon.js")) && !url.pathname.startsWith(new URL("./", self.location.href).pathname);
    if (ocr) {
      const ablage = await caches.open(OCR_CACHE);
      const alt = await ablage.match(req, { ignoreSearch: true, ignoreVary: true });
      if (alt) return alt;
      const res = await fetch(req).catch(() => null);
      if (res && res.ok) ablage.put(req, res.clone());
      return res || new Response("Offline", { status: 503 });
    }
    const res = await fetch(req).catch(() => null);
    return res || new Response("Offline", { status: 503 });
  }));
});
self.addEventListener("message", (e) => { if (e.data === "skipWaiting") self.skipWaiting(); });
