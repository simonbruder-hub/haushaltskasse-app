import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import type { Db } from "../../src/db/types";
import { handy, server } from "./hilfe";
import { entwurfBauen, entwurfSpeichern } from "../../src/scan/entwurf";
import type { Extraktion } from "../../src/scan/typen";
import { KONTEN_SQL, type Konto } from "../../src/lib/data";
import { SyncEngine } from "../../src/sync/engine";
import { PGliteRemote } from "../../src/sync/remote-pglite";

// M4: Produkte und Preise (Blueprint §2.1, §2.7, §3.2) und die Nacharbeiten zu M3 (ähnliche Kürzel, §3.3 Stufe 3)
const MIGROS = "00000000-0000-4000-8000-000000000001", COOP = "00000000-0000-4000-8000-000000000002", LIDL = "00000000-0000-4000-8000-000000000004";
const KETTE: Record<string, string> = { [MIGROS]: "migros", [COOP]: "coop", [LIDL]: "lidl" };

interface Z { raw: string; preis: number; name: string; rabatt?: number; packung?: { value: number; unit: "g" | "kg" | "ml" | "l" | "piece" } }
/** Ein Erkennungsergebnis, wie es die KI liefert (nur das Nötige) */
function bon(laden: string, datum: string, zeilen: Z[]): Extraktion {
  const total = Math.round(zeilen.reduce((s, z) => s + z.preis, 0) * 100) / 100;
  return {
    document: { document_type: "receipt", language: "de", legibility: "good", is_complete: true, warnings: [] },
    merchant: { name: "", chain_key: KETTE[laden], branch_name: null, street: null, postal_code: null, city: null, country: "CH", vat_number: null },
    transaction: { date: datum, time: null, currency: "CHF", receipt_number: null, register_id: null, receipt_barcode_text: null, is_refund: false },
    line_items: zeilen.map((z, i) => ({
      position: i + 1, raw_text: z.raw, item_type: "product", quantity: 1, quantity_unit: "piece", unit_price: null,
      regular_price: Math.round((z.preis + (z.rabatt ?? 0)) * 100) / 100, item_discount: z.rabatt ?? 0, discount_label: z.rabatt ? "Aktion" : null,
      final_price: z.preis, is_promo: !!z.rabatt, pack_size_hint: z.packung ?? null, multipack_count: null, vat_code: null, ean: null,
      confidence: "high", product_name: z.name, category: "Lebensmittel",
    })),
    basket_discounts: [], payments: [{ kind: "debit_card", label: "Karte", amount: total, card_last4: null }],
    loyalty: { program: "none", card_masked: null, points_earned: null, points_redeemed: null },
    totals: { subtotal: total, total, rounding: 0, vat_lines: [] },
  };
}

let d: Db;
const H = randomUUID();
let konten: Konto[];
let kats: { id: string; name: string; default_cost_account_id: string | null }[];
const eins = async <T>(sql: string, p: unknown[] = []) => (await d.query<T>(sql, p)).rows[0];
async function buchen(laden: string, datum: string, zeilen: Z[]) {
  const e = await entwurfBauen(d, { household: H, extraktion: bon(laden, datum, zeilen), quelle: "ki", kanal: "receipt_image", abweichungen: [], heute: "2026-10-15", datei: null, protokoll: null });
  const sp = konten.find((k) => k.name === "Simon Privat")!;
  return { e, id: await entwurfSpeichern(d, e, { household: H, konto: sp.id, konten, ich: sp.owners[0].person_id, kategorien: kats }) };
}
const produkt = async (name: string) => (await eins<{ id: string }>(`select id from master_product where household_id = $1 and name = $2 and deleted_at is null`, [H, name])).id;

beforeAll(async () => {
  d = await handy();
  await d.query(`select seed_household($1, 'Altstetten', 'Simon', 'Eliana')`, [H]);
  konten = (await d.query<Konto>(KONTEN_SQL, [H])).rows;
  kats = (await d.query<{ id: string; name: string; default_cost_account_id: string | null }>(`select id, name, default_cost_account_id from category where household_id = $1`, [H])).rows;
});

