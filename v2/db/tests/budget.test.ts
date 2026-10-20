import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import type { Db } from "../../src/db/types";
import { abbild, handy, server } from "./hilfe";
import { belegSpeichern } from "../../src/lib/belege";
import { SyncEngine } from "../../src/sync/engine";
import { PGliteRemote } from "../../src/sync/remote-pglite";

// M5: Budget und Konten (Blueprint §2.3 bis §2.6). Die Zahlen sind von Hand nachgerechnet.
const MIGROS = "00000000-0000-4000-8000-000000000001";
let d: Db;
const H = randomUUID();
const eins = async <T>(sql: string, p: unknown[] = []) => (await d.query<T>(sql, p)).rows[0];
const id = async (sql: string, p: unknown[] = []) => (await eins<{ id: string }>(sql, p)).id;
let simon = "", eliana = "", leben = "", simonPrivat = "", simonSparen = "", lebensmittel = "", zahnarzt = "";

async function kauf(datum: string, betrag: number, kategorie: string, topf: string, text = "Einkauf") {
  await belegSpeichern(d, { household: H, art: "purchase", datum, laden: MIGROS, total: betrag, topf, kaeufer: simon, kategorie,
    positionen: [{ text, betrag, kategorie, topf: null }], zahlungen: [{ art: "debit_card", betrag, konto: simonPrivat }] });
}

beforeAll(async () => {
  d = await handy();
  await d.query(`select seed_household($1, 'Altstetten', 'Simon', 'Eliana')`, [H]);
  simon = await id(`select id from person where household_id = $1 and display_name = 'Simon'`, [H]);
  eliana = await id(`select id from person where household_id = $1 and display_name = 'Eliana'`, [H]);
  leben = await id(`select id from account where household_id = $1 and name = 'Gemeinsam Leben'`, [H]);
  simonPrivat = await id(`select id from account where household_id = $1 and name = 'Simon Privat'`, [H]);
  simonSparen = await id(`select id from account where household_id = $1 and name = 'Simon Sparen'`, [H]);
  lebensmittel = await id(`select id from category where household_id = $1 and name = 'Lebensmittel'`, [H]);
  zahnarzt = await id(`select id from category where household_id = $1 and name = 'Arzt und Zahnarzt'`, [H]);
});

describe("Variable Budgets: Safe-to-Spend", () => {
  test("«Lebensmittel Simon»: Übertrag aus dem September, Tagesbudget, Tempo", async () => {
    await d.query(`insert into variable_budget (household_id, name, scope, person_id, category_id, monthly_amount, rollover_mode, valid_from)
                   values ($1, 'Lebensmittel Simon', 'person', $2, $3, 300, 'surplus_only', '2026-09-01')`, [H, simon, lebensmittel]);
    await kauf("2026-09-10", 100, lebensmittel, leben);   // Simons Hälfte 50.00 → Übertrag 250.00
    await kauf("2026-10-05", 40, lebensmittel, leben);    // 20.00
    await kauf("2026-10-15", 10, lebensmittel, leben);    // heute: 5.00
    const s = await eins<Record<string, string | number>>(`select available::text, spent_before_today::text, spent_today::text, month_spent::text, remaining_days,
        safe_per_day::text, left_today::text, burn_rate_per_day::text, projected_month_spend::text, pace from budget_status($1, '2026-10-15')`, [H]);
    // verfügbar 300 + 250 = 550 · bis gestern 20 · 530 / 17 Tage = 31.17 → auf 5 Rappen abgerundet 31.15 · 25 / 15 = 1.67 · × 31 = 51.77
    expect(s).toEqual({ available: "550.00", spent_before_today: "20.00", spent_today: "5.00", month_spent: "25.00", remaining_days: 17,
      safe_per_day: "31.15", left_today: "26.15", burn_rate_per_day: "1.67", projected_month_spend: "51.77", pace: "on_track" });
  });

  test("Eliana sieht nur ihre Hälfte; ein Budget in der Zukunft oder abgelaufen zählt nicht", async () => {
    await d.query(`insert into variable_budget (household_id, name, scope, person_id, category_id, monthly_amount, valid_from)
                   values ($1, 'Lebensmittel Eliana', 'person', $2, $3, 100, '2026-10-01'), ($1, 'Später', 'person', $2, $3, 50, '2026-11-01'),
                          ($1, 'Vorbei', 'person', $2, $3, 50, '2026-01-01')`, [H, eliana, lebensmittel]);
    await d.query(`update variable_budget set valid_to = '2026-08-31' where name = 'Vorbei'`);
    const r = (await d.query<{ name: string; available: string; month_spent: string }>(
      `select b.name, s.available::text, s.month_spent::text from budget_status($1, '2026-10-15') s join variable_budget b on b.id = s.budget_id order by b.name`, [H])).rows;
    expect(r).toEqual([{ name: "Lebensmittel Eliana", available: "100.00", month_spent: "25.00" }, { name: "Lebensmittel Simon", available: "550.00", month_spent: "25.00" }]);
  });

  test("Topf-Budget: alle Kosten des Topfs, Hälfte und Hälfte zusammen", async () => {
    await d.query(`insert into variable_budget (household_id, name, scope, account_id, monthly_amount, valid_from) values ($1, 'Leben', 'account', $2, 800, '2026-10-01')`, [H, leben]);
    const r = await eins<{ month_spent: string }>(`select s.month_spent::text from budget_status($1, '2026-10-15') s join variable_budget b on b.id = s.budget_id where b.name = 'Leben'`, [H]);
    expect(r.month_spent).toBe("50.00");   // 40 + 10, ohne den September
  });
});

