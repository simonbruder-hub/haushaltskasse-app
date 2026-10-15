import type { Db, Queryable } from "../db/types";
import { uuid7 } from "./ids";

/** Belege erfassen, ändern, löschen und den Ausgleich buchen. Alle Funktionen bekommen die Datenbank übergeben (testbar). */

export type BelegArt = "purchase" | "bill" | "refund";
export const BELEG_ART: Record<BelegArt, string> = { purchase: "Einkauf", bill: "Rechnung", refund: "Gutschrift" };
export const GUTSCHEIN_ARTEN = ["voucher", "gift_card", "loyalty_points", "reka", "lunch_check"] as const;

export type PositionsTyp = "product" | "deposit_or_fee" | "refund_or_return";
export type Einheit = "piece" | "kg" | "g" | "l" | "ml";
export interface Position {
  text: string;
  betrag: number;          // bezahlter Betrag der Position (nach Rabatten); Ware positiv, Depot/Leergut/Retoure auch negativ
  rabatt?: number;         // Artikelrabatt (Aktion), positiv
  rabattText?: string | null;
  korbRabatt?: number;     // Anteil an einem Rabatt auf den ganzen Einkauf, positiv
  korbText?: string | null;
  kategorie: string | null;
  topf: string | null;     // leer = Topf des Belegs
  typ?: PositionsTyp;      // leer = Ware
  produkt?: string | null; // master_product (aus dem Kürzel-Wörterbuch)
  kuerzel?: string | null; // receipt_alias_mapping
  menge?: number | null;
  einheit?: Einheit | null;
  einzelpreis?: number | null;
}
export interface Zahlung {
  art: string;             // payment_kind
  betrag: number;          // positiv eingeben
  konto: string | null;    // leer nur bei Gutscheinen/Punkten
  zahlungsmittel?: string | null;
  label?: string | null;
}
export interface Beleg {
  id?: string;
  household: string;
  art: BelegArt;
  datum: string;
  laden: string | null;
  bezeichnung?: string | null;  // Text, wenn es keine Positionen gibt (z. B. Ladenname)
  total: number;
  waehrung?: string;
  kurs?: number;
  topf: string;
  kaeufer: string;
  kategorie: string | null;
  positionen: Position[];
  zahlungen: Zahlung[];
  notiz?: string | null;
  quelle?: "manual" | "receipt_image" | "receipt_pdf";   // woher der Beleg kommt (Scanner)
  anhang?: string | null;                                // attachment (Foto/PDF des Belegs)
  zeit?: string | null;                                  // HH:MM laut Beleg
  belegNr?: string | null;
}

const rappen = (x: number) => Math.round(x * 100);
const chf = (r: number) => (r / 100).toFixed(2);

/** Prüft und vervollständigt die Eingabe: Rest-Position, Vorzeichen, Summen. Wirft verständliche Fehler. */
export function vorbereiten(b: Beleg) {
  const total = rappen(b.total);
  if (total <= 0) throw new Error("Bitte einen Betrag grösser als 0 eingeben.");
  const positionen = b.positionen.filter((p) => rappen(p.betrag) !== 0 || (p.rabatt ?? 0) > 0 || (p.korbRabatt ?? 0) > 0);
  for (const p of positionen) {
    if (rappen(p.betrag) < 0 && (p.typ ?? "product") === "product") throw new Error("Positionen bitte als positive Beträge eingeben.");
    if ((p.rabatt ?? 0) < 0 || (p.korbRabatt ?? 0) < 0) throw new Error("Rabatte bitte als positive Beträge eingeben.");
    if (p.menge != null && !(p.menge > 0)) throw new Error("Die Menge muss grösser als 0 sein.");
  }
  const summe = positionen.reduce((s, p) => s + rappen(p.betrag), 0);
  if (summe > total) throw new Error(`Die Positionen ergeben ${chf(summe)}, das Total ist ${chf(total)}.`);
  if (summe < total) {
    positionen.push({ text: positionen.length ? "Übriges" : (b.bezeichnung?.trim() || BELEG_ART[b.art]), betrag: (total - summe) / 100, kategorie: b.kategorie, topf: null });
  }
  const zahlungen = b.zahlungen.filter((z) => rappen(z.betrag) !== 0);
  if (!zahlungen.length) throw new Error("Bitte angeben, womit bezahlt wurde.");
  for (const z of zahlungen) {
    if (rappen(z.betrag) < 0) throw new Error("Zahlungen bitte als positive Beträge eingeben.");
    const gutschein = (GUTSCHEIN_ARTEN as readonly string[]).includes(z.art);
    if (!gutschein && !z.konto) throw new Error("Bei Zahlungen mit Karte, Twint oder bar fehlt das Konto.");
  }
  const bezahlt = zahlungen.reduce((s, z) => s + rappen(z.betrag), 0);
  if (bezahlt !== total) throw new Error(`Die Zahlungen ergeben ${chf(bezahlt)}, das Total ist ${chf(total)}.`);
  return { positionen, zahlungen, vorzeichen: b.art === "refund" ? -1 : 1 };
}

