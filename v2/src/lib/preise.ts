import type { Queryable } from "../db/types";
import type { Packung } from "../produkte/menge";
import { packungText, VERGLEICH_TEXT } from "../produkte/menge";
import { uuid7 } from "./ids";

/** Produkte und Preise (M4). Alle Funktionen bekommen die Datenbank übergeben (testbar). */

export interface Artikel {
  id: string; produkt_id: string; produkt: string; name: string; marke: string | null; ean: string | null;
  packung: Packung | null; bild: string | null; category_id: string | null;
}
const ARTIKEL_SQL = `select a.id, a.master_product_id as produkt_id, p.name as produkt, a.name, a.brand as marke, a.ean, a.image_url as bild, p.category_id,
       a.unit_size::text, a.unit_type::text, a.pack_count
  from merchant_product a join master_product p on p.id = a.master_product_id`;
type ArtikelRoh = Omit<Artikel, "packung"> & { unit_size: string | null; unit_type: Packung["einheit"] | null; pack_count: number };
const artikel = (r: ArtikelRoh): Artikel => ({
  id: r.id, produkt_id: r.produkt_id, produkt: r.produkt, name: r.name, marke: r.marke, ean: r.ean, bild: r.bild, category_id: r.category_id,
  packung: r.unit_size != null && r.unit_type ? { groesse: Number(r.unit_size), einheit: r.unit_type, anzahl: r.pack_count } : null,
});

/** Schon bekannter Artikel mit dieser EAN (offline, sofort) */
export async function artikelZurEan(d: Queryable, household: string, ean: string): Promise<Artikel | null> {
  const r = (await d.query<ArtikelRoh>(`${ARTIKEL_SQL} where a.household_id = $1 and a.ean = $2 and a.deleted_at is null`, [household, ean])).rows[0];
  return r ? artikel(r) : null;
}
export async function artikelLaden(d: Queryable, id: string): Promise<Artikel | null> {
  const r = (await d.query<ArtikelRoh>(`${ARTIKEL_SQL} where a.id = $1`, [id])).rows[0];
  return r ? artikel(r) : null;
}

/** Ähnliche Produkte des Haushalts zu einem Namen (für die Zuordnung «Zu welchem Produkt gehört das?») */
export async function produktVorschlaege(d: Queryable, household: string, name: string, anzahl = 5): Promise<{ id: string; name: string }[]> {
  if (!name.trim()) return [];
  return (await d.query<{ id: string; name: string }>(
    `select id, name from master_product where household_id = $1 and deleted_at is null
        and (aehnlichkeit(name, $2) >= 0.3 or lower($2) like '%' || lower(name) || '%')
      order by aehnlichkeit(name, $2) desc, name limit $3`, [household, name, anzahl])).rows;
}

/** Artikel mit EAN speichern und einem Produkt zuordnen (bestehend oder neu mit Name und Kategorie) */
export async function eanSpeichern(d: Queryable, x: {
  household: string; ean: string; produktId?: string | null; produktName?: string | null; kategorie?: string | null;
  name: string; marke?: string | null; packung: Packung | null; bild?: string | null;
}): Promise<Artikel> {
  let produkt = x.produktId ?? null;
  if (!produkt) {
    if (!x.produktName?.trim()) throw new Error("Bitte ein Produkt wählen oder einen Namen eingeben.");
    const vergleich = x.packung?.einheit === "g" || x.packung?.einheit === "kg" ? "per_1kg" : x.packung?.einheit === "ml" || x.packung?.einheit === "l" ? "per_1l" : "per_piece";
    produkt = (await d.query<{ id: string }>(`select produkt_sichern($1, $2, $3, $4) as id`, [x.household, x.produktName, x.kategorie ?? null, vergleich])).rows[0].id;
  } else if (x.kategorie) {
    await d.query(`update master_product set category_id = $2 where id = $1 and category_id is distinct from $2`, [produkt, x.kategorie]);
  }
  const id = (await d.query<{ id: string }>(`select ean_artikel_sichern($1, $2, $3, $4, $5, $6, $7, $8, $9) as id`,
    [x.household, x.ean, produkt, x.name.trim() || x.ean, x.marke ?? null, x.packung?.groesse ?? null, x.packung?.einheit ?? null, x.packung?.anzahl ?? null, x.bild ?? null])).rows[0].id;
  return (await artikelLaden(d, id))!;
}

