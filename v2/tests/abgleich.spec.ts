import { expect, test, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { jwt, starten, stoppen, URL_SUPABASE, verfuegbar } from "../db/tests/supabase-nachbau";

// Zwei Handys (getrennte Browser-Profile) gleichen über den Supabase-Nachbau ab: echter PostgreSQL + PostgREST.
// Anmeldung per E-Mail-Code ersetzt hier eine vorbereitete Sitzung (GoTrue gibt es im Nachbau nicht).
test.skip(!verfuegbar(), "PostgreSQL oder PostgREST fehlt");
test.beforeAll(async () => { await starten(fileURLToPath(new URL("../supabase/migrations/20261014000000_m1_fundament.sql", import.meta.url))); });
test.afterAll(() => stoppen());

async function handy(browser: Browser, email: string) {
  const uid = randomUUID();
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const token = jwt(uid);
  await context.addInitScript(([url, key, token, uid, email]) => {
    localStorage.setItem("haushalt-debug", "1");
    if (localStorage.getItem("haushalt-supabase")) return;
    localStorage.setItem("haushalt-supabase", JSON.stringify({ url, key }));
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem("sb-localhost-auth-token", JSON.stringify({
      access_token: token, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "nachbau",
      user: { id: uid, aud: "authenticated", role: "authenticated", email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
    }));
  }, [URL_SUPABASE, jwt(null, "anon"), token, uid, email]);
  const page = await context.newPage();
  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  page.on("console", (m) => { if (m.type() !== "log" || m.text().startsWith("Abgleich")) console.log(email.slice(0, 6), m.type(), m.text().slice(0, 300)); });
  return { page, fehler };
}
const abgleichen = async (page: Page) => {
  await page.goto("./#/einstellungen");
  await page.getByRole("button", { name: "Jetzt abgleichen" }).click();
  await expect(page.getByText(/Abgeglichen/).first()).toBeVisible({ timeout: 15_000 });
};

test("Zwei Handys: einrichten, einladen, beitreten, Änderungen hin und her", async ({ browser }) => {
  const simon = await handy(browser, "simon@example.ch");
  await simon.page.goto("./");
  await simon.page.getByText("Neuen Haushalt einrichten").click({ timeout: 30_000 });
  await simon.page.getByRole("button", { name: "Haushalt einrichten" }).click();
  await expect(simon.page.getByRole("heading", { name: "Hallo Simon" })).toBeVisible({ timeout: 20_000 });
  // Der Abgleich startet von selbst, sobald es Änderungen gibt
  await expect(simon.page.getByTitle("Abgleich")).toContainText("Abgeglichen", { timeout: 20_000 });

  await simon.page.goto("./#/einstellungen");
  await expect(simon.page.getByText("simon@example.ch")).toBeVisible();
  await simon.page.getByRole("button", { name: "Partner einladen" }).click();
  const code = (await simon.page.locator(".num.select-all").textContent())!.trim();
  expect(code).toMatch(/^[A-Z0-9]{8}$/);
  await simon.page.screenshot({ path: "tests/bilder/9-einladen.png" });
  await simon.page.getByRole("button", { name: "Schliessen" }).click();

  const eliana = await handy(browser, "eliana@example.ch");
  await eliana.page.goto("./");
  await eliana.page.getByText("Einem Haushalt beitreten").click({ timeout: 30_000 });
  await expect(eliana.page.getByRole("heading", { name: "Einladungscode eingeben" })).toBeVisible();
  await eliana.page.locator("input.uppercase").fill(code);
  await eliana.page.getByRole("button", { name: "Beitreten" }).click();
  await expect(eliana.page.getByText("Wer benutzt dieses Handy?")).toBeVisible({ timeout: 30_000 });
  await eliana.page.getByRole("button", { name: "Eliana" }).click();
  await expect(eliana.page.getByRole("heading", { name: "Hallo Eliana" })).toBeVisible();
  await eliana.page.screenshot({ path: "tests/bilder/10-eliana.png", fullPage: true });

  // Eliana hängt «Velo» in den gemeinsamen Topf, Simon sieht es nach dem Abgleich
  await eliana.page.goto("./#/kategorien");
  await eliana.page.getByRole("button", { name: /^Velo/ }).click();
  await eliana.page.getByRole("dialog").getByRole("button", { name: /Gemeinsam Leben/ }).click();
  await eliana.page.getByRole("button", { name: "Speichern" }).click();
  await expect(eliana.page.getByRole("button", { name: /^Velo/ })).toContainText("Gemeinsam Leben");
  await abgleichen(eliana.page);
  await abgleichen(simon.page);
  await simon.page.goto("./#/kategorien");
  await expect(simon.page.getByRole("button", { name: /^Velo/ })).toContainText("Gemeinsam Leben", { timeout: 10_000 });

  // Simon erfasst ein Kind mit Topf → erscheint bei Eliana
  await simon.page.goto("./#/personen");
  await simon.page.getByRole("button", { name: "Kind", exact: true }).click();
  await simon.page.getByLabel("Name").fill("Kind 1");
  await simon.page.getByRole("dialog").getByRole("button", { name: "Erfassen" }).click();
  await expect(simon.page.getByText("Topf «Kind 1»")).toBeVisible();
  await abgleichen(simon.page);
  await abgleichen(eliana.page);
  await eliana.page.goto("./#/konten");
  await expect(eliana.page.getByRole("link", { name: /Kind 1/ })).toBeVisible({ timeout: 10_000 });

  expect([...simon.fehler, ...eliana.fehler].filter((f) => !/ErrnoError/.test(f))).toEqual([]);
});
