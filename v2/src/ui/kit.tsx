import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Icon, KONTO_ICON } from "./Icon";
import { back } from "../lib/router";

export function Seite({ eyebrow, titel, text, zurueck, aktion, children }: {
  eyebrow?: string; titel: string; text?: ReactNode; zurueck?: string; aktion?: ReactNode; children?: ReactNode;
}) {
  return (
    <section className="grid gap-4">
      <header className="flex items-start gap-2 pt-2">
        {zurueck && (
          <button className="icon-btn -ml-2 mt-0.5" onClick={() => back(zurueck)} aria-label="Zurück"><Icon name="links" size={22} /></button>
        )}
        <div className="grid gap-1 min-w-0 flex-1">
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h1 className="text-[28px] font-extrabold tracking-tight">{titel}</h1>
          {text && <p className="text-ink-2 text-[14.5px]">{text}</p>}
        </div>
        {aktion}
      </header>
      {children}
    </section>
  );
}

export function Abschnitt({ titel, text, aktion, children }: { titel: string; text?: ReactNode; aktion?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-2.5">
      <div className="flex items-end justify-between gap-3 px-1">
        <div className="grid gap-0.5"><h2 className="text-[17px] font-bold">{titel}</h2>{text && <p className="text-muted text-[13px]">{text}</p>}</div>
        {aktion}
      </div>
      {children}
    </div>
  );
}

/** Eingabefeld mit Beschriftung. «gruppe» für mehrere Knöpfe (Auswahl), damit jeder Knopf seinen eigenen Namen behält. */
export function Feld({ label, hinweis, children, gruppe }: { label: string; hinweis?: ReactNode; children: ReactNode; gruppe?: boolean }) {
  if (gruppe) return <div className="field" role="group" aria-label={label}><span>{label}</span>{children}{hinweis && <small>{hinweis}</small>}</div>;
  return <label className="field"><span>{label}</span>{children}{hinweis && <small>{hinweis}</small>}</label>;
}

export function Seg<T extends string>({ wert, optionen, onChange, label }: { wert: T; optionen: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {optionen.map(([v, t]) => <button type="button" key={v} aria-pressed={v === wert} onClick={() => onChange(v)}>{t}</button>)}
    </div>
  );
}

export function Sheet({ offen, onClose, titel, children }: { offen: boolean; onClose: () => void; titel: string; children: ReactNode }) {
  useEffect(() => {
    if (!offen) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => { removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [offen, onClose]);
  if (!offen) return null;
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={titel} onClick={(e) => e.stopPropagation()}>
        <div className="grip" />
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="text-[20px] font-extrabold">{titel}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Schliessen"><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function KontoIcon({ kind, small }: { kind: string; small?: boolean }) {
  return <span className={`k-ico k-${kind} ${small ? "small" : ""}`}><Icon name={KONTO_ICON[kind] ?? "zweck"} size={small ? 18 : 21} /></span>;
}

export const PERSON_FARBEN = ["#2a78d6", "#d9576f", "#b07408", "#6250d6", "#237c8f", "#3d7a2a"];
export function farbe(p: { color?: string | null; sort?: number | null }) {
  return p.color || PERSON_FARBEN[((p.sort ?? 1) - 1 + PERSON_FARBEN.length) % PERSON_FARBEN.length];
}
export function Avatar({ name, color, size = 30 }: { name: string; color: string; size?: number }) {
  return <span className="avatar" aria-hidden="true" style={{ background: color, width: size, height: size, fontSize: size * 0.43 }}>{name.slice(0, 1).toUpperCase()}</span>;
}

export function Leer({ icon, titel, text, children }: { icon: string; titel: string; text?: ReactNode; children?: ReactNode }) {
  return (
    <div className="card-flat p-6 grid gap-2 justify-items-center text-center">
      <span className="k-ico k-zweck"><Icon name={icon} /></span>
      <h3 className="font-bold">{titel}</h3>
      {text && <p className="text-muted text-[14px] max-w-[30ch]">{text}</p>}
      {children}
    </div>
  );
}

// ---------- Kurzmeldungen ----------
const ToastCtx = createContext<(t: string) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => { if (!text) return; const t = setTimeout(() => setText(null), 3200); return () => clearTimeout(t); }, [text]);
  return <ToastCtx.Provider value={setText}>{children}{text && <div className="toast" role="status">{text}</div>}</ToastCtx.Provider>;
}
export const useToast = () => useContext(ToastCtx);

/** Führt eine Aktion aus und zeigt Fehler verständlich an. */
export function useAktion() {
  const toast = useToast();
  return useCallback(async (fn: () => Promise<unknown>, erfolg?: string) => {
    try { await fn(); if (erfolg) toast(erfolg); return true; }
    catch (e) { toast(fehlertext(e)); console.error(e); return false; }
  }, [toast]);
}
export function fehlertext(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/duplicate key|unique/i.test(m)) return "Diesen Namen gibt es schon.";
  if (/violates foreign key/i.test(m)) return "Das wird noch verwendet und kann nicht gelöscht werden.";
  if (/check constraint/i.test(m)) return "Ein Wert ist nicht zulässig. Bitte Eingaben prüfen.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Keine Verbindung. Es wird später erneut versucht.";
  return m.length > 140 ? m.slice(0, 140) + "…" : m;
}

/** Löschen mit Rückfrage direkt an Ort und Stelle (kein Browser-Dialog) */
export function LoeschKnopf({ text, frage, onJa }: { text: string; frage: ReactNode; onJa: () => void }) {
  const [fragen, setFragen] = useState(false);
  if (!fragen) return <button type="button" className="btn btn-danger" onClick={() => setFragen(true)}><Icon name="muell" />{text}</button>;
  return (
    <div className="card-flat p-3.5 grid gap-2.5" role="alertdialog" aria-label={text}>
      <p className="text-[14px]">{frage}</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-danger" onClick={onJa}>Ja, löschen</button>
        <button type="button" className="btn" onClick={() => setFragen(false)}>Abbrechen</button>
      </div>
    </div>
  );
}