/** Speichert einen Beleg (neu oder geändert) und bestätigt ihn: Anteile und Saldo rechnet die Datenbank. */
export async function belegSpeichern(d: Db, b: Beleg): Promise<string> {
  vorbereiten(b);   // Eingabefehler melden, bevor eine Transaktion beginnt
  let id = "";
  await d.transaction(async (tx) => { id = await belegSchreiben(tx, b); });
  return id;
}

/** Wie belegSpeichern, aber innerhalb einer laufenden Transaktion (z. B. zusammen mit dem Kürzel-Lernen des Scanners). */
export async function belegSchreiben(tx: Queryable, b: Beleg): Promise<string> {
  const { positionen, zahlungen, vorzeichen } = vorbereiten(b);
  const id = b.id ?? uuid7();
  {
    const felder = [b.household, b.art, b.laden, b.datum, b.waehrung ?? "CHF", b.kurs ?? 1, vorzeichen * b.total, b.kaeufer, b.topf, b.notiz?.trim() || null,
      b.anhang ?? null, b.zeit ?? null, b.belegNr ?? null];
    const zeitpunkt = `case when $13::text is null then null else ($5::date + $13::time) at time zone 'Europe/Zurich' end`;
    if (b.id) {
      await tx.query(`update transaction_header set status = 'needs_review', household_id = $2, kind = $3, merchant_id = $4, booking_date = $5,
                        currency = $6, fx_rate = $7, total_amount = $8, buyer_person_id = $9, default_cost_account_id = $10, notes = $11,
                        receipt_attachment_id = coalesce($12, receipt_attachment_id), transaction_at = coalesce(${zeitpunkt}, transaction_at),
                        receipt_number = coalesce($14, receipt_number)
                      where id = $1`, [id, ...felder]);
      await tx.query(`delete from line_item where transaction_id = $1`, [id]);
      await tx.query(`delete from transaction_payment where transaction_id = $1`, [id]);
    } else {
      await tx.query(`insert into transaction_header (id, household_id, kind, merchant_id, booking_date, currency, fx_rate, total_amount,
                        buyer_person_id, default_cost_account_id, notes, receipt_attachment_id, transaction_at, receipt_number, status, source_channel)
                      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, ${zeitpunkt}, $14, 'draft', $15)`, [id, ...felder, b.quelle ?? "manual"]);
    }
    let nr = 0;
    for (const p of positionen) {
      const lid = uuid7();
      const ware = vorzeichen > 0 && (p.typ ?? "product") === "product";
      const rabatt = ware ? Math.max(0, p.rabatt ?? 0) : 0;
      const korb = ware ? Math.max(0, p.korbRabatt ?? 0) : 0;
      const regulaer = vorzeichen * (p.betrag + rabatt + korb);
      const typ = vorzeichen > 0 ? (p.typ ?? "product") : regulaer <= 0 ? "refund_or_return" : "deposit_or_fee";
      await tx.query(`insert into line_item (id, transaction_id, household_id, position, item_type, raw_text, regular_price, item_discount,
                        is_promo, promo_label, category_id, cost_account_id, master_product_id, alias_mapping_id,
                        quantity, quantity_unit, regular_unit_price)
                      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, coalesce($15::numeric, 1), coalesce($16::unit_type, 'piece'), $17::numeric)`,
        [lid, id, b.household, ++nr, typ, p.text.trim() || "Position", regulaer, rabatt + korb, rabatt > 0,
          rabatt > 0 ? (p.rabattText?.trim() || "Rabatt") : null, p.kategorie, p.topf, p.produkt ?? null, p.kuerzel ?? null,
          p.menge ?? null, p.einheit ?? null, p.einzelpreis ?? null]);
      if (rabatt > 0) {
        await tx.query(`insert into line_item_discount (id, line_item_id, household_id, kind, label, amount) values ($1, $2, $3, 'promo', $4, $5)`,
          [uuid7(), lid, b.household, p.rabattText?.trim() || "Rabatt", rabatt]);
      }
      if (korb > 0) {
        await tx.query(`insert into line_item_discount (id, line_item_id, household_id, kind, label, amount) values ($1, $2, $3, 'basket_allocated', $4, $5)`,
          [uuid7(), lid, b.household, p.korbText?.trim() || "Rabatt auf den Einkauf", korb]);
      }
    }
    nr = 0;
    for (const z of zahlungen) {
      const gutschein = (GUTSCHEIN_ARTEN as readonly string[]).includes(z.art);
      await tx.query(`insert into transaction_payment (id, transaction_id, household_id, position, kind, account_id, payment_method_id, amount, label)
                      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [uuid7(), id, b.household, ++nr, z.art, gutschein ? null : z.konto, z.zahlungsmittel ?? null, vorzeichen * z.betrag, z.label ?? null]);
    }
    await tx.query(`update transaction_header set status = 'confirmed' where id = $1`, [id]);
  }
  return id;
}

export async function belegLoeschen(d: Db, id: string) {
  await d.query(`delete from transaction_header where id = $1`, [id]);
}

/** Gespeicherten Beleg als Eingabe laden (zum Bearbeiten). */
export async function belegLaden(d: Db, id: string): Promise<Beleg | null> {
  const h = (await d.query<{ household_id: string; kind: BelegArt; booking_date: string; merchant_id: string | null; currency: string; fx_rate: string;
    total_amount: string; buyer_person_id: string; default_cost_account_id: string; notes: string | null }>(
    `select household_id, kind, booking_date::text, merchant_id, currency, fx_rate::text, total_amount::text, buyer_person_id,
            default_cost_account_id, notes from transaction_header where id = $1`, [id])).rows[0];
  if (!h) return null;
  const v = h.kind === "refund" ? -1 : 1;
  const pos = (await d.query<{ raw_text: string; final_price: string; item_discount: string; category_id: string | null; cost_account_id: string | null;
    item_type: PositionsTyp; master_product_id: string | null; alias_mapping_id: string | null; quantity: string; quantity_unit: Einheit; regular_unit_price: string | null }>(
    `select raw_text, final_price::text, item_discount::text, category_id, cost_account_id, item_type::text, master_product_id, alias_mapping_id,
            quantity::text, quantity_unit::text, regular_unit_price::text from line_item where transaction_id = $1 order by position`, [id])).rows;
  const zahl = (await d.query<{ kind: string; amount: string; account_id: string | null; payment_method_id: string | null; label: string | null }>(
    `select kind, amount::text, account_id, payment_method_id, label from transaction_payment where transaction_id = $1 order by position`, [id])).rows;
  const einzel = pos.length === 1 && !pos[0].cost_account_id && !pos[0].master_product_id;
  return {
    id, household: h.household_id, art: h.kind, datum: h.booking_date, laden: h.merchant_id, total: v * Number(h.total_amount),
    waehrung: h.currency, kurs: Number(h.fx_rate), topf: h.default_cost_account_id, kaeufer: h.buyer_person_id,
    kategorie: pos[0]?.category_id ?? null, notiz: h.notes, bezeichnung: einzel ? pos[0].raw_text : null,
    positionen: einzel ? [] : pos.map((p) => ({
      text: p.raw_text, betrag: v * Number(p.final_price), rabatt: Number(p.item_discount) || undefined, kategorie: p.category_id, topf: p.cost_account_id,
      typ: v > 0 ? p.item_type : undefined, produkt: p.master_product_id, kuerzel: p.alias_mapping_id,
      ...(p.quantity_unit !== "piece" || Number(p.quantity) !== 1
        ? { menge: Number(p.quantity), einheit: p.quantity_unit, einzelpreis: p.regular_unit_price == null ? null : Number(p.regular_unit_price) } : {}),
    })),
    zahlungen: zahl.map((z) => ({ art: z.kind, betrag: v * Number(z.amount), konto: z.account_id, zahlungsmittel: z.payment_method_id, label: z.label })),
  };
}

// ---------- Ausgleich ----------
export interface Saldo { person_id: string; display_name: string; balance: number }
export async function saldo(d: Db, household: string): Promise<Saldo[]> {
  return (await d.query<{ person_id: string; display_name: string; balance: string }>(
    `select person_id, display_name, balance::text from v_settlement_balance where household_id = $1 order by display_name`, [household]))
    .rows.map((r) => ({ ...r, balance: Number(r.balance) }));
}

/** Ausgleichszahlung zwischen den Privatkonten zweier Personen. */
export async function ausgleichBuchen(d: Db, a: { household: string; von: string; an: string; betrag: number; datum: string; mittel: string }) {
  if (rappen(a.betrag) <= 0) throw new Error("Bitte einen Betrag grösser als 0 eingeben.");
  const konto = async (p: string) => (await d.query<{ account_id: string }>(`select account_id from v_private_account where person_id = $1 limit 1`, [p])).rows[0]?.account_id;
  const von = await konto(a.von), an = await konto(a.an);
  if (!von || !an) throw new Error("Für den Ausgleich braucht jede Person ein Privatkonto.");
  const id = uuid7();
  await d.query(`insert into transfer (id, household_id, from_account_id, to_account_id, amount, transfer_date, kind, note) values ($1, $2, $3, $4, $5, $6, 'settlement', $7)`,
    [id, a.household, von, an, a.betrag, a.datum, a.mittel]);
  return id;
}
export async function ueberweisungLoeschen(d: Db, id: string) {
  await d.query(`delete from transfer where id = $1`, [id]);
}

// ---------- Läden ----------
export async function ladenAnlegen(d: Queryable, household: string, name: string): Promise<string> {
  const n = name.trim();
  if (!n) throw new Error("Bitte einen Namen eingeben.");
  const vorhanden = (await d.query<{ id: string }>(`select id from merchant where lower(name) = lower($1) and (household_id is null or household_id = $2) limit 1`, [n, household])).rows[0];
  if (vorhanden) return vorhanden.id;
  const id = uuid7();
  const key = "eigen-" + n.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) + "-" + id.slice(-6);
  await d.query(`insert into merchant (id, household_id, chain_key, name, country) values ($1, $2, $3, $4, 'CH')`, [id, household, key, n]);
  return id;
}
