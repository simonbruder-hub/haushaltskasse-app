import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../ui/Icon";
import * as Bild from "./bild.js";
import type { Fund, Punkt } from "./bild.js";
import { ganz, MODI, modusLaden, modusMerken, verarbeiten, type Modus, type Seite } from "./seite";
import { Zuschneiden } from "./Zuschneiden";

/**
 * Kamera in der App mit automatischer Kantenerkennung und Auslöser (übernommen aus «Kasse unterwegs», scanner.js):
 * Liegt die Quittung 0.9 s ruhig im Bild, löst die App selbst aus, entzerrt und verbessert den Kontrast.
 * Lange Quittungen Teil für Teil von oben nach unten aufnehmen.
 */
declare class ImageCapture { constructor(t: MediaStreamTrack); takePhoto(): Promise<Blob> }
type Hinweis = { text: string; art?: "ok" | "fehler" };

/** Abdruck des Kamerabilds: 16 × 16 mittlere Helligkeiten. Daran erkennt die App, ob schon der nächste Teil im Bild ist. */
function abdruck(d: Uint8ClampedArray, W: number, H: number): Float32Array {
  const n = 16, a = new Float32Array(n * n), z = new Uint32Array(n * n);
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const i = (y * W + x) * 4, k = Math.min(n - 1, (y * n / H) | 0) * n + Math.min(n - 1, (x * n / W) | 0);
    a[k] += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; z[k]++;
  }
  for (let k = 0; k < a.length; k++) a[k] /= Math.max(1, z[k]);
  return a;
}
const unterschied = (a: Float32Array, b: Float32Array) => { let s = 0; for (let k = 0; k < a.length; k++) s += Math.abs(a[k] - b[k]); return s / a.length; };
/** Gleiche Ansicht wie beim letzten Teil: Ecken fast gleich und Bild kaum verändert */
const GLEICHE_ECKEN = 0.06, GLEICHES_BILD = 7;

