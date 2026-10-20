import { useState } from "react";
import { db, useQuery } from "../db/client";
import { datum, geld, heute, zahl } from "../lib/format";
import { fondsEintrag, fondsEintragLoeschen, sparzielAbschliessen, sparzielLoeschen, sparzielSpeichern } from "../lib/budget";
import { useHaushalt } from "../lib/haushalt";
import { KategorieWahl, TopfChips } from "../ui/Auswahl";
import { Feld, Leer, LoeschKnopf, Seg, Sheet, useAktion } from "../ui/kit";
import { Icon } from "../ui/Icon";
import { Fortschritt, KontoSelect } from "./bausteine";

/** Sparziele (Sinking Funds): ein Konto, auf dem das Geld liegt, und ein Topf mit Kategorie, dessen Ausgaben den Fonds belasten (Blueprint §2.6) */
interface Ziel {
  id: string; name: string; holding_account_id: string; cost_account_id: string; category_id: string; kategorie: string; sparkonto: string; topf: string;
  target_amount: string; target_date: string | null; monthly_contribution: string; start_date: string;
  balance: string; contributed: string; spent: string; months_left: number; required_monthly: string; on_track: boolean; progress_pct: string | null;
}
interface Eintrag { id: string; entry_date: string; kind: "contribution" | "adjustment"; amount: string; note: string | null }

