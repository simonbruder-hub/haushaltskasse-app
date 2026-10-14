import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import { MIGRATIONS, migrate, schemaVersion } from "../../src/db/migrations";
import type { Db } from "../../src/db/types";
import { ausgleichBuchen, belegLaden, belegLoeschen, belegSpeichern, ladenAnlegen, saldo, type Beleg } from "../../src/lib/belege";
import { SyncEngine } from "../../src/sync/engine";
import { PGliteRemote } from "../../src/sync/remote-pglite";
import { handy, server } from "./hilfe";

const H = randomUUID();
const MIGROS = "00000000-0000-4000-8000-000000000001";
let d: Db;
let ids: { simon: string; eliana: string; leben: string; sp: string; ep: string; lebensmittel: string; drogerie: string; kosmetik: string };
const saldoVon = async (db: Db, name: string) => (await saldo(db, H)).find((s) => s.display_name === name)!.balance;
const anteile = async (db: Db, txn: string) => Object.fromEntries((await db.query<{ n: string; s: string }>(
  `select p.display_name n, sum(a.amount_base)::text s from line_item_allocation a join line_item l on l.id = a.line_item_id
    join person p on p.id = a.person_id where l.transaction_id = $1 group by 1`, [txn])).rows.map((r) => [r.n, Number(r.s)]));

