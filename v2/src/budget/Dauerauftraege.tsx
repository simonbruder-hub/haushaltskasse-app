import { useState } from "react";
import { db, useQuery } from "../db/client";
import { datum, geld, heute, zahl } from "../lib/format";
import { DAUERAUFTRAG_ART, dauerauftragBeenden, dauerauftragLoeschen, dauerauftragSpeichern, ueberweisungSpeichern } from "../lib/budget";
import { useHaushalt } from "../lib/haushalt";
import { Abschnitt, Feld, Leer, LoeschKnopf, Seg, Sheet, useAktion } from "../ui/kit";
import { Icon } from "../ui/Icon";
import { KontoSelect } from "./bausteine";

/** Daueraufträge (Kontenplan: wohin das Geld jeden Monat fliesst) und einmalige Überweisungen */
interface Auftrag {
  id: string; from_account_id: string | null; von: string | null; to_account_id: string; nach: string; amount: string; day_of_month: number; kind: string;
  valid_from: string; valid_to: string | null; note: string | null; gebucht: number; laeuft: boolean;
}
const ARTEN: [string, string][] = [["deposit", "Einzahlung"], ["saving", "Sparen"], ["income", "Einnahme"]];

export function Dauerauftraege() {
  const { household } = useHaushalt();
  const [offen, setOffen] = useState<Auftrag | "neu" | null>(null);
  const [einmalig, setEinmalig] = useState(false);
  const liste = useQuery<Auftrag>(
    `select s.id, s.from_account_id, fa.name as von, s.to_account_id, ta.name as nach, s.amount::text, s.day_of_month, s.kind::text, s.valid_from::text, s.valid_to::text, s.note,
            (select count(*)::int from transfer t where t.standing_order_id = s.id) as gebucht,
            (s.valid_to is null or s.valid_to >= $2::date) as laeuft
       from standing_order s left join account fa on fa.id = s.from_account_id join account ta on ta.id = s.to_account_id
      where s.household_id = $1 order by (s.valid_to is null or s.valid_to >= $2::date) desc, s.day_of_month, ta.name`, [household, heute()]);
  const monat = (liste ?? []).filter((a) => a.laeuft).reduce((s, a) => s + Number(a.amount), 0);
  return (
    <div className="grid gap-4">
      <p className="text-ink-2 text-[14px] -mt-1">Ein Dauerauftrag schiebt jeden Monat Geld von einem Konto auf ein anderes, z. B. aufs Sparkonto. Die App bucht ihn selbst, sobald er fällig ist – auf beiden Handys nur einmal.</p>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn btn-primary" onClick={() => setOffen("neu")}><Icon name="plus" />Dauerauftrag</button>
        <button className="btn" onClick={() => setEinmalig(true)}><Icon name="ausgleich" />Überweisung</button>
      </div>
      {liste && !liste.length && <Leer icon="ausgleich" titel="Noch kein Dauerauftrag" text="Z. B. Lohn → Gemeinsam Leben 2000, → Sparen 500. So weiss die App, wie viel ihr spart." />}
      {liste && liste.length > 0 && (
        <div className="card list overflow-hidden" role="list" aria-label="Daueraufträge">
          {liste.map((a) => (
            <button key={a.id} role="listitem" aria-label={`${a.von ?? "Von aussen"} nach ${a.nach}`} className={`row ${a.laeuft ? "" : "opacity-55"}`} onClick={() => setOffen(a)}>
              <span className="grid flex-1 min-w-0">
                <span className="font-semibold truncate">{a.von ?? "Von aussen"} → {a.nach}</span>
                <span className="text-muted text-[12.5px] truncate">am {a.day_of_month}. · {DAUERAUFTRAG_ART[a.kind] ?? a.kind}{a.laeuft ? "" : ` · beendet ${datum(a.valid_to!)}`}{a.gebucht ? ` · ${a.gebucht}× gebucht` : ""}</span>
              </span>
              <span className="num">{geld(a.amount)}</span>
            </button>
          ))}
        </div>
      )}
      {liste && liste.length > 0 && <p className="text-muted text-[13px] px-1" data-testid="dauer-summe">Laufende Daueraufträge: CHF {geld(monat)} pro Monat</p>}
      <Abschnitt titel="Letzte Überweisungen"><Letzte /></Abschnitt>
      {offen && <AuftragSheet a={offen === "neu" ? null : offen} schliessen={() => setOffen(null)} />}
      {einmalig && <UeberweisungSheet schliessen={() => setEinmalig(false)} />}
    </div>
  );
}

