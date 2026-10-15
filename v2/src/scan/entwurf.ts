import type { Db, Queryable } from "../db/types";
import type { Konto } from "../lib/data";
import { persoenlich } from "../lib/auswahl";
import { belegSchreiben, GUTSCHEIN_ARTEN, ladenAnlegen, vorbereiten, type Beleg, type Einheit, type PositionsTyp, type Zahlung } from "../lib/belege";
import { uuid7 } from "../lib/ids";
import { dateiSpeichern } from "./dateien";
import type { Abweichung } from "./pruefen";
import type { Extraktion } from "./typen";

/**
 * Vom Erkennungsergebnis zum Beleg: Laden, Kürzel-Wörterbuch (Kanal 3), Kategorien, Töpfe, Rabatte, Zahlungen.
 * Der Entwurf geht in den Prüf-Dialog; gespeichert und gelernt wird erst nach der Bestätigung.
 */
export type ZeilenStatus = "sicher" | "bekannt" | "ki" | "neu" | "pruefen";
export type Vergleich = "per_100g" | "per_1kg" | "per_100ml" | "per_1l" | "per_piece";
export interface ScanZeile {
  key: string;
  raw: string;                 // wie gedruckt
  name: string;                // Produkt (Gattungsname)
  typ: PositionsTyp;
  betrag: number;              // bezahlt, nach allen Rabatten
  rabatt: number; rabattText: string | null;
  korbRabatt: number; korbText: string | null;
  menge: number | null; einheit: Einheit | null; einzelpreis: number | null;
  vergleich: Vergleich;
  kategorie: string | null;
  topf: string | null;         // ausdrücklich gewählt; leer = Standard der Kategorie, sonst persönlich
  status: ZeilenStatus;
  vorschlag: { produktId: string; produkt: string; kategorie: string | null } | null;
  hinweis: string | null;
}
export interface ScanZahlung { art: string; betrag: number; konto: string | null; label: string | null; last4: string | null }
export interface ScanEntwurf {
  quelle: "ki" | "ocr"; kanal: "receipt_image" | "receipt_pdf"; art: "purchase" | "refund";
  laden: string | null; ladenName: string;
  datum: string; zeit: string | null; belegNr: string | null;
  waehrung: "CHF" | "EUR" | "USD"; kurs: number;
  total: number;
  zahlungen: ScanZahlung[];
  zeilen: ScanZeile[];
  abweichungen: string[]; hinweise: string[];
  datei: { blob: Blob; sha: string; mime: string } | null;
  protokoll: { modell: string | null; requestId: string | null; tokensIn: number | null; tokensOut: number | null; roh: unknown; parsed: unknown } | null;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const ZAHLARTEN = ["cash", "debit_card", "credit_card", "twint", "bank_transfer", "ebill", "voucher", "gift_card", "loyalty_points", "reka", "lunch_check", "other"];
const istGutschein = (art: string) => (GUTSCHEIN_ARTEN as readonly string[]).includes(art);

function vergleichVon(einheit: string | null | undefined): Vergleich {
  if (einheit === "g" || einheit === "kg") return "per_1kg";
  if (einheit === "ml" || einheit === "l") return "per_1l";
  return "per_piece";
}
/** «M-CL VOLLMI UHT 1L» → «M-Cl Vollmi Uht 1L» (nur wenn die KI keinen Namen liefert) */
export function nameAusText(raw: string) {
  const t = raw.replace(/\s+-?\d+[.,]\d{2}(\s+[A-Z0-9])?\s*$/, "").replace(/[*]/g, " ").replace(/\s+/g, " ").trim();
  return t.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()).replace(/(\d)(L|Kg|G|Ml|Cl)\b/g, (_, z: string, e: string) => z + e.toLowerCase());
}

/** Rabatt auf den ganzen Einkauf anteilig auf die Positionen verteilen (Rappen genau, grösster Rest zuerst) */
function verteilen(betrag: number, gewichte: number[]): number[] {
  const rp = Math.round(betrag * 100), summe = gewichte.reduce((s, g) => s + g, 0);
  if (!summe) return gewichte.map(() => 0);
  const roh = gewichte.map((g) => (rp * g) / summe);
  const out = roh.map(Math.floor);
  let rest = rp - out.reduce((s, x) => s + x, 0);
  for (const i of roh.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i)) {
    if (rest <= 0) break;
    out[i]++; rest--;
  }
  return out.map((x) => x / 100);
}

