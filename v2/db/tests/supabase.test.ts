import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SyncEngine } from "../../src/sync/engine";
import { SupabaseRemote } from "../../src/sync/remote-supabase";
import type { Db } from "../../src/db/types";
import { abbild, handy } from "./hilfe";
import { belegLaden, belegSpeichern } from "../../src/lib/belege";
import { jwt, sql, starten, stoppen, URL_SUPABASE, verfuegbar } from "./supabase-nachbau";

const SIMON = randomUUID(), ELIANA = randomUUID(), FREMD = randomUUID();
const H = randomUUID();
const client = (sub: string) => createClient(URL_SUPABASE, jwt(null, "anon"), {
  accessToken: async () => jwt(sub), auth: { persistSession: false, autoRefreshToken: false },
});

describe.runIf(verfuegbar())("Nachbau Supabase: PostgreSQL 16 + PostgREST + supabase-js", () => {
  let a: Db, b: Db, syncA: SyncEngine, syncB: SyncEngine;
  beforeAll(async () => {
    await starten(fileURLToPath(new URL("../../supabase/migrations", import.meta.url)));
    a = await handy(); b = await handy();
  }, 120_000);
  afterAll(() => stoppen());

  test("Migration ist eingespielt, RLS überall aktiv", () => {
    const ohneRls = sql(`copy (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                             where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) to stdout`).trim();
    expect(ohneRls).toBe("0");
  });

  test("Simon lädt seinen offline eingerichteten Haushalt hoch", async () => {
    await a.query(`select seed_household($1, 'Altstetten', 'Simon', 'Eliana')`, [H]);
    const p = (await a.query<{ id: string }>(`select id from person where sort = 1`)).rows[0].id;
    await a.query(`insert into household_member (household_id, user_id, role, person_id) values ($1, $2, 'owner', $3)`, [H, SIMON, p]);
    syncA = new SyncEngine(a, new SupabaseRemote(client(SIMON)));
    const r = await syncA.sync();
    expect(r.error).toBeUndefined();
    expect(r.pushed).toBe(73);
    expect(sql(`copy (select count(*) from category where household_id = '${H}') to stdout`).trim()).toBe("36");
  });

  test("Fremde sehen über die REST-Schnittstelle nichts", async () => {
    const c = client(FREMD);
    const { data } = await c.from("category").select("id");
    expect(data).toEqual([]);
    const { error } = await c.from("person").insert({ household_id: H, display_name: "X", role: "adult" });
    expect(error?.message).toMatch(/row-level security/);
    const anon = createClient(URL_SUPABASE, jwt(null, "anon"), { auth: { persistSession: false } });
    expect((await anon.from("household").select("id")).data).toEqual([]);
    expect((await anon.from("currency").select("code")).data ?? []).toEqual([]);   // ohne Login nichts
    expect(((await c.from("currency").select("code")).data ?? []).length).toBe(3);  // mit Login lesbar
  });

  test("Einladung, Beitritt, beide Handys gleich", async () => {
    const { data: code, error } = await client(SIMON).rpc("create_invite", { p_household: H });
    expect(error).toBeNull();
    const join = await client(ELIANA).rpc("join_household", { p_code: code });
    expect(join.error).toBeNull();
    expect(join.data).toBe(H);
    syncB = new SyncEngine(b, new SupabaseRemote(client(ELIANA)));
    expect((await syncB.sync()).error).toBeUndefined();
    expect((await syncA.sync()).error).toBeUndefined();
    expect(await abbild(b, H)).toEqual(await abbild(a, H));
  });

  test("Änderungen, Löschen und Zeitstempel über PostgREST", async () => {
    const ep = (await b.query<{ id: string }>(`select id from account where name = 'Eliana Privat'`)).rows[0].id;
    await b.query(`insert into payment_method (household_id, account_id, kind, label, card_last4) values ($1, $2, 'debit_card', 'Debit Eliana', '0815')`, [H, ep]);
    await a.query(`update category set name = 'Getränke und Kaffee' where name = 'Getränke'`);
    await a.query(`update household_setting set price_jump_threshold_pct = 12.5`);
    expect((await syncB.sync()).error).toBeUndefined();
    expect((await syncA.sync()).error).toBeUndefined();
    expect((await syncB.sync()).error).toBeUndefined();
    expect(await abbild(b, H)).toEqual(await abbild(a, H));
    await a.query(`delete from payment_method`);
    expect((await syncA.sync()).error).toBeUndefined();
    expect((await syncB.sync()).deleted).toBe(1);
    expect(Number((await b.query<{ n: number }>(`select count(*)::int n from payment_method`)).rows[0].n)).toBe(0);
    // Mehrere Seiten: Cursor mit Mikrosekunden und Überlappung holen nichts doppelt und nichts zu wenig
    for (let i = 0; i < 230; i++) await a.query(`insert into category (household_id, life_area_id, name) select $1, id, 'Test ' || $2 from life_area where name = 'Sonstiges'`, [H, i]);
    expect((await syncA.sync()).error).toBeUndefined();
    expect((await syncB.sync()).error).toBeUndefined();
    expect(Number((await b.query<{ n: number }>(`select count(*)::int n from category`)).rows[0].n)).toBe(36 + 230);
  });

  test("M2: Belege über PostgREST – Server-Trigger blockieren nicht, Saldo gleich", async () => {
    const q = async (db: Db, sql: string) => (await db.query<{ id: string }>(sql)).rows[0].id;
    const leben = await q(a, `select id from account where name = 'Gemeinsam Leben'`), sp = await q(a, `select id from account where name = 'Simon Privat'`);
    const ep = await q(a, `select id from account where name = 'Eliana Privat'`), simon = await q(a, `select id from person where sort = 1`);
    const id = await belegSpeichern(a, { household: H, art: "purchase", datum: "2026-10-14", laden: "00000000-0000-4000-8000-000000000001", total: 37.18,
      topf: leben, kaeufer: simon, kategorie: null,
      positionen: [{ text: "Kaffee", betrag: 9, rabatt: 3.9, kategorie: null, topf: null }, { text: "Creme", betrag: 15.8, kategorie: null, topf: ep }],
      zahlungen: [{ art: "loyalty_points", betrag: 5, konto: null }, { art: "debit_card", betrag: 32.18, konto: sp }] });
    expect((await syncA.sync()).error).toBeUndefined();
    expect((await syncB.sync()).error).toBeUndefined();
    const saldo = async (db: Db) => (await db.query<{ n: string; b: string }>(`select display_name n, balance::text b from v_settlement_balance where household_id = $1 order by 1`, [H])).rows.map((r) => [r.n, Number(r.b)]);
    expect(await saldo(b)).toEqual(await saldo(a));
    expect(sql(`copy (select count(*) from line_item where transaction_id = '${id}') to stdout`).trim()).toBe("3");
    expect(sql(`copy (select item_discount from line_item where raw_text = 'Kaffee') to stdout`).trim()).toBe("3.90");
    // Eliana ändert den Beleg (Status wechselt auf dem Server needs_review → confirmed mit neuen Positionen)
    const beleg = (await belegLaden(b, id))!;
    beleg.positionen[1].topf = null;
    await belegSpeichern(b, beleg);
    expect((await syncB.sync()).error).toBeUndefined();
    expect((await syncA.sync()).error).toBeUndefined();
    expect(await saldo(a)).toEqual(await saldo(b));
    expect(await syncA.pending()).toBe(0);
    expect((await syncB.sync()).pushed).toBe(0);
  });

  test("M4: Artikel, Regalpreise und gelesene Alarme über PostgREST; Views schützen fremde Daten", async () => {
    const q = async (sql: string, p: unknown[] = []) => (await a.query<{ id: string }>(sql, p)).rows[0].id;
    const COOP = "00000000-0000-4000-8000-000000000002", LIDL = "00000000-0000-4000-8000-000000000004";
    const leben = await q(`select id from account where name = 'Gemeinsam Leben'`), sp = await q(`select id from account where name = 'Simon Privat'`);
    const simon = await q(`select id from person where sort = 1`);
    const chips = await q(`select produkt_sichern($1, 'Kartoffelchips', null, 'per_1kg') as id`, [H]);
    // Zwei Packungen desselben Artikels, beide neu in derselben Sendung: der Nachfolger verweist auf den Vorgänger
    const kauf = async (datum: string, text: string, g: number) => {
      const art = await q(`select artikel_sichern($1, $2, $3, $4, $5, 'g', 1) as id`, [H, COOP, text, chips, g]);
      await belegSpeichern(a, { household: H, art: "purchase", datum, laden: COOP, total: 4.95, topf: leben, kaeufer: simon, kategorie: null,
        positionen: [{ text, betrag: 4.95, kategorie: null, topf: null, produkt: chips, artikel: art, packung: { groesse: g, einheit: "g", anzahl: 1 } }],
        zahlungen: [{ art: "debit_card", betrag: 4.95, konto: sp }] });
    };
    await kauf("2026-09-01", "ZWEIFEL CHIPS NATURE 300G", 300);
    await kauf("2026-10-01", "ZWEIFEL CHIPS NATURE 280G", 280);
    const ean = await q(`select ean_artikel_sichern($1, '7610200337030', $2, 'Chips Nature', 'Zweifel', 280, 'g', 1, null) as id`, [H, chips]);
    await a.query(`insert into shelf_price (id, household_id, merchant_id, merchant_product_id, observed_on, price) values ($1, $2, $3, $4, '2026-10-10', 4.50)`,
      [randomUUID(), H, LIDL, ean]);
    const alarm = (await a.query<{ kind: string; source_id: string }>(`select kind::text, source_id from v_price_alert where household_id = $1`, [H])).rows;
    expect(alarm.map((x) => x.kind)).toEqual(["shrinkflation"]);
    await a.query(`select alarm_gelesen($1, $2, $3)`, [H, alarm[0].kind, alarm[0].source_id]);
    expect((await syncA.sync()).error).toBeUndefined();
    expect(sql(`copy (select count(*) from merchant_product where household_id = '${H}' and replaces_id is not null) to stdout`).trim()).toBe("1");
    expect((await syncB.sync()).error).toBeUndefined();
    const vergleich = async (db: Db) => (await db.query<{ laden: string; pro_einheit: string }>(
      `select laden, pro_einheit::text from produkt_preise($1, $2, '2026-10-15')`, [H, chips])).rows;
    expect(await vergleich(b)).toEqual(await vergleich(a));
    expect((await vergleich(b)).map((x) => x.laden)).toEqual(["Lidl", "Coop"]);
    const alarme = async (db: Db) => (await db.query<{ kind: string; gelesen: boolean; pct: string }>(
      `select kind::text, seen_at is not null as gelesen, change_pct::text pct from v_price_alert where household_id = $1`, [H])).rows;
    expect(await alarme(b)).toEqual([{ kind: "shrinkflation", gelesen: true, pct: "7.14" }]);
    expect(await abbild(b, H)).toEqual(await abbild(a, H));
    // Fremde: weder Tabellen noch Views zeigen etwas (Views laufen mit den Rechten der abfragenden Person)
    const c = client(FREMD);
    expect((await c.from("shelf_price").select("id")).data).toEqual([]);
    expect((await c.from("merchant_product").select("id")).data).toEqual([]);
    expect((await c.from("v_allocation").select("*")).data).toEqual([]);
    expect((await c.from("v_settlement_balance").select("*")).data).toEqual([]);
    expect((await client(SIMON).from("v_settlement_balance").select("*")).data?.length).toBeGreaterThan(0);
  });
});
