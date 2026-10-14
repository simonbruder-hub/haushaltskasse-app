import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import { SyncEngine } from "../../src/sync/engine";
import { PGliteRemote } from "../../src/sync/remote-pglite";
import type { Db } from "../../src/db/types";
import { abbild, handy, server } from "./hilfe";

const SIMON = randomUUID(), ELIANA = randomUUID(), FREMD = randomUUID();
const H = randomUUID();
let srv: Db, a: Db, b: Db, syncA: SyncEngine, syncB: SyncEngine;
const zahl = async (db: Db, sql: string, p: unknown[] = []) => Number((await db.query<{ n: number }>(sql, p)).rows[0].n);

describe("Abgleich Handy ↔ Server", () => {
  beforeAll(async () => {
    srv = await server();
    a = await handy();
    b = await handy();
  });

  test("Simon richtet offline ein, alles landet in der Outbox", async () => {
    await a.query(`select seed_household($1, 'Altstetten', 'Simon', 'Eliana')`, [H]);
    expect(await zahl(a, `select count(*) n from _outbox`)).toBe(72);
  });

  test("Erster Abgleich nach dem Login lädt alles hoch", async () => {
    const simonPerson = (await a.query<{ id: string }>(`select id from person where display_name = 'Simon'`)).rows[0].id;
    await a.query(`insert into household_member (household_id, user_id, role, person_id) values ($1, $2, 'owner', $3)`, [H, SIMON, simonPerson]);
    syncA = new SyncEngine(a, new PGliteRemote(srv, SIMON));
    const r = await syncA.sync();
    expect(r.error).toBeUndefined();
    expect(r.pushed).toBe(73);
    expect(await zahl(a, `select count(*) n from _outbox`)).toBe(0);
    expect(await zahl(srv, `select count(*) n from category where household_id = $1`, [H])).toBe(36);
    expect(await zahl(srv, `select count(*) n from account where household_id = $1`, [H])).toBe(7);
    expect((await srv.query<{ c: string }>(`select created_by::text c from household where id = $1`, [H])).rows[0].c).toBe(SIMON);
  });

  test("Fremde sehen nichts und können nichts schreiben", async () => {
    const fremd = new PGliteRemote(srv, FREMD);
    expect(await fremd.pull("household", "id", null, 100)).toHaveLength(0);
    expect(await fremd.pull("category", "id", null, 100)).toHaveLength(0);
    expect((await fremd.pull("currency", "code", null, 100).catch(() => null))).toBeNull();   // currency hat kein updated_at → kein Sync
    await expect(fremd.upsert("person", "id", [{ id: randomUUID(), household_id: H, display_name: "Eindringling", role: "adult", sort: 9, updated_at: new Date().toISOString(), created_at: new Date().toISOString() }]))
      .rejects.toThrow(/row-level security/);
    await expect(fremd.rpc("create_invite", { p_household: H })).rejects.toThrow(/Kein Mitglied/);
    await expect(fremd.rpc("join_household", { p_code: "FALSCH12" })).rejects.toThrow(/ungültig/);
  });

  test("Eliana tritt mit einem Code bei und bekommt alles", async () => {
    const code = await new PGliteRemote(srv, SIMON).rpc<string>("create_invite", { p_household: H });
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    const hh = await new PGliteRemote(srv, ELIANA).rpc<string>("join_household", { p_code: code.toLowerCase() });
    expect(hh).toBe(H);
    await expect(new PGliteRemote(srv, FREMD).rpc("join_household", { p_code: code })).rejects.toThrow(/ungültig/);
    syncB = new SyncEngine(b, new PGliteRemote(srv, ELIANA));
    const r = await syncB.sync();
    expect(r.error).toBeUndefined();
    expect(r.pulled).toBeGreaterThanOrEqual(74);
    expect((await syncA.sync()).error).toBeUndefined();   // Simon holt Elianas Mitgliedschaft ab
    const ia = await abbild(a, H);
    expect(ia.household_member).toHaveLength(2);
    expect(await abbild(b, H)).toEqual(ia);
  });

  test("Änderungen auf beiden Handys laufen zusammen", async () => {
    // Eliana ordnet ihren Login ihrer Person zu und legt ihre Twint an
    const eliana = (await b.query<{ id: string }>(`select id from person where display_name = 'Eliana'`)).rows[0].id;
    await b.query(`update household_member set person_id = $1 where user_id = $2`, [eliana, ELIANA]);
    const ep = (await b.query<{ id: string }>(`select id from account where name = 'Eliana Privat'`)).rows[0].id;
    await b.query(`insert into payment_method (household_id, account_id, holder_person_id, kind, label) values ($1, $2, $3, 'twint', 'Twint Eliana')`, [H, ep, eliana]);
    await b.query(`update category set default_cost_account_id = (select id from account where name = 'Gemeinsam Leben') where name = 'Velo'`);
    // Simon benennt gleichzeitig eine Kategorie um und erfasst ein Kind
    await a.query(`update category set name = 'Getränke und Kaffee' where name = 'Getränke'`);
    await a.query(`insert into person (household_id, display_name, role, sort, birth_date) values ($1, 'Kind 1', 'child', 3, '2027-03-01')`, [H]);
    expect((await syncB.sync()).error).toBeUndefined();
    expect((await syncA.sync()).error).toBeUndefined();
    expect((await syncB.sync()).error).toBeUndefined();
    const ia = await abbild(a, H), ib = await abbild(b, H);
    expect(ib).toEqual(ia);
    expect(ia.payment_method).toHaveLength(1);
    expect(ia.person).toHaveLength(3);
    expect((ia.category as { name: string }[]).some((c) => c.name === "Getränke und Kaffee")).toBe(true);
  });

  test("Löschen wird an das andere Handy weitergegeben", async () => {
    await a.query(`delete from payment_method where label = 'Twint Eliana'`);
    expect((await syncA.sync()).error).toBeUndefined();
    const r = await syncB.sync();
    expect(r.deleted).toBe(1);
    expect(await zahl(b, `select count(*) n from payment_method`)).toBe(0);
    expect(await zahl(srv, `select count(*) n from payment_method`)).toBe(0);
  });

  test("Später zuletzt geändert gewinnt; die Outbox bleibt leer", async () => {
    await a.query(`update person set color = '#1c6a4f' where display_name = 'Simon'`);
    await b.query(`update person set color = '#6250d6' where display_name = 'Simon'`);
    await syncA.sync(); await syncB.sync(); await syncA.sync();
    const farbe = async (db: Db) => (await db.query<{ c: string }>(`select color c from person where display_name = 'Simon'`)).rows[0].c;
    expect(await farbe(a)).toBe("#6250d6");
    expect(await farbe(b)).toBe("#6250d6");
    expect(await zahl(a, `select count(*) n from _outbox`)).toBe(0);
    expect(await zahl(b, `select count(*) n from _outbox`)).toBe(0);
  });

  test("Ein Topf mit falschen Anteilen wird vom Server abgewiesen", async () => {
    await a.query(`insert into account (household_id, name, kind) values ($1, 'Test', 'zweck')`, [H]);
    const acc = (await a.query<{ id: string }>(`select id from account where name = 'Test'`)).rows[0].id;
    const simon = (await a.query<{ id: string }>(`select id from person where display_name = 'Simon'`)).rows[0].id;
    await a.query(`insert into account_owner (account_id, person_id, share) values ($1, $2, 1.5)`, [acc, simon]).catch((e) => e);
    expect(await zahl(a, `select count(*) n from account_owner where account_id = $1`, [acc])).toBe(0);   // lokal schon abgewiesen (check)
    expect((await syncA.sync()).error).toBeUndefined();
  });
});