describe("Sparziele (Sinking Funds)", () => {
  test("«Zahnarzt Simon»: Stand 320, nötige Rate 146.70, auf Kurs, 26.7 %", async () => {
    await d.query(`insert into sinking_fund (household_id, name, holding_account_id, cost_account_id, category_id, target_amount, target_date, monthly_contribution, start_date)
                   values ($1, 'Zahnarzt Simon', $2, $3, $4, 1200, '2027-03-31', 150, '2026-07-01')`, [H, simonSparen, simonPrivat, zahnarzt]);
    expect(await eins<{ n: number }>(`select fonds_raten_buchen('2026-10-14') as n`)).toEqual({ n: 4 });   // Juli bis Oktober
    expect(await eins<{ n: number }>(`select fonds_raten_buchen('2026-10-14') as n`)).toEqual({ n: 0 });   // zweites Mal nichts
    await belegSpeichern(d, { household: H, art: "purchase", datum: "2026-09-20", laden: null, bezeichnung: "Dentalhygiene", total: 280, topf: simonPrivat, kaeufer: simon, kategorie: zahnarzt,
      positionen: [], zahlungen: [{ art: "debit_card", betrag: 280, konto: simonPrivat }] });
    const f = await eins<Record<string, string | number | boolean>>(`select balance::text, contributed::text, spent::text, months_left, round(required_monthly, 2)::text as required_monthly, on_track, progress_pct::text
                                                                        from sparziele($1, '2026-10-14')`, [H]);
    expect(f).toEqual({ balance: "320.00", contributed: "600.00", spent: "280.00", months_left: 6, required_monthly: "146.70", on_track: true, progress_pct: "26.7" });
  });

  test("Ausgaben dieser Kategorie belasten den Fonds, nicht das Budget", async () => {
    await d.query(`insert into variable_budget (household_id, name, scope, person_id, category_id, monthly_amount, valid_from)
                   values ($1, 'Arzt Simon', 'person', $2, $3, 300, '2026-09-01')`, [H, simon, zahnarzt]);
    const r = await eins<{ month_spent: string }>(`select round(s.month_spent, 2)::text as month_spent from budget_status($1, '2026-10-14') s join variable_budget b on b.id = s.budget_id where b.name = 'Arzt Simon'`, [H]);
    expect(r.month_spent).toBe("0.00");
  });
});

