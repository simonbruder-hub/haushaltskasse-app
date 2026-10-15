import * as Bild from "./bild.js";
import type { Punkt, Quelle } from "./bild.js";

/** Eine aufgenommene Seite (bei langen Belegen mehrere, von oben nach unten) */
export type Modus = "kontrast" | "farbe" | "sw";
export interface Seite { roh: Blob; ecken: Punkt[]; modus: Modus; drehung: number; blob: Blob; url: string }

export const MODI: [Modus, string][] = [["kontrast", "Kontrast"], ["farbe", "Farbe"], ["sw", "S/W"]];
const MODUS_KEY = "haushalt-scanmodus";
export function modusLaden(): Modus {
  try { const m = localStorage.getItem(MODUS_KEY); return m === "farbe" || m === "sw" ? m : "kontrast"; } catch { return "kontrast"; }
}
export function modusMerken(m: Modus) { try { localStorage.setItem(MODUS_KEY, m); } catch { /* egal */ } }

export const ganz = (): Punkt[] => [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
/** Startrahmen, wenn keine Kanten gefunden werden: knapp innerhalb des Bildes */
export const innen = (): Punkt[] => [{ x: 0.06, y: 0.04 }, { x: 0.94, y: 0.04 }, { x: 0.94, y: 0.96 }, { x: 0.06, y: 0.96 }];

/** Foto + Ecken → entzerrte, verbesserte Seite (JPEG 92 %, lange Seite ≤ 4000 px) */
export async function verarbeiten(quelle: Blob | Quelle, ecken: Punkt[], modus: Modus, drehung = 0): Promise<Blob> {
  let bild: Quelle = quelle instanceof Blob ? await Bild.laden(quelle) : quelle;
  if (drehung) bild = Bild.drehen(bild, drehung);
  const W = Bild.breite(bild), H = Bild.hoehe(bild);
  const c = Bild.verbessern(Bild.entzerren(bild, ecken.map((p) => ({ x: p.x * W, y: p.y * H })), 4000), modus);
  return Bild.zuBlob(c, "image/jpeg", 0.92);
}

/** Mehrere Seiten untereinander zu einem Bild für die Ablage (gleiche Breite, höchstens 1400 px) */
export async function zusammensetzen(blobs: Blob[]): Promise<Blob> {
  if (blobs.length === 1) return blobs[0];
  const bilder = await Promise.all(blobs.map((b) => Bild.laden(b)));
  const breite = Math.min(1400, Math.max(...bilder.map((b) => Bild.breite(b))));
  const hoehen = bilder.map((b) => Math.round(Bild.hoehe(b) * breite / Bild.breite(b)));
  const c = document.createElement("canvas");
  c.width = breite; c.height = hoehen.reduce((s, h) => s + h, 0);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  let y = 0;
  bilder.forEach((b, i) => { ctx.drawImage(b, 0, y, breite, hoehen[i]); y += hoehen[i]; if ("close" in b) b.close(); });
  return Bild.zuBlob(c, "image/jpeg", 0.88);
}
