import { useState } from "react";
import { Feld, Seg, useAktion } from "../ui/kit";
import { Icon } from "../ui/Icon";
import { CodeLogin, VerbindungFormular } from "../ui/Anmeldung";
import { einrichten } from "../lib/data";
import { verbindung } from "../lib/supabase";
import { beitreten, useSync } from "../lib/sync";

/** Erster Start: neuen Haushalt einrichten oder einem bestehenden beitreten */
export function Start() {
  const [schritt, setSchritt] = useState<"start" | "neu" | "beitreten">("start");
  return (
    <div className="mx-auto max-w-[34rem] px-4 pt-[calc(env(safe-area-inset-top)+20px)] pb-10 grid gap-5">
      {schritt === "start" && <Willkommen weiter={setSchritt} />}
      {schritt === "neu" && <Neu zurueck={() => setSchritt("start")} />}
      {schritt === "beitreten" && <Beitreten zurueck={() => setSchritt("start")} />}
    </div>
  );
}

function Willkommen({ weiter }: { weiter: (s: "neu" | "beitreten") => void }) {
  return (
    <>
      <div className="hero p-6 grid gap-4">
        <img src="./icon-192.png" alt="" width={56} height={56} className="rounded-2xl ring-2 ring-white/30" />
        <div className="grid gap-2">
          <h1 className="text-[30px] font-extrabold leading-tight">Euer Haushalt an einem Ort</h1>
          <p className="opacity-90 text-[15px]">Einkäufe, gemeinsame und eigene Töpfe, Budget und Ausgleich – für zwei, immer 50/50. Läuft auch ohne Netz.</p>
        </div>
      </div>
      <button className="card p-5 text-left flex gap-4 items-center" onClick={() => weiter("neu")}>
        <span className="k-ico k-leben"><Icon name="plus" /></span>
        <span className="grid gap-0.5 flex-1"><b className="text-[17px]">Neuen Haushalt einrichten</b><span className="text-muted text-[14px]">Konten, Töpfe und Kategorien sind sofort vorbereitet.</span></span>
        <Icon name="rechts" className="text-muted" />
      </button>
      <button className="card p-5 text-left flex gap-4 items-center" onClick={() => weiter("beitreten")}>
        <span className="k-ico k-privat"><Icon name="link" /></span>
        <span className="grid gap-0.5 flex-1"><b className="text-[17px]">Einem Haushalt beitreten</b><span className="text-muted text-[14px]">Mit dem Einladungscode vom Handy deines Partners.</span></span>
        <Icon name="rechts" className="text-muted" />
      </button>
      <p className="text-muted text-[13px] px-1">Alle Daten liegen zuerst nur auf diesem Handy. Den Abgleich zwischen euren Handys schaltest du später in den Einstellungen ein.</p>
    </>
  );
}

