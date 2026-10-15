/**
 * Strichcodes (EAN-13, EAN-8, UPC) lesen: der eingebaute BarcodeDetector (Android Chrome), sonst ZXing als WebAssembly
 * (iPhone, Desktop). Die WebAssembly-Datei liegt im Build und wird erst beim ersten Scan geladen – danach auch offline.
 */
export interface Strichcode { rawValue: string; format: string }
export interface Leser { detect(quelle: CanvasImageSource | ImageData | Blob): Promise<Strichcode[]> }

const FORMATE = ["ean_13", "ean_8", "upc_a", "upc_e"];
let leser: Promise<Leser> | null = null;

export function strichcodeLeser(): Promise<Leser> {
  leser ??= (async (): Promise<Leser> => {
    const Nativ = (globalThis as { BarcodeDetector?: { new (o: { formats: string[] }): Leser; getSupportedFormats(): Promise<string[]> } }).BarcodeDetector;
    if (Nativ) {
      try {
        const da = await Nativ.getSupportedFormats();
        const f = FORMATE.filter((x) => da.includes(x));
        if (f.length) return new Nativ({ formats: f });
      } catch { /* weiter mit ZXing */ }
    }
    const [{ BarcodeDetector, prepareZXingModule }, { default: wasm }] = await Promise.all([
      import("barcode-detector/ponyfill"),
      import("zxing-wasm/reader/zxing_reader.wasm?url"),
    ]);
    prepareZXingModule({ overrides: { locateFile: (pfad: string, prefix: string) => (pfad.endsWith(".wasm") ? wasm : prefix + pfad) } });
    return new BarcodeDetector({ formats: FORMATE as never[] }) as unknown as Leser;
  })().catch((e) => { leser = null; throw e; });
  return leser;
}
