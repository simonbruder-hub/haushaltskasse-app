import { expect, test, type Page } from "@playwright/test";

// M2 auf einem Handy (ohne Server): erfassen, aufteilen, Gutschein, Rabatt, Gutschrift, bearbeiten, löschen, ausgleichen, offline
const erfassen = async (page: Page) => {
  await page.getByRole("link", { name: "Erfassen", exact: true }).click();
  await expect(page.getByLabel("Betrag", { exact: true })).toBeVisible();
};
const gruppe = (page: Page, name: string) => page.getByRole("group", { name, exact: true });
const speichern = (page: Page) => page.getByRole("button", { name: /^(Speichern|Änderung speichern)/ }).click();

test("M2: Belege erfassen, aufteilen, Gutschrift, bearbeiten, ausgleichen", async ({ page, context }) => {
  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") fehler.push(m.text()); });

  await page.goto("./");
  await page.getByText("Neuen Haushalt einrichten").click({ timeout: 30_000 });
  await page.getByRole("button", { name: "Haushalt einrichten" }).click();
  await expect(page.getByRole("heading", { name: "Hallo Simon" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Erfasse euren ersten Einkauf")).toBeVisible();

  // 1) Schnell erfassen: Migros, Lebensmittel → Gemeinsam, bezahlt von Simon
  await erfassen(page);
  await page.getByLabel("Betrag", { exact: true }).fill("86.40");
  await gruppe(page, "Wo").getByRole("button", { name: "Migros" }).click();
  await gruppe(page, "Was").getByRole("button", { name: "Lebensmittel" }).click();
  await expect(gruppe(page, "Für wen").getByRole("button", { name: "Gemeinsam Leben" })).toHaveAttribute("aria-pressed", "true");
  await expect(gruppe(page, "Bezahlt von").getByRole("button", { name: "Simon Privat" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Aus diesem Beleg schuldet Eliana Simon CHF 43.20")).toBeVisible();
  await page.screenshot({ path: "tests/bilder/m2-1-erfassen.png", fullPage: true });
  await speichern(page);
  await expect(page.getByRole("heading", { name: "Ausgaben" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Migros/ })).toContainText("86.40");
  // «Gespeichert» heisst dauerhaft gespeichert: danach sofort neu laden (wie App wegwischen), der Beleg ist noch da
  await expect(page.getByRole("status")).toHaveText("Gespeichert");
  await page.reload();
  await expect(page.getByRole("link", { name: /Migros/ })).toContainText("86.40", { timeout: 20_000 });

  // 2) Coop mit Positionen: Shampoo für Simon (mit Rabatt), Rest gemeinsam, 5.– Superpunkte, bezahlt von Eliana
  await erfassen(page);
  await page.getByLabel("Betrag", { exact: true }).fill("52.30");
  await gruppe(page, "Wo").getByRole("button", { name: "Coop", exact: true }).click();
  await gruppe(page, "Was").getByRole("button", { name: "Lebensmittel" }).click();
  await gruppe(page, "Bezahlt von").getByRole("button", { name: "Eliana Privat" }).click();
  await page.getByRole("button", { name: "Gutschein / Punkte" }).click();
  await page.getByLabel("Betrag des Gutscheins").fill("5");
  await expect(page.getByText("Vom Konto: CHF 47.30")).toBeVisible();
  await page.getByRole("button", { name: "Positionen, Notiz, Währung" }).click();
  await page.getByRole("checkbox").check();
  await page.getByLabel("Position 1", { exact: true }).fill("Shampoo");
  await page.getByLabel("Betrag Position 1").fill("7.90");
  await page.getByLabel("Rabatt Position 1").fill("1");
  await gruppe(page, "Topf Position 1").getByRole("button", { name: "Simon", exact: true }).click();
  await expect(page.getByText("Rest 44.40")).toBeVisible();
  await expect(page.getByText("Aus diesem Beleg schuldet Simon Eliana CHF 27.22")).toBeVisible();
  await page.screenshot({ path: "tests/bilder/m2-2-positionen.png", fullPage: true });
  await speichern(page);
  await expect(page.getByRole("link", { name: /Coop/ })).toContainText("52.30");

  // Detail: Anteile und Positionen
  await page.getByRole("link", { name: /Coop/ }).click();
  await expect(page.getByText("Aus diesem Beleg schuldet Simon Eliana CHF 27.22")).toBeVisible();
  await expect(page.getByText("Rabatt 1.00")).toBeVisible();
  await expect(page.getByText("Übriges")).toBeVisible();
  await page.screenshot({ path: "tests/bilder/m2-3-detail.png", fullPage: true });

  // 3) Gutschrift: Shampoo zurückgebracht, Geld zurück auf Elianas Karte, gehört Simon
  await erfassen(page);
  await gruppe(page, "Art").getByRole("button", { name: "Gutschrift" }).click();
  await page.getByLabel("Betrag", { exact: true }).fill("7.90");
  await gruppe(page, "Wo").getByRole("button", { name: "Coop", exact: true }).click();
  await gruppe(page, "Für wen").getByRole("button", { name: "Simon", exact: true }).click();
  await gruppe(page, "Zurück auf").getByRole("button", { name: "Eliana Privat" }).click();
  await expect(page.getByText("Aus dieser Gutschrift schuldet Eliana Simon CHF 7.90")).toBeVisible();
  await speichern(page);
  await expect(page.getByRole("link", { name: /Gutschrift/ })).toContainText("7.90");

  // Saldo: 43.20 − 27.22 + 7.90 = 23.88
  await page.getByRole("link", { name: "Ausgleich", exact: true }).click();
  await expect(page.getByTestId("saldo-text")).toHaveText("Eliana schuldet Simon");
  await expect(page.getByTestId("saldo-betrag")).toHaveText("CHF 23.88");

  // 4) Bearbeiten: Migros war 90.–
  await page.getByRole("link", { name: "Belege", exact: true }).click();
  await page.getByRole("link", { name: /Migros/ }).click();
  await page.getByRole("link", { name: "Bearbeiten" }).click();
  await expect(page.getByLabel("Betrag", { exact: true })).toHaveValue("86.4");
  await page.getByLabel("Betrag", { exact: true }).fill("90");
  await speichern(page);
  await expect(page.getByRole("link", { name: "Bearbeiten" })).toBeVisible();
  await expect(page.getByText("CHF 90.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Aus diesem Beleg schuldet Eliana Simon CHF 45.00")).toBeVisible();

  // 5) Ausgleich buchen → quitt
  await page.getByRole("link", { name: "Ausgleich", exact: true }).click();
  await expect(page.getByTestId("saldo-betrag")).toHaveText("CHF 25.68");
  await page.screenshot({ path: "tests/bilder/m2-4-ausgleich.png", fullPage: true });
  await page.getByRole("button", { name: "Ausgleich erfassen" }).click();
  await expect(page.getByLabel("Betrag (CHF)")).toHaveValue("25.68");
  await page.getByRole("button", { name: "Ausgleich buchen" }).click();
  await expect(page.getByTestId("saldo-text")).toHaveText("Ihr seid quitt");
  await expect(page.getByRole("button", { name: /Ausgleichszahlung/ })).toBeVisible();

  // 6) Gutschrift löschen → jetzt schuldet Simon Eliana 7.90
  await page.getByRole("link", { name: "Belege", exact: true }).click();
  await page.getByRole("link", { name: /Gutschrift/ }).click();
  await page.getByRole("button", { name: "Beleg löschen" }).click();
  await page.getByRole("button", { name: "Ja, löschen" }).click();
  await expect(page.getByRole("heading", { name: "Ausgaben" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Gutschrift/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Ausgleich", exact: true }).click();
  await expect(page.getByTestId("saldo-text")).toHaveText("Simon schuldet Eliana");
  await expect(page.getByTestId("saldo-betrag")).toHaveText("CHF 7.90");

  // Filter in der Liste
  await page.getByRole("link", { name: "Belege", exact: true }).click();
  await gruppe(page, "Filter").getByRole("button", { name: "Simon" }).click();
  await expect(page.locator("a.row")).toHaveCount(1);
  await gruppe(page, "Filter").getByRole("button", { name: "Gemeinsam" }).click();
  await expect(page.locator("a.row")).toHaveCount(2);
  await page.screenshot({ path: "tests/bilder/m2-5-belege.png", fullPage: true });

  // Übersicht: Ausgleich, dieser Monat, zuletzt erfasst
  await page.getByRole("link", { name: "Übersicht", exact: true }).click();
  await expect(page.getByText("Simon schuldet Eliana")).toBeVisible();
  await expect(page.getByText("CHF 142.30")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Zuletzt erfasst" })).toBeVisible();
  await page.screenshot({ path: "tests/bilder/m2-6-uebersicht.png", fullPage: true });

  // Neu laden und offline: alles noch da
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.goto("./#/belege");
  await page.reload();
  await expect(page.getByRole("link", { name: /Coop/ })).toContainText("52.30", { timeout: 20_000 });
  await context.setOffline(false);

  expect(fehler.filter((f) => !/favicon|Failed to load resource|ErrnoError/.test(f))).toEqual([]);
});
