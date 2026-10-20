import type { Db, Queryable } from "../db/types";
import { belegSpeichern } from "./belege";
import { uuid7 } from "./ids";

/** Budget und Konten (M5): Budgets, Fixkosten, Verträge, Sparziele, Daueraufträge. Alle Funktionen bekommen die Datenbank übergeben (testbar). */

export type Uebertrag = "none" | "surplus_only" | "surplus_and_deficit";
export const UEBERTRAG_TEXT: Record<Uebertrag, [string, string]> = {
  none: ["Kein Übertrag", "Was übrig bleibt, verfällt"],
  surplus_only: ["Überschuss mitnehmen", "Was übrig bleibt, gilt im nächsten Monat zusätzlich"],
  surplus_and_deficit: ["Überschuss und Defizit", "Auch Mehrausgaben werden im nächsten Monat abgezogen"],
};
export type Haeufigkeit = "weekly" | "monthly" | "quarterly" | "semiannual" | "annual";
export const HAEUFIGKEIT_TEXT: Record<Haeufigkeit, string> = { weekly: "wöchentlich", monthly: "monatlich", quarterly: "vierteljährlich", semiannual: "halbjährlich", annual: "jährlich" };
export const DAUERAUFTRAG_ART: Record<string, string> = { deposit: "Einzahlung", saving: "Sparen", income: "Einnahme", settlement: "Ausgleich", rebooking: "Umbuchung" };

const rp = (x: number) => Math.round(x * 100) / 100;
function betrag(x: number, name: string) {
  if (!Number.isFinite(x) || x < 0) throw new Error(`${name}: bitte einen Betrag von 0 oder mehr eingeben.`);
  return rp(x);
}
const text = (s: string, was: string) => { const t = s.trim(); if (!t) throw new Error(`Bitte ${was} eingeben.`); return t; };

