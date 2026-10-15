import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// M3: Beleg-Scanner. Die Claude-API wird hier simuliert (ohne Schlüssel und Kosten); die Offline-Erkennung läuft echt (Tesseract).
const wurzel = fileURLToPath(new URL("../../", import.meta.url));
const beispiel = JSON.parse(readFileSync(new URL("../docs/scanner/beispiele/migros_beispiel_A.json", import.meta.url), "utf8"));
const ZUORDNUNG = [["Vollmilch", "Lebensmittel"], ["Bohnen", "Lebensmittel"], ["Bananen", "Lebensmittel"], ["Shampoo", "Drogerie"], ["Gesichtscreme", "Kosmetik und Coiffeur"]];
const extraktion = { ...beispiel, line_items: beispiel.line_items.map((z: object, i: number) => ({ ...z, product_name: ZUORDNUNG[i][0], category: ZUORDNUNG[i][1] })) };

/** Ein Kassenzettel als Bild: Text in Monospace, schwarz auf weiss */
// Ohne Handy-Emulation zeichnen, sonst hängt die Schriftgrösse im Bild von der Chromium-Version ab
async function belegBild(page: Page, zeilen: string[]): Promise<Buffer> {
  const ctx = await page.context().browser()!.newContext({ viewport: { width: 560, height: 120 + zeilen.length * 44 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
  const p = await ctx.newPage();
  await p.setContent(`<body style="margin:0;background:#fff"><pre style="font:600 30px/44px 'DejaVu Sans Mono',monospace;margin:30px;color:#111">${zeilen.join("\n")}</pre></body>`);
  const b = await p.screenshot({ type: "png" });
  await ctx.close();
  return b;
}

async function einrichten(page: Page) {
  await page.goto("./");
  await page.getByText("Neuen Haushalt einrichten").click({ timeout: 30_000 });
  await page.getByRole("button", { name: "Haushalt einrichten" }).click();
  await expect(page.getByRole("heading", { name: "Hallo Simon" })).toBeVisible({ timeout: 20_000 });
}

test("M3: Beleg mit KI scannen, prüfen, Topf ändern, lernen", async ({ page }) => {
  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  const anfragen: { body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const req = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-expose-headers": "request-id" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    anfragen.push({ body: req.postDataJSON(), headers: req.headers() });
    await route.fulfill({ status: 200, contentType: "application/json", headers: { ...cors, "request-id": "req_test" }, body: JSON.stringify({
      id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
      content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: JSON.stringify(extraktion) }],
      usage: { input_tokens: 5200, output_tokens: 1800, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }) });
  });
  await einrichten(page);

  // KI einrichten
  await page.goto("./#/einstellungen");
  await page.getByLabel("API-Schlüssel").fill("sk-ant-api03-test0000000000000000000000");
  await page.getByRole("button", { name: "Speichern" }).first().click();
  await expect(page.getByText("Schlüssel …0000")).toBeVisible();

  // Foto wählen → Prüf-Dialog
  const bild = await belegBild(page, ["MIGROS", "M-CL VOLLMI UHT 1L   3.30", "TOTAL  37.18"]);
  await page.getByRole("link", { name: "Erfassen", exact: true }).click();
  await page.getByLabel("Beleg aus Datei").setInputFiles({ name: "beleg.png", mimeType: "image/png", buffer: bild });
  await expect(page.getByRole("heading", { name: "Migros" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("summe")).toContainText("5 Positionen · Summe stimmt");
  const liste = page.getByRole("list", { name: "Positionen" });
  await expect(liste.getByRole("listitem")).toHaveCount(5);
  await expect(liste.getByRole("listitem", { name: "Bananen" })).toContainText("0.734 kg à 2.90");
  await expect(liste.getByRole("listitem", { name: "Bohnen" })).toContainText("− 3.90");
  await expect(liste.getByRole("listitem", { name: "Shampoo" })).toContainText("Drogerie");
  await expect(page.getByText("Cumulus-Bon · zählt für beide nach Anteil")).toBeVisible();
  await page.screenshot({ path: "tests/bilder/m3-1-pruefen.png", fullPage: true });

  // Gesichtscreme gehört Eliana
  await page.getByRole("button", { name: "Gesichtscreme bearbeiten" }).click();
  await page.getByRole("dialog").getByRole("group", { name: "Für wen" }).getByRole("button", { name: "Eliana", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Fertig" }).click();
  await expect(liste.getByRole("listitem", { name: "Gesichtscreme" })).toContainText("Eliana");
  await page.getByRole("button", { name: /^Bestätigen/ }).click();
  await expect(page.getByRole("heading", { name: "5 Positionen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Belegfoto anzeigen" })).toBeVisible();
  await expect(page.getByText(/^Gescannt/)).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Beleg gespeichert");

  // Anfrage an Claude: Modell, Schema, Cache, Fallback, Bild
  const a = anfragen[0];
  expect(a.headers["x-api-key"]).toBe("sk-ant-api03-test0000000000000000000000");
  expect(a.headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
  expect(a.body).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", output_config: { effort: "medium", format: { type: "json_schema" } } });
  expect((a.body.system as { cache_control: unknown }[])[0].cache_control).toEqual({ type: "ephemeral" });
  const inhalt = (a.body.messages as { content: { type: string; source?: { media_type: string } }[] }[])[0].content;
  expect(inhalt[0]).toMatchObject({ type: "image", source: { media_type: "image/jpeg" } });
  expect(JSON.stringify(a.body.output_config)).toContain("Kosmetik und Coiffeur");

  // Zweiter Scan desselben Fotos: Hinweis und gelernte Vorschläge
  await page.getByRole("link", { name: "Erfassen", exact: true }).click();
  await page.getByLabel("Beleg aus Datei").setInputFiles({ name: "beleg.png", mimeType: "image/png", buffer: bild });
  await expect(page.getByText(/Dieses Foto wurde schon erfasst/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Vorschlag", { exact: true })).toBeVisible();
  await expect(liste.getByRole("listitem", { name: "Gesichtscreme" })).toContainText("Kosmetik und Coiffeur");

  // Ausgleich: Eliana trägt die Hälfte der Lebensmittel und die Creme
  await page.getByRole("link", { name: "Ausgleich", exact: true }).click();
  await expect(page.getByTestId("saldo-text")).toHaveText("Eliana schuldet Simon");
  expect(fehler.filter((f) => !/ErrnoError/.test(f))).toEqual([]);
});

// Die Texterkennung wird hier über page.route aus dem Repository geliefert; das geht nur ohne Service Worker
test.describe(() => { test.use({ serviceWorkers: "block" });
test("M3: ohne KI liest das Handy selbst (Tesseract)", async ({ page }) => {
  test.setTimeout(150_000);
  // Die Texterkennung liegt bei der alten App (eine Ebene höher); die Vorschau hier liefert nur neu/ aus
  await page.route(/\/(ocr\/[^?]+|bon\.js)(\?.*)?$/, async (route) => {
    const pfad = new URL(route.request().url()).pathname.replace(/^\//, "");
    const typ = pfad.endsWith(".js") ? "text/javascript" : pfad.endsWith(".gz") ? "application/gzip" : "application/octet-stream";
    await route.fulfill({ status: 200, contentType: typ, body: readFileSync(wurzel + pfad) });
  });
  await einrichten(page);
  const bild = await belegBild(page, ["MIGROS", "", "VOLLMILCH UHT 1L        1.65", "BANANEN                 2.13", "ZWEIFEL CHIPS NATURE    4.95", "", "TOTAL CHF               8.73", "", "14.10.2026"]);
  await page.getByRole("link", { name: "Erfassen", exact: true }).click();
  await page.getByLabel("Beleg aus Datei").setInputFiles({ name: "kassenzettel.png", mimeType: "image/png", buffer: bild });
  await expect(page.getByRole("heading", { name: "Migros" })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("Beleg prüfen · auf dem Handy gelesen")).toBeVisible();
  await expect(page.getByTestId("summe")).toContainText("Summe stimmt");
  const liste = page.getByRole("list", { name: "Positionen" });
  await expect(liste.getByRole("listitem")).toHaveCount(3);
  // Supermarkt ohne KI: Kategorie «Lebensmittel» vorbelegt → gemeinsamer Topf
  await expect(liste.getByRole("listitem").first()).toContainText("Lebensmittel");
  await expect(liste.getByRole("listitem").first()).toContainText("Gemeinsam Leben");
  await page.screenshot({ path: "tests/bilder/m3-2-offline.png", fullPage: true });
  await page.getByRole("button", { name: /^Bestätigen/ }).click();
  await expect(page.getByRole("heading", { name: "3 Positionen" })).toBeVisible();

  // PDF ohne KI: klare Meldung
  await page.getByRole("link", { name: "Erfassen", exact: true }).click();
  await page.getByLabel("Beleg aus Datei").setInputFiles({ name: "e-beleg.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") });
  await expect(page.getByText(/PDF-Belege liest nur die KI-Erkennung/)).toBeVisible({ timeout: 20_000 });
});
});