describe("Ähnliche Kürzel (Trigramme wie pg_trgm)", () => {
  // Sollwerte aus PostgreSQL 16 mit pg_trgm: select similarity(a, b)
  test.each([
    ["word", "two words", 0.36363637],
    ["ZWEIFEL CHIPS NATURE 280G", "ZWEIFEL CHIPS NATURE 300G", 0.73333335],
    ["M-CL VOLLMI UHT 1L", "M-CL HALBRAHM UHT 1L", 0.42857143],
    ["BROT HALBWEISS", "BROT HALBWEISS 500G", 0.75],
    ["abc", "xyz", 0],
  ])("%s ~ %s", async (a, b, wert) => {
    expect((await eins<{ s: number }>(`select aehnlichkeit($1, $2) as s`, [a, b])).s).toBeCloseTo(wert, 4);
  });

  test("Gleiches Produkt mit anderer Grösse: Vorschlag mit Hinweis, nie sicher, kein Vergleichspreis", async () => {
    await buchen(MIGROS, "2026-09-01", [{ raw: "ZWEIFEL CHIPS NATURE 300G 4.95", preis: 4.95, name: "Kartoffelchips" }]);
    const v = await eins<{ produkt: string; sicher: boolean; aehnlich_wie: string; last_unit_price: string | null }>(
      `select produkt, sicher, aehnlich_wie, last_unit_price from kuerzel_vorschlaege($1, $2, $3)`, [H, MIGROS, ["ZWEIFEL CHIPS NATURE 280G 4.95"]]);
    expect(v).toEqual({ produkt: "Kartoffelchips", sicher: false, aehnlich_wie: "ZWEIFEL CHIPS NATURE 300G 4.95", last_unit_price: null });
    // Anderer Laden: kein Vorschlag (das Wörterbuch gilt pro Laden)
    expect((await eins<{ produkt: string | null }>(`select produkt from kuerzel_vorschlaege($1, $2, $3)`, [H, COOP, ["ZWEIFEL CHIPS NATURE 280G"]])).produkt).toBeNull();
    // Zu verschieden: kein Vorschlag
    expect((await eins<{ produkt: string | null }>(`select produkt from kuerzel_vorschlaege($1, $2, $3)`, [H, MIGROS, ["M-BUDGET RAPSOEL 1L"]])).produkt).toBeNull();
  });

  test("Im Entwurf: Status «Vorschlag», Hinweis «ähnlich wie», Packung aus dem Belegtext", async () => {
    const e = await entwurfBauen(d, { household: H, extraktion: bon(MIGROS, "2026-10-01", [{ raw: "ZWEIFEL CHIPS NATURE 280G 4.95", preis: 4.95, name: "Chips" }]),
      quelle: "ki", kanal: "receipt_image", abweichungen: [], heute: "2026-10-15", datei: null, protokoll: null });
    expect(e.zeilen[0]).toMatchObject({ name: "Kartoffelchips", status: "bekannt", hinweis: "ähnlich wie «ZWEIFEL CHIPS NATURE 300G 4.95»",
      packung: { groesse: 280, einheit: "g", anzahl: 1 }, vergleich: "per_1kg" });
  });
});