function Letzte() {
  const { household } = useHaushalt();
  const t = useQuery<{ id: string; transfer_date: string; amount: string; von: string | null; nach: string; kind: string; auto: boolean }>(
    `select t.id, t.transfer_date::text, t.amount::text, fa.name as von, ta.name as nach, t.kind::text, t.standing_order_id is not null as auto
       from transfer t left join account fa on fa.id = t.from_account_id join account ta on ta.id = t.to_account_id
      where t.household_id = $1 and t.kind <> 'settlement' order by t.transfer_date desc, t.created_at desc limit 8`, [household]);
  if (!t?.length) return <p className="text-muted text-[13.5px] px-1">Noch keine Überweisungen.</p>;
  return (
    <div className="card list overflow-hidden" role="list" aria-label="Letzte Überweisungen">
      {t.map((x) => (
        <div key={x.id} role="listitem" className="row !cursor-default !min-h-0 py-2.5">
          <span className="grid flex-1 min-w-0"><span className="text-[14px] truncate">{x.von ?? "Von aussen"} → {x.nach}</span>
            <span className="text-muted text-[12px]">{datum(x.transfer_date)} · {x.auto ? "Dauerauftrag" : DAUERAUFTRAG_ART[x.kind] ?? x.kind}</span></span>
          <span className="num">{geld(x.amount)}</span>
        </div>
      ))}
    </div>
  );
}

