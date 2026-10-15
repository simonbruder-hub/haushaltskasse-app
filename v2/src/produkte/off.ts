import type { Queryable } from "../db/types";
import { packungAusOff, type Packung } from "./menge";

/**
 * Produkt zur EAN bei OpenFoodFacts nachschlagen (Blueprint §3.2), für Drogerie und Haushalt auch bei
 * Open Beauty Facts und Open Products Facts. Antworten bleiben im Zwischenspeicher off_cache auf diesem Handy:
 * gefunden 30 Tage, nicht gefunden 7 Tage. Ladeninterne Codes (20–29) fragt die App gar nicht erst nach.
 */
export interface OffProdukt {
  ean: string; quelle: "off" | "obf" | "opf";
  name: string | null; gattung: string | null; marke: string | null;
  menge: string | null; packung: Packung | null; bild: string | null; kategorien: string[];
}
export type OffErgebnis = { status: "found"; produkt: OffProdukt } | { status: "not_found" } | { status: "offline" | "error"; text: string };

const DATENBANKEN: [OffProdukt["quelle"], string][] = [
  ["off", "https://world.openfoodfacts.org"],
  ["obf", "https://world.openbeautyfacts.org"],
  ["opf", "https://world.openproductsfacts.org"],
];
const FELDER = "code,product_name,product_name_de,product_name_fr,generic_name_de,generic_name,brands,quantity,product_quantity,product_quantity_unit,image_front_small_url,categories_tags";

interface Roh {
  product_name?: string; product_name_de?: string; product_name_fr?: string; generic_name_de?: string; generic_name?: string;
  brands?: string; quantity?: string; product_quantity?: number | string; product_quantity_unit?: string; image_front_small_url?: string; categories_tags?: string[];
}
const text = (s: string | undefined | null) => (s && s.trim() ? s.trim() : null);

export function ausRoh(ean: string, quelle: OffProdukt["quelle"], p: Roh): OffProdukt {
  return {
    ean, quelle,
    name: text(p.product_name_de) ?? text(p.product_name) ?? text(p.product_name_fr),
    gattung: text(p.generic_name_de) ?? text(p.generic_name),
    marke: text(p.brands?.split(",")[0]),
    menge: text(p.quantity),
    packung: packungAusOff(p.quantity, p.product_quantity, p.product_quantity_unit),
    bild: text(p.image_front_small_url),
    kategorien: p.categories_tags ?? [],
  };
}

async function ausCache(d: Queryable, ean: string): Promise<OffErgebnis | null> {
  const c = (await d.query<{ status: string; source_db: OffProdukt["quelle"]; payload: Roh | null; frisch: boolean }>(
    `select status, source_db, payload,
            fetched_at > now() - case when status = 'found' then interval '30 days' else interval '7 days' end as frisch
       from off_cache where ean = $1`, [ean])).rows[0];
  if (!c?.frisch) return null;
  if (c.status === "found" && c.payload) return { status: "found", produkt: ausRoh(ean, c.source_db, c.payload) };
  if (c.status === "not_found") return { status: "not_found" };
  return null;
}

async function merken(d: Queryable, ean: string, status: "found" | "not_found", quelle: OffProdukt["quelle"], roh: Roh | null, p: OffProdukt | null) {
  await d.query(`insert into off_cache (ean, fetched_at, status, source_db, product_name, brand, quantity_raw, unit_size, unit_type, pack_count, image_url, categories_tags, payload)
                 values ($1, now(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                 on conflict (ean) do update set fetched_at = now(), status = excluded.status, source_db = excluded.source_db, product_name = excluded.product_name,
                   brand = excluded.brand, quantity_raw = excluded.quantity_raw, unit_size = excluded.unit_size, unit_type = excluded.unit_type,
                   pack_count = excluded.pack_count, image_url = excluded.image_url, categories_tags = excluded.categories_tags, payload = excluded.payload`,
    [ean, status, quelle, p?.name ?? null, p?.marke ?? null, p?.menge ?? null, p?.packung?.groesse ?? null, p?.packung?.einheit ?? null, p?.packung?.anzahl ?? null,
      p?.bild ?? null, p?.kategorien ?? null, roh ? JSON.stringify(roh) : null]);
}

export async function offSuchen(d: Queryable, ean: string, holen: typeof fetch = fetch): Promise<OffErgebnis> {
  const c = await ausCache(d, ean);
  if (c) return c;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { status: "offline", text: "Ohne Internet: Produkt von Hand erfassen." };
  let fehler: string | null = null;
  for (const [quelle, basis] of DATENBANKEN) {
    try {
      const r = await holen(`${basis}/api/v2/product/${ean}?fields=${FELDER}`, { signal: AbortSignal.timeout(8000) });
      if (r.status === 404) continue;   // OFF antwortet bei unbekannter EAN teils mit 404 und status 0
      if (!r.ok) { fehler = `${basis.replace("https://world.", "")} antwortet mit ${r.status}`; continue; }
      const j = (await r.json()) as { status?: number; product?: Roh };
      if (j.status === 1 && j.product) {
        const p = ausRoh(ean, quelle, j.product);
        await merken(d, ean, "found", quelle, j.product, p);
        return { status: "found", produkt: p };
      }
    } catch (e) {
      fehler = e instanceof Error && e.name === "TimeoutError" ? "OpenFoodFacts antwortet nicht." : "Keine Verbindung zu OpenFoodFacts.";
      if (quelle === "off") break;   // ohne Netz nicht noch zwei weitere Datenbanken versuchen
    }
  }
  if (fehler) return { status: "error", text: fehler };
  await merken(d, ean, "not_found", "off", null, null);
  return { status: "not_found" };
}