describe("Artikel pro Laden, Packung und Preisalarme (Blueprint §2.7)", () => {
  test("Shrinkflation: Zweifel 300 g → 280 g zum gleichen Preis = +7.14 % pro 100 g", async () => {
    const { id } = await buchen(MIGROS, "2026-10-01", [{ raw: "ZWEIFEL CHIPS NATURE 280G 4.95", preis: 4.95, name: "Kartoffelchips" }]);
    const a = await eins<{ neu: string; alt: string | null; size: string; typ: string }>(
      `select l.merchant_product_id neu, p.replaces_id alt, l.unit_size::text size, l.unit_type::text typ
         from line_item l join merchant_product p on p.id = l.merchant_product_id where l.transaction_id = $1`, [id]);
    expect(a).toMatchObject({ size: "280.000", typ: "g" });
    const alt = await eins<{ id: string }>(`select id from merchant_product where household_id = $1 and receipt_key = 'ZWEIFEL CHIPS NATURE 300G'`, [H]);
    expect(a.alt).toBe(alt.id);
    // Die Vergleichseinheit wurde von «pro Stück» auf «pro kg» umgestellt, sobald Packungen in g bekannt waren
    expect((await eins<{ u: string }>(`select comparison_unit::text u from master_product where id = $1`, [await produkt("Kartoffelchips")])).u).toBe("per_1kg");
    const al = await eins<{ kind: string; change_pct: string; old_base_quantity: string; new_base_quantity: string; seen_at: string | null }>(
      `select kind::text, change_pct::text, old_base_quantity::text, new_base_quantity::text, seen_at from v_price_alert where household_id = $1`, [H]);
    expect(al).toEqual({ kind: "shrinkflation", change_pct: "7.14", old_base_quantity: "300.000", new_base_quantity: "280.000", seen_at: null });
    // Im Preisvergleich zählt nur noch die neue Packung: 4.95 / 0.28 kg
    const p = (await d.query<{ laden: string; pro_einheit: string }>(`select laden, pro_einheit::text from produkt_preise($1, $2, '2026-10-15')`,
      [H, await produkt("Kartoffelchips")])).rows;
    expect(p).toEqual([{ laden: "Migros", pro_einheit: "17.6786" }]);
  });

  test("Preissprung: Kaffee 500 g 12.90 → 14.47 = +12.17 %; gleiche Packung → gleicher Artikel", async () => {
    const z = (preis: number): Z => ({ raw: `CAFE CREME BOHNEN 500G ${preis.toFixed(2)}`, preis, name: "Kaffeebohnen", packung: { value: 500, unit: "g" } });
    const b1 = await buchen(COOP, "2026-09-02", [z(12.9)]);
    const b2 = await buchen(COOP, "2026-10-02", [z(14.47)]);
    const art = (await d.query<{ a: string }>(`select merchant_product_id a from line_item where transaction_id in ($1, $2)`, [b1.id, b2.id])).rows.map((r) => r.a);
    expect(new Set(art).size).toBe(1);
    const al = await eins<{ kind: string; change_pct: string; old_normalized: string; new_normalized: string }>(
      `select kind::text, change_pct::text, old_normalized::text, new_normalized::text from v_price_alert where household_id = $1 and produkt = 'Kaffeebohnen'`, [H]);
    expect(al).toEqual({ kind: "price_jump", change_pct: "12.17", old_normalized: "25.8000", new_normalized: "28.9400" });
  });

  test("Neu rechnen in beliebiger Reihenfolge (wie nach einem Abgleich): derselbe Alarm", async () => {
    const txs = (await d.query<{ t: string }>(`select distinct l.transaction_id t, h.booking_date from line_item l join transaction_header h on h.id = l.transaction_id
       join master_product p on p.id = l.master_product_id where p.name = 'Kaffeebohnen' order by h.booking_date desc`)).rows.map((r) => r.t);
    for (const t of txs) await d.query(`select record_price_observations($1)`, [t]);   // neuere zuerst
    const al = (await d.query<{ kind: string; change_pct: string }>(`select kind::text, change_pct::text from v_price_alert where household_id = $1 and produkt = 'Kaffeebohnen'`, [H])).rows;
    expect(al).toEqual([{ kind: "price_jump", change_pct: "12.17" }]);
  });

  test("«Gelesen» übersteht das Neurechnen der Preise", async () => {
    const a = await eins<{ kind: string; source_id: string }>(`select kind::text, source_id from v_price_alert where household_id = $1 and produkt = 'Kaffeebohnen'`, [H]);
    await d.query(`select alarm_gelesen($1, $2, $3)`, [H, a.kind, a.source_id]);
    const tx = (await eins<{ t: string }>(`select transaction_id t from line_item where id = $1`, [a.source_id])).t;
    await d.query(`select record_price_observations($1)`, [tx]);   // wie nach einem Abgleich
    const n = await eins<{ offen: number; gelesen: number }>(`select count(*) filter (where seen_at is null)::int offen, count(seen_at)::int gelesen
      from v_price_alert where household_id = $1 and produkt = 'Kaffeebohnen'`, [H]);
    expect(n).toEqual({ offen: 0, gelesen: 1 });
  });
});