// ---------- Variable Budgets ----------
export interface BudgetEingabe {
  id?: string; household: string; name: string; scope: "person" | "account"; person: string | null; account: string | null;
  bereich: string | null; kategorie: string | null; betrag: number; uebertrag: Uebertrag; von: string; bis: string | null;
}
export async function budgetSpeichern(d: Queryable, b: BudgetEingabe): Promise<string> {
  const name = text(b.name, "einen Namen");
  const betragRp = betrag(b.betrag, "Monatsbudget");
  if (b.scope === "person" && !b.person) throw new Error("Bitte eine Person wählen.");
  if (b.scope === "account" && !b.account) throw new Error("Bitte einen Topf wählen.");
  if (b.bis && b.bis < b.von) throw new Error("«Bis» liegt vor «Ab».");
  const vals = [name, b.scope, b.scope === "person" ? b.person : null, b.scope === "account" ? b.account : null,
    b.kategorie ? null : b.bereich, b.kategorie, betragRp, b.uebertrag, b.von, b.bis];
  if (b.id) {
    await d.query(`update variable_budget set name = $2, scope = $3, person_id = $4, account_id = $5, life_area_id = $6, category_id = $7,
                     monthly_amount = $8, rollover_mode = $9, valid_from = $10, valid_to = $11 where id = $1`, [b.id, ...vals]);
    return b.id;
  }
  const id = uuid7();
  await d.query(`insert into variable_budget (id, household_id, name, scope, person_id, account_id, life_area_id, category_id, monthly_amount, rollover_mode, valid_from, valid_to)
                 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [id, b.household, ...vals]);
  return id;
}
export const budgetLoeschen = (d: Queryable, id: string) => d.query(`delete from variable_budget where id = $1`, [id]);

// ---------- Fixkosten und Verträge ----------
export interface FixkostenEingabe {
  id?: string; household: string; name: string; bereich: string; kategorie: string | null; topf: string; zahltVon: string | null; betrag: number;
  haeufigkeit: Haeufigkeit; faellig: string; klasse: "need" | "want" | "saving"; vertrag: string | null; aktiv: boolean;
}
export async function fixkostSpeichern(d: Queryable, f: FixkostenEingabe): Promise<string> {
  const name = text(f.name, "einen Namen");
  if (!f.bereich) throw new Error("Bitte einen Lebensbereich wählen.");
  if (!f.topf) throw new Error("Bitte wählen, in welchen Topf die Fixkost gehört.");
  const vals = [name, f.bereich, f.kategorie, f.vertrag, f.topf, f.zahltVon, betrag(f.betrag, "Betrag"), f.haeufigkeit, f.faellig, f.klasse, f.aktiv];
  if (f.id) {
    await d.query(`update fixed_cost set name = $2, life_area_id = $3, category_id = $4, contract_id = $5, cost_account_id = $6, pay_from_account_id = $7,
                     amount = $8, frequency = $9, next_due_date = $10, spending_class = $11, is_active = $12 where id = $1`, [f.id, ...vals]);
    return f.id;
  }
  const id = uuid7();
  await d.query(`insert into fixed_cost (id, household_id, name, life_area_id, category_id, contract_id, cost_account_id, pay_from_account_id, amount, frequency, next_due_date, spending_class, is_active)
                 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`, [id, f.household, ...vals]);
  return id;
}
export const fixkostLoeschen = (d: Queryable, id: string) => d.query(`delete from fixed_cost where id = $1`, [id]);

export interface VertragEingabe {
  id?: string; household: string; name: string; partner: string; nummer: string | null; verlaengerung: string; periodeMonate: number;
  autoVerlaengert: boolean; fristTage: number; bisMonatsende: boolean; notiz: string | null;
}
export async function vertragSpeichern(d: Queryable, v: VertragEingabe): Promise<string> {
  const name = text(v.name, "einen Namen"), partner = text(v.partner, "den Vertragspartner");
  if (!v.verlaengerung) throw new Error("Bitte das Datum der nächsten Verlängerung eingeben.");
  if (!(v.periodeMonate >= 1)) throw new Error("Die Laufzeit muss mindestens 1 Monat sein.");
  if (!(v.fristTage >= 0)) throw new Error("Die Kündigungsfrist darf nicht negativ sein.");
  const vals = [name, partner, v.nummer?.trim() || null, v.verlaengerung, Math.round(v.periodeMonate), v.autoVerlaengert, Math.round(v.fristTage), v.bisMonatsende, v.notiz?.trim() || null];
  if (v.id) {
    await d.query(`update contract set name = $2, counterparty = $3, contract_number = $4, renewal_date = $5, renewal_period_months = $6, auto_renews = $7,
                     cancellation_notice_days = $8, notice_to_month_end = $9, note = $10 where id = $1`, [v.id, ...vals]);
    return v.id;
  }
  const id = uuid7();
  await d.query(`insert into contract (id, household_id, name, counterparty, contract_number, renewal_date, renewal_period_months, auto_renews, cancellation_notice_days, notice_to_month_end, note)
                 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [id, v.household, ...vals]);
  return id;
}
/** Gekündigt: der Vertrag erscheint nicht mehr bei den Fristen */
export const vertragKuendigen = (d: Queryable, id: string, datum: string | null) => d.query(`update contract set cancelled_on = $2 where id = $1`, [id, datum]);
export const vertragLoeschen = async (d: Queryable, id: string) => {
  await d.query(`update fixed_cost set contract_id = null where contract_id = $1`, [id]);
  await d.query(`delete from contract where id = $1`, [id]);
};