describe("M2: Belege und Ausgleich", () => {
  test("Migration 1 → 2 behält bestehende Daten", async () => {
    const alt = new PGlite() as unknown as Db;
    await alt.transaction(async (tx) => { await tx.exec(MIGRATIONS[0].sql); await tx.query(`insert into _schema_version (version) values (1)`); });
    await alt.query(`select seed_household($1, 'Altstetten', 'Simon', 'Eliana')`, [H]);
    expect(await schemaVersion(alt)).toBe(1);
    expect(await migrate(alt)).toBe(2);
    expect(Number((await alt.query<{ n: number }>(`select count(*)::int n from category where household_id = $1`, [H])).rows[0].n)).toBe(36);
    const trig = (await alt.query<{ n: number }>(`select count(*)::int n from pg_trigger where tgname = 't_outbox'`)).rows[0].n;
    expect(Number(trig)).toBe(16);
    d = alt;
    const id = async (sql: string, p: unknown[] = []) => (await d.query<{ id: string }>(sql, p)).rows[0].id;
    ids = {
      simon: await id(`select id from person where display_name = 'Simon'`), eliana: await id(`select id from person where display_name = 'Eliana'`),
      leben: await id(`select id from account where name = 'Gemeinsam Leben'`), sp: await id(`select id from account where name = 'Simon Privat'`),
      ep: await id(`select id from account where name = 'Eliana Privat'`), lebensmittel: await id(`select id from category where name = 'Lebensmittel'`),
      drogerie: await id(`select id from category where name = 'Drogerie'`), kosmetik: await id(`select id from category where name = 'Kosmetik und Coiffeur'`),
    };
  });

  const beispielA = (): Beleg => ({
    household: H, art: "purchase", datum: "2026-10-03", laden: MIGROS, total: 37.18, topf: ids.leben, kaeufer: ids.simon, kategorie: ids.lebensmittel,
    positionen: [
      { text: "M-CL VOLLMI UHT 1L", betrag: 3.30, kategorie: ids.lebensmittel, topf: null },
      { text: "BONCAMPO BOHNEN 500G", betrag: 9.00, rabatt: 3.90, kategorie: ids.lebensmittel, topf: null },
      { text: "BANANEN", betrag: 2.13, kategorie: ids.lebensmittel, topf: null },
      { text: "SHAMPOO", betrag: 6.95, kategorie: ids.drogerie, topf: ids.sp },
      { text: "GESICHTSCREME", betrag: 15.80, kategorie: ids.kosmetik, topf: ids.ep },
    ],
    zahlungen: [{ art: "loyalty_points", betrag: 5, konto: null, label: "Cumulus-Bon" }, { art: "debit_card", betrag: 32.18, konto: ids.sp }],
  });
  let a: string;

  test("Beispiel A: Positionen, Rabatt, Gutschein, eigene Töpfe", async () => {
    a = await belegSpeichern(d, beispielA());
    expect(await anteile(d, a)).toEqual({ Simon: 14.17, Eliana: 23.01 });
    expect(await saldoVon(d, "Simon")).toBe(19.92);
    expect(await saldoVon(d, "Eliana")).toBe(-19.92);
    const sum = (await d.query<{ i: string; v: string }>(`select item_discount_total::text i, voucher_or_loyalty_redeemed::text v from v_transaction_summary where transaction_id = $1`, [a])).rows[0];
    expect([Number(sum.i), Number(sum.v)]).toEqual([3.9, 5]);
    const geladen = (await belegLaden(d, a))!;
    expect(geladen.positionen.map((p) => [p.betrag, p.rabatt ?? 0])).toEqual([[3.3, 0], [9, 3.9], [2.13, 0], [6.95, 0], [15.8, 0]]);
    expect(geladen.zahlungen.map((z) => z.betrag)).toEqual([5, 32.18]);
  });

  test("Schnellerfassung ohne Positionen; Eliana zahlt", async () => {
    await belegSpeichern(d, { household: H, art: "purchase", datum: "2026-10-10", laden: "00000000-0000-4000-8000-000000000002", bezeichnung: "Coop",
      total: 95.40, topf: ids.leben, kaeufer: ids.eliana, kategorie: ids.lebensmittel, positionen: [], zahlungen: [{ art: "twint", betrag: 95.40, konto: ids.ep }] });
    expect(await saldoVon(d, "Simon")).toBeCloseTo(19.92 - 47.70, 2);
  });

  test("Bearbeiten: Topf ändern rechnet neu", async () => {
    const b = (await belegLaden(d, a))!;
    b.positionen[3].topf = null;   // Shampoo doch gemeinsam
    await belegSpeichern(d, b);
    // 6.95 gemeinsam → 3.47/3.48 (Position 4: der Rappen geht diesmal an Eliana)
    expect(await anteile(d, a)).toEqual({ Simon: 10.69, Eliana: 26.49 });
    expect(Number((await d.query<{ n: number }>(`select count(*)::int n from line_item where transaction_id = $1`, [a])).rows[0].n)).toBe(5);
  });

  test("Gutschrift: kommt im Monat des Eingangs, gleich geteilt", async () => {
    const g = await belegSpeichern(d, { household: H, art: "refund", datum: "2026-10-12", laden: MIGROS, bezeichnung: "Rückgabe Pfanne",
      total: 79.90, topf: ids.leben, kaeufer: ids.simon, kategorie: ids.lebensmittel, positionen: [], zahlungen: [{ art: "credit_card", betrag: 79.90, konto: ids.sp }] });
    expect(await anteile(d, g)).toEqual({ Simon: -39.95, Eliana: -39.95 });
    const vorher = await saldoVon(d, "Simon");
    await belegLoeschen(d, g);
    expect(await saldoVon(d, "Simon")).toBeCloseTo(vorher + 39.95, 2);
  });

  test("Fremdwährung", async () => {
    const e = await belegSpeichern(d, { household: H, art: "purchase", datum: "2026-10-12", laden: null, bezeichnung: "Lidl Konstanz", waehrung: "EUR", kurs: 0.94,
      total: 50, topf: ids.leben, kaeufer: ids.eliana, kategorie: ids.lebensmittel, positionen: [], zahlungen: [{ art: "debit_card", betrag: 50, konto: ids.ep }] });
    expect(await anteile(d, e)).toEqual({ Simon: 23.5, Eliana: 23.5 });
  });

  test("Fehler werden verständlich abgewiesen", async () => {
    const b = beispielA();
    await expect(belegSpeichern(d, { ...b, total: 30 })).rejects.toThrow("Die Positionen ergeben 37.18, das Total ist 30.00.");
    await expect(belegSpeichern(d, { ...b, zahlungen: [{ art: "debit_card", betrag: 30, konto: ids.sp }] })).rejects.toThrow("Die Zahlungen ergeben 30.00");
    await expect(belegSpeichern(d, { ...b, zahlungen: [{ art: "debit_card", betrag: 37.18, konto: null }] })).rejects.toThrow("fehlt das Konto");
    await expect(belegSpeichern(d, { ...b, positionen: [], total: 0 })).rejects.toThrow("grösser als 0");
  });

  test("Ausgleich: wer schuldet, zahlt – danach quitt", async () => {
    const simon = await saldoVon(d, "Simon");   // A 22.93 − Coop 47.70 − Lidl 23.50 = −48.27
    expect(simon).toBeCloseTo(-48.27, 2);
    await ausgleichBuchen(d, { household: H, von: ids.simon, an: ids.eliana, betrag: -simon, datum: "2026-10-14", mittel: "Twint" });
    expect(await saldoVon(d, "Eliana")).toBe(0);
    expect(await saldoVon(d, "Simon")).toBe(0);
  });

  test("Eigener Laden wird nur einmal angelegt", async () => {
    const x = await ladenAnlegen(d, H, "Bäckerei Hug");
    expect(await ladenAnlegen(d, H, "bäckerei hug")).toBe(x);
    expect(await ladenAnlegen(d, H, "Migros")).toBe(MIGROS);
  });
});