describe("Regalpreise und Preisvergleich", () => {
  let kaffee = "", artikel = "";
  test("EAN-Artikel mit Regalpreis: Preis pro kg, frische Aktion zählt, alte nicht", async () => {
    kaffee = await produkt("Kaffeebohnen");
    artikel = (await eins<{ id: string }>(`select ean_artikel_sichern($1, '7610200337030', $2, 'Caffè Crema Bohnen', 'Lavazza', 1000, 'g', 1, null) as id`, [H, kaffee])).id;
    expect(artikel).toBe((await eins<{ id: string }>(`select stabile_id('ean', $1::text, '7610200337030') as id`, [H])).id);
    // Lidl: 1 kg für 22.90 am Regal, Aktion 19.90 (gestern)
    await d.query(`insert into shelf_price (id, household_id, merchant_id, merchant_product_id, observed_on, price, regular_price, is_promo)
                   values ($1, $2, $3, $4, '2026-10-14', 19.90, 22.90, true)`, [randomUUID(), H, LIDL, artikel]);
    const preise = (await d.query<{ laden: string; pro_einheit: string; aktion: boolean; packungspreis: string; guenstigster: boolean; alt: boolean }>(
      `select laden, pro_einheit::text, aktion, packungspreis::text, guenstigster, alt from produkt_preise($1, $2, '2026-10-15')`, [H, kaffee])).rows;
    expect(preise).toEqual([
      { laden: "Lidl", pro_einheit: "19.9000", aktion: true, packungspreis: "19.90", guenstigster: true, alt: false },
      { laden: "Coop", pro_einheit: "28.9400", aktion: false, packungspreis: "14.47", guenstigster: false, alt: false },
    ]);
    // Zwei Wochen später gilt die Aktion nicht mehr: Normalpreis 22.90 / kg
    const spaeter = (await d.query<{ laden: string; pro_einheit: string; aktion: boolean }>(
      `select laden, pro_einheit::text, aktion from produkt_preise($1, $2, '2026-10-28')`, [H, kaffee])).rows;
    expect(spaeter[0]).toEqual({ laden: "Lidl", pro_einheit: "22.9000", aktion: false });
  });

  test("Übersicht: bester Preis und Zahl der Läden pro Produkt", async () => {
    const u = await eins<{ laeden: number; kaeufe: number; bester_preis: string; bester_laden: string; alarme: number }>(
      `select laeden, kaeufe, bester_preis::text, bester_laden, alarme from produkt_uebersicht($1, '2026-10-15') where id = $2`, [H, kaffee]);
    expect(u).toEqual({ laeden: 2, kaeufe: 2, bester_preis: "19.9000", bester_laden: "Lidl", alarme: 0 });
  });

  test("Vergleichseinheit ändern: alle Preise neu normalisiert (pro 100 g)", async () => {
    await d.query(`select vergleich_setzen($1, 'per_100g', null)`, [kaffee]);
    const p = (await d.query<{ laden: string; pro_einheit: string }>(`select laden, pro_einheit::text from produkt_preise($1, $2, '2026-10-15')`, [H, kaffee])).rows;
    expect(p.map((x) => [x.laden, x.pro_einheit])).toEqual([["Lidl", "1.9900"], ["Coop", "2.8940"]]);
    await d.query(`select vergleich_setzen($1, 'per_1kg', null)`, [kaffee]);
  });

  test("Zusammenführen: «Kaffee» in «Kaffeebohnen», danach findet der Name das Ziel", async () => {
    await buchen(LIDL, "2026-10-05", [{ raw: "BELLAROM BOHNEN 1KG 15.99", preis: 15.99, name: "Kaffee" }]);
    const von = await produkt("Kaffee");
    await d.query(`select produkte_zusammenfuehren($1, $2, $3)`, [H, von, kaffee]);
    const n = await eins<{ rest: number; preise: number }>(`select
      (select count(*) from line_item where master_product_id = $1)::int + (select count(*) from receipt_alias_mapping where master_product_id = $1)::int
      + (select count(*) from merchant_product where master_product_id = $1)::int as rest,
      (select count(*) from price_observation where master_product_id = $2)::int as preise`, [von, kaffee]);
    expect(n).toEqual({ rest: 0, preise: 4 });
    expect((await eins<{ id: string }>(`select produkt_sichern($1, 'kaffee', null, null) as id`, [H])).id).toBe(kaffee);
    expect((await eins<{ bester_laden: string; bester_preis: string }>(`select bester_laden, bester_preis::text from produkt_uebersicht($1, '2026-10-15') where id = $2`, [H, kaffee])))
      .toEqual({ bester_laden: "Lidl", bester_preis: "15.9900" });
  });
});

