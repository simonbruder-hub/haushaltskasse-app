/** Typen zu bild.js (Bildverarbeitung aus «Kasse unterwegs») */
export interface Punkt { x: number; y: number }
/** Ecken relativ zum Bild (0..1): oben links, oben rechts, unten rechts, unten links */
export interface Fund { ecken: Punkt[]; guete: number; anteil?: number; verfahren?: "kanten" | "maske" }
export type Quelle = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas | HTMLVideoElement;
export type Leinwand = HTMLCanvasElement | OffscreenCanvas;

export function laden(blob: Blob): Promise<ImageBitmap | HTMLImageElement>;
export function finden(quelle: Quelle, max?: number): Fund | null;
export function findenDaten(d: Uint8ClampedArray, W: number, H: number): Fund | null;
/** ecken in Pixeln */
export function entzerren(quelle: Quelle, ecken: Punkt[], max?: number): Leinwand;
export function verbessern<T extends Leinwand>(canvas: T, modus: "kontrast" | "farbe" | "sw"): T;
export function drehen(quelle: Quelle, grad: number): Leinwand;
export function zuBlob(canvas: Leinwand, typ?: string, q?: number): Promise<Blob>;
export function vorschau(quelle: Quelle, max?: number): Leinwand;
export function klein(quelle: Quelle, max: number): Leinwand;
export function breite(b: Quelle): number;
export function hoehe(b: Quelle): number;
export function homographie(q: Punkt[]): { a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number };
