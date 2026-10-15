import type { Einheit } from "../lib/belege";

/**
 * Packungsgrösse aus Text lesen (Blueprint §3.2): OpenFoodFacts-Angaben wie «6 x 1.5 l», «75 cl», «4x125g»
 * und Belegtexte wie «M-CL VOLLMI UHT 1L» oder «ZWEIFEL CHIPS NATURE 280G».
 * Intern zählt g, ml oder Stück; cl und dl werden zu ml. Unsichere Angaben («environ 1 kg») ergeben null, es wird nie geraten.
 */
export interface Packung { groesse: number; einheit: Einheit; anzahl: number }

const ZAHL = String.raw`(\d+(?:[.,]\d+)?)`;
const MASS = String.raw`(kg|g|mg|l|cl|dl|ml)`;
const STUECK = String.raw`(stück|stueck|stk|st\.?|pcs|pc|pièces|pieces|pièce|piece|er-pack|er pack|er)`;
const zahl = (s: string) => Number(s.replace(",", "."));

function umrechnen(wert: number, einheit: string): { groesse: number; einheit: Einheit } | null {
  switch (einheit) {
    case "kg": case "g": case "l": case "ml": return { groesse: wert, einheit: einheit as Einheit };
    case "mg": return { groesse: wert / 1000, einheit: "g" };
    case "cl": return { groesse: Math.round(wert * 10 * 1000) / 1000, einheit: "ml" };
    case "dl": return { groesse: Math.round(wert * 100 * 1000) / 1000, einheit: "ml" };
    default: return null;
  }
}
const gut = (p: Packung | null) => (p && p.groesse > 0 && p.groesse < 100000 && p.anzahl >= 1 && p.anzahl <= 200 ? p : null);

export function packungAusText(text: string | null | undefined): Packung | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/×/g, "x").replace(/\s+/g, " ").trim();
  if (/\b(environ|ca\.?|circa|approx\.?|env\.)\s*\d|~\s*\d/.test(t)) return null;
  // Mehrfachpackung: «6 x 1.5 l», «4x125g», «1.5l x 6»
  let m = t.match(new RegExp(String.raw`(?:^|[^\d.,])(\d{1,3})\s*x\s*${ZAHL}\s*${MASS}(?![a-zäöü])`));
  if (m) { const u = umrechnen(zahl(m[2]), m[3]); return u && gut({ ...u, anzahl: Number(m[1]) }); }
  m = t.match(new RegExp(String.raw`${ZAHL}\s*${MASS}\s*x\s*(\d{1,3})(?![\d.,])`));
  if (m) { const u = umrechnen(zahl(m[1]), m[2]); return u && gut({ ...u, anzahl: Number(m[3]) }); }
  // Einzelpackung: «75 cl», «1,5 L», «280G»
  m = t.match(new RegExp(String.raw`(?:^|[^\d.,a-zäöü])${ZAHL}\s*${MASS}(?![a-zäöü])`));
  if (m) { const u = umrechnen(zahl(m[1]), m[2]); return u && gut({ ...u, anzahl: 1 }); }
  // Stückzahl: «10 Stück», «6er», «10STK»
  m = t.match(new RegExp(String.raw`(?:^|[^\d.,a-zäöü])(\d{1,3})\s*${STUECK}(?![a-zäöü])`));
  if (m) return gut({ groesse: Number(m[1]), einheit: "piece", anzahl: 1 });
  return null;
}

/** OpenFoodFacts: zuerst «quantity», sonst product_quantity + product_quantity_unit (Gesamtmenge) */
export function packungAusOff(quantity: string | null | undefined, menge?: number | string | null, einheit?: string | null): Packung | null {
  const p = packungAusText(quantity);
  if (p) return p;
  const wert = typeof menge === "string" ? zahl(menge) : menge;
  if (wert && einheit) { const u = umrechnen(wert, einheit.toLowerCase()); if (u) return gut({ ...u, anzahl: 1 }); }
  return null;
}

/** «6 × 1.5 l», «500 g», «10 Stk.» */
export function packungText(p: { groesse: number; einheit: Einheit; anzahl: number } | null | undefined): string {
  if (!p) return "";
  const z = (x: number) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000));
  const e = p.einheit === "piece" ? "Stk." : p.einheit;
  return `${p.anzahl > 1 ? `${p.anzahl} × ` : ""}${z(p.groesse)} ${e}`;
}

/** Vergleichseinheit, die zur Packung passt */
export function vergleichFuer(einheit: Einheit | null | undefined): "per_1kg" | "per_1l" | "per_piece" {
  return einheit === "g" || einheit === "kg" ? "per_1kg" : einheit === "ml" || einheit === "l" ? "per_1l" : "per_piece";
}
export const VERGLEICH_TEXT: Record<string, string> = { per_100g: "100 g", per_1kg: "kg", per_100ml: "100 ml", per_1l: "l", per_piece: "Stk." };