describe("Daueraufträge: buchen sich selbst, nur Fälliges, nie doppelt", () => {
  let so = "";
  test("Simon → Simon Sparen 500 am 25., ab 15. August", async () => {
    so = await id(`insert into standing_order (household_id, from_account_id, to_account_id, amount, day_of_month, kind, valid_from)
                   values ($1, $2, $3, 500, 25, 'saving', '2026-08-15') returning id`, [H, simonPrivat, simonSparen]);
    expect(await eins<{ n: number }>(`select dauerauftraege_buchen('2026-10-20') as n`)).toEqual({ n: 2 });   // 25.8. und 25.9.; der 25.10. ist noch nicht dran
    expect(await eins<{ n: number }>(`select dauerauftraege_buchen('2026-10-20') as n`)).toEqual({ n: 0 });
    expect(await eins<{ n: number }>(`select dauerauftraege_buchen('2026-10-25') as n`)).toEqual({ n: 1 });
    const t = (await d.query<{ transfer_date: string; amount: string; id: string }>(`select transfer_date::text, amount::text, id from transfer where standing_order_id = $1 order by 1`, [so])).rows;
    expect(t.map((x) => [x.transfer_date, x.amount])).toEqual([["2026-08-25", "500.00"], ["2026-09-25", "500.00"], ["2026-10-25", "500.00"]]);
    // dieselbe ID auf jedem Handy
    expect(t[0].id).toBe((await eins<{ s: string }>(`select stabile_id('dauerauftrag', $1::text, '2026-08-25') as s`, [so])).s);
  });

  test("Betrag später ändern: Gebuchtes bleibt; Ende setzen: danach nichts mehr", async () => {
    await d.query(`update standing_order set amount = 600 where id = $1`, [so]);
    await d.query(`select dauerauftraege_buchen('2026-11-25')`);
    const t = (await d.query<{ amount: string }>(`select amount::text from transfer where standing_order_id = $1 order by transfer_date`, [so])).rows.map((x) => x.amount);
    expect(t).toEqual(["500.00", "500.00", "500.00", "600.00"]);
    await d.query(`update standing_order set valid_to = '2026-11-30' where id = $1`, [so]);
    expect(await eins<{ n: number }>(`select dauerauftraege_buchen('2027-03-01') as n`)).toEqual({ n: 0 });
  });

  test("Einnahme von aussen (Lohn) ist für den Saldo neutral", async () => {
    await d.query(`insert into standing_order (household_id, from_account_id, to_account_id, amount, day_of_month, kind, valid_from) values ($1, null, $2, 6500, 25, 'income', '2026-10-01')`, [H, simonPrivat]);
    const vorher = (await d.query<{ balance: string }>(`select balance::text from v_settlement_balance where household_id = $1 order by person_id`, [H])).rows;
    await d.query(`select dauerauftraege_buchen('2026-10-25')`);
    expect((await d.query<{ balance: string }>(`select balance::text from v_settlement_balance where household_id = $1 order by person_id`, [H])).rows).toEqual(vorher);
  });
});

describe("Fixkosten und Verträge (Blueprint §2.6)", () => {
  test("Miete 2400 im Topf Gemeinsam: je 1200; Halbtax 190/Jahr bei Simon: 15.83", async () => {
    const wohnen = await id(`select id from life_area where household_id = $1 and name = 'Wohnen'`, [H]);
    await d.query(`insert into fixed_cost (household_id, name, life_area_id, cost_account_id, pay_from_account_id, amount, frequency, next_due_date)
                   values ($1, 'Miete', $2, $3, $4, 2400, 'monthly', '2026-11-01'), ($1, 'Halbtax', $2, $4, $4, 190, 'annual', '2027-01-15')`, [H, wohnen, leben, simonPrivat]);
    const r = (await d.query<{ person: string; monthly_share: string }>(
      `select p.display_name as person, f.monthly_share::text from v_fixed_cost_person_monthly f join person p on p.id = f.person_id where f.household_id = $1 order by 1`, [H])).rows;
    expect(r).toEqual([{ person: "Eliana", monthly_share: "1200.00" }, { person: "Simon", monthly_share: "1215.83" }]);
  });

  test.each([
    ["2026-01-31", "monthly", "2026-02-10", "2026-02-28"],
    ["2026-11-01", "monthly", "2026-10-20", "2026-11-01"],
    ["2025-03-01", "annual", "2026-10-20", "2027-03-01"],
    ["2026-10-01", "weekly", "2026-10-20", "2026-10-22"],
    ["2026-04-10", "quarterly", "2026-10-20", "2027-01-10"],
  ])("nächste Fälligkeit %s (%s) ab %s → %s", async (datum, f, heute, soll) => {
    expect((await eins<{ d: string }>(`select naechste_faelligkeit($1::date, $2::frequency, $3::date)::text as d`, [datum, f, heute])).d).toBe(soll);
  });

  test("Kündigungsfristen: Internet bis 31.12., Grundversicherung bis 30.11. (Monatsende)", async () => {
    await d.query(`insert into contract (household_id, name, counterparty, renewal_date, renewal_period_months, cancellation_notice_days) values ($1, 'Internet', 'Sunrise', '2027-03-01', 12, 60)`, [H]);
    await d.query(`insert into contract (household_id, name, counterparty, renewal_date, renewal_period_months, cancellation_notice_days, notice_to_month_end)
                   values ($1, 'Grundversicherung', 'Krankenkasse', '2027-01-01', 12, 31, true)`, [H]);
    const f = async (heute: string) => (await d.query<{ name: string; d: string; r: string; status: string }>(
      `select name, cancellation_deadline::text d, remind_on::text r, status from vertrags_fristen($1, $2) order by name`, [H, heute])).rows;
    expect(await f("2026-10-14")).toEqual([
      { name: "Grundversicherung", d: "2026-11-30", r: "2026-10-31", status: "ok" },
      { name: "Internet", d: "2026-12-31", r: "2026-12-01", status: "ok" }]);
    expect((await f("2026-11-02"))[0].status).toBe("remind");
    expect((await f("2026-11-25"))[0].status).toBe("last_chance");
    expect((await f("2026-12-02"))[0].status).toBe("missed");
  });
});