export async function entwurfBauen(d: Queryable, x: {
  household: string; extraktion: Extraktion; quelle: "ki" | "ocr"; kanal: "receipt_image" | "receipt_pdf";
  abweichungen: Abweichung[]; heute: string; datei: ScanEntwurf["datei"]; protokoll: ScanEntwurf["protokoll"];
}): Promise<ScanEntwurf> {
  const e = x.extraktion;
  const hinweise: string[] = [];
  const art = e.transaction.is_refund || e.document.document_type === "refund_receipt" ? "refund" : "purchase";

  // Laden: grosse Ketten aus der globalen Liste, sonst ein eigener Laden mit diesem Namen (wird beim Speichern angelegt)
  let laden: string | null = null, ladenName = e.merchant.name?.trim() ?? "";
  if (e.merchant.chain_key && e.merchant.chain_key !== "other") {
    const m = (await d.query<{ id: string; name: string }>(`select id, name from merchant where household_id is null and chain_key = $1`, [e.merchant.chain_key])).rows[0];
    if (m) { laden = m.id; ladenName = m.name; }
  }
  if (!laden && ladenName) {
    laden = (await d.query<{ id: string }>(`select id from merchant where lower(name) = lower($1) and (household_id is null or household_id = $2) limit 1`,
      [ladenName, x.household])).rows[0]?.id ?? null;
  }

  const kats = (await d.query<{ id: string; name: string }>(`select id, name from category where household_id = $1 and archived_at is null`, [x.household])).rows;
  const katVonName = (n: string | null) => (n ? kats.find((k) => k.name.toLowerCase() === n.toLowerCase())?.id ?? null : null);

  const roh = e.line_items.map((z) => z.raw_text);
  const kuerzel = laden && roh.length
    ? (await d.query<{ nr: number; produkt_id: string | null; produkt: string | null; category_id: string | null; sicher: boolean; last_unit_price: string | null }>(
        `select nr, produkt_id, produkt, category_id, sicher, last_unit_price::text from kuerzel_vorschlaege($1, $2, $3)`, [x.household, laden, roh])).rows
    : [];
  const fraglich = new Set(x.abweichungen.flatMap((a) => a.zeilen ?? []));

  const zeilen: ScanZeile[] = e.line_items.map((z, i) => {
    const k = kuerzel[i]?.produkt_id ? kuerzel[i] : null;
    const menge = z.quantity_unit !== "piece" || z.quantity !== 1 ? z.quantity : null;
    const einzel = z.unit_price ?? (menge ? null : z.regular_price);
    let status: ZeilenStatus = z.item_type !== "product" ? "sicher" : k ? (k.sicher ? "sicher" : "bekannt") : z.category ? "ki" : "neu";
    let hinweis: string | null = null;
    if (k?.last_unit_price && einzel && Math.abs(einzel - Number(k.last_unit_price)) / Number(k.last_unit_price) > 0.5) {
      status = "pruefen"; hinweis = `Preis weicht stark vom letzten Mal ab (${Number(k.last_unit_price).toFixed(2)})`;
    }
    if (z.confidence === "low") { status = "pruefen"; hinweis ??= "unsicher gelesen"; }
    if (fraglich.has(z.position)) { status = "pruefen"; hinweis ??= "passt nicht zur Summe"; }
    return {
      key: `${i}-${z.position}`, raw: z.raw_text,
      name: k?.produkt ?? z.product_name?.trim() ?? (z.item_type === "product" ? nameAusText(z.raw_text) : z.raw_text),
      typ: art === "refund" ? "product" : z.item_type,
      // Gutschrift: Beträge positiv wie im Erfassen-Formular, das Vorzeichen setzt das Speichern
      betrag: art === "refund" ? r2(Math.abs(z.final_price)) : r2(z.final_price), rabatt: art === "refund" ? 0 : r2(z.item_discount), rabattText: z.discount_label,
      korbRabatt: 0, korbText: null,
      menge, einheit: menge ? z.quantity_unit : null, einzelpreis: z.unit_price,
      vergleich: vergleichVon(z.pack_size_hint?.unit ?? (menge ? z.quantity_unit : null)),
      kategorie: k?.category_id ?? katVonName(z.category), topf: null,
      status, vorschlag: k ? { produktId: k.produkt_id!, produkt: k.produkt!, kategorie: k.category_id } : null, hinweis,
    };
  });

  // Rabatt auf den ganzen Einkauf → anteilig auf die betroffenen Waren
  if (art === "purchase") {
    for (const kr of e.basket_discounts) {
      const ziel = zeilen.map((z, i) => ({ z, pos: e.line_items[i].position }))
        .filter(({ z, pos }) => z.typ === "product" && z.betrag > 0 && (!kr.applies_to_positions.length || kr.applies_to_positions.includes(pos)));
      const teile = verteilen(kr.amount, ziel.map(({ z }) => z.betrag));
      ziel.forEach(({ z }, i) => { z.korbRabatt = r2(z.korbRabatt + teile[i]); z.betrag = r2(z.betrag - teile[i]); z.korbText = kr.label; });
    }
    if (e.totals.rounding) {
      zeilen.push({ key: "rundung", raw: "Rundung", name: "Rundung", typ: "deposit_or_fee", betrag: r2(e.totals.rounding), rabatt: 0, rabattText: null,
        korbRabatt: 0, korbText: null, menge: null, einheit: null, einzelpreis: null, vergleich: "per_piece", kategorie: null, topf: null,
        status: "sicher", vorschlag: null, hinweis: null });
    }
  }

  // Zahlungen: Karte über die letzten 4 Ziffern dem Konto zuordnen; Gutscheine und Punkte ohne Konto
  const karten = (await d.query<{ account_id: string; card_last4: string }>(
    `select account_id, card_last4 from payment_method where household_id = $1 and archived_at is null and card_last4 is not null`, [x.household])).rows;
  const zahlungen: ScanZahlung[] = e.payments.filter((p) => Math.abs(p.amount) >= 0.005).map((p) => {
    const a = ZAHLARTEN.includes(p.kind) ? p.kind : "other";
    return { art: a, betrag: r2(Math.abs(p.amount)), label: p.label || null, last4: p.card_last4,
      konto: istGutschein(a) ? null : karten.find((k) => p.card_last4 && k.card_last4 === p.card_last4)?.account_id ?? null };
  });

  const total = r2(Math.abs(e.totals.total));
  let waehrung = e.transaction.currency ?? "CHF", kurs = 1;
  if (waehrung !== "CHF") {
    const k = (await d.query<{ k: string }>(`select fx_rate::text k from transaction_header where household_id = $1 and currency = $2 order by booking_date desc limit 1`,
      [x.household, waehrung])).rows[0]?.k;
    kurs = Number(k ?? (waehrung === "EUR" ? 0.94 : 0.8));
  }
  const datum = e.transaction.date && /^\d{4}-\d{2}-\d{2}$/.test(e.transaction.date) ? e.transaction.date : x.heute;
  if (!e.transaction.date) hinweise.push("Kein Datum gefunden – heute eingesetzt.");
  const zeit = e.transaction.time && /^\d{1,2}:\d{2}$/.test(e.transaction.time) ? e.transaction.time.padStart(5, "0") : null;

  // Doppelt erfasst?
  if (x.datei) {
    const alt = (await d.query<{ datum: string }>(`select h.booking_date::text as datum from attachment a join transaction_header h on h.receipt_attachment_id = a.id
       where a.household_id = $1 and a.sha256 = $2 and h.deleted_at is null limit 1`, [x.household, x.datei.sha])).rows[0];
    if (alt) hinweise.push(`Dieses Foto wurde schon erfasst (Beleg vom ${alt.datum}).`);
  }
  if (laden) {
    const gleich = (await d.query<{ n: number }>(`select count(*)::int as n from transaction_header where household_id = $1 and merchant_id = $2
       and booking_date = $3 and abs(total_amount) = $4 and deleted_at is null`, [x.household, laden, datum, total])).rows[0].n;
    if (gleich) hinweise.push(`Es gibt schon einen Beleg von ${ladenName} mit CHF ${total.toFixed(2)} am ${datum}.`);
  }
  if (e.document.legibility === "poor") hinweise.push("Schlecht lesbar – bitte die Positionen prüfen.");
  if (!e.document.is_complete) hinweise.push("Der Beleg ist nicht vollständig auf dem Bild.");
  hinweise.push(...e.document.warnings);

  return {
    quelle: x.quelle, kanal: x.kanal, art, laden, ladenName, datum, zeit, belegNr: e.transaction.receipt_number,
    waehrung, kurs, total, zahlungen, zeilen, abweichungen: x.abweichungen.map((a) => a.text), hinweise,
    datei: x.datei, protokoll: x.protokoll,
  };
}

