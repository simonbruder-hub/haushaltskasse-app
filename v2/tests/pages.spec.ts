import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

// Wie auf GitHub Pages: das ganze Repository als Website, die neue App unter /neu/, die alte App (mit Texterkennung) darüber.
// Prüft mit echtem Service Worker: Texterkennung einmal online laden, danach geht sie auch ohne Netz.
const wurzel = fileURLToPath(new URL("../../", import.meta.url));
const TYPEN: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".data": "application/octet-stream",
  ".png": "image/png", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".json": "application/json", ".gz": "application/gzip",
};
const PORT = 4182;
let server: http.Server | undefined;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    let datei = normalize(join(wurzel, decodeURIComponent((req.url ?? "/").split("?")[0])));
    if (!datei.startsWith(wurzel)) { res.writeHead(403).end(); return; }
    if (existsSync(datei) && statSync(datei).isDirectory()) datei = join(datei, "index.html");
    if (!existsSync(datei)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": TYPEN[extname(datei)] ?? "application/octet-stream" });
    res.end(readFileSync(datei));
  });
  await new Promise<void>((ok) => server!.listen(PORT, ok));
});
test.afterAll(() => { server?.close(); });

// Ohne Handy-Emulation zeichnen: Mit «isMobile» baut Chromium die Seite 980 px breit auf und verkleinert sie,
// dann hängt die Schriftgrösse im Bild von der Chromium-Version ab.
async function belegBild(page: Page, zeilen: string[]): Promise<Buffer> {
  const ctx = await page.context().browser()!.newContext({ viewport: { width: 560, height: 120 + zeilen.length * 44 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
  const p = await ctx.newPage();
  await p.setContent(`<body style="margin:0;background:#fff"><pre style="font:600 30px/44px 'DejaVu Sans Mono',monospace;margin:30px;color:#111">${zeilen.join("\n")}</pre></body>`);
  const b = await p.screenshot({ type: "png" });
  await ctx.close();
  return b;
}

test("GitHub-Pages-Aufbau: Texterkennung kommt von der alten App und geht danach offline", async ({ page, context }) => {
  test.setTimeout(240_000);
  await page.goto(`http://localhost:${PORT}/neu/`);
  await page.getByText("Neuen Haushalt einrichten").click({ timeout: 60_000 });
  await page.getByRole("button", { name: "Haushalt einrichten" }).click();
  await expect(page.getByRole("heading", { name: "Hallo Simon" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("status")).toHaveText("Haushalt eingerichtet", { timeout: 15_000 });   // erst jetzt fest gespeichert
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();   // ab jetzt steuert der Service Worker die Seite
  await expect(page.getByRole("heading", { name: "Hallo Simon" })).toBeVisible({ timeout: 30_000 });

  const bild = await belegBild(page, ["COOP", "", "BROT HALBWEISS           3.20", "BUTTER 250G              4.10", "", "TOTAL CHF                7.30"]);
  await page.getByRole("link", { name: "Erfassen", exact: true }).click();
  await page.getByLabel("Beleg aus Datei").setInputFiles({ name: "coop.png", mimeType: "image/png", buffer: bild });
  await expect(page.getByText("Beleg prüfen · auf dem Handy gelesen")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("summe")).toContainText("Summe stimmt");

  // Ohne Netz: App neu starten und nochmals lesen
  await context.setOffline(true);
  await page.goto(`http://localhost:${PORT}/neu/#/`);
  await expect(page.getByRole("heading", { name: "Hallo Simon" })).toBeVisible({ timeout: 30_000 });
  const bild2 = await belegBild(page, ["COOP", "", "MILCH 1L                 1.95", "", "TOTAL CHF                1.95"]);
  await page.getByRole("link", { name: "Erfassen", exact: true }).click();
  await page.getByLabel("Beleg aus Datei").setInputFiles({ name: "coop2.png", mimeType: "image/png", buffer: bild2 });
  await expect(page.getByText("Beleg prüfen · auf dem Handy gelesen")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("summe")).toContainText("Summe stimmt");
  await context.setOffline(false);
});
