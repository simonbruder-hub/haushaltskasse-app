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

// Update von der veröffentlichten M3-Version: Produkt und Kürzel aus einem KI-Scan bleiben; neue Scans legen Artikel mit Packung an
const M3 = "2a7031a";
test("Update M3 → aktuell: Produkte und Kürzel bleiben, Preise pro kg ab dem nächsten Scan", async ({ browser }) => {
  test.skip((() => { try { execFileSync("git", ["cat-file", "-e", M3], { cwd: repo, stdio: "ignore" }); return false; } catch { return true; } })(), "M3 nicht im Verlauf");
  const alt = mkdtempSync(join(tmpdir(), "haushalt-m3-"));
  execFileSync("sh", ["-c", `git archive ${M3} neu | tar -x -C "${alt}"`], { cwd: repo });
  wurzel = join(alt, "neu");
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 412, height: 839 }, isMobile: true, hasTouch: true, locale: "de-CH" });
  const page = await ctx.newPage();
  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-expose-headers": "request-id" };
  const beleg = (datum: string, preis: number) => ({
    document: { document_type: "receipt", language: "de", legibility: "good", is_complete: true, warnings: [] },
    merchant: { name: "Coop", chain_key: "coop", branch_name: null, street: null, postal_code: null, city: null, country: "CH", vat_number: null },
    transaction: { date: datum, time: null, currency: "CHF", receipt_number: null, register_id: null, receipt_barcode_text: null, is_refund: false },
    line_items: [{ position: 1, raw_text: `CAFE CREME BOHNEN 500G ${preis.toFixed(2)}`, item_type: "product", quantity: 1, quantity_unit: "piece", unit_price: null,
      regular_price: preis, item_discount: 0, discount_label: null, final_price: preis, is_promo: false, pack_size_hint: { value: 500, unit: "g" },
      multipack_count: null, vat_code: null, ean: null, confidence: "high", product_name: "Kaffeebohnen", category: "Lebensmittel" }],
    basket_discounts: [], payments: [{ kind: "debit_card", label: "Karte", amount: preis, card_last4: null }],
    loyalty: { program: "none", card_masked: null, points_earned: null, points_redeemed: null },
    totals: { subtotal: preis, total: preis, rounding: 0, vat_lines: [] },
  });
  const antworten = [beleg("2026-09-02", 12.9), beleg("2026-10-02", 14.47)];
  await page.route("https://api.anthropic.com/**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    await route.fulfill({ status: 200, contentType: "application/json", headers: { ...cors, "request-id": "req_u" }, body: JSON.stringify({
      id: "msg_u", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
      content: [{ type: "text", text: JSON.stringify(antworten.shift()) }], usage: { input_tokens: 3000, output_tokens: 900 } }) });
  });
  const url = `http://localhost:${PORT}/`;
  const bild = readFileSync(fileURLToPath(new URL("./fixtures/beleg-kamera.mjpeg", import.meta.url)));
  const scannen = async () => {
    await page.getByRole("link", { name: "Erfassen", exact: true }).click();
    await page.getByLabel("Beleg aus Datei").setInputFiles({ name: "kaffee.jpg", mimeType: "image/jpeg", buffer: bild });
    await expect(page.getByRole("heading", { name: "Coop" })).toBeVisible({ timeout: 20_000 });
  };

  // M3: einrichten, KI-Schlüssel, Beleg scannen
  await page.goto(url);
  await page.getByText("Neuen Haushalt einrichten").click({ timeout: 30_000 });
  await page.getByRole("button", { name: "Haushalt einrichten" }).click();
  await expect(page.getByRole("heading", { name: "Hallo Simon" })).toBeVisible({ timeout: 20_000 });
  await page.goto(url + "#/einstellungen");
  await page.getByLabel("API-Schlüssel").fill("sk-ant-api03-test0000000000000000000000");
  await page.getByRole("button", { name: "Speichern" }).first().click();
  await scannen();
  await page.getByRole("button", { name: /^Bestätigen/ }).click();
  await expect(page.getByRole("status")).toHaveText("Beleg gespeichert", { timeout: 15_000 });

  // Aktueller Build: Datenbank v3 → v4
  wurzel = aktuell;
  await page.goto(url + "#/preise");
  await page.reload();
  await expect(page.getByRole("listitem", { name: "Kaffeebohnen" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("listitem", { name: "Kaffeebohnen" })).toContainText("kein Preis");   // M3 kannte die Packung noch nicht
  // Zweiter Scan: Kürzel bekannt (Vorschlag), Packung 500 g, Preis pro kg
  await scannen();
  await expect(page.getByText("Vorschlag", { exact: true })).toBeVisible();
  await expect(page.getByRole("listitem", { name: "Kaffeebohnen" })).toContainText("500 g");
  await page.getByRole("button", { name: /^Bestätigen/ }).click();
  await expect(page.getByRole("status")).toHaveText("Beleg gespeichert", { timeout: 15_000 });
  await page.goto(url + "#/preise");
  await expect(page.getByRole("listitem", { name: "Kaffeebohnen" })).toContainText("28.94 / kg");
  expect(fehler.filter((f) => !/ErrnoError/.test(f))).toEqual([]);
  await ctx.close();
});