describe("Abgleich: Artikel, Regalpreise und «gelesen» kommen aufs andere Handy", () => {
  test("Eliana sieht denselben Preisvergleich und dieselben gelesenen Alarme", async () => {
    const srv = await server();
    const SIMON = randomUUID(), ELIANA = randomUUID();
    const simon = (await eins<{ id: string }>(`select id from person where household_id = $1 and display_name = 'Simon'`, [H])).id;
    await d.query(`insert into household_member (household_id, user_id, role, person_id) values ($1, $2, 'owner', $3)`, [H, SIMON, simon]);
    const a = new SyncEngine(d, new PGliteRemote(srv, SIMON));
    expect((await a.sync()).error).toBeUndefined();
    const code = await new PGliteRemote(srv, SIMON).rpc<string>("create_invite", { p_household: H });
    await new PGliteRemote(srv, ELIANA).rpc("join_household", { p_code: code });
    const b = await handy();
    expect((await new SyncEngine(b, new PGliteRemote(srv, ELIANA)).sync()).error).toBeUndefined();
    const kaffee = await produkt("Kaffeebohnen");
    const vergleich = async (db: Db) => (await db.query<{ laden: string; pro_einheit: string; packungspreis: string }>(
      `select laden, pro_einheit::text, packungspreis::text from produkt_preise($1, $2, '2026-10-15')`, [H, kaffee])).rows;
    expect(await vergleich(b)).toEqual(await vergleich(d));
    const alarme = async (db: Db) => (await db.query<{ produkt: string; kind: string; gelesen: boolean }>(
      `select produkt, kind::text, seen_at is not null as gelesen from v_price_alert where household_id = $1 order by produkt`, [H])).rows;
    expect(await alarme(b)).toEqual(await alarme(d));
    expect((await alarme(b)).find((x) => x.produkt === "Kaffeebohnen")?.gelesen).toBe(true);
    // Regalpreis auf Elianas Handy löschen → nach dem Abgleich auch bei Simon weg, samt Preisbeobachtung
    await b.query(`delete from shelf_price where household_id = $1`, [H]);
    expect((await new SyncEngine(b, new PGliteRemote(srv, ELIANA)).sync()).error).toBeUndefined();
    expect((await a.sync()).error).toBeUndefined();
    expect((await vergleich(d)).map((x) => x.laden)).toEqual(["Lidl", "Coop"]);   // Lidl jetzt nur noch vom Beleg (15.99 / kg)
    expect((await eins<{ n: number }>(`select count(*)::int n from price_observation where shelf_price_id is not null`)).n).toBe(0);
  });
});
