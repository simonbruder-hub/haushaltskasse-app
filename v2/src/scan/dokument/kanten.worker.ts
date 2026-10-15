/// <reference lib="webworker" />
// Kantenerkennung im Hintergrund, damit das Kamerabild flüssig bleibt
import { findenDaten } from "./bild.js";

self.onmessage = (e: MessageEvent<{ id: number; d: ArrayBuffer; W: number; H: number }>) => {
  const { id, d, W, H } = e.data;
  let r = null;
  try { r = findenDaten(new Uint8ClampedArray(d), W, H); } catch { r = null; }
  self.postMessage({ id, r });
};