export function Kamera({ onFertig, onAbbrechen, onOhneKamera }: {
  onFertig: (seiten: Seite[]) => void; onAbbrechen: () => void; onOhneKamera: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null), ueber = useRef<HTMLCanvasElement>(null), blitz = useRef<HTMLDivElement>(null), ringFg = useRef<SVGCircleElement>(null);
  const [hinweis, setHinweis] = useState<Hinweis>({ text: "Kamera startet …" });
  const [auto, setAuto] = useState(true);
  const [modus, setModus] = useState<Modus>(modusLaden);
  const [seiten, setSeiten] = useState<Seite[]>([]);
  const [licht, setLicht] = useState<boolean | null>(null);   // null = kein Licht verfügbar
  const [keineKamera, setKeineKamera] = useState(false);
  const [korrigieren, setKorrigieren] = useState<number | null>(null);
  const [galerie, setGalerie] = useState<Blob[]>([]);
  // Zustand der Schleife (ohne Neuzeichnen von React)
  const s = useRef({
    auto: true, modus: "kontrast" as Modus, track: null as MediaStreamTrack | null, cap: null as ImageCapture | null, worker: null as Worker | null,
    beschaeftigt: false, ziel: null as Punkt[] | null, glatt: null as Punkt[] | null, verlauf: [] as { t: number; e: Punkt[] }[],
    stabilSeit: 0, sperreBis: 0, aufnahme: false, pausiert: false,
    abdruck: null as Float32Array | null, letzte: null as { ecken: Punkt[]; abdruck: Float32Array | null } | null,
  });
  s.current.auto = auto; s.current.modus = modus;
  s.current.pausiert = korrigieren != null || galerie.length > 0;

  const ausloesen = useRef<() => void>(() => undefined);
  const seitenRef = useRef(seiten); seitenRef.current = seiten;
  const ring = (a: number) => ringFg.current?.setAttribute("stroke-dashoffset", String(226.2 * (1 - a)));

  useEffect(() => {
    const st = s.current;
    let aus = false;   // pro Durchlauf: StrictMode startet den Effekt beim Entwickeln zweimal
    let stream: MediaStream | null = null, loop = 0;
    document.body.style.overflow = "hidden";
    const probe = document.createElement("canvas");

    function ergebnis(r: Fund | null) {
      const jetzt = performance.now();
      if (r && r.guete >= 0.5) {
        st.ziel = r.ecken;
        // Noch derselbe Teil wie zuletzt aufgenommen: nicht nochmals auslösen, bis der nächste Teil im Bild ist
        const l = st.letzte;
        if (l && l.ecken.every((p, i) => Math.hypot(p.x - r.ecken[i].x, p.y - r.ecken[i].y) < GLEICHE_ECKEN)
          && (!l.abdruck || !st.abdruck || unterschied(l.abdruck, st.abdruck) < GLEICHES_BILD)) {
          st.verlauf = []; st.stabilSeit = 0; ring(0);
          if (!st.aufnahme) setHinweis({ text: `Teil ${seitenRef.current.length} aufgenommen – nächsten Teil ins Bild schieben oder «Fertig»`, art: "ok" });
          return;
        }
        st.letzte = null;
        st.verlauf.push({ t: jetzt, e: r.ecken }); st.verlauf = st.verlauf.filter((v) => jetzt - v.t < 1200);
        const ruhig = st.verlauf.length >= 3 && st.verlauf.every((v) => v.e.every((p, i) => Math.hypot(p.x - r.ecken[i].x, p.y - r.ecken[i].y) < 0.025));
        if (ruhig) { if (!st.stabilSeit) st.stabilSeit = jetzt; } else st.stabilSeit = 0;
        const dauer = st.stabilSeit ? jetzt - st.stabilSeit : 0;
        if (!st.aufnahme) setHinweis({ text: st.auto ? (dauer > 0 ? "Ruhig halten …" : "Quittung erkannt") : "Erkannt – auslösen", art: "ok" });
        ring(st.auto ? Math.min(1, dauer / 900) : 0);
        if (st.auto && dauer > 900 && jetzt > st.sperreBis && !st.aufnahme) aufnehmen(r.ecken);
      } else {
        st.verlauf = []; st.stabilSeit = 0; ring(0);
        if (!r) st.letzte = null;
        if (!st.aufnahme) setHinweis({ text: st.ziel ? "Quittung ins Bild halten" : "Quittung ins Bild halten – dunkler Untergrund hilft" });
        st.ziel = null;
      }
    }
    function zeichnen() {
      const v = video.current, cv = ueber.current;
      if (!v || !cv) return;
      const cw = cv.clientWidth, ch = cv.clientHeight, dpr = devicePixelRatio || 1;
      if (cv.width !== Math.round(cw * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
      const ctx = cv.getContext("2d")!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cw, ch);
      if (!st.ziel || !v.videoWidth) { st.glatt = null; return; }
      const ziel = st.ziel;
      st.glatt = st.glatt ? st.glatt.map((p, i) => ({ x: p.x + (ziel[i].x - p.x) * 0.45, y: p.y + (ziel[i].y - p.y) * 0.45 })) : ziel;
      const k = Math.max(cw / v.videoWidth, ch / v.videoHeight), ox = (cw - v.videoWidth * k) / 2, oy = (ch - v.videoHeight * k) / 2;
      const pts = st.glatt.map((p) => ({ x: ox + p.x * v.videoWidth * k, y: oy + p.y * v.videoHeight * k }));
      const pfad = () => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); };
      ctx.fillStyle = "rgba(10, 20, 14, .35)"; ctx.beginPath(); ctx.rect(0, 0, cw, ch); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.fill("evenodd");
      ctx.strokeStyle = st.stabilSeit ? "#5cf0a8" : "#ffffff"; ctx.lineWidth = 3; ctx.lineJoin = "round"; pfad(); ctx.stroke();
      ctx.fillStyle = "#ffffff"; for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill(); }
    }
    function schleife() {
      clearTimeout(loop);
      if (aus) return;
      const v = video.current;
      if (v?.videoWidth && !st.beschaeftigt && !st.aufnahme && !st.pausiert) {
        const f = Math.min(1, 320 / Math.max(v.videoWidth, v.videoHeight));
        probe.width = Math.round(v.videoWidth * f); probe.height = Math.round(v.videoHeight * f);
        const ctx = probe.getContext("2d", { willReadFrequently: true })!; ctx.drawImage(v, 0, 0, probe.width, probe.height);
        const d = ctx.getImageData(0, 0, probe.width, probe.height);
        st.abdruck = abdruck(d.data, probe.width, probe.height);
        if (st.worker) { st.beschaeftigt = true; st.worker.postMessage({ id: Date.now(), d: d.data.buffer, W: probe.width, H: probe.height }, [d.data.buffer]); }
        else ergebnis(Bild.findenDaten(d.data, probe.width, probe.height));
      }
      zeichnen();
      loop = window.setTimeout(schleife, 120);
    }
    async function aufnehmen(liveEcken?: Punkt[]) {
      const v = video.current;
      if (!v?.videoWidth || st.aufnahme) return;
      st.aufnahme = true; ring(0);
      const ansicht = { ecken: liveEcken ?? st.ziel ?? ganz(), abdruck: st.abdruck };
      const b = blitz.current; if (b) { b.classList.remove("an"); void b.offsetWidth; b.classList.add("an"); }
      try { navigator.vibrate?.(30); } catch { /* egal */ }
      setHinweis({ text: "Wird verarbeitet …", art: "ok" });
      try {
        let roh: Blob | null = null;
        // Volle Auflösung; hängt die Kamera, nach 4 s das Videobild nehmen
        if (st.cap) {
          const cap = st.cap;
          try { roh = await Promise.race([cap.takePhoto(), new Promise<null>((ok) => setTimeout(() => ok(null), 4000))]); } catch { roh = null; }
        }
        if (!roh) {
          const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
          c.getContext("2d")!.drawImage(v, 0, 0); roh = await Bild.zuBlob(c, "image/jpeg", 0.95);
        }
        const bmp = await Bild.laden(roh);
        const f = Bild.finden(bmp);
        const ecken = f && f.guete >= 0.45 ? f.ecken : (liveEcken ?? st.ziel ?? ganz());
        const blob = await verarbeiten(bmp, ecken, st.modus);
        if ("close" in bmp) bmp.close();
        if (aus) return;
        const neu: Seite = { roh, ecken, modus: st.modus, drehung: 0, blob, url: URL.createObjectURL(blob) };
        setHinweis({ text: `Teil ${seitenRef.current.length + 1} aufgenommen – weiterer Teil oder «Fertig»`, art: "ok" });
        setSeiten((alt) => [...alt, neu]);
        st.letzte = ansicht;
      } catch {
        setHinweis({ text: "Aufnahme ging nicht – nochmals versuchen", art: "fehler" });
      }
      st.sperreBis = performance.now() + 2500; st.verlauf = []; st.stabilSeit = 0;
      st.aufnahme = false;
    }
    ausloesen.current = () => aufnehmen();

    try {
      st.worker = new Worker(new URL("./kanten.worker.ts", import.meta.url), { type: "module" });
      st.worker.onmessage = (e: MessageEvent<{ r: Fund | null }>) => { st.beschaeftigt = false; ergebnis(e.data.r); };
      st.worker.onerror = () => { st.worker?.terminate(); st.worker = null; st.beschaeftigt = false; };
    } catch { st.worker = null; }

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("keine Kamera");
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } } });
      } catch (e) {
        if (aus) return;
        setKeineKamera(true);
        setHinweis({ text: e instanceof DOMException && e.name === "NotAllowedError" ? "Kein Zugriff auf die Kamera – in den Einstellungen erlauben oder ein Foto wählen." : "Kamera nicht verfügbar – Foto wählen.", art: "fehler" });
        return;
      }
      if (aus) { stream.getTracks().forEach((t) => t.stop()); return; }
      const v = video.current!;
      v.srcObject = stream; st.track = stream.getVideoTracks()[0];
      try { await v.play(); } catch { /* startet von selbst */ }
      try {
        const cap = (st.track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };
        if (cap.torch) setLicht(false);
        if (cap.focusMode?.includes("continuous")) st.track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => undefined);
      } catch { /* egal */ }
      try { if ("ImageCapture" in window) st.cap = new ImageCapture(st.track); } catch { st.cap = null; }
      setHinweis({ text: "Quittung ins Bild halten" });
      schleife();
    })();

    return () => {
      aus = true;
      clearTimeout(loop);
      stream?.getTracks().forEach((t) => t.stop());
      st.worker?.terminate(); st.worker = null;
      st.track = null; st.cap = null; st.ziel = null; st.glatt = null; st.verlauf = [];
      document.body.style.overflow = "";
    };
  }, []);

  // Bilder freigeben, wenn die Kamera geschlossen wird, ohne sie zu übernehmen
  const uebergeben = useRef(false);
  useEffect(() => () => { if (!uebergeben.current) seitenRef.current.forEach((x) => URL.revokeObjectURL(x.url)); }, []);

  function lichtUmschalten() {
    const t = s.current.track; if (!t || licht == null) return;
    const an = !licht; setLicht(an);
    t.applyConstraints({ advanced: [{ torch: an } as MediaTrackConstraintSet] }).catch(() => undefined);
  }
  function fertig() { uebergeben.current = true; onFertig(seiten); }

  return createPortal(
    <div className="scanner" role="dialog" aria-modal="true" aria-label="Beleg scannen">
      <video ref={video} playsInline muted autoPlay />
      <canvas ref={ueber} className="ueber" />
      <div ref={blitz} className="blitz" />
      <div className="sc-oben">
        <button type="button" className="sc-rund" aria-label="Schliessen" onClick={onAbbrechen}><Icon name="x" size={22} /></button>
        <span className={`sc-hinweis ${hinweis.art ?? ""}`} role="status">{hinweis.text}</span>
        {licht != null ? <button type="button" className={`sc-rund ${licht ? "an" : ""}`} aria-label="Licht" aria-pressed={licht} onClick={lichtUmschalten}><Icon name="licht" size={22} /></button> : <span className="w-11" />}
      </div>
      <div className="sc-unten">
        {keineKamera
          ? <button type="button" className="btn btn-primary btn-big" onClick={onOhneKamera}><Icon name="bild" />Foto wählen</button>
          : <div className="sc-leiste">
              <button type="button" className="sc-pill" aria-pressed={auto} onClick={() => setAuto(!auto)}><Icon name="blitzauto" size={16} />{auto ? "Auto" : "Manuell"}</button>
              <div className="seg sc-seg" role="group" aria-label="Bildart">
                {MODI.map(([v, t]) => <button type="button" key={v} aria-pressed={modus === v} onClick={() => { setModus(v); modusMerken(v); }}>{t}</button>)}
              </div>
            </div>}
        <div className="sc-knoepfe">
          <label className="sc-rund gross" aria-label="Aus der Galerie">
            <Icon name="bild" size={22} />
            <input type="file" accept="image/*" multiple className="sr-only" tabIndex={-1} aria-label="Bilder aus der Galerie"
              onChange={(ev) => { const f = [...(ev.target.files ?? [])]; ev.target.value = ""; if (f.length) setGalerie(f); }} />
          </label>
          <button type="button" className="sc-ausloeser" aria-label="Aufnehmen" disabled={keineKamera} onClick={() => ausloesen.current()}>
            <svg className="sc-ring" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="36" className="bg" /><circle ref={ringFg} cx="40" cy="40" r="36" className="fg" strokeDasharray="226.2" strokeDashoffset="226.2" /></svg>
          </button>
          <span className="flex items-center gap-2 justify-self-end">
            {seiten.length > 0 && (
              <button type="button" className="sc-thumbs" aria-label="Letzten Teil zuschneiden" onClick={() => setKorrigieren(seiten.length - 1)}>
                {seiten.slice(-3).map((x) => <img key={x.url} src={x.url} alt="" />)}
              </button>
            )}
            <button type="button" className="sc-fertig" disabled={!seiten.length} onClick={fertig}>{seiten.length ? `Fertig (${seiten.length})` : "Fertig"}</button>
          </span>
        </div>
        <p className="sc-tipp">Lange Quittung? Teil für Teil von oben nach unten aufnehmen.</p>
      </div>
      {korrigieren != null && seiten[korrigieren] && (
        <Zuschneiden roh={seiten[korrigieren].roh} start={seiten[korrigieren]} onAbbrechen={() => setKorrigieren(null)}
          onFertig={(neu) => { URL.revokeObjectURL(seiten[korrigieren].url); setSeiten(seiten.map((x, i) => (i === korrigieren ? neu : x))); setKorrigieren(null); }} />
      )}
      {galerie.length > 0 && (
        <Zuschneiden key={galerie.length} roh={galerie[0]} onAbbrechen={() => setGalerie(galerie.slice(1))}
          onFertig={(neu) => { setSeiten((alt) => [...alt, neu]); setGalerie(galerie.slice(1)); }} />
      )}
    </div>,
    document.body,
  );
}