export function Sparziele() {
  const { household } = useHaushalt();
  const [offen, setOffen] = useState<Ziel | "neu" | null>(null);
  const ziele = useQuery<Ziel>(
    `select s.fund_id as id, s.name, f.holding_account_id, f.cost_account_id, f.category_id, c.name as kategorie, a.name as sparkonto, t.name as topf,
            f.target_amount::text, f.target_date::text, f.monthly_contribution::text, f.start_date::text, s.balance::text, s.contributed::text, s.spent::text,
            s.months_left, round(s.required_monthly, 2)::text as required_monthly, s.on_track, s.progress_pct::text
       from sparziele($1, $2) s join sinking_fund f on f.id = s.fund_id join category c on c.id = f.category_id
       join account a on a.id = f.holding_account_id join account t on t.id = f.cost_account_id order by s.name`, [household, heute()]);
  const abgeschlossen = useQuery<{ id: string; name: string }>(`select id, name from sinking_fund where household_id = $1 and closed_at is not null order by name`, [household]) ?? [];
  const aktion = useAktion();
  return (
    <div className="grid gap-4">
      <p className="text-ink-2 text-[14px] -mt-1">Ein Sparziel legt Geld für etwas Grösseres zur Seite, z. B. den Zahnarzt oder die Ferien. Ausgaben dieser Kategorie belasten das Sparziel statt das Budget.</p>
      <button className="btn btn-primary" onClick={() => setOffen("neu")}><Icon name="plus" />Sparziel</button>
      {ziele && !ziele.length && <Leer icon="sparen" titel="Noch kein Sparziel" text="Lege z. B. «Ferien 2027» mit Ziel, Datum und Monatsrate an. Die App sagt dir, ob du auf Kurs bist." />}
      <div className="grid gap-3" role="list" aria-label="Sparziele">
        {(ziele ?? []).map((z) => {
          const pct = Number(z.progress_pct ?? 0);
          return (
            <button key={z.id} className="card p-4 grid gap-3 text-left" role="listitem" aria-label={z.name} onClick={() => setOffen(z)}>
              <div className="flex items-start justify-between gap-3">
                <span className="grid min-w-0"><b className="text-[16.5px] truncate">{z.name}</b><span className="text-muted text-[13px] truncate">{z.kategorie} · {z.topf} · liegt auf {z.sparkonto}</span></span>
                <span className={`chip ${z.on_track ? "chip-ok" : "chip-warn"}`}>{z.on_track ? "Auf Kurs" : "Rate zu tief"}</span>
              </div>
              <Fortschritt anteil={pct / 100} art={z.on_track ? "gut" : "warn"} label={`${z.name}: Fortschritt`} />
              <div className="flex items-end justify-between gap-3">
                <span className="grid"><span className="text-muted text-[12px]">Stand</span><span className="num text-[20px] leading-tight">{geld(z.balance)}</span></span>
                <span className="grid justify-items-end text-[13px] text-ink-2">
                  <span>Ziel {geld(z.target_amount)}{z.target_date ? ` bis ${datum(z.target_date)}` : ""}</span>
                  <span className="text-muted">{z.target_date ? `nötig ${geld(z.required_monthly)} pro Monat · eingeplant ${geld(z.monthly_contribution)}` : `Rate ${geld(z.monthly_contribution)} pro Monat`}</span>
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {abgeschlossen.length > 0 && (
        <details className="card-flat p-3.5"><summary className="cursor-pointer text-[14px] font-semibold">Abgeschlossen ({abgeschlossen.length})</summary>
          <div className="grid gap-1 mt-2">
            {abgeschlossen.map((a) => (
              <span key={a.id} className="flex items-center justify-between gap-2 text-[14px]">{a.name}
                <button className="btn !min-h-0 py-1.5 px-3 text-[13px]" onClick={() => aktion(async () => sparzielAbschliessen(await db(), a.id, null), "Wieder geöffnet")}>Wieder öffnen</button></span>
            ))}
          </div>
        </details>
      )}
      {offen && <ZielSheet z={offen === "neu" ? null : offen} schliessen={() => setOffen(null)} />}
    </div>
  );
}

function ZielSheet({ z, schliessen }: { z: Ziel | null; schliessen: () => void }) {
  const { household } = useHaushalt();
  const aktion = useAktion();
  const [name, setName] = useState(z?.name ?? "");
  const [sparkonto, setSparkonto] = useState<string | null>(z?.holding_account_id ?? null);
  const [topf, setTopf] = useState<string | null>(z?.cost_account_id ?? null);
  const [kategorie, setKategorie] = useState<string | null>(z?.category_id ?? null);
  const [ziel, setZiel] = useState(z ? String(Number(z.target_amount)) : "");
  const [zielDatum, setZielDatum] = useState(z?.target_date ?? "");
  const [rate, setRate] = useState(z ? String(Number(z.monthly_contribution)) : "");
  const [start, setStart] = useState(z?.start_date ?? heute().slice(0, 8) + "01");
  const [busy, setBusy] = useState(false);
  const eintraege = useQuery<Eintrag>(`select id, entry_date::text, kind::text, amount::text, note from sinking_fund_entry where fund_id = $1 order by entry_date desc, kind`, [z?.id ?? null]) ?? [];
  const [betrag, setBetrag] = useState(""); const [art, setArt] = useState<"contribution" | "adjustment">("contribution");

  const speichern = async () => {
    setBusy(true);
    const ok = await aktion(async () => sparzielSpeichern(await db(), {
      id: z?.id, household, name, sparkonto: sparkonto ?? "", topf: topf ?? "", kategorie: kategorie ?? "", ziel: zahl(ziel), zielDatum: zielDatum || null, rate: zahl(rate), start }), "Sparziel gespeichert");
    setBusy(false);
    if (ok) schliessen();
  };
  return (
    <Sheet offen onClose={schliessen} titel={z ? z.name : "Neues Sparziel"}>
      <div className="grid gap-4">
        <Feld label="Name"><input className="input" value={name} placeholder="z. B. Ferien 2027" onChange={(e) => setName(e.target.value)} /></Feld>
        <Feld gruppe label="Wo liegt das Geld" hinweis="Das Konto oder der Topf, auf den die Raten gehen (z. B. «Simon Sparen»)."><KontoSelect label="Wo liegt das Geld" wert={sparkonto} onChange={setSparkonto} /></Feld>
        <Feld gruppe label="Wessen Ausgaben" hinweis="Ausgaben dieses Topfs in der Kategorie unten belasten das Sparziel."><TopfChips wert={topf} onChange={setTopf} label="Wessen Ausgaben" /></Feld>
        <Feld gruppe label="Welche Kategorie"><KategorieWahl wert={kategorie} onChange={setKategorie} /></Feld>
        <div className="grid grid-cols-2 gap-3">
          <Feld label="Ziel (CHF)"><input className="input mono" inputMode="decimal" value={ziel} onChange={(e) => setZiel(e.target.value)} /></Feld>
          <Feld label="Bis (optional)"><input className="input" type="date" value={zielDatum} onChange={(e) => setZielDatum(e.target.value)} /></Feld>
          <Feld label="Monatsrate (CHF)"><input className="input mono" inputMode="decimal" value={rate} placeholder="0" onChange={(e) => setRate(e.target.value)} /></Feld>
          <Feld label="Start"><input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Feld>
        </div>
        <p className="text-muted text-[12.5px] -mt-2">Die Monatsrate schreibt sich die App am Monatsanfang selbst gut.</p>
        <button className="btn btn-primary btn-big" disabled={busy || !name.trim() || !ziel.trim() || !sparkonto || !topf || !kategorie} onClick={speichern}><Icon name="haken" />Speichern</button>

        {z && (
          <div className="grid gap-3 pt-2 border-t border-[var(--rule)]">
            <h3 className="font-bold text-[15px]">Einzahlungen</h3>
            <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
              <Feld label="Betrag (CHF)"><input className="input mono" inputMode="decimal" value={betrag} placeholder="z. B. 200" onChange={(e) => setBetrag(e.target.value)} /></Feld>
              <button className="btn btn-soft" disabled={!betrag.trim()} onClick={async () => {
                if (await aktion(async () => fondsEintrag(await db(), { household, fund: z.id, datum: heute(), art, betrag: zahl(betrag) }), "Eingetragen")) setBetrag("");
              }}><Icon name="plus" />Eintragen</button>
            </div>
            <Seg label="Art" wert={art} onChange={setArt} optionen={[["contribution", "Einzahlung"], ["adjustment", "Korrektur (auch negativ)"]]} />
            <div className="card list overflow-hidden" role="list" aria-label="Einträge">
              {eintraege.map((e) => (
                <div key={e.id} role="listitem" className="row !cursor-default !min-h-0 py-2.5">
                  <span className="grid flex-1"><span className="text-[14px]">{datum(e.entry_date)}</span><span className="text-muted text-[12px]">{e.kind === "contribution" ? (e.note ?? "Einzahlung") : "Korrektur"}</span></span>
                  <span className="num">{geld(e.amount)}</span>
                  <button className="icon-btn !w-9 !h-9" aria-label={`Eintrag vom ${datum(e.entry_date)} löschen`} onClick={() => aktion(async () => fondsEintragLoeschen(await db(), e.id), "Gelöscht")}><Icon name="muell" size={17} /></button>
                </div>
              ))}
              {!eintraege.length && <p className="p-3.5 text-muted text-[13.5px]">Noch nichts eingezahlt.</p>}
            </div>
            <button className="btn" onClick={async () => { if (await aktion(async () => sparzielAbschliessen(await db(), z.id, heute()), "Sparziel abgeschlossen")) schliessen(); }}><Icon name="haken" />Sparziel abschliessen</button>
            <LoeschKnopf text="Sparziel löschen" frage="Das Sparziel mit allen Einträgen löschen?" onJa={async () => { if (await aktion(async () => sparzielLoeschen(await db(), z.id), "Sparziel gelöscht")) schliessen(); }} />
          </div>
        )}
      </div>
    </Sheet>
  );
}
