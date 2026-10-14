import { expect, test, type Page } from "@playwright/test";

// Konten, Kategorien, Personen und Einstellungen liegen seit M2 unter «Mehr»
const mehr = async (page: Page, eintrag: RegExp) => {
  await page.getByRole("link", { name: "Mehr", exact: true }).click();
  await page.getByRole("link", { name: eintrag }).click();
};

test("M1: einrichten, Konten, Kategorien, Kind, Neustart, offline", async ({ page, context }) => {
  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") fehler.push(m.text()); });

  await page.goto("./");
  await expect(page.getByText("Euer Haushalt an einem Ort")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "tests/bilder/1-start.png" });
  await page.getByText("Neuen Haushalt einrichten").click();
  await page.getByLabel("Name des Haushalts").fill("Altstetten");
  await page.screenshot({ path: "tests/bilder/2-einrichten.png", fullPage: true });
  await page.getByRole("button", { name: "Haushalt einrichten" }).click();
  await expect(page.getByRole("heading", { name: "Hallo Simon" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Gemeinsam Leben").first()).toBeVisible();
  await page.screenshot({ path: "tests/bilder/3-uebersicht.png", fullPage: true });

  // Gemeinsam Leben als echtes Konto führen, Karte erfassen
  await mehr(page, /^Konten und Töpfe/);
  await expect(page.getByRole("heading", { name: "Wo das Geld liegt" })).toBeVisible();
  await page.screenshot({ path: "tests/bilder/4-konten.png", fullPage: true });
  await page.getByRole("link", { name: /Gemeinsam Leben/ }).click();
  await page.getByRole("button", { name: "Als echtes Konto führen" }).click();
  await page.getByLabel("IBAN (optional)").fill("CH93 0076 2011 6238 5295 8");
  await expect(page.getByText("Die IBAN stimmt nicht.")).toBeVisible();
  await page.getByLabel("IBAN (optional)").fill("CH93 0076 2011 6238 5295 7");
  await page.getByLabel("Bank").fill("Zürcher Kantonalbank");
  await page.getByRole("dialog").getByRole("button", { name: "Als echtes Konto führen" }).click();
  await expect(page.getByText("Echtes Konto", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Neu" }).click();
  await page.getByLabel("Bezeichnung").fill("Debit Gemeinsam");
  await page.getByLabel("Letzte 4 Ziffern").fill("4711");
  await page.getByRole("button", { name: "Erfassen" }).click();
  await expect(page.getByText("•••• 4711")).toBeVisible();
  await page.screenshot({ path: "tests/bilder/5-konto.png", fullPage: true });

  // Kategorie «Velo» in den gemeinsamen Topf
  await mehr(page, /^Kategorien/);
  await page.getByRole("button", { name: /^Velo/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Gemeinsam Leben/ }).click();
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("button", { name: /^Velo/ })).toContainText("Gemeinsam Leben");
  await page.screenshot({ path: "tests/bilder/6-kategorien.png" });

  // Kind mit eigenem Topf
  await mehr(page, /^Personen/);
  await page.getByRole("button", { name: "Kind", exact: true }).click();
  await page.getByLabel("Name").fill("Kind 1");
  await page.getByRole("dialog").getByRole("button", { name: "Erfassen" }).click();
  await expect(page.getByText("Topf «Kind 1»")).toBeVisible();
  await page.screenshot({ path: "tests/bilder/7-personen.png", fullPage: true });

  // Neu laden: alles noch da
  await page.reload();
  await expect(page.getByText("Topf «Kind 1»")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: "Übersicht", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Kinder" })).toBeVisible();

  // Einstellungen
  await mehr(page, /^Einstellungen/);
  await expect(page.getByText("Nur auf diesem Handy").first()).toBeVisible();
  await page.screenshot({ path: "tests/bilder/8-einstellungen.png", fullPage: true });

  // Offline starten (Service Worker)
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Gerät und Abgleich" })).toBeVisible({ timeout: 20_000 });
  await context.setOffline(false);

  // «ErrnoError» meldet PGlite einmalig beim allerersten Start (Datenordner existiert noch nicht) – harmlos
  expect(fehler.filter((f) => !/favicon|Failed to load resource|ErrnoError/.test(f))).toEqual([]);
});
