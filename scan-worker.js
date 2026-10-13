/* Kasse unterwegs – Kantenerkennung im Hintergrund, damit das Kamerabild flüssig bleibt */
importScripts("bild.js");
self.onmessage = e => {
  const { id, d, W, H } = e.data;
  let r = null;
  try { r = self.Bild.findenDaten(new Uint8ClampedArray(d), W, H); } catch (x) { r = null; }
  self.postMessage({ id, r });
};