describe("M2: Belege werden abgeglichen", () => {
  let srv: Db, a: Db, b: Db, sa: SyncEngine, sb: SyncEngine;
  const H2 = randomUUID(), SIMON = randomUUID(), ELIANA = randomUUID();
  beforeAll(async () => { srv = await server(); a = await handy(); b = await handy(); });

  test("Beleg von Handy A erscheint mit gleichem Saldo auf Handy B; Ändern und Löschen auch", async () => {
    await a.query(`select seed_household($1, 'Altstetten', 'Simon', 'Eliana')`, [H2]);
    const q = async (db: Db, sql: string) => (await db.query<{ id: string }>(sql)).rows[0].id;
    const simon = await q(a, `select id from person where sort = 1`);
    await a.query(`insert into household_member (household_id, user_id, role, person_id) values ($1, $2, 'owner', $3)`, [H2, SIMON, simon]);
    sa = new SyncEngine(a, new PGliteRemote(srv, SIMON));
    expect((await sa.sync()).error).toBeUndefined();
    const code = await new PGliteRemote(srv, SIMON).rpc<string>("create_invite", { p_household: H2 });
    await new PGliteRemote(srv, ELIANA).rpc("join_household", { p_code: code });
    sb = new SyncEngine(b, new PGliteRemote(srv, ELIANA));
    expect((await sb.sync()).error).toBeUndefined();

    const leben = await q(a, `select id from account where name = 'Gemeinsam Leben'`), sp = await q(a, `select id from account where name = 'Simon Privat'`);
    const laden = await ladenAnlegen(a, H2, "Bäckerei Hug");
    const id = await belegSpeichern(a, { household: H2, art: "purchase", datum: "2026-10-14", laden, total: 12.35, topf: leben, kaeufer: simon, kategorie: null,
      positionen: [{ text: "Zopf", betrag: 7.35, kategorie: null, topf: null }, { text: "Gipfeli", betrag: 5, rabatt: 1, kategorie: null, topf: sp }],
      zahlungen: [{ art: "cash", betrag: 12.35, konto: sp }] });
    expect((await sa.sync()).error).toBeUndefined();
    expect((await sb.sync()).error).toBeUndefined();
    const s = async (db: Db) => (await db.query<{ n: string; b: string }>(`select display_name n, balance::text b from v_settlement_balance where household_id = $1 order by 1`, [H2])).rows.map((r) => [r.n, Number(r.b)]);
    expect(await s(a)).toEqual([["Eliana", -3.67], ["Simon", 3.67]]);
    expect(await s(b)).toEqual(await s(a));
    expect(Number((await b.query<{ n: number }>(`select count(*)::int n from line_item_allocation`)).rows[0].n)).toBe(3);
    expect((await b.query<{ n: string }>(`select name n from merchant where id = $1`, [laden])).rows[0].n).toBe("Bäckerei Hug");

    // Ändern auf B, zurück zu A
    const beleg = (await belegLaden(b, id))!;
    beleg.positionen[1].topf = null;
    await belegSpeichern(b, beleg);
    expect((await sb.sync()).error).toBeUndefined();
    expect((await sa.sync()).error).toBeUndefined();
    // Gipfeli jetzt gemeinsam: Simon trägt 3.68 + 2.50, Eliana 3.67 + 2.50 → Eliana schuldet 6.17
    expect(await s(a)).toEqual([["Eliana", -6.17], ["Simon", 6.17]]);
    expect(await s(b)).toEqual(await s(a));
    // Keine Endlosschleife: nach dem Abgleich ist nichts mehr offen
    expect(await sa.pending()).toBe(0);
    expect(await sb.pending()).toBe(0);
    expect((await sb.sync()).pushed).toBe(0);

    // Löschen auf A
    await belegLoeschen(a, id);
    expect((await sa.sync()).error).toBeUndefined();
    expect((await sb.sync()).error).toBeUndefined();
    expect(await s(b)).toEqual([["Eliana", 0], ["Simon", 0]]);
    expect(Number((await b.query<{ n: number }>(`select count(*)::int n from line_item`)).rows[0].n)).toBe(0);
    expect(Number((await b.query<{ n: number }>(`select count(*)::int n from line_item_allocation`)).rows[0].n)).toBe(0);
  });
});
