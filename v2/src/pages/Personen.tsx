import { useState } from "react";
import { useQuery } from "../db/client";
import { datum, geld, heute } from "../lib/format";
import { einkommenLoeschen, einkommenSpeichern, kindAnlegen, persoenlicherTopf, personSpeichern, type Person } from "../lib/data";
import { useHaushalt } from "../lib/haushalt";
import { Abschnitt, Avatar, farbe, Feld, KontoIcon, Leer, PERSON_FARBEN, Seite, Sheet, useAktion } from "../ui/kit";
import { Icon } from "../ui/Icon";

interface Einkommen { id: string; person_id: string; valid_from: string; net_monthly: string }

export function Personen() {
  const { household, personen, ich, konten } = useHaushalt();
  const einkommen = useQuery<Einkommen>(`select id, person_id, valid_from::text, net_monthly::text from person_income where household_id = $1 order by valid_from desc`, [household]);
  const [offen, setOffen] = useState<Person | null>(null);
  const [neuesKind, setNeuesKind] = useState(false);
  const erwachsene = personen.filter((p) => p.role === "adult");
  const kinder = personen.filter((p) => p.role === "child");
  return (
    <Seite eyebrow="Personen" titel="Wer dazugehört" text="Gemeinsames teilt ihr immer 50/50. Kinder bezahlen nichts – ihre Kosten tragt ihr zu zweit.">
      <div className="grid gap-3">
        {erwachsene.map((p) => {
          const topf = konten.find((k) => k.is_personal_default && k.owners.length === 1 && k.owners[0].person_id === p.id);
          const lohn = einkommen?.find((e) => e.person_id === p.id && e.valid_from <= heute());
          return (
            <button key={p.id} className="card p-4 flex items-center gap-3.5 text-left" onClick={() => setOffen(p)}>
              <Avatar name={p.display_name} color={farbe(p)} size={46} />
              <span className="grid flex-1 min-w-0 gap-0.5">
                <span className="flex items-center gap-2"><b className="text-[17px]">{p.display_name}</b>{p.id === ich && <span className="chip chip-ok">dieses Handy</span>}</span>
                <span className="text-muted text-[13px]">Persönlicher Topf: {topf?.name ?? "–"}</span>
                <span className="text-muted text-[13px]">Nettolohn: {lohn ? `CHF ${geld(lohn.net_monthly)} / Monat` : "nicht erfasst"}</span>
              </span>
              <Icon name="rechts" className="text-muted" />
            </button>
          );
        })}
      </div>
      <Abschnitt titel="Kinder" aktion={<button className="btn btn-soft" onClick={() => setNeuesKind(true)}><Icon name="plus" />Kind</button>}>
        {kinder.length ? (
          <div className="card list overflow-hidden">
            {kinder.map((k) => {
              const topf = konten.find((a) => a.kind === "kind" && a.beneficiary_person_id === k.id);
              return (
                <button key={k.id} className="row" onClick={() => setOffen(k)}>
                  <Avatar name={k.display_name} color={farbe(k)} size={38} />
                  <span className="grid flex-1"><b>{k.display_name}</b><span className="text-muted text-[13px]">{k.birth_date ? `geboren ${datum(k.birth_date)}` : "Geburtsdatum offen"}{topf ? ` · Topf «${topf.name}»` : ""}</span></span>
                  <Icon name="rechts" className="text-muted" />
                </button>
              );
            })}
          </div>
        ) : <Leer icon="kind" titel="Noch keine Kinder erfasst" text="Kommt ein Kind dazu, erfasst du es hier – auf Wunsch gleich mit eigenem Topf." />}
      </Abschnitt>
      {offen && <PersonSheet p={offen} einkommen={(einkommen ?? []).filter((e) => e.person_id === offen.id)} schliessen={() => setOffen(null)} />}
      <KindSheet offen={neuesKind} schliessen={() => setNeuesKind(false)} household={household} />
    </Seite>
  );
}

