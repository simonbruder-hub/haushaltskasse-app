import type { Extraktion } from "./typen";

/** Deterministische Prüfung der Erkennung (Blueprint §3.1 Schritt 4). Leere Liste = alles stimmt. */
export interface Abweichung { text: string; zeilen?: number[] }

const rp = (x: number) => Math.round(x * 100);
const chf = (x: number) => (Math.round(x * 100) / 100).toFixed(2);

export function pruefen(e: Extraktion, heute: string): Abweichung[] {
  const out: Abweichung[] = [];
  const summe = e.line_items.reduce((s, z) => s + z.final_price, 0);
  const korb = e.basket_discounts.reduce((s, k) => s + k.amount, 0);
  const soll = summe - korb + (e.totals.rounding ?? 0);
  if (Math.abs(rp(soll) - rp(e.totals.total)) > 1) {
    out.push({ text: `Summe der Positionen (${chf(soll)}) ≠ Total (${chf(e.totals.total)}), Differenz ${chf(e.totals.total - soll)}` });
  }
  if (e.payments.length) {
    const bezahlt = e.payments.reduce((s, z) => s + z.amount, 0);
    if (Math.abs(rp(bezahlt) - rp(e.totals.total)) > 1) out.push({ text: `Summe der Zahlungen (${chf(bezahlt)}) ≠ Total (${chf(e.totals.total)})` });
  }
  for (const z of e.line_items) {
    if (Math.abs(rp(z.regular_price - z.item_discount) - rp(z.final_price)) > 1) {
      out.push({ text: `Zeile ${z.position} «${z.raw_text}»: ${chf(z.regular_price)} − ${chf(z.item_discount)} ≠ ${chf(z.final_price)}`, zeilen: [z.position] });
    }
    if (z.unit_price != null && z.quantity > 0 && Math.abs(rp(z.quantity * z.unit_price) - rp(z.regular_price)) > 2) {
      out.push({ text: `Zeile ${z.position} «${z.raw_text}»: ${z.quantity} × ${chf(z.unit_price)} ≠ ${chf(z.regular_price)}`, zeilen: [z.position] });
    }
  }
  if (e.transaction.date) {
    if (e.transaction.date > heute) out.push({ text: `Das Datum ${e.transaction.date} liegt in der Zukunft` });
    const vor2 = `${Number(heute.slice(0, 4)) - 2}${heute.slice(4)}`;
    if (e.transaction.date < vor2) out.push({ text: `Das Datum ${e.transaction.date} ist älter als zwei Jahre` });
  }
  return out;
}

/** Nachricht für die Reparatur-Runde */
export function reparaturText(abw: Abweichung[]): string {
  return "Die automatische Prüfung hat Abweichungen gefunden:\n" + abw.map((a) => "- " + a.text).join("\n")
    + "\nLies die betroffenen Zeilen und Summen auf dem Beleg noch einmal und gib das vollständige, korrigierte JSON aus. "
    + "Erfinde nichts. Bleibt eine Differenz, nenne sie in document.warnings.";
}
