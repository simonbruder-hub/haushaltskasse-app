// Service Worker: hält die App offline verfügbar.
// Bei jeder neuen Version VERSION erhöhen, dann lädt das Handy die neuen Dateien.
const VERSION = "v5";
const CACHE = "kasse-" + VERSION;
const DATEIEN = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./apple-touch-icon.png",
  "./kern.js", "./liste.js", "./preise.js", "./erfassen.js", "./budget.js", "./abgleich.js", "./produkte.js", "./excel.js", "./bon.js", "./ocr/tesseract.min.js",
  "./bild.js", "./scanner.js", "./scan-worker.js", "./pdf.js", "./ablage.js", "./entwurf.js",
  "./fonts/bricolage-grotesque.woff2", "./fonts/ibm-plex-mono-500.woff2", "./Haushaltsbudget-Vorlage.xlsx"];
// Texterkennung (rund 5 MB, ändert sich selten): eigener Speicher, der bei App-Updates erhalten bleibt.
// Bei neuen OCR-Dateien OCR_CACHE umbenennen.
const OCR_CACHE = "kasse-ocr-1";
const OCR_DATEIEN = ["./ocr/worker.min.js", "./ocr/tesseract-core-simd-lstm.wasm.js", "./ocr/deu.traineddata.gz"];

self.addEventListener("install", ev => {
  const app = caches.open(CACHE).then(c => c.addAll(DATEIEN));
  // Fehlt das Netz für die grossen Dateien, installiert sich die App trotzdem; sie werden beim ersten Auslesen geholt.
  const ocr = caches.open(OCR_CACHE).then(async c => { for (const f of OCR_DATEIEN) if (!(await c.match(f))) await c.add(f); }).catch(() => { });
  ev.waitUntil(Promise.all([app, ocr]).then(() => self.skipWaiting()));
});

self.addEventListener("activate", ev => {
  ev.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith("kasse-") && k !== CACHE && k !== OCR_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", ev => {
  const req = ev.request;
  const url = new URL(req.url);
  // Die neue App unter /neu/ hat ihren eigenen Service Worker – hier nicht abfangen
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.includes("/neu/") || url.pathname.includes("/v2/")) return;
  // Texterkennung: nur aus dem Speicher, beim ersten Mal aus dem Netz holen und ablegen
  if (url.pathname.includes("/ocr/") && !url.pathname.endsWith("/tesseract.min.js")) {
    ev.respondWith(caches.open(OCR_CACHE).then(async cache => {
      const gespeichert = await cache.match(req, { ignoreSearch: true });
      if (gespeichert) return gespeichert;
      const res = await fetch(req).catch(() => null);
      if (res && res.ok) { cache.put(req, res.clone()); return res; }
      return res || new Response("Offline und noch nicht gespeichert.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }));
    return;
  }
  // Übrige Dateien: zuerst aus dem Speicher (sofort, auch offline), im Hintergrund aktualisieren.
  ev.respondWith(caches.open(CACHE).then(async cache => {
    const gespeichert = await cache.match(req, { ignoreSearch: true }) || (req.mode === "navigate" ? await cache.match("./index.html") : null);
    const netz = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    if (gespeichert) { ev.waitUntil(netz); return gespeichert; }
    const res = await netz;
    return res || new Response("Offline und noch nicht gespeichert.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }));
});