/** Preis am Regal festhalten (Aktion mit oder ohne angeschriebenen Normalpreis) */
export async function regalpreisSpeichern(d: Queryable, x: {
  household: string; laden: string; artikel: string; datum: string; preis: number; aktion: boolean; normalpreis?: number | null;
}): Promise<string> {
  if (!(x.preis > 0)) throw new Error("Bitte einen Preis grösser als 0 eingeben.");
  const normal = x.aktion && x.normalpreis && x.normalpreis > 0 ? x.normalpreis : null;
  if (normal != null && normal < x.preis) throw new Error("Der Normalpreis ist tiefer als der Aktionspreis.");
  const id = uuid7();
  await d.query(`insert into shelf_price (id, household_id, merchant_id, merchant_product_id, observed_on, price, regular_price, is_promo)
                 values ($1, $2, $3, $4, $5, $6, $7, $8)`, [id, x.household, x.laden, x.artikel, x.datum, x.preis, normal, x.aktion]);
  return id;
}

export async function regalpreisLoeschen(d: Queryable, id: string) {
  await d.query(`delete from shelf_price where id = $1`, [id]);
}

// ---------- Anzeige ----------
export interface Alarm {
  id: string; kind: "shrinkflation" | "price_jump" | "price_drop"; laden: string | null; produkt: string; master_product_id: string;
  observed_on: string; old_base_quantity: string | null; new_base_quantity: string | null; old_unit_price: string | null; new_unit_price: string | null;
  change_pct: string; comparison_unit: string; source_id: string; seen_at: string | null;
}
export const ALARM_SQL = `select id, kind::text, laden, produkt, master_product_id, observed_on::text, old_base_quantity::text, new_base_quantity::text,
    old_unit_price::text, new_unit_price::text, change_pct::text, comparison_unit::text, source_id, seen_at::text
  from v_price_alert where household_id = $1`;

const menge = (b: string | null, einheit: string) => {
  if (b == null) return "?";
  const n = Number(b);
  if (einheit === "per_piece") return `${n} Stk.`;
  const vol = einheit === "per_1l" || einheit === "per_100ml";
  return n >= 1000 ? `${n / 1000} ${vol ? "l" : "kg"}` : `${n} ${vol ? "ml" : "g"}`;
};
const chf = (v: string | null) => (v == null ? "?" : Number(v).toFixed(2));

/** «Packung kleiner: 300 g → 280 g, gleicher Preis 4.95 – pro kg +7.14 %» */
export function alarmText(a: Alarm): { titel: string; text: string } {
  const pct = Number(a.change_pct);
  const p = `${pct > 0 ? "+" : "−"}${Math.abs(pct).toLocaleString("de-CH", { maximumFractionDigits: 1 })} %`;
  const pro = `pro ${VERGLEICH_TEXT[a.comparison_unit] ?? "Einheit"}`;
  if (a.kind === "shrinkflation") {
    return { titel: "Weniger drin", text: `${menge(a.old_base_quantity, a.comparison_unit)} → ${menge(a.new_base_quantity, a.comparison_unit)} für ${chf(a.new_unit_price)} (vorher ${chf(a.old_unit_price)}) · ${pro} ${p}` };
  }
  return { titel: a.kind === "price_jump" ? "Teurer" : "Günstiger", text: `${chf(a.old_unit_price)} → ${chf(a.new_unit_price)} · ${p}` };
}

/** «2.90 / kg» */
export const proEinheit = (wert: number | string | null | undefined, vergleich: string) =>
  wert == null ? "–" : `${Number(wert).toFixed(2)} / ${VERGLEICH_TEXT[vergleich] ?? "Einheit"}`;
export { packungText };