// ---------- Sparziele ----------
export interface SparzielEingabe {
  id?: string; household: string; name: string; sparkonto: string; topf: string; kategorie: string; ziel: number; zielDatum: string | null; rate: number; start: string;
}
export async function sparzielSpeichern(d: Queryable, f: SparzielEingabe): Promise<string> {
  const name = text(f.name, "einen Namen");
  if (!f.sparkonto) throw new Error("Bitte wählen, wo das Geld liegt.");
  if (!f.topf) throw new Error("Bitte den Topf wählen, dessen Ausgaben das Sparziel belasten.");
  if (!f.kategorie) throw new Error("Bitte die Kategorie wählen, deren Ausgaben das Sparziel belasten.");
  if (!(f.ziel > 0)) throw new Error("Das Ziel muss grösser als 0 sein.");
  const vals = [name, f.sparkonto, f.topf, f.kategorie, rp(f.ziel), f.zielDatum, betrag(f.rate, "Monatsrate"), f.start];
  if (f.id) {
    await d.query(`update sinking_fund set name = $2, holding_account_id = $3, cost_account_id = $4, category_id = $5, target_amount = $6, target_date = $7,
                     monthly_contribution = $8, start_date = $9 where id = $1`, [f.id, ...vals]);
    return f.id;
  }
  const id = uuid7();
  await d.query(`insert into sinking_fund (id, household_id, name, holding_account_id, cost_account_id, category_id, target_amount, target_date, monthly_contribution, start_date)
                 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [id, f.household, ...vals]);
  return id;
}
export const sparzielAbschliessen = (d: Queryable, id: string, datum: string | null) => d.query(`update sinking_fund set closed_at = $2 where id = $1`, [id, datum]);
export const sparzielLoeschen = (d: Queryable, id: string) => d.query(`delete from sinking_fund where id = $1`, [id]);

/** Einzahlung (positiv) oder Korrektur (positiv oder negativ) von Hand; am selben Tag wird zusammengezählt */
export async function fondsEintrag(d: Queryable, x: { household: string; fund: string; datum: string; art: "contribution" | "adjustment"; betrag: number; notiz?: string | null }) {
  if (!Number.isFinite(x.betrag) || x.betrag === 0) throw new Error("Bitte einen Betrag eingeben.");
  if (x.art === "contribution" && x.betrag < 0) throw new Error("Eine Einzahlung ist positiv. Für Korrekturen «Korrektur» wählen.");
  await d.query(`insert into sinking_fund_entry (id, household_id, fund_id, entry_date, kind, amount, note) values ($1, $2, $3, $4, $5, $6, $7)
                 on conflict (fund_id, entry_date, kind) do update set amount = sinking_fund_entry.amount + excluded.amount`,
    [uuid7(), x.household, x.fund, x.datum, x.art, rp(x.betrag), x.notiz?.trim() || null]);
}
export const fondsEintragLoeschen = (d: Queryable, id: string) => d.query(`delete from sinking_fund_entry where id = $1`, [id]);

// ---------- Daueraufträge ----------
export interface DauerauftragEingabe {
  id?: string; household: string; von: string | null; nach: string; betrag: number; tag: number; art: string; ab: string; bis: string | null; notiz: string | null;
}
export async function dauerauftragSpeichern(d: Queryable, s: DauerauftragEingabe): Promise<string> {
  if (!s.nach) throw new Error("Bitte das Zielkonto wählen.");
  if (s.von && s.von === s.nach) throw new Error("Quelle und Ziel müssen verschieden sein.");
  if (!(s.betrag > 0)) throw new Error("Bitte einen Betrag grösser als 0 eingeben.");
  const tag = Math.round(s.tag);
  if (!(tag >= 1 && tag <= 28)) throw new Error("Der Tag im Monat muss zwischen 1 und 28 liegen.");
  if (s.bis && s.bis < s.ab) throw new Error("«Bis» liegt vor «Ab».");
  const vals = [s.von, s.nach, rp(s.betrag), tag, s.art, s.ab, s.bis, s.notiz?.trim() || null];
  if (s.id) {
    await d.query(`update standing_order set from_account_id = $2, to_account_id = $3, amount = $4, day_of_month = $5, kind = $6, valid_from = $7, valid_to = $8, note = $9 where id = $1`, [s.id, ...vals]);
    return s.id;
  }
  const id = uuid7();
  await d.query(`insert into standing_order (id, household_id, from_account_id, to_account_id, amount, day_of_month, kind, valid_from, valid_to, note)
                 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [id, s.household, ...vals]);
  return id;
}
/** Beenden: ab dann bucht sich nichts mehr; Gebuchtes bleibt */
export const dauerauftragBeenden = (d: Queryable, id: string, datum: string) => d.query(`update standing_order set valid_to = $2 where id = $1`, [id, datum]);
export const dauerauftragLoeschen = (d: Queryable, id: string) => d.query(`delete from standing_order where id = $1`, [id]);

