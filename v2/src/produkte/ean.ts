/** EAN/GTIN prüfen (Blueprint §3.2): Länge 8, 12, 13 oder 14, Prüfziffer modulo 10 (Gewichte 3/1 von rechts). */
export function gtinGueltig(code: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false;
  const ziffern = [...code].map(Number);
  const pruef = ziffern.pop()!;
  const summe = ziffern.reverse().reduce((s, z, i) => s + z * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (summe % 10)) % 10 === pruef;
}

/** Ladeninterner Code (EAN-13 mit Präfix 20–29): Gewicht oder Preis im Code, kein Nachschlagen bei OpenFoodFacts */
export const istLadenCode = (code: string) => code.length === 13 && /^2\d/.test(code);

/** UPC-A (12 Stellen) als EAN-13 schreiben, damit derselbe Artikel nur einmal vorkommt */
export const normalisieren = (code: string) => (code.length === 12 ? "0" + code : code);
