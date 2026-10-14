import { db } from "../db/client";
import { uuid7 } from "./ids";
import { heute } from "./format";

// ---------- Typen der Oberfläche ----------
export type Kind = "privat" | "leben" | "sparen" | "freizeit" | "kind" | "zweck";
export type Status = "virtual" | "active" | "closed";
export type Klasse = "need" | "want" | "saving";
export interface Owner { person_id: string; share: number; name: string; color: string | null; sort: number }
export interface Konto {
  id: string; name: string; kind: Kind; status: Status; iban: string | null; bank_name: string | null;
  opening_balance: string; opening_date: string | null; beneficiary_person_id: string | null;
  is_personal_default: boolean; sort: number; note: string | null; owners: Owner[];
}
export interface Person { id: string; display_name: string; role: "adult" | "child"; birth_date: string | null; sort: number; color: string | null; archived_at: string | null }

export const KONTO_ART: Record<Kind, { name: string; text: string }> = {
  leben: { name: "Gemeinsam leben", text: "Essen, Haushalt, Wohnen, Ferien – alles, was ihr gemeinsam bezahlt" },
  privat: { name: "Privatkonto", text: "Lohnkonto einer Person" },
  sparen: { name: "Sparen", text: "Rücklagen und Sparziele" },
  freizeit: { name: "Freizeit", text: "Persönliche Ausgaben, frei verfügbar" },
  kind: { name: "Kind", text: "Kosten oder Ersparnisse für ein Kind – getragen von euch beiden" },
  zweck: { name: "Zweck-Konto", text: "Für alles andere: Auto, Haus, Hochzeit …" },
};
export const STATUS_TEXT: Record<Status, string> = { virtual: "Topf ohne eigenes Konto", active: "Echtes Konto", closed: "Geschlossen" };
export const KLASSE_TEXT: Record<Klasse, string> = { need: "Bedarf", want: "Wunsch", saving: "Sparen" };

export const KONTEN_SQL = `
  select a.id, a.name, a.kind, a.status, a.iban, a.bank_name, a.opening_balance::text, a.opening_date::text,
         a.beneficiary_person_id, a.is_personal_default, a.sort, a.note,
         coalesce(json_agg(json_build_object('person_id', o.person_id, 'share', o.share, 'name', p.display_name, 'color', p.color, 'sort', p.sort)
                           order by p.sort) filter (where o.id is not null), '[]') as owners
    from account a
    left join account_owner o on o.account_id = a.id
    left join person p on p.id = o.person_id
   where a.household_id = $1
   group by a.id
   order by a.sort, a.name`;

// ---------- Gerätezustand ----------
export async function state(key: string): Promise<string | null> {
  const d = await db();
  return (await d.query<{ value: string }>(`select value from _sync_state where key = $1`, [key])).rows[0]?.value ?? null;
}
export async function setState(key: string, value: string | null) {
  const d = await db();
  if (value === null) await d.query(`delete from _sync_state where key = $1`, [key]);
  else await d.query(`insert into _sync_state (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value`, [key, value]);
}

// ---------- Einrichtung ----------
export async function einrichten(p: { name: string; a1: string; a2: string; ich: 1 | 2 }) {
  const d = await db();
  const id = uuid7();
  await d.transaction(async (tx) => {
    await tx.query(`select seed_household($1, $2, $3, $4, $5::date)`, [id, p.name.trim(), p.a1.trim(), p.a2.trim(), heute()]);
    const me = (await tx.query<{ id: string }>(`select id from person where household_id = $1 and sort = $2`, [id, p.ich])).rows[0].id;
    await tx.query(`insert into _sync_state (key, value) values ('household_id', $1), ('person_id', $2)
                    on conflict (key) do update set value = excluded.value`, [id, me]);
  });
  return id;
}

