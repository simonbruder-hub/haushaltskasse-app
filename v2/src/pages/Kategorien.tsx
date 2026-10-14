import { useMemo, useState } from "react";
import { useQuery } from "../db/client";
import { KLASSE_TEXT, kategorieAnlegen, kategorieSpeichern, lebensbereichAnlegen, lebensbereichSpeichern, type Klasse } from "../lib/data";
import { useHaushalt } from "../lib/haushalt";
import { Feld, KontoIcon, Seg, Seite, Sheet, useAktion } from "../ui/kit";
import { Icon } from "../ui/Icon";

interface Bereich { id: string; name: string; spending_class: Klasse; sort: number; archived_at: string | null }
interface Kat { id: string; life_area_id: string; name: string; spending_class: Klasse | null; default_cost_account_id: string | null; archived_at: string | null }

export function Kategorien() {
  const { household, konten } = useHaushalt();
  const bereiche = useQuery<Bereich>(`select id, name, spending_class, sort, archived_at::text from life_area where household_id = $1 order by sort, name`, [household]);
  const kats = useQuery<Kat>(`select id, life_area_id, name, spending_class, default_cost_account_id, archived_at::text from category where household_id = $1 order by sort, name`, [household]);
  const [filter, setFilter] = useState<"alle" | "gemeinsam" | "persoenlich">("alle");
  const [archiv, setArchiv] = useState(false);
  const [kat, setKat] = useState<Kat | null>(null);
  const [bereich, setBereich] = useState<Bereich | null>(null);
  const [neuIn, setNeuIn] = useState<Bereich | null>(null);
  const [neuerBereich, setNeuerBereich] = useState(false);
  const topf = useMemo(() => new Map(konten.map((k) => [k.id, k])), [konten]);
  if (!bereiche || !kats) return null;
  const sichtbar = (c: Kat) => (archiv || !c.archived_at) && (filter === "alle" || (filter === "gemeinsam") === !!c.default_cost_account_id);
  const archiviert = kats.filter((c) => c.archived_at).length + bereiche.filter((b) => b.archived_at).length;
  return (
    <Seite eyebrow="Lebensbereiche und Kategorien" titel="Wohin Ausgaben gehören"
      text="Jede Kategorie hat einen Standard-Topf. Beim Erfassen schlägt die App ihn vor – ändern geht immer mit einem Tipp.">
      <Seg label="Filter" wert={filter} onChange={setFilter} optionen={[["alle", "Alle"], ["gemeinsam", "Gemeinsam"], ["persoenlich", "Persönlich"]]} />
      {bereiche.filter((b) => archiv || !b.archived_at).map((b) => {
        const liste = kats.filter((c) => c.life_area_id === b.id && sichtbar(c));
        if (!liste.length && filter !== "alle") return null;
        return (
          <div key={b.id} className={`card overflow-hidden ${b.archived_at ? "opacity-60" : ""}`}>
            <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
              <h2 className="font-bold text-[16.5px] flex-1">{b.name}</h2>
              <span className="chip chip-virtuell">{KLASSE_TEXT[b.spending_class]}</span>
              <button className="icon-btn" aria-label={`${b.name} bearbeiten`} onClick={() => setBereich(b)}><Icon name="stift" size={18} /></button>
            </div>
            <div className="list border-t border-[var(--rule)]">
              {liste.map((c) => {
                const k = c.default_cost_account_id ? topf.get(c.default_cost_account_id) : null;
                return (
                  <button key={c.id} className={`row ${c.archived_at ? "opacity-60" : ""}`} onClick={() => setKat(c)}>
                    <span className="flex-1 grid min-w-0"><span className="font-medium truncate">{c.name}</span>
                      {c.spending_class && <span className="text-muted text-[12px]">{KLASSE_TEXT[c.spending_class]} (abweichend)</span>}</span>
                    {k ? <span className={`chip k-tag k-${k.kind}`}><Icon name={k.kind === "leben" ? "leben" : k.kind} size={13} strokeWidth={2.2} />{k.name}</span>
                       : <span className="chip chip-virtuell"><Icon name="person" size={13} strokeWidth={2.2} />persönlich</span>}
                  </button>
                );
              })}
              {filter === "alle" && !b.archived_at && (
                <button className="row text-accent-ink font-semibold" onClick={() => setNeuIn(b)}><Icon name="plus" size={18} />Kategorie hinzufügen</button>
              )}
            </div>
          </div>
        );
      })}
      <div className="grid gap-2">
        <button className="btn" onClick={() => setNeuerBereich(true)}><Icon name="plus" />Lebensbereich hinzufügen</button>
        {archiviert > 0 && <button className="btn btn-ghost" onClick={() => setArchiv(!archiv)}>{archiv ? "Archivierte ausblenden" : `${archiviert} archivierte zeigen`}</button>}
      </div>
      {kat && <KategorieSheet kat={kat} bereiche={bereiche} schliessen={() => setKat(null)} />}
      {bereich && <BereichSheet b={bereich} schliessen={() => setBereich(null)} />}
      {neuIn && <NeueKategorie b={neuIn} schliessen={() => setNeuIn(null)} />}
      <NeuerBereich offen={neuerBereich} schliessen={() => setNeuerBereich(false)} />
    </Seite>
  );
}

