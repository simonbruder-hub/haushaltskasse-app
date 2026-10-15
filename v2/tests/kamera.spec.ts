import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Dokumentscanner mit Live-Kamera: Chromium spielt ein Testbild als Kamera ab (Beleg schräg auf dunklem Holz).
// Die App muss die Kanten finden, selbst auslösen, entzerren und den Beleg danach ohne KI lesen (Tesseract).
const wurzel = fileURLToPath(new URL("../../", import.meta.url));
const video = fileURLToPath(new URL("./fixtures/beleg-kamera.mjpeg", import.meta.url));
test.use({
  serviceWorkers: "block",
  permissions: ["camera"],
  launchOptions: {
    executablePath: process.env.CHROMIUM ?? undefined,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${video}`],
  },
});

async function vorbereiten(page: Page) {
  await page.route(/\/(ocr\/[^?]+|bon\.js)(\?.*)?$/, async (route) => {
    const pfad = new URL(route.request().url()).pathname.replace(/^\//, "");
    const typ = pfad.endsWith(".js") ? "text/javascript" : pfad.endsWith(".gz") ? "application/gzip" : "application/octet-stream";
    await route.fulfill({ status: 200, contentType: typ, body: readFileSync(wurzel + pfad) });
  });
  await page.goto("./");
  await page.getByText("Neuen Haushalt einrichten").click({ timeout: 30_000 });
  await page.getByRole("button", { name: "Haushalt einrichten" }).click();
  await expect(page.getByRole("heading", { name: "Hallo Simon" })).toBeVisible({ timeout: 20_000 });
}

test("Kamera: Kanten finden, selbst auslösen, entzerren und lesen", async ({ page }) => {
  test.setTimeout(150_000);
  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  await vorbereiten(page);
  await page.getByRole("link", { name: "Erfassen", exact: true }).click();
  await page.getByRole("link", { name: "Fotografieren" }).click();
  const scanner = page.getByRole("dialog", { name: "Beleg scannen" });
  await expect(scanner).toBeVisible();
  // Auto-Auslöser: Quittung erkannt → ruhig → aufgenommen
  await expect(scanner.getByRole("status")).toHaveText(/Teil 1 aufgenommen/, { timeout: 30_000 });
  await page.screenshot({ path: "tests/bilder/kamera-1-live.png" });
  // Dieselbe Ansicht wird nicht ein zweites Mal aufgenommen (erst wenn der nächste Teil im Bild ist)
  await page.waitForTimeout(3500);
  await expect(scanner.getByRole("button", { name: "Fertig (1)" })).toBeVisible();
  await expect(scanner.getByRole("status")).toHaveText(/Teil 1 aufgenommen – nächsten Teil/);
  // Ecken nachträglich prüfen: der Zuschnitt zeigt die gefundenen Ecken (nicht das ganze Bild)
  await scanner.getByRole("button", { name: "Letzten Teil zuschneiden" }).click();
  const zuschnitt = page.getByRole("dialog", { name: "Zuschneiden" });
  const ecke = zuschnitt.getByRole("slider", { name: "Ecke oben links" });
  await expect(ecke).toHaveAttribute("aria-valuetext", /^(1[0-9]|2[0-4]) %, ([5-9]|1[0-9]) %$/);
  await page.screenshot({ path: "tests/bilder/kamera-2-zuschneiden.png" });
  await zuschnitt.getByRole("button", { name: "Übernehmen" }).click();
  await expect(zuschnitt).toBeHidden();
  await scanner.getByRole("button", { name: "Fertig (1)" }).click();
  await expect(scanner).toBeHidden();

  await expect(page.getByText("Beleg prüfen · auf dem Handy gelesen")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("heading", { name: "Coop" })).toBeVisible();
  await expect(page.getByTestId("summe")).toContainText("2 Positionen · Summe stimmt");
  await page.getByRole("button", { name: /^Bestätigen/ }).click();
  await expect(page.getByRole("heading", { name: "2 Positionen" })).toBeVisible({ timeout: 20_000 });
  expect(fehler.filter((f) => !/ErrnoError/.test(f))).toEqual([]);
});

test("Kamera: zwei Teile, einer aus der Galerie zugeschnitten", async ({ page }) => {
  test.setTimeout(150_000);
  await vorbereiten(page);
  await page.goto("./#/scan/kamera");
  const scanner = page.getByRole("dialog", { name: "Beleg scannen" });
  await expect(scanner.getByRole("status")).toHaveText(/Teil 1 aufgenommen/, { timeout: 30_000 });
  // Zweiter Teil aus der Galerie: Zuschneiden findet die Kanten selbst
  await scanner.getByLabel("Bilder aus der Galerie").setInputFiles({ name: "beleg.jpg", mimeType: "image/jpeg", buffer: readFileSync(video) });
  const zuschnitt = page.getByRole("dialog", { name: "Zuschneiden" });
  await expect(zuschnitt.getByRole("slider", { name: "Ecke unten rechts" })).toHaveAttribute("aria-valuetext", /^(7[5-9]|8[0-9]) %, (8[0-9]|9[0-4]) %$/);
  await zuschnitt.getByRole("button", { name: "Drehen" }).click();
  await zuschnitt.getByRole("button", { name: "Drehen" }).click();
  await zuschnitt.getByRole("button", { name: "Drehen" }).click();
  await zuschnitt.getByRole("button", { name: "Drehen" }).click();   // einmal ganz herum: gleiche Ecken wie vorher
  await expect(zuschnitt.getByRole("slider", { name: "Ecke unten rechts" })).toHaveAttribute("aria-valuetext", /^(7[5-9]|8[0-9]) %, (8[0-9]|9[0-4]) %$/);
  await zuschnitt.getByRole("button", { name: "Übernehmen" }).click();
  await expect(scanner.getByRole("button", { name: "Fertig (2)" })).toBeEnabled();
  await scanner.getByRole("button", { name: "Fertig (2)" }).click();
  // Zweimal derselbe Beleg: bon.js entfernt die doppelten Zeilen am Übergang nur bei Überlappung;
  // hier zählt, dass beide Teile gelesen werden und die Prüfung erscheint
  await expect(page.getByText("Beleg prüfen · auf dem Handy gelesen")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("heading", { name: "Coop" })).toBeVisible();
});
