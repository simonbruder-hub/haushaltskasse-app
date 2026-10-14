const chf = new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const geld = (v: number | string | null | undefined) => (v == null || v === "" ? "–" : chf.format(Number(v)));
export const datum = (v: string | Date | null | undefined) =>
  v ? (typeof v === "string" ? lokal(v) : v).toLocaleDateString("de-CH", { day: "numeric", month: "long", year: "numeric" }) : "–";
export const isoDatum = (v: string | Date | null | undefined) => {
  if (!v) return "";
  const d = new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const heute = () => isoDatum(new Date());
export function iban(v: string | null | undefined) {
  const s = (v ?? "").replace(/\s+/g, "").toUpperCase();
  return s.replace(/(.{4})/g, "$1 ").trim();
}
/** IBAN-Prüfung (mod 97), nur CH/LI-Länge streng */
export function ibanGueltig(v: string): boolean {
  const s = v.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  if ((s.startsWith("CH") || s.startsWith("LI")) && s.length !== 21) return false;
  const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let m = 0;
  for (const d of r) m = (m * 10 + Number(d)) % 97;
  return m === 1;
}
/** Eingabe wie «12,30», «1'234.50» oder «12.3» als Zahl */
export const zahl = (s: string | number | null | undefined) => {
  const n = Number(String(s ?? "").replace(/['’\s]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
export const monatName = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("de-CH", { month: "long", year: "numeric" });
};
/** «2026-10-14» als lokales Datum (new Date("2026-10-14") wäre UTC-Mitternacht) */
export const lokal = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(Number(v.slice(0, 4)), Number(v.slice(5, 7)) - 1, Number(v.slice(8, 10))) : new Date(v));
export const kurzDatum = (v: string) => lokal(v).toLocaleDateString("de-CH", { weekday: "short", day: "numeric", month: "short" });
/** Erster Tag dieses und des nächsten Monats (für Monatsabfragen) */
export function monatsGrenzen(tag = heute()) {
  const y = Number(tag.slice(0, 4)), m = Number(tag.slice(5, 7));
  return { von: isoDatum(new Date(y, m - 1, 1)), bis: isoDatum(new Date(y, m, 1)) };
}
