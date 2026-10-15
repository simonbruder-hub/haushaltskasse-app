import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../ui/Icon";
import { gtinGueltig, normalisieren } from "./ean";
import { strichcodeLeser } from "./strichcode";

/**
 * Kamera für Produkt-Strichcodes. Ein Code gilt erst, wenn er zweimal hintereinander mit gültiger Prüfziffer gelesen
 * wurde (Fehllesungen bei schrägem Licht). Ohne Kamera oder bei schlechtem Licht: Nummer eintippen.
 */
export function EanScanner({ onCode, onAbbrechen, titel = "Strichcode scannen" }: { onCode: (ean: string) => void; onAbbrechen: () => void; titel?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [hinweis, setHinweis] = useState<{ text: string; art?: "ok" | "fehler" }>({ text: "Kamera startet …" });
  const [tippen, setTippen] = useState(false);
  const [nummer, setNummer] = useState("");
  const [licht, setLicht] = useState<boolean | null>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  const fertig = useRef(onCode); fertig.current = onCode;

  useEffect(() => {
    let aus = false, stream: MediaStream | null = null, t = 0, letzter = "";
    const leinwand = document.createElement("canvas");
    document.body.style.overflow = "hidden";
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("keine Kamera");
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
      } catch (e) {
        if (aus) return;
        setTippen(true);
        setHinweis({ text: e instanceof DOMException && e.name === "NotAllowedError" ? "Kein Zugriff auf die Kamera – Nummer eintippen." : "Keine Kamera – Nummer eintippen.", art: "fehler" });
        return;
      }
      if (aus) { stream.getTracks().forEach((x) => x.stop()); return; }
      const v = video.current!;
      v.srcObject = stream; track.current = stream.getVideoTracks()[0];
      try { await v.play(); } catch { /* startet von selbst */ }
      try {
        const cap = (track.current.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };
        if (cap.torch) setLicht(false);
        if (cap.focusMode?.includes("continuous")) track.current.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => undefined);
      } catch { /* egal */ }
      let leser;
      try { leser = await strichcodeLeser(); } catch {
        if (!aus) { setTippen(true); setHinweis({ text: "Der Strichcode-Leser liess sich nicht laden – Nummer eintippen.", art: "fehler" }); }
        return;
      }
      if (aus) return;
      setHinweis({ text: "Strichcode ins Bild halten" });
      const runde = async () => {
        if (aus) return;
        if (v.videoWidth) {
          // Mitte des Bildes, höchstens 1280 px breit: schneller und genauer als das ganze Bild
          const f = Math.min(1, 1280 / v.videoWidth);
          leinwand.width = Math.round(v.videoWidth * f); leinwand.height = Math.round(v.videoHeight * f);
          leinwand.getContext("2d", { willReadFrequently: true })!.drawImage(v, 0, 0, leinwand.width, leinwand.height);
          try {
            const codes = (await leser.detect(leinwand)).map((c) => normalisieren(c.rawValue.trim())).filter(gtinGueltig);
            const c = codes[0];
            if (c && c === letzter) {
              try { navigator.vibrate?.(40); } catch { /* egal */ }
              setHinweis({ text: c, art: "ok" });
              aus = true;
              fertig.current(c);
              return;
            }
            letzter = c ?? "";
          } catch { /* nächster Versuch */ }
        }
        t = window.setTimeout(runde, 180);
      };
      runde();
    })();
    return () => {
      aus = true; clearTimeout(t);
      stream?.getTracks().forEach((x) => x.stop());
      track.current = null;
      document.body.style.overflow = "";
    };
  }, []);

  const eingabe = normalisieren(nummer.replace(/\D/g, ""));
  const gueltig = gtinGueltig(eingabe);
  return createPortal(
    <div className="scanner" role="dialog" aria-modal="true" aria-label={titel}>
      <video ref={video} playsInline muted autoPlay />
      <div className="ean-rahmen" aria-hidden="true"><span /></div>
      <div className="sc-oben">
        <button type="button" className="sc-rund" aria-label="Schliessen" onClick={onAbbrechen}><Icon name="x" size={22} /></button>
        <span className={`sc-hinweis ${hinweis.art ?? ""}`} role="status">{hinweis.text}</span>
        {licht != null
          ? <button type="button" className={`sc-rund ${licht ? "an" : ""}`} aria-label="Licht" aria-pressed={licht}
              onClick={() => { const an = !licht; setLicht(an); track.current?.applyConstraints({ advanced: [{ torch: an } as MediaTrackConstraintSet] }).catch(() => undefined); }}>
              <Icon name="licht" size={22} /></button>
          : <span className="w-11" />}
      </div>
      <div className="sc-unten">
        {tippen
          ? <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (gueltig) onCode(eingabe); }}>
              <input className="input mono !text-[18px] !bg-white !text-[#10251b]" inputMode="numeric" autoFocus aria-label="EAN-Nummer"
                placeholder="z. B. 7610200337030" value={nummer} onChange={(e) => setNummer(e.target.value)} />
              {nummer.replace(/\D/g, "").length >= 8 && !gueltig && <p className="sc-tipp !text-[#ffb4a8]">Die Prüfziffer stimmt nicht – bitte die Nummer kontrollieren.</p>}
              <button className="btn btn-primary btn-big" disabled={!gueltig}><Icon name="haken" />Übernehmen</button>
            </form>
          : <button type="button" className="sc-pill justify-self-center" onClick={() => setTippen(true)}><Icon name="stift" size={16} />Nummer eintippen</button>}
        <p className="sc-tipp">EAN-Strichcode auf der Packung, nicht der Regal-Etikette.</p>
      </div>
    </div>,
    document.body,
  );
}