// ---------- Konten / Töpfe ----------
export async function kontoAnlegen(household: string, k: {
  name: string; kind: Kind; owners: { person_id: string; share: number }[]; beneficiary?: string | null; status?: Status;
}) {
  const d = await db();
  const id = uuid7();
  await d.transaction(async (tx) => {
    const sort = (await tx.query<{ s: number }>(`select coalesce(max(sort), 0) + 1 as s from account where household_id = $1`, [household])).rows[0].s;
    await tx.query(`insert into account (id, household_id, name, kind, status, beneficiary_person_id, sort, opening_date)
                    values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, household, k.name.trim(), k.kind, k.status ?? "virtual", k.beneficiary ?? null, sort, k.status === "active" ? heute() : null]);
    for (const o of k.owners) {
      await tx.query(`insert into account_owner (id, household_id, account_id, person_id, share) values ($1, $2, $3, $4, $5)`,
        [uuid7(), household, id, o.person_id, o.share]);
    }
  });
  return id;
}

export async function kontoSpeichern(id: string, f: Partial<Pick<Konto, "name" | "status" | "iban" | "bank_name" | "opening_date" | "note" | "is_personal_default">> & { opening_balance?: string }) {
  const d = await db();
  const sets: string[] = []; const vals: unknown[] = [];
  for (const [k, v] of Object.entries(f)) { vals.push(v === "" ? null : v); sets.push(`${k} = $${vals.length}`); }
  if (!sets.length) return;
  vals.push(id);
  await d.query(`update account set ${sets.join(", ")} where id = $${vals.length}`, vals);
}

/** Persönlichen Topf einer Person umstellen (z. B. von «Privat» auf «Freizeit»). */
export async function persoenlicherTopf(personId: string, accountId: string) {
  const d = await db();
  await d.transaction(async (tx) => {
    await tx.query(`update account a set is_personal_default = (a.id = $2)
                     where a.id in (select account_id from account_owner o where o.person_id = $1)
                       and (select count(*) from account_owner x where x.account_id = a.id) = 1
                       and a.is_personal_default <> (a.id = $2)`, [personId, accountId]);
  });
}

export async function zahlungsmittelAnlegen(household: string, z: { account_id: string; kind: string; label: string; card_last4: string | null; holder: string | null }) {
  const d = await db();
  await d.query(`insert into payment_method (id, household_id, account_id, kind, label, card_last4, holder_person_id) values ($1, $2, $3, $4, $5, $6, $7)`,
    [uuid7(), household, z.account_id, z.kind, z.label.trim(), z.card_last4 || null, z.holder]);
}
export async function zahlungsmittelLoeschen(id: string) {
  const d = await db();
  await d.query(`delete from payment_method where id = $1`, [id]);
}

// ---------- Personen ----------
export async function personSpeichern(id: string, f: { display_name?: string; color?: string | null; birth_date?: string | null }) {
  const d = await db();
  const sets: string[] = []; const vals: unknown[] = [];
  for (const [k, v] of Object.entries(f)) { vals.push(v === "" ? null : v); sets.push(`${k} = $${vals.length}`); }
  vals.push(id);
  await d.query(`update person set ${sets.join(", ")} where id = $${vals.length}`, vals);
}

export async function kindAnlegen(household: string, k: { name: string; geburt: string | null; topf: boolean }) {
  const d = await db();
  const id = uuid7();
  await d.transaction(async (tx) => {
    const sort = (await tx.query<{ s: number }>(`select coalesce(max(sort), 0) + 1 as s from person where household_id = $1`, [household])).rows[0].s;
    await tx.query(`insert into person (id, household_id, display_name, role, birth_date, sort) values ($1, $2, $3, 'child', $4, $5)`,
      [id, household, k.name.trim(), k.geburt || null, sort]);
    if (k.topf) {
      const eltern = (await tx.query<{ id: string }>(`select id from person where household_id = $1 and role = 'adult' and archived_at is null order by sort`, [household])).rows;
      const acc = uuid7();
      const asort = (await tx.query<{ s: number }>(`select coalesce(max(sort), 0) + 1 as s from account where household_id = $1`, [household])).rows[0].s;
      await tx.query(`insert into account (id, household_id, name, kind, status, beneficiary_person_id, sort) values ($1, $2, $3, 'kind', 'virtual', $4, $5)`,
        [acc, household, k.name.trim(), id, asort]);
      for (const e of eltern) {
        await tx.query(`insert into account_owner (id, household_id, account_id, person_id, share) values ($1, $2, $3, $4, $5)`,
          [uuid7(), household, acc, e.id, 1 / eltern.length]);
      }
    }
  });
  return id;
}

export async function einkommenSpeichern(household: string, personId: string, betrag: number, ab: string) {
  const d = await db();
  await d.query(`insert into person_income (id, household_id, person_id, valid_from, net_monthly) values ($1, $2, $3, $4, $5)
                 on conflict (person_id, valid_from) do update set net_monthly = excluded.net_monthly`, [uuid7(), household, personId, ab, betrag]);
}
export async function einkommenLoeschen(id: string) {
  const d = await db();
  await d.query(`delete from person_income where id = $1`, [id]);
}

// ---------- Lebensbereiche und Kategorien ----------
export async function kategorieSpeichern(id: string, f: { name?: string; default_cost_account_id?: string | null; spending_class?: Klasse | null; life_area_id?: string; archived_at?: string | null }) {
  const d = await db();
  const sets: string[] = []; const vals: unknown[] = [];
  for (const [k, v] of Object.entries(f)) { vals.push(v === "" ? null : v); sets.push(`${k} = $${vals.length}`); }
  vals.push(id);
  await d.query(`update category set ${sets.join(", ")} where id = $${vals.length}`, vals);
}
export async function kategorieAnlegen(household: string, lifeArea: string, name: string, pot: string | null) {
  const d = await db();
  await d.query(`insert into category (id, household_id, life_area_id, name, default_cost_account_id, sort)
                 values ($1, $2, $3, $4, $5, (select coalesce(max(sort), 0) + 1 from category where life_area_id = $3))`,
    [uuid7(), household, lifeArea, name.trim(), pot]);
}
export async function lebensbereichSpeichern(id: string, f: { name?: string; spending_class?: Klasse; archived_at?: string | null }) {
  const d = await db();
  const sets: string[] = []; const vals: unknown[] = [];
  for (const [k, v] of Object.entries(f)) { vals.push(v); sets.push(`${k} = $${vals.length}`); }
  vals.push(id);
  await d.query(`update life_area set ${sets.join(", ")} where id = $${vals.length}`, vals);
}
export async function lebensbereichAnlegen(household: string, name: string, klasse: Klasse) {
  const d = await db();
  await d.query(`insert into life_area (id, household_id, name, spending_class, sort)
                 values ($1, $2, $3, $4, (select coalesce(max(sort), 0) + 1 from life_area where household_id = $2))`,
    [uuid7(), household, name.trim(), klasse]);
}

// ---------- Sicherung ----------
export async function sicherung(household: string): Promise<Blob> {
  const d = await db();
  const out: Record<string, unknown> = { format: "haushalt-sicherung", version: 1, erstellt: new Date().toISOString() };
  const tabs = (await d.query<{ name: string }>(`select name from sync_tables() order by ord`)).rows;
  for (const t of tabs) {
    const col = t.name === "household" ? "id" : "household_id";
    out[t.name] = (await d.query<{ r: unknown }>(`select to_jsonb(x) as r from "${t.name}" x where "${col}" = $1`, [household])).rows.map((r) => r.r);
  }
  return new Blob([JSON.stringify(out, null, 1)], { type: "application/json" });
}
