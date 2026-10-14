const chf = new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const geld = (v: number | string | null | undefined) => (v == null || v === "" ? "–" : chf.format(Number(v)));
export const datum = (v: string | Date | null | undefined) =>
  v ? new Date(v).toLocaleDateString("de-CH", { day: "numeric", month: "long", year: "numeric" }) : "–";
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