function AuftragSheet({ a, schliessen }: { a: Auftrag | null; schliessen: () => void }) {
  const { household } = useHaushalt();
  const aktion = useAktion();
  const [von, setVon] = useState<string | null>(a?.from_account_id ?? null);
  const [nach, setNach] = useState<string | null>(a?.to_account_id ?? null);
  const [betrag, setBetrag] = useState(a ? String(Number(a.amount)) : "");
  const [tag, setTag] = useState(String(a?.day_of_month ?? 25));
  const [art, setArt] = useState(a?.kind ?? "deposit");
  const [ab, setAb] = useState(a?.valid_from ?? heute().slice(0, 8) + "01");
  const [bis, setBis] = useState(a?.valid_to ?? "");
  const [notiz, setNotiz] = useState(a?.note ?? "");
  const [busy, setBusy] = useState(false);
  const speichern = async () => {
    setBusy(true);
    const ok = await aktion(async () => dauerauftragSpeichern(await db(), { id: a?.id, household, von, nach: nach ?? "", betrag: zahl(betrag), tag: zahl(tag), art, ab, bis: bis || null, notiz }), "Dauerauftrag gespeichert");
    setBusy(false);
    if (ok) schliessen();
  };
  return (
    <Sheet offen onClose={schliessen} titel={a ? "Dauerauftrag bearbeiten" : "Neuer Dauerauftrag"}>
      <div className="grid gap-4">
        <Feld gruppe label="Von" hinweis="Leer lassen für Geld von aussen, z. B. den Lohn."><KontoSelect label="Von" wert={von} onChange={setVon} leer="Von aussen (Lohn, Zulage)" /></Feld>
        <Feld gruppe label="Nach"><KontoSelect label="Nach" wert={nach} onChange={setNach} /></Feld>
        <div className="grid grid-cols-2 gap-3">
          <Feld label="Betrag (CHF)"><input className="input mono" inputMode="decimal" value={betrag} placeholder="500" onChange={(e) => setBetrag(e.target.value)} /></Feld>
          <Feld label="Tag im Monat (1–28)"><input className="input mono" inputMode="numeric" value={tag} onChange={(e) => setTag(e.target.value)} /></Feld>
        </div>
        <Feld gruppe label="Art"><Seg label="Art" wert={art} onChange={setArt} optionen={ARTEN} /></Feld>
        <div className="grid grid-cols-2 gap-3">
          <Feld label="Ab" hinweis="Frühere Monate bucht die App nach."><input className="input" type="date" value={ab} onChange={(e) => setAb(e.target.value)} /></Feld>
          <Feld label="Bis (optional)"><input className="input" type="date" value={bis} onChange={(e) => setBis(e.target.value)} /></Feld>
        </div>
        <Feld label="Notiz (optional)"><input className="input" value={notiz} onChange={(e) => setNotiz(e.target.value)} /></Feld>
        <button className="btn btn-primary btn-big" disabled={busy || !nach || !betrag.trim()} onClick={speichern}><Icon name="haken" />Speichern</button>
        {a && a.laeuft && a.gebucht > 0 && (
          <button className="btn" onClick={async () => { if (await aktion(async () => dauerauftragBeenden(await db(), a.id, heute()), "Dauerauftrag beendet")) schliessen(); }}>
            <Icon name="haken" />Dauerauftrag beenden</button>
        )}
        {a && a.gebucht === 0 && <LoeschKnopf text="Dauerauftrag löschen" frage="Den Dauerauftrag löschen?" onJa={async () => { if (await aktion(async () => dauerauftragLoeschen(await db(), a.id), "Dauerauftrag gelöscht")) schliessen(); }} />}
        {a && a.gebucht > 0 && <p className="text-muted text-[12.5px]">Schon Gebuchtes bleibt bestehen. Ein Dauerauftrag mit Buchungen lässt sich nur beenden, nicht löschen.</p>}
      </div>
    </Sheet>
  );
}

function UeberweisungSheet({ schliessen }: { schliessen: () => void }) {
  const { household } = useHaushalt();
  const aktion = useAktion();
  const [von, setVon] = useState<string | null>(null);
  const [nach, setNach] = useState<string | null>(null);
  const [betrag, setBetrag] = useState("");
  const [tag, setTag] = useState(heute());
  const [art, setArt] = useState("saving");
  const [busy, setBusy] = useState(false);
  return (
    <Sheet offen onClose={schliessen} titel="Überweisung erfassen">
      <div className="grid gap-4">
        <Feld gruppe label="Von"><KontoSelect label="Von" wert={von} onChange={setVon} leer="Von aussen (Lohn, Zulage)" /></Feld>
        <Feld gruppe label="Nach"><KontoSelect label="Nach" wert={nach} onChange={setNach} /></Feld>
        <div className="grid grid-cols-2 gap-3">
          <Feld label="Betrag (CHF)"><input className="input mono" inputMode="decimal" value={betrag} onChange={(e) => setBetrag(e.target.value)} /></Feld>
          <Feld label="Datum"><input className="input" type="date" value={tag} onChange={(e) => setTag(e.target.value)} /></Feld>
        </div>
        <Feld gruppe label="Art"><Seg label="Art" wert={art} onChange={setArt} optionen={ARTEN} /></Feld>
        <button className="btn btn-primary btn-big" disabled={busy || !nach || !betrag.trim()} onClick={async () => {
          setBusy(true);
          const ok = await aktion(async () => ueberweisungSpeichern(await db(), { household, von, nach: nach ?? "", betrag: zahl(betrag), datum: tag, art }), "Überweisung gespeichert");
          setBusy(false);
          if (ok) schliessen();
        }}><Icon name="haken" />Speichern</button>
      </div>
    </Sheet>
  );
}