describe("50/30/20 pro Person", () => {
  test("Einkommen, Bedarf, gespart (Dauerauftrag auf eigenes Sparkonto), nicht verplant", async () => {
    await d.query(`insert into person_income (household_id, person_id, net_monthly, valid_from) values ($1, $2, 6500, '2026-01-01')`, [H, simon]);
    const a = await eins<Record<string, string>>(`select income::text, needs::text, round(wants, 2)::text as wants, saved_to_accounts::text, unallocated::text, needs_pct::text from analysis_50_30_20($1, '2026-10-01')`, [simon]);
    // Oktober: Lebensmittel 20 + 5 (Simons Hälfte) = 25 Bedarf · 500 aufs Sparkonto (25.10.) · Rest 6500 − 25 − 500
    expect(a).toEqual({ income: "6500.00", needs: "25.00", wants: "0.00", saved_to_accounts: "500.00", unallocated: "5975.00", needs_pct: "0.4" });
  });
});

describe("Abgleich: zwei Handys buchen dasselbe, nichts verdoppelt sich", () => {
  test("Budgets, Fixkosten, Verträge, Sparziele und Daueraufträge kommen aufs andere Handy", async () => {
    const srv = await server();
    const SIMON = randomUUID(), ELIANA = randomUUID();
    await d.query(`insert into household_member (household_id, user_id, role, person_id) values ($1, $2, 'owner', $3)`, [H, SIMON, simon]);
    const a = new SyncEngine(d, new PGliteRemote(srv, SIMON));
    expect((await a.sync()).error).toBeUndefined();
    const code = await new PGliteRemote(srv, SIMON).rpc<string>("create_invite", { p_household: H });
    await new PGliteRemote(srv, ELIANA).rpc("join_household", { p_code: code });
    const b = await handy();
    const syncB = new SyncEngine(b, new PGliteRemote(srv, ELIANA));
    expect((await syncB.sync()).error).toBeUndefined();
    expect((await a.sync()).error).toBeUndefined();   // Simon holt Elianas Mitgliedschaft ab
    expect(await abbild(b, H)).toEqual(await abbild(d, H));
    // Beide Handys buchen den November; der Dauerauftrag auf Simon Sparen ist beendet, der Lohn läuft weiter
    for (const db of [d, b]) await db.query(`select dauerauftraege_buchen('2026-11-26'), fonds_raten_buchen('2026-11-26')`);
    expect((await a.sync()).error).toBeUndefined();
    expect((await syncB.sync()).error).toBeUndefined();
    expect((await a.sync()).error).toBeUndefined();
    expect(await abbild(b, H)).toEqual(await abbild(d, H));
    const n = async (db: Db, t: string) => Number((await db.query<{ n: number }>(`select count(*)::int n from ${t} where household_id = $1`, [H])).rows[0].n);
    for (const t of ["transfer", "sinking_fund_entry"]) {
      expect(await n(srv, t)).toBe(await n(d, t));
      expect(await n(b, t)).toBe(await n(d, t));
    }
    expect(await n(srv, "variable_budget")).toBe(6);
    expect(await n(srv, "contract")).toBe(2);
    // Fremde sehen nichts
    const fremd = new PGliteRemote(srv, randomUUID());
    for (const t of ["variable_budget", "fixed_cost", "contract", "sinking_fund", "sinking_fund_entry", "standing_order", "transfer"]) {
      expect(await fremd.pull(t, "id", null, 100)).toHaveLength(0);
    }
  });
});