function TopfWahl({ wert, setWert }: { wert: string; setWert: (v: string) => void }) {
  const { konten } = useHaushalt();
  const offen = konten.filter((k) => k.status !== "closed" && (k.owners.length > 1 || k.kind === "kind"));
  return (
    <div className="grid gap-2">
      <button type="button" aria-pressed={wert === ""} onClick={() => setWert("")} className={`card-flat p-3 flex items-center gap-3 text-left ${wert === "" ? "outline-2 outline-[var(--accent)]" : ""}`}>
        <span className="k-ico small k-privat"><Icon name="person" size={18} /></span>
        <span className="grid"><b>Persönlich</b><span className="text-muted text-[12.5px]">Topf der Person, die einkauft</span></span>
      </button>
      {offen.map((k) => (
        <button type="button" key={k.id} aria-pressed={wert === k.id} onClick={() => setWert(k.id)} className={`card-flat p-3 flex items-center gap-3 text-left ${wert === k.id ? "outline-2 outline-[var(--accent)]" : ""}`}>
          <KontoIcon kind={k.kind} small />
          <span className="grid"><b>{k.name}</b><span className="text-muted text-[12.5px]">{k.owners.map((o) => o.name).join(" & ")} je 50 %</span></span>
        </button>
      ))}
    </div>
  );
}

function KategorieSheet({ kat, bereiche, schliessen }: { kat: Kat; bereiche: Bereich[]; schliessen: () => void }) {
  const [name, setName] = useState(kat.name);
  const [pot, setPot] = useState(kat.default_cost_account_id ?? "");
  const [klasse, setKlasse] = useState<string>(kat.spending_class ?? "");
  const [bereich, setBereich] = useState(kat.life_area_id);
  const aktion = useAktion();
  const speichern = async () => {
    if (await aktion(() => kategorieSpeichern(kat.id, { name: name.trim(), default_cost_account_id: pot || null, spending_class: (klasse || null) as Klasse | null, life_area_id: bereich }), "Gespeichert")) schliessen();
  };
  return (
    <Sheet offen onClose={schliessen} titel={kat.name}>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); speichern(); }}>
        <Feld label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Feld>
        <Feld gruppe label="Standard-Topf"><TopfWahl wert={pot} setWert={setPot} /></Feld>
        <Feld label="Lebensbereich"><select className="input" value={bereich} onChange={(e) => setBereich(e.target.value)}>{bereiche.filter((b) => !b.archived_at || b.id === bereich).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Feld>
        <Feld gruppe label="Für die 50/30/20-Auswertung" hinweis="Normalerweise wie der Lebensbereich.">
          <Seg label="Klasse" wert={klasse} onChange={setKlasse} optionen={[["", "Wie Bereich"], ["need", "Bedarf"], ["want", "Wunsch"], ["saving", "Sparen"]]} />
        </Feld>
        <button className="btn btn-primary btn-big" disabled={!name.trim()}>Speichern</button>
        <button type="button" className="btn btn-ghost" onClick={async () => { if (await aktion(() => kategorieSpeichern(kat.id, { archived_at: kat.archived_at ? null : new Date().toISOString() }), kat.archived_at ? "Wiederhergestellt" : "Archiviert")) schliessen(); }}>
          {kat.archived_at ? "Wiederherstellen" : "Archivieren (ausblenden)"}
        </button>
      </form>
    </Sheet>
  );
}

