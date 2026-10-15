/** Bilder für die Erkennung vorbereiten: richtig gedreht, lange Seite ≤ 2576 px (hohe Auflösung der Modelle), JPEG 85 %.
 *  Sehr lange Belege (Höhe/Breite > 3.5) werden in überlappende Abschnitte zerlegt (Höhe ≈ 2.2 × Breite, 15 % Überlappung). */
const MAX = 2576;

export async function sha256(blob: Blob): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function zuBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function leinwand(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}
const alsJpeg = (c: HTMLCanvasElement) => new Promise<Blob>((ok, nein) => c.toBlob((b) => (b ? ok(b) : nein(new Error("Bild konnte nicht umgewandelt werden"))), "image/jpeg", 0.85));

/** Ausschnitt (sx, sy, sw, sh) des Bildes so verkleinern, dass die lange Seite höchstens MAX ist */
async function ausschnitt(bmp: ImageBitmap, sx: number, sy: number, sw: number, sh: number): Promise<Blob> {
  const f = Math.min(1, MAX / Math.max(sw, sh));
  const c = leinwand(sw * f, sh * f);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return alsJpeg(c);
}

export interface Vorbereitet { ablage: Blob; abschnitte: Blob[] }

export async function bildVorbereiten(datei: Blob): Promise<Vorbereitet> {
  const bmp = await createImageBitmap(datei, { imageOrientation: "from-image" });
  try {
    const { width: w, height: h } = bmp;
    const ablage = await ausschnitt(bmp, 0, 0, w, h);
    if (h / w <= 3.5) return { ablage, abschnitte: [ablage] };
    const hoehe = Math.round(2.2 * w), schritt = Math.round(hoehe * 0.85);
    const abschnitte: Blob[] = [];
    for (let y = 0; y < h; y += schritt) {
      const sh = Math.min(hoehe, h - y);
      abschnitte.push(await ausschnitt(bmp, 0, y, w, sh));
      if (y + sh >= h) break;
    }
    return { ablage, abschnitte };
  } finally {
    bmp.close();
  }
}
