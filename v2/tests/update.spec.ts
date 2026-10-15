import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

// Update von der veröffentlichten M1-Version auf den aktuellen Build: gleiche Adresse, gleiche Datenbank im Browser.
// Die alte Version kommt aus dem Git-Verlauf (Commit der M1-Veröffentlichung). Ohne Service Worker, damit der Wechsel sofort greift.
const VORVERSION = "d4beb45";
const repo = fileURLToPath(new URL("../..", import.meta.url));
const aktuell = fileURLToPath(new URL("../../neu", import.meta.url));
const vorhanden = (() => { try { execFileSync("git", ["cat-file", "-e", VORVERSION], { cwd: repo, stdio: "ignore" }); return true; } catch { return false; } })();
test.skip(!vorhanden, "Vorversion nicht im Git-Verlauf");

const TYPEN: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".data": "application/octet-stream",
  ".png": "image/png", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".json": "application/json",
};
const PORT = 4181;
let wurzel = "";
let server: http.Server | undefined;

test.beforeAll(async () => {
  const alt = mkdtempSync(join(tmpdir(), "haushalt-vorversion-"));
  execFileSync("sh", ["-c", `git archive ${VORVERSION} neu | tar -x -C "${alt}"`], { cwd: repo });
  wurzel = join(alt, "neu");
  server = http.createServer((req, res) => {
    let datei = normalize(join(wurzel, decodeURIComponent((req.url ?? "/").split("?")[0])));
    if (!datei.startsWith(wurzel)) { res.writeHead(403).end(); return; }
    if (existsSync(datei) && statSync(datei).isDirectory()) datei = join(datei, "index.html");
    if (!existsSync(datei)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": TYPEN[extname(datei)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(readFileSync(datei));
  });
  await new Promise<void>((ok) => server!.listen(PORT, ok));
});
test.afterAll(() => { server?.close(); });

test("Update M1 → aktuell: Daten bleiben, Belege und Ausgleich funktionieren", async ({ browser }) => {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 412, height: 839 }, isMobile: true, hasTouch: true, locale: "de-CH" });
  const page = await ctx.newPage();
  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  const url = `http://localhost:${PORT}/`;

  // Vorversion: Haushalt einrichten und ein Kind mit eigenem Topf erfassen
  await page.goto(url);
  await page.getByText("Neuen Haushalt einrichten").click({ timeout: 30_000 });
  await page.getByRole("button", { name: "Haushalt einrichten" }).click();
  await expect(page.getByRole("heading", { name: "Hallo Simon" })).toBeVisible({ timeout: 20_000 });
  await page.goto(url + "#/personen");
  await page.getByRole("button", { name: "Kind", exact: true }).click();
  await page.getByLabel("Name").fill("Kind 1");
  await page.getByRole("dialog").getByRole("button", { name: "Erfassen" }).click();
  await expect(page.getByText("Topf «Kind 1»")).toBeVisible();
  await expect(page.getByRole("link", { name: "Mehr", exact: true })).toHaveCount(0);
  await page.waitForTimeout(2000);   // M1 schreibt nach dem Speichern noch im Hintergrund in IndexedDB

  // Aktueller Build unter derselben Adresse: die Datenbank wird beim Start auf den neuen Stand gebracht
  wurzel = aktuell;
  await page.goto(url);
  await page.reload();
  await expect(page.getByRole("link", { name: "Mehr", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Hallo Simon" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kinder" })).toBeVisible();

  await page.getByRole("link", { name: "Erfassen", exact: true }).click();
  await page.getByLabel("Betrag", { exact: true }).fill("40");
  await page.getByRole("group", { name: "Wo", exact: true }).getByRole("button", { name: "Coop", exact: true }).click();
  await page.getByRole("group", { name: "Was", exact: true }).getByRole("button", { name: "Lebensmittel" }).click();
  await page.getByRole("button", { name: /^Speichern/ }).click();
  await expect(page.getByRole("heading", { name: "Ausgaben" })).toBeVisible();
  await page.getByRole("link", { name: "Ausgleich", exact: true }).click();
  await expect(page.getByTestId("saldo-text")).toHaveText("Eliana schuldet Simon");
  await expect(page.getByTestId("saldo-betrag")).toHaveText("CHF 20.00");

  // Nochmals neu laden: keine doppelte Migration, alles noch da
  await page.reload();
  await expect(page.getByTestId("saldo-betrag")).toHaveText("CHF 20.00", { timeout: 30_000 });
  expect(fehler.filter((f) => !/ErrnoError/.test(f))).toEqual([]);
  await ctx.close();
});

// Update von der veröffentlichten M2-Version mit einem echten Beleg
const M2 = "e62e009";
test("Update M2 → aktuell: Belege und Saldo bleiben, Scanner geht", async ({ browser }) => {
  test.skip((() => { try { execFileSync("git", ["cat-file", "-e", M2], { cwd: repo, stdio: "ignore" }); return false; } catch { return true; } })(), "M2 nicht im Verlauf");
  const alt = mkdtempSync(join(tmpdir(), "haushalt-m2-"));
  execFileSync("sh", ["-c", `git archive ${M2} neu | tar -x -C "${alt}"`], { cwd: repo });
  wurzel = join(alt, "neu");
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 412, height: 839 }, isMobile: true, hasTouch: true, locale: "de-CH" });
  const page = await ctx.newPage();
  const url = `http://localhost:${PORT}/`;
  await page.goto(url);
  await page.getByText("Neuen Haushalt einrichten").click({ timeout: 30_000 });
  await page.getByRole("button", { name: "Haushalt einrichten" }).click();
  await expect(page.getByRole("heading", { name: "Hallo Simon" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: "Erfassen", exact: true }).click();
  await page.getByLabel("Betrag", { exact: true }).fill("50");
  await page.getByRole("group", { name: "Wo", exact: true }).getByRole("button", { name: "Migros" }).click();
  await page.getByRole("group", { name: "Was", exact: true }).getByRole("button", { name: "Lebensmittel" }).click();
  await page.getByRole("button", { name: /^Speichern/ }).click();
  await expect(page.getByRole("status")).toHaveText("Gespeichert", { timeout: 15_000 });
  await expect(page.getByLabel("Beleg aus Datei")).toHaveCount(0);   // M2 hat noch keinen Scanner

  wurzel = aktuell;
  await page.goto(url + "#/ausgleich");
  await page.reload();
  await expect(page.getByTestId("saldo-betrag")).toHaveText("CHF 25.00", { timeout: 30_000 });
  await page.getByRole("link", { name: "Belege", exact: true }).click();
  await expect(page.getByRole("link", { name: /Migros/ })).toContainText("50.00");
  await page.getByRole("link", { name: "Erfassen", exact: true }).click();
  await expect(page.getByLabel("Beleg aus Datei")).toHaveCount(1);
  await ctx.close();
});
