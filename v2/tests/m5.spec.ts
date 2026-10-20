import { expect, test } from "@playwright/test";

// M5: Budget und Planung – Budget, Fixkosten, Dauerauftrag und die Karte auf der Übersicht
test("M5: Budget, Fixkost, Dauerauftrag anlegen; Karte auf der Übersicht", async ({ page }) => {
  test.setTimeout(90_000);
  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  await page.goto("./");
  await page.getByText("Neuen Haushalt einrichten").click({ timeout: 30_000 });
  await page.getByRole("button", { name: "Haushalt einrichten" }).click();
  await expect(page.getByRole("heading", { name: "Hallo Simon" })).toBeVisible({ timeout: 20_000 });

  // Budget «Lebensmittel» für Simon
  await page.goto("./#/budget");
  await page.getByRole("button", { name: "Budget", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Kategorie", exact: true }).click();
  await dialog.getByRole("button", { name: "Lebensmittel", exact: true }).click();
  await dialog.getByLabel("Pro Monat (CHF)").fill("300");
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("status")).toHaveText("Budget gespeichert", { timeout: 15_000 });
  const karte = page.getByRole("listitem", { name: "Lebensmittel Simon" });
  await expect(karte).toContainText("Heute noch");
  await expect(karte).toContainText("von 300.00");

  // Fixkost «Miete» im gemeinsamen Topf: je 1200
  await page.getByRole("button", { name: "Fixkosten", exact: true }).click();
  await page.getByRole("button", { name: "Fixkost", exact: true }).click();
  await dialog.getByLabel("Name", { exact: true }).fill("Miete");
  await dialog.getByLabel("Betrag (CHF)").fill("2400");
  await dialog.getByRole("button", { name: "Gemeinsam Leben" }).click();
  await dialog.getByLabel("Lebensbereich").selectOption({ label: "Wohnen" });
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("status")).toHaveText("Fixkost gespeichert", { timeout: 15_000 });
  await expect(page.getByRole("listitem", { name: "Miete" })).toContainText("2’400.00");
  await expect(page.getByTestId("fix-summe")).toContainText("1’200.00");

  // Dauerauftrag: von aussen (Lohn) aufs Privatkonto
  await page.getByRole("button", { name: "Daueraufträge", exact: true }).click();
  await page.getByRole("button", { name: "Dauerauftrag", exact: true }).click();
  await dialog.locator("select[aria-label='Nach']").selectOption({ label: "Simon Sparen (Topf)" });
  await dialog.getByLabel("Betrag (CHF)").fill("500");
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("status")).toHaveText("Dauerauftrag gespeichert", { timeout: 15_000 });
  await expect(page.getByRole("listitem", { name: "Von aussen nach Simon Sparen" })).toContainText("500.00");
  await expect(page.getByTestId("dauer-summe")).toContainText("500.00");

  // 50/30/20 zeigt ohne Lohn den Hinweis, die Übersicht die Budget-Karte
  await page.getByRole("button", { name: "50/30/20", exact: true }).click();
  await expect(page.getByRole("link", { name: "Lohn eintragen" }).first()).toBeVisible();
  await page.goto("./#/");
  await expect(page.getByTestId("planung-karte")).toContainText("Lebensmittel Simon");
  expect(fehler.filter((f) => !/ErrnoError/.test(f))).toEqual([]);
});