function PersonSheet({ p, einkommen, schliessen }: { p: Person; einkommen: Einkommen[]; schliessen: () => void }) {
  const { household, konten } = useHaushalt();
  const [name, setName] = useState(p.display_name);
  const [color, setColor] = useState(farbe(p));
  const [geburt, setGeburt] = useState(p.birth_date ?? "");
  const [betrag, setBetrag] = useState(""); const [ab, setAb] = useState(heute().slice(0, 8) + "01");
  const aktion = useAktion();
  const eigene = konten.filter((k) => k.status !== "closed" && k.owners.length === 1 && k.owners[0].person_id === p.id && (k.kind === "privat" || k.kind === "freizeit"));
  return (
    <Sheet offen onClose={schliessen} titel={p.display_name}>
      <div className="grid gap-5">
        <form className="grid gap-4" onSubmit={async (e) => { e.preventDefault(); if (await aktion(() => personSpeichern(p.id, { display_name: name.trim(), color, ...(p.role === "child" ? { birth_date: geburt || null } : {}) }), "Gespeichert")) schliessen(); }}>
          <Feld label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Feld>
          {p.role === "child" && <Feld label="Geburtsdatum"><input className="input" type="date" value={geburt} onChange={(e) => setGeburt(e.target.value)} /></Feld>}
          <Feld gruppe label="Farbe">
            <div className="flex gap-2.5 flex-wrap">{PERSON_FARBEN.map((f) => (
              <button type="button" key={f} aria-label={`Farbe ${f}`} aria-pressed={color === f} onClick={() => setColor(f)}
                className="size-10 rounded-full border-2" style={{ background: f, borderColor: color === f ? "var(--ink)" : "transparent" }} />
            ))}</div>
          </Feld>
          <button className="btn btn-primary" disabled={!name.trim()}>Speichern</button>
        </form>

        {p.role === "adult" && eigene.length > 0 && (
          <Feld gruppe label="Persönlicher Topf" hinweis="Dorthin gehen persönliche Ausgaben, wenn nichts anderes gewählt ist.">
            <div className="grid gap-2">{eigene.map((k) => (
              <button type="button" key={k.id} aria-pressed={k.is_personal_default} onClick={() => aktion(() => persoenlicherTopf(p.id, k.id), "Umgestellt")}
                className={`card-flat p-3 flex items-center gap-3 text-left ${k.is_personal_default ? "outline-2 outline-[var(--accent)]" : ""}`}>
                <KontoIcon kind={k.kind} small /><b className="flex-1">{k.name}</b>{k.is_personal_default && <Icon name="haken" className="text-accent-ink" />}
              </button>
            ))}</div>
          </Feld>
        )}

        {p.role === "adult" && (
          <div className="grid gap-3">
            <div className="grid gap-0.5"><b>Nettolohn pro Monat</b><span className="text-muted text-[13px]">Für die 50/30/20-Auswertung und den Kontenplan. Bleibt bei euch.</span></div>
            {einkommen.length > 0 && (
              <div className="card-flat list overflow-hidden">
                {einkommen.map((e) => (
                  <div key={e.id} className="row cursor-default">
                    <span className="grid flex-1"><span className="num">CHF {geld(e.net_monthly)}</span><span className="text-muted text-[12.5px]">ab {datum(e.valid_from)}</span></span>
                    <button className="icon-btn" aria-label="Eintrag löschen" onClick={() => aktion(() => einkommenLoeschen(e.id))}><Icon name="muell" /></button>
                  </div>
                ))}
              </div>
            )}
            <form className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end" onSubmit={async (e) => { e.preventDefault(); if (await aktion(() => einkommenSpeichern(household, p.id, Number(betrag), ab), "Erfasst")) setBetrag(""); }}>
              <Feld label="Betrag (CHF)"><input className="input mono" inputMode="decimal" value={betrag} onChange={(e) => setBetrag(e.target.value.replace(",", "."))} /></Feld>
              <Feld label="gültig ab"><input className="input" type="date" value={ab} onChange={(e) => setAb(e.target.value)} /></Feld>
              <button className="btn btn-soft" aria-label="Lohn erfassen" disabled={!(Number(betrag) > 0) || !ab}><Icon name="plus" /></button>
            </form>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function KindSheet({ offen, schliessen, household }: { offen: boolean; schliessen: () => void; household: string }) {
  const [name, setName] = useState(""); const [geburt, setGeburt] = useState(""); const [topf, setTopf] = useState(true);
  const aktion = useAktion();
  return (
    <Sheet offen={offen} onClose={schliessen} titel="Kind erfassen">
      <form className="grid gap-4" onSubmit={async (e) => { e.preventDefault(); if (await aktion(() => kindAnlegen(household, { name, geburt: geburt || null, topf }), "Erfasst")) { schliessen(); setName(""); setGeburt(""); } }}>
        <Feld label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Feld>
        <Feld label="Geburtsdatum (optional)"><input className="input" type="date" value={geburt} onChange={(e) => setGeburt(e.target.value)} /></Feld>
        <label className="card-flat p-3.5 flex gap-3 items-start">
          <input type="checkbox" className="size-5 mt-0.5 accent-[var(--accent)]" checked={topf} onChange={(e) => setTopf(e.target.checked)} />
          <span className="grid"><b>Eigenen Topf anlegen</b><span className="text-muted text-[13px]">Für Kinderkosten oder ein Kindersparkonto – ihr tragt ihn je zur Hälfte.</span></span>
        </label>
        <button className="btn btn-primary btn-big" disabled={!name.trim()}>Erfassen</button>
      </form>
    </Sheet>
  );
}