/** Summe der Zeilen (für die Anzeige im Prüf-Dialog) */
export const zeilenSumme = (e: ScanEntwurf) => r2(e.zeilen.reduce((s, z) => s + z.betrag, 0));

/** Topf einer Zeile: ausdrücklich gewählt › Standard der Kategorie › persönlicher Topf der zahlenden Person */
export function topfFuer(z: ScanZeile, katTopf: (k: string | null) => string | null, persoenlicherTopf: string | null, hauptKategorie: string | null) {
  return z.topf ?? katTopf(z.kategorie ?? hauptKategorie) ?? persoenlicherTopf;
}

/** Bestätigen: Laden, Anhang, Kürzel lernen und Beleg buchen – alles in einer Transaktion. */
export async function entwurfSpeichern(d: Db, e: ScanEntwurf, ctx: {
  household: string; konto: string; konten: Konto[]; ich: string | null; kategorien: { id: string; default_cost_account_id: string | null }[];
}): Promise<string> {
  const kontoObj = ctx.konten.find((k) => k.id === ctx.konto);
  const kaeufer = kontoObj && kontoObj.owners.length === 1 ? kontoObj.owners[0].person_id : ctx.ich ?? kontoObj?.owners[0]?.person_id;
  if (!kaeufer) throw new Error("Bitte wählen, von welchem Konto bezahlt wurde.");
  const katTopf = (k: string | null) => ctx.kategorien.find((c) => c.id === k)?.default_cost_account_id ?? null;
  const eigener = persoenlich(ctx.konten, kaeufer);

  // Hauptkategorie = die mit dem grössten Betrag; gilt für Zeilen ohne Kategorie (Depot, Rundung …)
  const proKat = new Map<string, number>();
  for (const z of e.zeilen) if (z.kategorie) proKat.set(z.kategorie, (proKat.get(z.kategorie) ?? 0) + Math.abs(z.betrag));
  const hauptKategorie = [...proKat.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const toepfe = e.zeilen.map((z) => topfFuer(z, katTopf, eigener, hauptKategorie));
  if (toepfe.some((t) => !t)) throw new Error("Für eine Position fehlt der Topf.");
  const proTopf = new Map<string, number>();
  e.zeilen.forEach((z, i) => proTopf.set(toepfe[i]!, (proTopf.get(toepfe[i]!) ?? 0) + Math.abs(z.betrag)));
  const belegTopf = [...proTopf.entries()].sort((a, b) => b[1] - a[1])[0][0];

  // Zahlungen: ohne Konto (ausser Gutscheine) → gewähltes Konto. Passt die Summe nicht, eine Zahlung über den Rest.
  let zahlungen: Zahlung[] = e.zahlungen.map((z) => ({ art: z.art, betrag: z.betrag, label: z.label,
    konto: istGutschein(z.art) ? null : z.konto ?? ctx.konto }));
  const summe = r2(zahlungen.reduce((s, z) => s + z.betrag, 0));
  if (!zahlungen.length || Math.round(summe * 100) !== Math.round(e.total * 100)) {
    const gutscheine = zahlungen.filter((z) => istGutschein(z.art));
    const rest = r2(e.total - gutscheine.reduce((s, z) => s + z.betrag, 0));
    const art = zahlungen.find((z) => !istGutschein(z.art))?.art ?? "debit_card";
    zahlungen = [...gutscheine, ...(rest > 0 ? [{ art, betrag: rest, konto: ctx.konto, label: null }] : [])];
  }

  const beleg: Beleg = {
    household: ctx.household, art: e.art, datum: e.datum, laden: e.laden, bezeichnung: e.ladenName || null, total: e.total,
    waehrung: e.waehrung, kurs: e.kurs, topf: belegTopf, kaeufer, kategorie: hauptKategorie,
    positionen: e.zeilen.map((z, i) => ({
      text: z.raw, betrag: z.betrag, rabatt: z.rabatt || undefined, rabattText: z.rabattText,
      korbRabatt: z.korbRabatt || undefined, korbText: z.korbText, kategorie: z.kategorie ?? hauptKategorie,
      topf: toepfe[i] === belegTopf ? null : toepfe[i], typ: z.typ, menge: z.menge, einheit: z.einheit, einzelpreis: z.einzelpreis,
    })),
    zahlungen, quelle: e.kanal, zeit: e.zeit, belegNr: e.belegNr,
  };
  vorbereiten(beleg);   // Summen prüfen, bevor etwas geschrieben wird
  if (e.datei) await dateiSpeichern(e.datei.sha, e.datei.blob);

  return d.transaction(async (tx) => {
    if (!beleg.laden && e.ladenName.trim()) beleg.laden = await ladenAnlegen(tx, ctx.household, e.ladenName);
    if (e.datei) {
      await tx.query(`insert into attachment (id, household_id, kind, storage_path, mime_type, sha256)
                      values (stabile_id('anhang', $1::text, $2), $1, $3, 'lokal/' || $2, $4, $2) on conflict do nothing`,
        [ctx.household, e.datei.sha, e.kanal, e.datei.mime]);
      beleg.anhang = (await tx.query<{ id: string }>(`select id from attachment where household_id = $1 and sha256 = $2`, [ctx.household, e.datei.sha])).rows[0].id;
    }
    // Kürzel lernen: jede Ware wird zum Produkt; der Vorschlag galt als richtig, wenn Produkt und Kategorie blieben
    if (beleg.laden) {
      for (let i = 0; i < e.zeilen.length; i++) {
        const z = e.zeilen[i], p = beleg.positionen[i];
        if (z.typ !== "product" || !z.name.trim()) continue;
        const produkt = (await tx.query<{ id: string }>(`select produkt_sichern($1, $2, $3, $4) as id`,
          [ctx.household, z.name, p.kategorie, z.vergleich])).rows[0].id;
        const richtig = !!z.vorschlag && z.vorschlag.produktId === produkt && z.vorschlag.kategorie === p.kategorie;
        const preis = z.einzelpreis ?? (z.menge ? null : Math.abs(z.betrag + z.rabatt + z.korbRabatt));
        p.produkt = produkt;
        p.kuerzel = (await tx.query<{ id: string }>(`select confirm_alias($1, $2, $3, $4, null, $5, $6) as id`,
          [ctx.household, beleg.laden, z.raw, produkt, preis, richtig])).rows[0].id;
      }
    }
    const id = await belegSchreiben(tx, beleg);
    if (e.protokoll || e.datei) {
      await tx.query(`insert into scan_job (id, household_id, channel, status, attachment_id, input_sha256, model, request_id, raw_output, parsed,
                        validation_errors, transaction_id, tokens_in, tokens_out, finished_at)
                      values ($1, $2, $3, 'done', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())`,
        [uuid7(), ctx.household, e.kanal, beleg.anhang ?? null, e.datei?.sha ?? null, e.protokoll?.modell ?? (e.quelle === "ocr" ? "tesseract" : null),
          e.protokoll?.requestId ?? null, e.protokoll?.roh ? JSON.stringify(e.protokoll.roh) : null,
          e.protokoll?.parsed ? JSON.stringify(e.protokoll.parsed) : null, e.abweichungen, id, e.protokoll?.tokensIn ?? null, e.protokoll?.tokensOut ?? null]);
    }
    return id;
  });
}