/** Beim Start und nach Mitternacht: fällige Daueraufträge und Sparraten buchen (idempotent, siehe db/m5.sql) */
export async function faelligesBuchen(d: Queryable, heute: string): Promise<{ dauerauftraege: number; raten: number }> {
  const r = (await d.query<{ a: number; b: number }>(`select dauerauftraege_buchen($1::date) as a, fonds_raten_buchen($1::date) as b`, [heute])).rows[0];
  return { dauerauftraege: r.a, raten: r.b };
}

/** Einmalige Überweisung zwischen Konten und Töpfen (leere Quelle = Einnahme von aussen) */
export async function ueberweisungSpeichern(d: Queryable, x: { household: string; von: string | null; nach: string; betrag: number; datum: string; art: string; notiz?: string | null }) {
  if (!x.nach) throw new Error("Bitte das Zielkonto wählen.");
  if (x.von && x.von === x.nach) throw new Error("Quelle und Ziel müssen verschieden sein.");
  if (!(x.betrag > 0)) throw new Error("Bitte einen Betrag grösser als 0 eingeben.");
  await d.query(`insert into transfer (id, household_id, from_account_id, to_account_id, amount, transfer_date, kind, note) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [uuid7(), x.household, x.von, x.nach, rp(x.betrag), x.datum, x.art, x.notiz?.trim() || null]);
}

/** Fixkost bezahlt: als Beleg (Rechnung) buchen und die nächste Fälligkeit weiterrücken. Der Betrag darf vorher abweichen (Strom, Nebenkosten). */
export async function fixkostBuchen(d: Db, x: { fixkost: string; datum: string; betrag: number; kaeufer: string }): Promise<string> {
  const f = (await d.query<{ household_id: string; name: string; category_id: string | null; life_area_id: string; cost_account_id: string; pay_from_account_id: string | null;
    next_due_date: string; frequency: Haeufigkeit }>(
    `select household_id, name, category_id, life_area_id, cost_account_id, pay_from_account_id, next_due_date::text, frequency::text from fixed_cost where id = $1`, [x.fixkost])).rows[0];
  if (!f) throw new Error("Fixkost nicht gefunden.");
  if (!f.pay_from_account_id) throw new Error("Bitte zuerst bei der Fixkost eintragen, von welchem Konto sie bezahlt wird.");
  if (!(x.betrag > 0)) throw new Error("Bitte einen Betrag grösser als 0 eingeben.");
  // Ohne eigene Kategorie: die erste des Lebensbereichs, damit Budgets nach Bereich mitzählen
  const kategorie = f.category_id ?? (await d.query<{ id: string }>(`select id from category where life_area_id = $1 and archived_at is null order by sort, name limit 1`, [f.life_area_id])).rows[0]?.id ?? null;
  const id = await belegSpeichern(d, {
    household: f.household_id, art: "bill", datum: x.datum, laden: null, bezeichnung: f.name, total: rp(x.betrag), topf: f.cost_account_id, kaeufer: x.kaeufer, kategorie,
    positionen: [{ text: f.name, betrag: rp(x.betrag), kategorie, topf: null }],
    zahlungen: [{ art: "bank_transfer", betrag: rp(x.betrag), konto: f.pay_from_account_id }],
  });
  // nächste Fälligkeit nach dem Zahlungstag, bei früher Zahlung die Periode danach
  await d.query(`update fixed_cost set next_due_date = naechste_faelligkeit(next_due_date, frequency, greatest($2::date, next_due_date) + 1) where id = $1`, [x.fixkost, x.datum]);
  return id;
}
