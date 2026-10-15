import type { Extraktion } from "./typen";

/**
 * Offline-Erkennung mit Tesseract – der erprobte Weg aus «Kasse unterwegs» (bon.js, ocr/).
 * Die Dateien liegen bei der alten App eine Ebene höher und werden nur bei Bedarf geladen.
 */
interface Artikel { b?: string; n: string; p: number; r?: number; q?: number | null; e?: string | null; unsicher?: boolean; fehlt?: boolean }
interface BonErgebnis { laden: string; datum: string | null; total: number; summeArtikel: number; artikel: Artikel[]; text: string }
declare global {
  interface Window { Bon?: { auslesen(blobs: Blob[], f?: (anteil: number) => void): Promise<BonErgebnis>; setzeBasis(b: string): void } }
}

const ALT = () => new URL("../", location.href.split("#")[0]);
let laden: Promise<void> | null = null;

function skript(src: string) {
  return new Promise<void>((ok, nein) => {
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = () => ok();
    s.onerror = () => nein(new Error("Die Texterkennung konnte nicht geladen werden."));
    document.head.appendChild(s);
  });
}

export function ocrLaden(): Promise<void> {
  laden ??= (async () => {
    await skript(new URL("ocr/tesseract.min.js", ALT()).href);
    await skript(new URL("bon.js", ALT()).href);
    window.Bon!.setzeBasis(new URL("ocr/", ALT()).href);
  })().catch((e) => { laden = null; throw e; });
  return laden;
}

const KETTEN: Record<string, string> = { Migros: "migros", Coop: "coop", Denner: "denner", Lidl: "lidl", Aldi: "aldi" };

/** Mehrere Bilder = Teile eines langen Belegs von oben nach unten; doppelte Zeilen an den Übergängen entfernt bon.js */
export async function ocrLesen(bilder: Blob[], fortschritt?: (anteil: number) => void): Promise<Extraktion> {
  await ocrLaden();
  const r = await window.Bon!.auslesen(bilder, fortschritt);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    document: { document_type: "receipt", language: "de", legibility: "partial", is_complete: true, warnings: [] },
    merchant: { name: r.laden || "", chain_key: KETTEN[r.laden] ?? "other", branch_name: null, street: null, postal_code: null, city: null, country: "CH", vat_number: null },
    transaction: { date: r.datum, time: null, currency: "CHF", receipt_number: null, register_id: null, receipt_barcode_text: null, is_refund: false },
    line_items: r.artikel.map((a, i) => ({
      position: i + 1, raw_text: a.b || a.n, item_type: "product" as const,
      quantity: a.q && a.q > 0 ? a.q : 1, quantity_unit: a.e === "kg" ? "kg" as const : "piece" as const, unit_price: null,
      regular_price: r2(a.p + (a.r ?? 0)), item_discount: r2(a.r ?? 0), discount_label: a.r ? "Rabatt" : null, final_price: r2(a.p),
      is_promo: !!a.r, pack_size_hint: null, multipack_count: null, vat_code: null, ean: null,
      confidence: a.unsicher || a.fehlt ? "low" as const : "medium" as const, product_name: null, category: null,
    })),
    basket_discounts: [], payments: [],
    loyalty: { program: "none", card_masked: null, points_earned: null, points_redeemed: null },
    totals: { subtotal: r.summeArtikel, total: r2(r.total), rounding: 0, vat_lines: [] },
  };
}
