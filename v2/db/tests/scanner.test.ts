import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import type { Db } from "../../src/db/types";
import { handy } from "./hilfe";
import beispielText from "../../docs/scanner/beispiele/migros_beispiel_A.json?raw";
import { anfrageSchema, SYSTEMPROMPT } from "../../src/scan/schema";
import { pruefen } from "../../src/scan/pruefen";
import { entwurfBauen, entwurfSpeichern, zeilenSumme } from "../../src/scan/entwurf";
import type { Extraktion } from "../../src/scan/typen";
import { belegLoeschen, saldo } from "../../src/lib/belege";
import { KONTEN_SQL, type Konto } from "../../src/lib/data";
import { SyncEngine } from "../../src/sync/engine";
import { PGliteRemote } from "../../src/sync/remote-pglite";
import { server } from "./hilfe";

// M3: Kürzel-Wörterbuch und Produkte (Blueprint §3.3)
let db: Db;
const H = randomUUID();
const MIGROS = "00000000-0000-4000-8000-000000000001";
const eins = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0];

describe("Kürzel-Wörterbuch", () => {
  beforeAll(async () => {
    db = await handy();
    await db.query(`select seed_household($1, 'Altstetten', 'Simon', 'Eliana')`, [H]);
  });

  test.each([
    ["M-CL VOLLMI UHT 1L     1.65 A", "M-CL VOLLMI UHT 1L"],
    ["2 x ZWEIFEL CHIPS NATURE 280G", "ZWEIFEL CHIPS NATURE 280G"],
    ["BANANEN 0.734 kg x 2.90/kg 2.13", "BANANEN"],
    ["Müsli Bircher* AKTION", "MUESLI BIRCHER"],
  ])("Schlüssel für «%s»", async (raw, key) => {
    expect((await eins<{ k: string }>(`select alias_key($1) as k`, [raw])).k).toBe(key);
  });

  test("Produkt: gleicher Name → gleiches Produkt, feste ID über Geräte hinweg", async () => {
    const kat = (await eins<{ id: string }>(`select id from category where household_id = $1 and name = 'Lebensmittel'`, [H])).id;
    const a = (await eins<{ id: string }>(`select produkt_sichern($1, 'Vollmilch', $2, 'per_1l') as id`, [H, kat])).id;
    const b = (await eins<{ id: string }>(`select produkt_sichern($1, '  vollmilch ', null, null) as id`, [H])).id;
    expect(b).toBe(a);
    const anderesHandy = await handy();
    await anderesHandy.query(`select seed_household($1, 'Altstetten', 'Simon', 'Eliana')`, [H]).catch(() => undefined);
    const c = (await anderesHandy.query<{ id: string }>(`select stabile_id('produkt', $1::text, 'vollmilch') as id`, [H])).rows[0].id;
    expect(c).toBe(a);
  });

  test("Lernen: erst Vorschlag, ab der fünften Bestätigung automatisch", async () => {
    const kat = (await eins<{ id: string }>(`select id from category where household_id = $1 and name = 'Lebensmittel'`, [H])).id;
    const p = (await eins<{ id: string }>(`select produkt_sichern($1, 'Vollmilch', $2, 'per_1l') as id`, [H, kat])).id;
    const raw = "M-CL VOLLMI UHT 1L     1.65 A";
    const vorschlag = async () => (await db.query<{ produkt: string | null; confidence: string | null; sicher: boolean }>(
      `select produkt, confidence::text, sicher from kuerzel_vorschlaege($1, $2, $3)`, [H, MIGROS, [raw]])).rows[0];
    expect(await vorschlag()).toMatchObject({ produkt: null, sicher: false });
    const stufen: [string, boolean][] = [];
    for (let i = 1; i <= 5; i++) {
      await db.query(`select confirm_alias($1, $2, $3, $4, null, 1.65, $5)`, [H, MIGROS, raw, p, i > 1]);
      const v = await vorschlag();
      stufen.push([v.confidence!, v.sicher]);
    }
    // gesehen/bestätigt: 1/1 → 0.667 · 2/2 → 0.75 · 3/3 → 0.8 · 4/4 → 0.833 · 5/5 → 0.857 (automatisch)
    expect(stufen).toEqual([["0.667", false], ["0.750", false], ["0.800", false], ["0.833", false], ["0.857", true]]);
    expect((await vorschlag()).produkt).toBe("Vollmilch");
    // Andere Schreibweise desselben Artikels (Menge vorne, Preis hinten) → gleicher Schlüssel
    const v2 = (await db.query<{ produkt: string }>(`select produkt from kuerzel_vorschlaege($1, $2, $3)`, [H, MIGROS, ["2 x M-CL VOLLMI UHT 1L"]])).rows[0];
    expect(v2.produkt).toBe("Vollmilch");
  });

  test("Korrektur: falscher Vorschlag zählt als korrigiert und senkt die Sicherheit", async () => {
    const p2 = (await eins<{ id: string }>(`select produkt_sichern($1, 'Milchdrink', null, 'per_1l') as id`, [H])).id;
    await db.query(`select confirm_alias($1, $2, 'M-CL VOLLMI UHT 1L', $3, null, 1.70, false)`, [H, MIGROS, p2]);
    const r = await eins<{ times_seen: number; times_corrected: number; produkt: string; sicher: boolean }>(
      `select m.times_seen, m.times_corrected, k.produkt, k.sicher from receipt_alias_mapping m
         cross join kuerzel_vorschlaege($1, $2, array['M-CL VOLLMI UHT 1L']) k
        where m.household_id = $1 and m.raw_text_key = 'M-CL VOLLMI UHT 1L'`, [H, MIGROS]);
    expect(r).toMatchObject({ times_seen: 6, times_corrected: 1, produkt: "Milchdrink", sicher: false });   // (5+1)/(6+2) = 0.75
  });

  test("Neue Tabellen sind im Abgleich und haben die Outbox", async () => {
    const t = (await db.query<{ name: string }>(`select name from sync_tables() order by ord`)).rows.map((r) => r.name);
    expect(t).toEqual(expect.arrayContaining(["master_product", "receipt_alias_mapping", "attachment"]));
    expect(t.indexOf("master_product")).toBeLessThan(t.indexOf("receipt_alias_mapping"));
    expect(t.indexOf("attachment")).toBeLessThan(t.indexOf("transaction_header"));
    const n = (await eins<{ n: number }>(`select count(*)::int as n from _outbox where table_name in ('master_product', 'receipt_alias_mapping')`)).n;
    expect(n).toBeGreaterThan(0);
  });
});