function Neu({ zurueck }: { zurueck: () => void }) {
  const [name, setName] = useState("Unser Haushalt");
  const [a1, setA1] = useState("Simon");
  const [a2, setA2] = useState("Eliana");
  const [ich, setIch] = useState<"1" | "2">("1");
  const aktion = useAktion();
  const ok = name.trim() && a1.trim() && a2.trim() && a1.trim() !== a2.trim();
  return (
    <form className="grid gap-5" onSubmit={(e) => { e.preventDefault(); aktion(() => einrichten({ name, a1, a2, ich: ich === "1" ? 1 : 2 }), "Haushalt eingerichtet"); }}>
      <div className="flex items-center gap-2">
        <button type="button" className="icon-btn -ml-2" onClick={zurueck} aria-label="Zurück"><Icon name="links" size={22} /></button>
        <h1 className="text-[26px] font-extrabold">Neuer Haushalt</h1>
      </div>
      <div className="card p-5 grid gap-4">
        <Feld label="Name des Haushalts"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Feld>
        <div className="grid grid-cols-2 gap-3">
          <Feld label="Person 1"><input className="input" value={a1} onChange={(e) => setA1(e.target.value)} /></Feld>
          <Feld label="Person 2"><input className="input" value={a2} onChange={(e) => setA2(e.target.value)} /></Feld>
        </div>
        <Feld gruppe label="Wer benutzt dieses Handy?">
          <Seg label="Wer benutzt dieses Handy?" wert={ich} onChange={setIch} optionen={[["1", a1 || "Person 1"], ["2", a2 || "Person 2"]]} />
        </Feld>
      </div>
      <div className="card-flat p-5 grid gap-3">
        <p className="eyebrow">Das wird vorbereitet</p>
        <Punkt kind="leben" titel="Gemeinsam Leben" text="Topf für Essen, Haushalt, Wohnen, Ferien – immer 50/50. Heute ohne eigenes Konto." />
        <Punkt kind="privat" titel={`${a1 || "…"} Privat · ${a2 || "…"} Privat`} text="Eure Lohnkonten, über die heute bezahlt wird." />
        <Punkt kind="sparen" titel="Je ein Spar- und Freizeit-Topf" text="Vorbereitet für später, wenn ihr eigene Konten eröffnet." />
        <Punkt kind="zweck" titel="17 Lebensbereiche, 36 Kategorien" text="Mit Standard-Topf: gemeinsam oder persönlich. Alles anpassbar." />
      </div>
      <button className="btn btn-primary btn-big" disabled={!ok}>Haushalt einrichten</button>
    </form>
  );
}

function Punkt({ kind, titel, text }: { kind: string; titel: string; text: string }) {
  return (
    <div className="flex gap-3 items-start">
      <span className={`k-ico small k-${kind}`}><Icon name={kind === "zweck" ? "kategorien" : kind} size={18} /></span>
      <div className="grid"><b className="text-[15px]">{titel}</b><span className="text-muted text-[13.5px]">{text}</span></div>
    </div>
  );
}

function Beitreten({ zurueck }: { zurueck: () => void }) {
  const sync = useSync();
  const [verbunden, setVerbunden] = useState(!!verbindung());
  const angemeldet = sync.modus === "bereit" || sync.modus === "fehler" || sync.modus === "laeuft";
  const [code, setCode] = useState("");
  const aktion = useAktion();
  const schritt = !verbunden ? 1 : !angemeldet ? 2 : 3;
  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-2">
        <button className="icon-btn -ml-2" onClick={zurueck} aria-label="Zurück"><Icon name="links" size={22} /></button>
        <h1 className="text-[26px] font-extrabold">Beitreten</h1>
      </div>
      <Schritt nr={1} aktiv={schritt === 1} fertig={schritt > 1} titel="Verbindung zum Server">
        <VerbindungFormular fertig={() => setVerbunden(true)} />
      </Schritt>
      <Schritt nr={2} aktiv={schritt === 2} fertig={schritt > 2} titel="Anmelden">
        <CodeLogin fertig={() => undefined} />
      </Schritt>
      <Schritt nr={3} aktiv={schritt === 3} fertig={false} titel="Einladungscode eingeben">
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); aktion(() => beitreten(code), "Willkommen im Haushalt"); }}>
          <p className="text-[14px] text-ink-2">Den Code erstellt dein Partner unter Einstellungen → «Partner einladen».</p>
          <input className="input mono text-center text-[22px] tracking-[.25em] uppercase" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <button className="btn btn-primary" disabled={code.length < 8}>Beitreten</button>
        </form>
      </Schritt>
    </div>
  );
}

function Schritt({ nr, titel, aktiv, fertig, children }: { nr: number; titel: string; aktiv: boolean; fertig: boolean; children: React.ReactNode }) {
  return (
    <div className={`card p-5 grid gap-4 ${aktiv ? "" : "opacity-70"}`}>
      <div className="flex items-center gap-3">
        <span className="step" style={{ background: fertig || aktiv ? "var(--accent)" : "var(--paper-2)", color: fertig || aktiv ? "var(--on-accent)" : "var(--muted)" }}>
          {fertig ? <Icon name="haken" size={16} strokeWidth={2.4} /> : nr}
        </span>
        <h2 className="font-bold text-[17px]">{titel}</h2>
      </div>
      {aktiv && children}
    </div>
  );
}
