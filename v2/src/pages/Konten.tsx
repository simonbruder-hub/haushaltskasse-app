import { useState } from "react";
import { KONTO_ART, kontoAnlegen, type Kind, type Konto } from "../lib/data";
import { besitzText, gruppieren } from "../lib/gruppen";
import { useHaushalt } from "../lib/haushalt";
import { go } from "../lib/router";
import { Abschnitt, Avatar, farbe, Feld, KontoIcon, Seg, Seite, Sheet, useAktion } from "../ui/kit";
import { Icon } from "../ui/Icon";

export function Konten() {
  const { konten, personen } = useHaushalt();
  const [neu, setNeu] = useState(false);
  const g = gruppieren(konten, personen);
  return (
    <Seite eyebrow="Konten und Töpfe" titel="Wo das Geld liegt"
      text="Jede Ausgabe gehört einem Topf: gemeinsam (50/50) oder einer Person. Ein Topf kann ein echtes Konto sein oder vorerst nur ein Topf."
      aktion={<button className="btn btn-soft" onClick={() => setNeu(true)}><Icon name="plus" />Neu</button>}>
      <Abschnitt titel="Gemeinsam"><Liste konten={g.gemeinsam} /></Abschnitt>
      {g.proPerson.map(({ person, konten: ks }) => (
        <Abschnitt key={person.id} titel={person.display_name}><Liste konten={ks} /></Abschnitt>
      ))}
      {g.kinder.length > 0 && <Abschnitt titel="Kinder"><Liste konten={g.kinder} /></Abschnitt>}
      {g.geschlossen.length > 0 && <Abschnitt titel="Geschlossen"><Liste konten={g.geschlossen} /></Abschnitt>}
      <NeuesKonto offen={neu} schliessen={() => setNeu(false)} />
    </Seite>
  );
}

function Liste({ konten }: { konten: Konto[] }) {
  const { personen } = useHaushalt();
  if (!konten.length) return <p className="text-muted text-[14px] px-1">Noch keine.</p>;
  return (
    <div className="card list overflow-hidden">
      {konten.map((k) => (
        <a key={k.id} href={`#/konten/${k.id}`} className={`row no-underline text-ink k-${k.kind}`}>
          <KontoIcon kind={k.kind} />
          <span className="grid flex-1 min-w-0">
            <span className="flex items-center gap-2 flex-wrap"><b className="truncate">{k.name}</b>
              {k.status === "virtual" && <span className="chip chip-virtuell">vorbereitet</span>}
              {k.is_personal_default && <span className="chip k-tag">persönlicher Topf</span>}</span>
            <span className="text-muted text-[13px] truncate">{KONTO_ART[k.kind].name} · {besitzText(k, personen)}</span>
          </span>
          <Icon name="rechts" className="text-muted" />
        </a>
      ))}
    </div>
  );
}

function NeuesKonto({ offen, schliessen }: { offen: boolean; schliessen: () => void }) {
  const { household, personen } = useHaushalt();
  const erwachsene = personen.filter((p) => p.role === "adult" && !p.archived_at);
  const kinder = personen.filter((p) => p.role === "child" && !p.archived_at);
  const [kind, setKind] = useState<Kind>("zweck");
  const [name, setName] = useState("");
  const [gehoert, setGehoert] = useState("gemeinsam");
  const [kindId, setKindId] = useState(kinder[0]?.id ?? "");
  const [aktiv, setAktiv] = useState<"virtual" | "active">("virtual");
  const aktion = useAktion();
  const gemeinsam = kind === "kind" || kind === "leben" || gehoert === "gemeinsam";
  const owners = gemeinsam ? erwachsene.map((p) => ({ person_id: p.id, share: 1 / erwachsene.length })) : [{ person_id: gehoert, share: 1 }];
  const ok = name.trim() && (kind !== "kind" || kindId);
  return (
    <Sheet offen={offen} onClose={schliessen} titel="Neues Konto / neuer Topf">
      <form className="grid gap-4" onSubmit={async (e) => {
        e.preventDefault();
        let id = "";
        if (await aktion(async () => { id = await kontoAnlegen(household, { name, kind, owners, beneficiary: kind === "kind" ? kindId : null, status: aktiv }); }, "Angelegt")) {
          schliessen(); setName(""); go(`konten/${id}`);
        }
      }}>
        <Feld gruppe label="Art">
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(KONTO_ART) as Kind[]).map((k) => (
              <button type="button" key={k} onClick={() => setKind(k)} aria-pressed={kind === k}
                className={`card-flat p-2.5 flex items-center gap-2 text-left ${kind === k ? "outline-2 outline-[var(--accent)]" : ""}`}>
                <KontoIcon kind={k} small /><span className="font-semibold text-[14px]">{KONTO_ART[k].name}</span>
              </button>
            ))}
          </div>
          <small>{KONTO_ART[kind].text}</small>
        </Feld>
        <Feld label="Name"><input className="input" placeholder={kind === "zweck" ? "z. B. Auto" : kind === "kind" ? "Name des Kindes" : ""} value={name} onChange={(e) => setName(e.target.value)} /></Feld>
        {kind === "kind" ? (
          kinder.length ? (
            <Feld label="Für welches Kind?"><select className="input" value={kindId} onChange={(e) => setKindId(e.target.value)}>{kinder.map((k) => <option key={k.id} value={k.id}>{k.display_name}</option>)}</select></Feld>
          ) : <p className="text-[14px] text-crit">Zuerst unter «Personen» ein Kind erfassen.</p>
        ) : kind !== "leben" && (
          <Feld gruppe label="Gehört" hinweis="Gemeinsame Töpfe sind immer 50/50. Die Aufteilung lässt sich später nicht ändern.">
            <Seg label="Gehört" wert={gehoert} onChange={setGehoert} optionen={[["gemeinsam", "Gemeinsam"], ...erwachsene.map((p) => [p.id, p.display_name] as [string, string])]} />
          </Feld>
        )}
        <div className="flex items-center gap-2 text-[13.5px] text-ink-2">
          <span className="avatars">{owners.map((o) => { const p = personen.find((x) => x.id === o.person_id)!; return <Avatar key={o.person_id} name={p.display_name} color={farbe(p)} size={24} />; })}</span>
          {owners.map((o) => `${personen.find((x) => x.id === o.person_id)?.display_name} ${Math.round(o.share * 100)} %`).join(" · ")}
        </div>
        <Feld gruppe label="Gibt es dafür schon ein Bankkonto?">
          <Seg label="Status" wert={aktiv} onChange={setAktiv} optionen={[["virtual", "Noch nicht"], ["active", "Ja"]]} />
        </Feld>
        <button className="btn btn-primary btn-big" disabled={!ok}>Anlegen</button>
      </form>
    </Sheet>
  );
}