// ---------- Vom Erkennungsergebnis zum gebuchten Beleg ----------

const ZUORDNUNG: [string, string][] = [["Vollmilch", "Lebensmittel"], ["Bohnen", "Lebensmittel"], ["Bananen", "Lebensmittel"],
  ["Shampoo", "Drogerie"], ["Gesichtscreme", "Kosmetik und Coiffeur"]];
const beispiel = (): Extraktion => {
  const e = JSON.parse(beispielText) as Extraktion;
  e.line_items = e.line_items.map((z, i) => ({ ...z, product_name: ZUORDNUNG[i][0], category: ZUORDNUNG[i][1] }));
  return e;
};

describe("Scanner: Schema, Prüfung, Entwurf, Lernen", () => {
  let d: Db;
  const HH = randomUUID();
  let konten: Konto[];
  let kats: { id: string; name: string; default_cost_account_id: string | null }[];
  const ctx = () => ({ household: HH, konto: konten.find((k) => k.name === "Simon Privat")!.id, konten, ich: konten.find((k) => k.name === "Simon Privat")!.owners[0].person_id,
    kategorien: kats });
  const heute = "2026-10-15";

  beforeAll(async () => {
    d = await handy();
    await d.query(`select seed_household($1, 'Altstetten', 'Simon', 'Eliana')`, [HH]);
    konten = (await d.query<Konto>(KONTEN_SQL, [HH])).rows;
    kats = (await d.query<{ id: string; name: string; default_cost_account_id: string | null }>(
      `select id, name, default_cost_account_id from category where household_id = $1`, [HH])).rows;
    const sp = konten.find((k) => k.name === "Simon Privat")!;
    await d.query(`insert into payment_method (id, household_id, account_id, kind, label, card_last4) values ($1, $2, $3, 'debit_card', 'Debit Simon', '4711')`,
      [randomUUID(), HH, sp.id]);
  });

  test("Schema für Structured Outputs: ohne $ref, mit Produkt und Kategorie pro Position", () => {
    const s = anfrageSchema(["Lebensmittel", "Drogerie", "Lebensmittel"]);
    const text = JSON.stringify(s);
    expect(text).not.toContain("$ref");
    expect(text).not.toContain("$schema");
    const zeile = (s as any).properties.line_items.items;
    expect(zeile.required).toEqual(expect.arrayContaining(["product_name", "category"]));
    expect(zeile.properties.category.anyOf[0].enum).toEqual(["Lebensmittel", "Drogerie"]);
    expect(zeile.additionalProperties).toBe(false);
    expect(SYSTEMPROMPT).toMatch(/^Du liest Kassenbelege/);
    expect(SYSTEMPROMPT).toContain("product_name");
  });

  test("Prüfung: Beispiel A stimmt; falsche Summe und falsche Zeile fallen auf", () => {
    expect(pruefen(beispiel(), heute)).toEqual([]);
    const falsch = beispiel();
    falsch.line_items[1].final_price = 9.4;
    falsch.transaction.date = "2027-01-01";
    const a = pruefen(falsch, heute);
    expect(a.map((x) => x.text).join(" | ")).toMatch(/Summe der Positionen \(37.58\) ≠ Total \(37.18\).*Zeile 2.*Zukunft/);
    expect(a.find((x) => x.zeilen)?.zeilen).toEqual([2]);
  });

  test("Entwurf: Laden, Kategorien, Menge, Karte → Konto, Gutschein ohne Konto", async () => {
    const e = await entwurfBauen(d, { household: HH, extraktion: beispiel(), quelle: "ki", kanal: "receipt_image", abweichungen: [], heute, datei: null, protokoll: null });
    expect(e.laden).toBe(MIGROS);
    expect(e.ladenName).toBe("Migros");
    expect(e.zeit).toBe("17:42");
    expect(e.zeilen.map((z) => [z.name, kats.find((k) => k.id === z.kategorie)?.name, z.status])).toEqual(
      ZUORDNUNG.map(([n, k]) => [n, k, "ki"]));
    expect(e.zeilen[2]).toMatchObject({ menge: 0.734, einheit: "kg", einzelpreis: 2.9, betrag: 2.13, vergleich: "per_1kg" });
    expect(e.zeilen[1]).toMatchObject({ betrag: 9, rabatt: 3.9, rabattText: "Aktion 30%" });
    const sp = konten.find((k) => k.name === "Simon Privat")!.id;
    expect(e.zahlungen).toEqual([
      { art: "loyalty_points", betrag: 5, konto: null, label: "Cumulus-Bon", last4: null },
      { art: "debit_card", betrag: 32.18, konto: sp, label: "Debit Mastercard", last4: "4711" },
    ]);
    expect(zeilenSumme(e)).toBe(37.18);
  });

  let ersterBeleg = "";
  test("Bestätigen: Beleg gebucht, Töpfe nach Kategorie, Produkte und Kürzel gelernt", async () => {
    const e = await entwurfBauen(d, { household: HH, extraktion: beispiel(), quelle: "ki", kanal: "receipt_image", abweichungen: [], heute, datei: null,
      protokoll: { modell: "claude-opus-5-5", requestId: "req_1", tokensIn: 5000, tokensOut: 2000, roh: { id: "msg_1" }, parsed: beispiel() } });
    ersterBeleg = await entwurfSpeichern(d, e, ctx());
    const h = (await d.query<{ total: string; source: string; at: string | null; nr: string | null; topf: string }>(
      `select total_amount::text total, source_channel::text source, to_char(transaction_at at time zone 'Europe/Zurich', 'HH24:MI') at, receipt_number nr,
              default_cost_account_id topf from transaction_header where id = $1`, [ersterBeleg])).rows[0];
    expect(h).toMatchObject({ total: "37.18", source: "receipt_image", at: "17:42", nr: "0815" });
    // Lebensmittel 14.43 gemeinsam, Shampoo und Creme (persönlich) bei Simon, der bezahlt hat
    const s = Object.fromEntries((await saldo(d, HH)).map((x) => [x.display_name, x.balance]));
    expect(s.Eliana + s.Simon).toBeCloseTo(0, 2);
    // Eliana trägt die Hälfte von 14.43 (7.21/7.22); vom Cumulus-Bon (5.–) zählt ihr Anteil 5 × 7.215 / 37.18 ≈ 0.97 als bezahlt
    expect([-6.24, -6.25]).toContain(s.Eliana);
    const linien = (await d.query<{ produkt: string | null; kuerzel: string | null }>(
      `select master_product_id produkt, alias_mapping_id kuerzel from line_item where transaction_id = $1 order by position`, [ersterBeleg])).rows;
    expect(linien.every((l) => l.produkt && l.kuerzel)).toBe(true);
    const n = (await d.query<{ n: number }>(`select count(*)::int n from receipt_alias_mapping where household_id = $1 and merchant_id = $2`, [HH, MIGROS])).rows[0].n;
    expect(n).toBe(5);
    expect((await d.query<{ n: number }>(`select count(*)::int n from scan_job where transaction_id = $1`, [ersterBeleg])).rows[0].n).toBe(1);
  });

  test("Zweiter Scan: bekannte Kürzel als Vorschlag, Hinweis auf möglichen Doppelbeleg", async () => {
    const ohneKi = beispiel();
    ohneKi.line_items = ohneKi.line_items.map((z) => ({ ...z, product_name: null, category: null }));   // z. B. Offline-Erkennung
    const e = await entwurfBauen(d, { household: HH, extraktion: ohneKi, quelle: "ocr", kanal: "receipt_image", abweichungen: [], heute, datei: null, protokoll: null });
    expect(e.zeilen.map((z) => z.status)).toEqual(["bekannt", "bekannt", "bekannt", "bekannt", "bekannt"]);
    expect(e.zeilen.map((z) => z.name)).toEqual(ZUORDNUNG.map(([n]) => n));
    expect(e.zeilen[3].vorschlag?.produkt).toBe("Shampoo");
    expect(e.hinweise.join(" ")).toContain("Es gibt schon einen Beleg von Migros mit CHF 37.18 am 2026-10-03");
  });

  test("Rabatt auf den Einkauf wird verteilt, Rundung wird eine Position", async () => {
    const x = beispiel();
    x.basket_discounts = [{ label: "10% Mitarbeiterrabatt", kind: "staff_discount", amount: 1.0, applies_to_positions: [] }];
    x.totals.rounding = -0.02;
    x.totals.total = 36.16;
    x.payments = [{ kind: "cash", label: "Bar", amount: 36.16, card_last4: null }];
    expect(pruefen(x, heute)).toEqual([]);
    const e = await entwurfBauen(d, { household: HH, extraktion: x, quelle: "ki", kanal: "receipt_image", abweichungen: [], heute, datei: null, protokoll: null });
    expect(e.zeilen.reduce((s, z) => s + z.korbRabatt, 0)).toBeCloseTo(1, 2);
    expect(e.zeilen.at(-1)).toMatchObject({ name: "Rundung", typ: "deposit_or_fee", betrag: -0.02 });
    expect(zeilenSumme(e)).toBe(36.16);
    const id = await entwurfSpeichern(d, e, ctx());
    const r = (await d.query<{ n: number; korb: string }>(`select count(*)::int n, sum(amount)::text korb from line_item_discount ld join line_item l on l.id = ld.line_item_id
       where l.transaction_id = $1 and ld.kind = 'basket_allocated'`, [id])).rows[0];
    expect(Number(r.korb)).toBe(1);
    await belegLoeschen(d, id);
  });

  test("Gutschrift: Betrag kommt zurück; Löschen eines gescannten Belegs geht", async () => {
    const x = beispiel();
    x.transaction.is_refund = true;
    x.line_items = [x.line_items[3]];
    x.totals.total = 6.95; x.totals.subtotal = 6.95;
    x.payments = [{ kind: "debit_card", label: "Debit", amount: -6.95, card_last4: "4711" }];
    const e = await entwurfBauen(d, { household: HH, extraktion: x, quelle: "ki", kanal: "receipt_image", abweichungen: [], heute, datei: null, protokoll: null });
    expect(e.art).toBe("refund");
    const id = await entwurfSpeichern(d, e, ctx());
    expect((await d.query<{ t: string }>(`select total_amount::text t from transaction_header where id = $1`, [id])).rows[0].t).toBe("-6.95");
    await belegLoeschen(d, id);
    await belegLoeschen(d, ersterBeleg);
    expect((await d.query<{ n: number }>(`select count(*)::int n from scan_job where transaction_id is null`)).rows[0].n).toBeGreaterThan(0);
  });

  test("Produkte und Kürzel kommen über den Abgleich aufs zweite Handy", async () => {
    const srv = await server();
    const user = randomUUID(), user2 = randomUUID();
    const simon = (await d.query<{ id: string }>(`select id from person where household_id = $1 and display_name = 'Simon'`, [HH])).rows[0].id;
    await d.query(`insert into household_member (household_id, user_id, role, person_id) values ($1, $2, 'owner', $3)`, [HH, user, simon]);
    const r = await new SyncEngine(d, new PGliteRemote(srv, user)).sync();
    expect(r.error).toBeUndefined();
    const code = await new PGliteRemote(srv, user).rpc<string>("create_invite", { p_household: HH });
    await new PGliteRemote(srv, user2).rpc("join_household", { p_code: code });
    const b = await handy();
    const r2 = await new SyncEngine(b, new PGliteRemote(srv, user2)).sync();
    expect(r2.error).toBeUndefined();
    const v = (await b.query<{ produkt: string | null }>(`select produkt from kuerzel_vorschlaege($1, $2, $3)`, [HH, MIGROS, ["SHAMPOO REPAIR 250ML"]])).rows[0];
    expect(v.produkt).toBe("Shampoo");
    const p = (await b.query<{ n: number }>(`select count(*)::int n from master_product where household_id = $1`, [HH])).rows[0].n;
    expect(p).toBeGreaterThanOrEqual(5);
  });
});