function NeueKategorie({ b, schliessen }: { b: Bereich; schliessen: () => void }) {
  const { household } = useHaushalt();
  const [name, setName] = useState(""); const [pot, setPot] = useState("");
  const aktion = useAktion();
  return (
    <Sheet offen onClose={schliessen} titel={`Neu in ${b.name}`}>
      <form className="grid gap-4" onSubmit={async (e) => { e.preventDefault(); if (await aktion(() => kategorieAnlegen(household, b.id, name, pot || null), "Hinzugefügt")) schliessen(); }}>
        <Feld label="Name"><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Feld>
        <Feld gruppe label="Standard-Topf"><TopfWahl wert={pot} setWert={setPot} /></Feld>
        <button className="btn btn-primary btn-big" disabled={!name.trim()}>Hinzufügen</button>
      </form>
    </Sheet>
  );
}

function BereichSheet({ b, schliessen }: { b: Bereich; schliessen: () => void }) {
  const [name, setName] = useState(b.name); const [klasse, setKlasse] = useState<Klasse>(b.spending_class);
  const aktion = useAktion();
  return (
    <Sheet offen onClose={schliessen} titel={b.name}>
      <form className="grid gap-4" onSubmit={async (e) => { e.preventDefault(); if (await aktion(() => lebensbereichSpeichern(b.id, { name: name.trim(), spending_class: klasse }), "Gespeichert")) schliessen(); }}>
        <Feld label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Feld>
        <Feld gruppe label="Klasse (50/30/20)"><Seg label="Klasse" wert={klasse} onChange={setKlasse} optionen={[["need", "Bedarf"], ["want", "Wunsch"], ["saving", "Sparen"]]} /></Feld>
        <button className="btn btn-primary btn-big" disabled={!name.trim()}>Speichern</button>
        <button type="button" className="btn btn-ghost" onClick={async () => { if (await aktion(() => lebensbereichSpeichern(b.id, { archived_at: b.archived_at ? null : new Date().toISOString() }), b.archived_at ? "Wiederhergestellt" : "Archiviert")) schliessen(); }}>
          {b.archived_at ? "Wiederherstellen" : "Lebensbereich archivieren"}
        </button>
      </form>
    </Sheet>
  );
}

function NeuerBereich({ offen, schliessen }: { offen: boolean; schliessen: () => void }) {
  const { household } = useHaushalt();
  const [name, setName] = useState(""); const [klasse, setKlasse] = useState<Klasse>("need");
  const aktion = useAktion();
  return (
    <Sheet offen={offen} onClose={schliessen} titel="Neuer Lebensbereich">
      <form className="grid gap-4" onSubmit={async (e) => { e.preventDefault(); if (await aktion(() => lebensbereichAnlegen(household, name, klasse), "Hinzugefügt")) { schliessen(); setName(""); } }}>
        <Feld label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Feld>
        <Feld gruppe label="Klasse (50/30/20)"><Seg label="Klasse" wert={klasse} onChange={setKlasse} optionen={[["need", "Bedarf"], ["want", "Wunsch"], ["saving", "Sparen"]]} /></Feld>
        <button className="btn btn-primary btn-big" disabled={!name.trim()}>Hinzufügen</button>
      </form>
    </Sheet>
  );
}
