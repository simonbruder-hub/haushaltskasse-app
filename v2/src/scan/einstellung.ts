import { STANDARD_MODELL } from "./ki";

/** KI-Erkennung: API-Schlüssel und Modell. Bleiben auf diesem Handy (localStorage), werden nie abgeglichen. */
const SCHLUESSEL = "haushalt-ki";
export interface KiEinstellung { schluessel: string; modell: string }

export function kiEinstellung(): KiEinstellung | null {
  try {
    const v = JSON.parse(localStorage.getItem(SCHLUESSEL) ?? "null") as KiEinstellung | null;
    return v?.schluessel ? { schluessel: v.schluessel, modell: v.modell || STANDARD_MODELL } : null;
  } catch { return null; }
}
export function kiSpeichern(v: KiEinstellung | null) {
  if (v) localStorage.setItem(SCHLUESSEL, JSON.stringify(v));
  else localStorage.removeItem(SCHLUESSEL);
}

/** Übergabe der gewählten Datei vom Erfassen-Formular an die Scan-Seite */
let gewaehlt: File | null = null;
export const scanDateiSetzen = (f: File | null) => { gewaehlt = f; };
export const scanDateiNehmen = () => { const f = gewaehlt; gewaehlt = null; return f; };
