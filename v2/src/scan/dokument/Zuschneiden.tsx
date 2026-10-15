import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../ui/Icon";
import * as Bild from "./bild.js";
import type { Punkt, Quelle } from "./bild.js";
import { ganz, innen, MODI, modusLaden, modusMerken, verarbeiten, type Modus, type Seite } from "./seite";

/**
 * Zuschneiden mit verschiebbaren Ecken und Kanten, Lupe, Drehen, automatischer Erkennung und Bildart
 * (übernommen aus «Kasse unterwegs», scanner.js). Liefert die fertige, entzerrte Seite.
 */
const ECKEN = ["Ecke oben links", "Ecke oben rechts", "Ecke unten rechts", "Ecke unten links"];
const KANTEN = ["Oberkante", "rechte Kante", "Unterkante", "linke Kante"];

export function Zuschneiden({ roh, start, onFertig, onAbbrechen }: {
  roh: Blob; start?: { ecken: Punkt[]; modus: Modus; drehung: number };
  onFertig: (s: Seite) => void; onAbbrechen: () => void;
}) {
  const [bmp, setBmp] = useState<Quelle | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [drehung, setDrehung] = useState(start?.drehung ?? 0);
  const [ecken, setEcken] = useState<Punkt[] | null>(start ? start.ecken.map((p) => ({ ...p })) : null);
  const [modus, setModus] = useState<Modus>(start?.modus ?? modusLaden());
  const [busy, setBusy] = useState(false);
  const [lupe, setLupe] = useState<Punkt | null>(null);
  const [lage, setLage] = useState({ s: 1, ox: 0, oy: 0, w: 1, h: 1 });
  const buehne = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null), lupeCv = useRef<HTMLCanvasElement>(null);
  const ziehen = useRef<{ ecke: number } | { kante: number; start: Punkt; alt: Punkt[] } | null>(null);

  useEffect(() => {
    let weg = false;
    Bild.laden(roh).then((b) => { if (!weg) setBmp(b); }).catch(() => setFehler("Dieses Bild lässt sich nicht öffnen."));
    document.body.style.overflow = "hidden";
    return () => { weg = true; document.body.style.overflow = ""; };
  }, [roh]);

  const bild = useMemo<Quelle | null>(() => (bmp ? (drehung ? Bild.drehen(bmp, drehung) : bmp) : null), [bmp, drehung]);
  // Beim ersten Öffnen: Ecken automatisch suchen
  useEffect(() => {
    if (!bild || ecken) return;
    const f = Bild.finden(bild);
    setEcken(f && f.guete >= 0.35 ? f.ecken : innen());
  }, [bild, ecken]);

  // Bild einpassen und zeichnen
  useLayoutEffect(() => {
    const b = buehne.current, c = cv.current;
    if (!bild || !ecken || !b || !c) return;
    const malen = () => {
      const bw = b.clientWidth, bh = b.clientHeight, dpr = devicePixelRatio || 1, W = Bild.breite(bild), H = Bild.hoehe(bild);
      const s = Math.min(bw / W, bh / H) * 0.94, w = W * s, hh = H * s, ox = (bw - w) / 2, oy = (bh - hh) / 2;
      setLage((l) => (l.s === s && l.ox === ox && l.oy === oy ? l : { s, ox, oy, w, h: hh }));
      c.style.cssText = `left:${ox}px;top:${oy}px;width:${w}px;height:${hh}px`;
      c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr);
      const ctx = c.getContext("2d")!; ctx.drawImage(bild, 0, 0, c.width, c.height);
      const P = ecken.map((p) => ({ x: p.x * c.width, y: p.y * c.height }));
      ctx.fillStyle = "rgba(10, 16, 12, .55)"; ctx.beginPath(); ctx.rect(0, 0, c.width, c.height); P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.fill("evenodd");
      ctx.strokeStyle = "#5cf0a8"; ctx.lineWidth = 2.5 * dpr; ctx.beginPath(); P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
    };
    malen();
    addEventListener("resize", malen);
    return () => removeEventListener("resize", malen);
  }, [bild, ecken]);

  // Lupe: dreifach vergrössert um die gezogene Ecke
  useEffect(() => {
    const l = lupeCv.current;
    if (!lupe || !l || !bild) return;
    const W = Bild.breite(bild), H = Bild.hoehe(bild), ctx = l.getContext("2d")!, z = 3, r = 110;
    const px = lupe.x * W, py = lupe.y * H, quell = r / (lage.s * z);
    ctx.save(); ctx.clearRect(0, 0, 220, 220); ctx.beginPath(); ctx.arc(r, r, r - 2, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(bild, px - quell, py - quell, quell * 2, quell * 2, 0, 0, 220, 220);
    ctx.strokeStyle = "#5cf0a8"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(r - 14, r); ctx.lineTo(r + 14, r); ctx.moveTo(r, r - 14); ctx.lineTo(r, r + 14); ctx.stroke(); ctx.restore();
  }, [lupe, bild, lage]);

  const pos = (ev: React.PointerEvent): Punkt => {
    const r = buehne.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (ev.clientX - r.left - lage.ox) / lage.w)), y: Math.min(1, Math.max(0, (ev.clientY - r.top - lage.oy) / lage.h)) };
  };
  function runter(ev: React.PointerEvent) {
    const t = (ev.target as HTMLElement).closest<HTMLElement>(".zs-ecke, .zs-kante");
    if (!t || !ecken) return;
    ev.preventDefault(); t.setPointerCapture(ev.pointerId);
    ziehen.current = t.classList.contains("zs-ecke") ? { ecke: Number(t.dataset.i) } : { kante: Number(t.dataset.k), start: pos(ev), alt: ecken.map((p) => ({ ...p })) };
  }
  function bewegen(ev: React.PointerEvent) {
    const z = ziehen.current;
    if (!z || !ecken) return;
    const p = pos(ev);
    if ("ecke" in z) { setEcken(ecken.map((e, i) => (i === z.ecke ? p : e))); setLupe(p); }
    else {
      const i = z.kante, j = (i + 1) % 4, dx = p.x - z.start.x, dy = p.y - z.start.y;
      const neu = ecken.map((e, k) => (k === i || k === j ? { x: Math.min(1, Math.max(0, z.alt[k].x + dx)), y: Math.min(1, Math.max(0, z.alt[k].y + dy)) } : e));
      setEcken(neu); setLupe(neu[i]);
    }
  }
  const loslassen = () => { ziehen.current = null; setLupe(null); };

  function drehen() {
    if (!ecken) return;
    const q = ecken.map((p) => ({ x: 1 - p.y, y: p.x }));
    setEcken([q[3], q[0], q[1], q[2]]);
    setDrehung((drehung + 90) % 360);
  }
  async function uebernehmen() {
    if (!bmp || !ecken) return;
    setBusy(true);
    try {
      const blob = await verarbeiten(bmp, ecken, modus, drehung);
      modusMerken(modus);
      onFertig({ roh, ecken, modus, drehung, blob, url: URL.createObjectURL(blob) });
    } catch {
      setBusy(false); setFehler("Das Bild liess sich nicht verarbeiten.");
    }
  }

  return createPortal(
    <div className="zuschnitt" role="dialog" aria-modal="true" aria-label="Zuschneiden">
      <div className="zs-oben">
        <button type="button" className="sc-rund" aria-label="Abbrechen" onClick={onAbbrechen}><Icon name="x" size={22} /></button>
        <b>Zuschneiden</b>
        <span className="w-11" />
      </div>
      <div ref={buehne} className="zs-buehne" onPointerDown={runter} onPointerMove={bewegen} onPointerUp={loslassen} onPointerCancel={loslassen}>
        <canvas ref={cv} className="zs-bild" />
        {ecken && bild && <>
          {KANTEN.map((t, i) => {
            const a = ecken[i], b = ecken[(i + 1) % 4];
            return <span key={t} className="zs-kante" data-k={i} aria-label={t} style={{ left: lage.ox + (a.x + b.x) / 2 * lage.w, top: lage.oy + (a.y + b.y) / 2 * lage.h }} />;
          })}
          {ECKEN.map((t, i) => (
            <span key={t} className="zs-ecke" data-i={i} role="slider" aria-label={t} aria-valuetext={`${Math.round(ecken[i].x * 100)} %, ${Math.round(ecken[i].y * 100)} %`}
              style={{ left: lage.ox + ecken[i].x * lage.w, top: lage.oy + ecken[i].y * lage.h }} />
          ))}
        </>}
        <canvas ref={lupeCv} className="lupe" width={220} height={220} hidden={!lupe}
          style={lupe ? { left: Math.min((buehne.current?.clientWidth ?? 300) - 120, Math.max(0, lage.ox + lupe.x * lage.w - 55)), top: Math.max(0, lage.oy + lupe.y * lage.h - 150) } : undefined} />
      </div>
      <div className="zs-unten">
        {fehler ? <p className="zs-tipp !text-[#ffb4a8]" role="alert">{fehler}</p>
          : <p className="zs-tipp">Ecken oder Kanten ziehen. Tipp: Kopf mit Adresse und Fussteil weglassen – dann liest die App nur die Artikel.</p>}
        <div className="flex justify-center gap-1.5 flex-wrap">
          <button type="button" className="btn !min-h-0 py-2 text-[14px]" onClick={drehen}><Icon name="drehen" size={18} />Drehen</button>
          <button type="button" className="btn !min-h-0 py-2 text-[14px]" onClick={() => {
            if (!bild) return;
            const f = Bild.finden(bild);
            if (f && f.guete >= 0.35) { setEcken(f.ecken); setFehler(null); } else setFehler("Keine Kanten gefunden – Ecken bitte von Hand setzen.");
          }}><Icon name="zauber" size={18} />Automatisch</button>
          <button type="button" className="btn !min-h-0 py-2 text-[14px]" onClick={() => setEcken(ganz())}><Icon name="rahmen" size={18} />Ganzes Bild</button>
        </div>
        <div className="flex justify-center">
          <div className="seg" role="group" aria-label="Bildart">
            {MODI.map(([v, t]) => <button type="button" key={v} aria-pressed={modus === v} onClick={() => setModus(v)}>{t}</button>)}
          </div>
        </div>
        <button type="button" className="btn btn-primary btn-big" disabled={busy || !ecken} onClick={uebernehmen}>
          <Icon name="haken" />{busy ? "Wird verarbeitet …" : "Übernehmen"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
