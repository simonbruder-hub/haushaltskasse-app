import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// M4: Produkte und Preise. Chromium spielt einen EAN-13-Strichcode als Kamera ab (7610200337030); gelesen wird er mit ZXing
// (WebAssembly aus dem Build – Chromium unter Linux hat keinen eingebauten BarcodeDetector). OpenFoodFacts und Claude sind simuliert.
const video = fileURLToPath(new URL("./fixtures/ean-kamera.mjpeg", import.meta.url));
test.use({
  serviceWorkers: "block",   // sonst sieht page.route die Anfragen an OpenFoodFacts und Claude nicht
  permissions: ["camera"],
  launchOptions: {
    executablePath: process.env.CHROMIUM ?? undefined,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${video}`],
  },
});
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-expose-headers": "request-id" };

/** Ein Beleg, wie ihn die KI liefert: Coop, eine Packung Kaffeebohnen 500 g */
function kaffeeBeleg(datum: string, preis: number) {
  return {
    document: { document_type: "receipt", language: "de", legibility: "good", is_complete: true, warnings: [] },
    merchant: { name: "Coop", chain_key: "coop", branch_name: null, street: null, postal_code: null, city: null, country: "CH", vat_number: null },
    transaction: { date: datum, time: "10:15", currency: "CHF", receipt_number: null, register_id: null, receipt_barcode_text: null, is_refund: false },
    line_items: [{ position: 1, raw_text: `QUALITE&PRIX CAFE CREME BOHNEN 500G ${preis.toFixed(2)}`, item_type: "product", quantity: 1, quantity_unit: "piece", unit_price: null,
      regular_price: preis, item_discount: 0, discount_label: null, final_price: preis, is_promo: false, pack_size_hint: { value: 500, unit: "g" },
      multipack_count: null, vat_code: null, ean: null, confidence: "high", product_name: "Kaffeebohnen", category: "Lebensmittel" }],
    basket_discounts: [], payments: [{ kind: "debit_card", label: "Karte", amount: preis, card_last4: null }],
    loyalty: { program: "none", card_masked: null, points_earned: null, points_redeemed: null },
    totals: { subtotal: preis, total: preis, rounding: 0, vat_lines: [] },
  };
}

async function claudeSimulieren(page: Page, antworten: object[]) {
  await page.route("https://api.anthropic.com/**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const e = antworten.shift();
    await route.fulfill({ status: 200, contentType: "application/json", headers: { ...CORS, "request-id": "req_m4" }, body: JSON.stringify({
      id: "msg_m4", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
      content: [{ type: "text", text: JSON.stringify(e) }], usage: { input_tokens: 3000, output_tokens: 900, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }) });
  });
}

async function einrichten(page: Page) {
  await page.goto("./");
  await page.getByText("Neuen Haushalt einrichten").click({ timeout: 30_000 });
  await page.getByRole("button", { name: "Haushalt einrichten" }).click();
  await expect(page.getByRole("heading", { name: "Hallo Simon" })).toBeVisible({ timeout: 20_000 });
}

async function belegScannen(page: Page) {
  await page.getByRole("link", { name: "Erfassen", exact: true }).click();
  await page.getByLabel("Beleg aus Datei").setInputFiles({ name: "kaffee.png", mimeType: "image/png", buffer: Buffer.from(readFileSync(fileURLToPath(new URL("./fixtures/beleg-kamera.mjpeg", import.meta.url)))) });
  await expect(page.getByRole("heading", { name: "Coop" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /^Bestätigen/ }).click();
  await expect(page.getByRole("status")).toHaveText("Beleg gespeichert", { timeout: 15_000 });
}

test("M4: Strichcode scannen, OpenFoodFacts, Regalpreis, Vergleich mit Belegen, Preisalarm", async ({ page }) => {
  test.setTimeout(120_000);
  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  await claudeSimulieren(page, [kaffeeBeleg("2026-09-02", 12.9), kaffeeBeleg("2026-10-02", 14.47)]);
  const offAnfragen: string[] = [];
  await page.route(/https:\/\/world\.open(food|beauty|products)facts\.org\/.*/, async (route) => {
    offAnfragen.push(route.request().url());
    await route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify({
      code: "7610200337030", status: 1, product: { product_name: "Caffè Crema Classico", generic_name_de: "Kaffeebohnen", brands: "Lavazza,Ferrero", quantity: "1 kg", categories_tags: ["en:coffees"] },
    }) });
  });
  await einrichten(page);
  await page.goto("./#/einstellungen");
  await page.getByLabel("API-Schlüssel").fill("sk-ant-api03-test0000000000000000000000");
  await page.getByRole("button", { name: "Speichern" }).first().click();
  await expect(page.getByText("Schlüssel …0000")).toBeVisible();

  // Erster Beleg: Kaffeebohnen 500 g bei Coop für 12.90 → 25.80 / kg
  await page.goto("./#/");
  await belegScannen(page);

  // Im Laden: Strichcode scannen
  await page.goto("./#/mehr");
  await page.getByRole("link", { name: /Produkte und Preise/ }).click();
  await expect(page.getByRole("listitem", { name: "Kaffeebohnen" })).toContainText("25.80 / kg");
  await page.getByRole("link", { name: "Preis prüfen" }).click();
  await expect(page.getByRole("heading", { name: "Caffè Crema Classico" })).toBeVisible({ timeout: 30_000 });
  expect(offAnfragen[0]).toContain("/api/v2/product/7610200337030?fields=");
  await expect(page.getByText(/Gefunden bei OpenFoodFacts/)).toBeVisible();
  await expect(page.getByLabel("Packungsgrösse")).toHaveValue("1");
  await expect(page.getByLabel("Einheit der Packung")).toHaveValue("kg");
  await page.getByRole("group", { name: "Vorschläge" }).getByRole("button", { name: "Kaffeebohnen" }).click();
  await page.getByRole("button", { name: "Speichern" }).click();

  // Preis-Check: bisher nur der Belegpreis von Coop
  await expect(page.getByRole("heading", { name: "Kaffeebohnen" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Lavazza · 1 kg")).toBeVisible();
  const preise = page.getByRole("list", { name: "Preise pro Laden" });
  await expect(preise.getByRole("listitem")).toHaveCount(1);
  await expect(preise.getByRole("listitem", { name: "Coop" })).toContainText("25.80 / kg");

  // Regalpreis bei Lidl: Aktion 19.90 statt 22.90
  await page.getByRole("group", { name: "Laden" }).getByRole("button", { name: "Lidl" }).click();
  await page.getByLabel("Aktion").check();
  await page.getByLabel("Aktionspreis").fill("19.90");
  await page.getByLabel("Normalpreis (falls angeschrieben)").fill("22.90");
  await page.getByRole("button", { name: "Preis speichern" }).click();
  await expect(page.getByRole("status")).toHaveText("Preis gespeichert");
  await expect(preise.getByRole("listitem")).toHaveCount(2);
  await expect(preise.getByRole("listitem").first()).toHaveAccessibleName("Lidl");
  await expect(preise.getByRole("listitem", { name: "Lidl" })).toContainText("günstigster");
  await expect(preise.getByRole("listitem", { name: "Lidl" })).toContainText("19.90 / kg");
  await expect(preise.getByRole("listitem", { name: "Lidl" })).toContainText("Aktion 19.90");
  await expect(preise.getByRole("listitem", { name: "Lidl" })).toContainText("Regal · statt 22.90");
  await page.screenshot({ path: "tests/bilder/m4-1-preischeck.png", fullPage: true });

  // Zweiter Beleg: gleicher Artikel bei Coop 14.47 → Preissprung +12.17 %
  await page.goto("./#/");
  await belegScannen(page);
  await page.goto("./#/");
  const karte = page.getByTestId("preis-karte");
  await expect(karte).toContainText("1 neuer Preisalarm");
  await expect(karte).toContainText("Teurer: Kaffeebohnen · Coop");
  await expect(karte).toContainText("12.90 → 14.47 · +12.2 %");
  await page.screenshot({ path: "tests/bilder/m4-2-uebersicht.png", fullPage: true });

  // Gelesen → verschwindet von der Übersicht
  await page.goto("./#/preise");
  await page.getByRole("button", { name: "Kaffeebohnen gelesen" }).click();
  await expect(page.getByRole("status")).toHaveText("Als gelesen markiert");
  await page.goto("./#/");
  await expect(page.getByTestId("preis-karte")).toContainText("Keine neuen Preisalarme");

  // Produkt: Verlauf, Artikel, Vergleich pro 100 g
  await page.goto("./#/preise");
  await page.getByRole("listitem", { name: "Kaffeebohnen" }).click();
  await expect(page.getByRole("list", { name: "Preisverlauf" }).getByRole("listitem")).toHaveCount(3);
  await expect(page.getByRole("list", { name: "Artikel" })).toContainText("EAN 7610200337030");
  await expect(page.getByRole("list", { name: "Artikel" })).toContainText("Beleg Coop · 500 g");
  await page.getByRole("button", { name: "Produkt bearbeiten" }).click();
  await page.getByRole("group", { name: "Vergleich" }).getByRole("button", { name: "100 g" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("list", { name: "Preise pro Laden" }).getByRole("listitem", { name: "Lidl" })).toContainText("1.99 / 100 g");
  await page.screenshot({ path: "tests/bilder/m4-3-produkt.png", fullPage: true });
  expect(fehler.filter((f) => !/ErrnoError/.test(f))).toEqual([]);
});

test("M4: Nummer eintippen, nicht bei OpenFoodFacts → kurz von Hand erfassen", async ({ page }) => {
  test.setTimeout(90_000);
  const gefragt: string[] = [];
  await page.route(/https:\/\/world\.open(food|beauty|products)facts\.org\/.*/, async (route) => {
    gefragt.push(new URL(route.request().url()).hostname);
    await route.fulfill({ status: 404, contentType: "application/json", headers: CORS, body: JSON.stringify({ code: "4006381333931", status: 0, status_verbose: "product not found" }) });
  });
  await einrichten(page);
  await page.goto("./#/preis-pruefen");
  const scanner = page.getByRole("dialog", { name: "Preis prüfen" });
  await scanner.getByRole("button", { name: "Nummer eintippen" }).click();
  await scanner.getByLabel("EAN-Nummer").fill("4006381333932");
  await expect(scanner.getByText(/Prüfziffer stimmt nicht/)).toBeVisible();
  await scanner.getByLabel("EAN-Nummer").fill("4006381333931");
  await scanner.getByRole("button", { name: "Übernehmen" }).click();
  await expect(page.getByText(/Nicht bei OpenFoodFacts/)).toBeVisible({ timeout: 15_000 });
  expect(gefragt).toEqual(["world.openfoodfacts.org", "world.openbeautyfacts.org", "world.openproductsfacts.org"]);
  await page.getByLabel("Bezeichnung auf der Packung").fill("Textmarker gelb");
  await page.getByLabel("Marke").fill("Stabilo");
  await page.getByLabel("Packungsgrösse").fill("4");
  await page.getByLabel("Einheit der Packung").selectOption("piece");
  await page.getByLabel("Produkt", { exact: true }).fill("Textmarker");
  await page.getByRole("group", { name: "Kategorie" }).getByRole("button", { name: "Alle Kategorien …" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Hobby" }).click();
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("heading", { name: "Textmarker" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Stabilo · 4 Stk.")).toBeVisible();
  // Zweites Mal dieselbe Nummer: sofort bekannt, ohne OpenFoodFacts zu fragen
  await page.getByRole("button", { name: "Nächster Artikel" }).click();
  await page.getByRole("dialog", { name: "Preis prüfen" }).getByRole("button", { name: "Nummer eintippen" }).click();
  await page.getByLabel("EAN-Nummer").fill("4006381333931");
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await expect(page.getByRole("heading", { name: "Textmarker" })).toBeVisible();
  expect(gefragt).toHaveLength(3);
});
