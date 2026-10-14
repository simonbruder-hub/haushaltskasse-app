import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createHash } from "node:crypto";

/** Erzeugt sw.js mit der Liste aller gebauten Dateien: die App startet danach komplett offline. */
function serviceWorker(): Plugin {
  return {
    name: "haushalt-sw",
    apply: "build",
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith(".map"));
      const version = createHash("sha256").update(files.sort().join("|")).digest("hex").slice(0, 10);
      const source = `// Erzeugt beim Build – nicht von Hand ändern
const VERSION = "${version}";
const CACHE = "haushalt-" + VERSION;
const FILES = ${JSON.stringify(["./", ...files.map((f) => "./" + f), "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png"])};
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
`;
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  base: "./",
  define: { __BUILD__: JSON.stringify(new Date().toLocaleString("de-CH", { timeZone: "Europe/Zurich", dateStyle: "medium", timeStyle: "short" })) },
  plugins: [react(), tailwindcss(), serviceWorker()],
  optimizeDeps: { exclude: ["@electric-sql/pglite"] },
  worker: { format: "es" },
  build: { outDir: "../neu", emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 2000 },
});
