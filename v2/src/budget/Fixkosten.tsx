import { useState } from "react";
import { db, useQuery } from "../db/client";
import { datum, geld, heute, kurzDatum, zahl } from "../lib/format";
import { fixkostBuchen, fixkostLoeschen, fixkostSpeichern, HAEUFIGKEIT_TEXT, vertragKuendigen, vertragLoeschen, vertragSpeichern, type Haeufigkeit } from "../lib/budget";
import { useHaushalt } from "../lib/haushalt";
import { KategorieWahl, TopfChips } from "../ui/Auswahl";
import { Abschnitt, Avatar, farbe, Feld, Leer, LoeschKnopf, Seg, Sheet, useAktion } from "../ui/kit";
import { Icon } from "../ui/Icon";
import { Haken, KontoSelect, useBereiche } from "./bausteine";

/** Fixkosten (Monatsäquivalent je Topf und Person) und Verträge mit Kündigungsterminen (Blueprint §2.6) */
interface Fix {
  id: string; name: string; life_area_id: string; bereich: string; category_id: string | null; contract_id: string | null; cost_account_id: string; topf: string;
  pay_from_account_id: string | null; amount: string; frequency: Haeufigkeit; next_due_date: string; naechste: string; spending_class: "need" | "want" | "saving";
  is_active: boolean; monatlich: string;
}
interface Vertrag {
  id: string; name: string; counterparty: string; contract_number: string | null; renewal_date: string; renewal_period_months: number; auto_renews: boolean;
  cancellation_notice_days: number; notice_to_month_end: boolean; cancelled_on: string | null; note: string | null;
  cancellation_deadline: string | null; remind_on: string | null; days_left: number | null; status: string | null;
}
export const FRIST: Record<string, [string, string]> = {
  ok: ["Läuft", "chip-virtuell"], remind: ["Bald kündigen", "chip-warn"], last_chance: ["Letzte Chance", "chip-crit"], missed: ["Frist verpasst", "chip-crit"],
};

export function Fixkosten() {
  const { household, personen } = useHaushalt();
  const [fix, setFix] = useState<Fix | "neu" | null>(null);
  const [vertrag, setVertrag] = useState<Vertrag | "neu" | null>(null);
  const kosten = useQuery<Fix>(
    `select f.id, f.name, f.life_area_id, la.name as bereich, f.category_id, f.contract_id, f.cost_account_id, a.name as topf, f.pay_from_account_id, f.amount::text,
            f.frequency::text, f.next_due_date::text, naechste_faelligkeit(f.next_due_date, f.frequency, $2)::text as naechste, f.spending_class::text, f.is_active,
            round(f.amount * frequency_per_month(f.frequency), 2)::text as monatlich
       from fixed_cost f join life_area la on la.id = f.life_area_id join account a on a.id = f.cost_account_id
      where f.household_id = $1 order by f.is_active desc, f.name`, [household, heute()]);
  const anteile = useQuery<{ person_id: string; monthly_share: string }>(`select person_id, monthly_share::text from v_fixed_cost_person_monthly where household_id = $1`, [household]) ?? [];
  const vertraege = useQuery<Vertrag>(
    `select k.id, k.name, k.counterparty, k.contract_number, k.renewal_date::text, k.renewal_period_months, k.auto_renews, k.cancellation_notice_days, k.notice_to_month_end,
            k.cancelled_on::text, k.note, d.cancellation_deadline::text, d.remind_on::text, d.days_left, d.status
       from contract k left join vertrags_fristen($1, $2) d on d.contract_id = k.id
      where k.household_id = $1 order by k.cancelled_on is not null, d.cancellation_deadline nulls last, k.name`, [household, heute()]);
  const summe = (kosten ?? []).filter((f) => f.is_active).reduce((s, f) => s + Number(f.monatlich), 0);
  return (
    <div className="grid gap-5">
      <Abschnitt titel="Fixkosten" text="Was regelmässig anfällt: Miete, Versicherungen, Abos. Hier zur Planung; gezählt werden Ausgaben, sobald du sie als Beleg erfasst."
        aktion={<button className="btn btn-soft" onClick={() => setFix("neu")}><Icon name="plus" />Fixkost</button>}>
        {kosten && kosten.length > 0 && (
          <div className="card p-4 grid gap-2" data-testid="fix-summe">
            <div className="flex items-baseline justify-between"><span className="text-muted text-[13px]">Pro Monat</span><span className="num text-[22px]">CHF {geld(summe)}</span></div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {personen.filter((p) => p.role === "adult").map((p) => (
                <span key={p.id} className="flex items-center gap-1.5 text-[13.5px]"><Avatar name={p.display_name} color={farbe(p)} size={20} />{p.display_name}
                  <b className="num">{geld(anteile.find((a) => a.person_id === p.id)?.monthly_share ?? 0)}</b></span>
              ))}
            </div>
          </div>
        )}
        {kosten && !kosten.length
          ? <Leer icon="konten" titel="Noch keine Fixkosten" text="Erfasse Miete, Krankenkasse und Abos. Die App rechnet dir aus, was pro Monat auf jede Person fällt." />
          : <div className="card list overflow-hidden" role="list" aria-label="Fixkosten">
              {(kosten ?? []).map((f) => (
                <button key={f.id} role="listitem" aria-label={f.name} className={`row ${f.is_active ? "" : "opacity-55"}`} onClick={() => setFix(f)}>
                  <span className="grid flex-1 min-w-0">
                    <span className="font-semibold truncate">{f.name}</span>
                    <span className="text-muted text-[12.5px] truncate">{f.topf} · {HAEUFIGKEIT_TEXT[f.frequency]} · nächste {kurzDatum(f.naechste)}{f.is_active ? "" : " · pausiert"}</span>
                  </span>
                  <span className="grid justify-items-end"><span className="num">{geld(f.amount)}</span>
                    {f.frequency !== "monthly" && <span className="text-muted text-[12px] num">{geld(f.monatlich)} / Mt.</span>}</span>
                </button>
              ))}
            </div>}
      </Abschnitt>

      <Abschnitt titel="Verträge" text="Die App sagt rechtzeitig, bis wann du kündigen musst."
        aktion={<button className="btn btn-soft" onClick={() => setVertrag("neu")}><Icon name="plus" />Vertrag</button>}>
        {vertraege && !vertraege.length
          ? <Leer icon="link" titel="Noch keine Verträge" text="Internet, Handy, Versicherungen: Verlängerung und Kündigungsfrist eintragen, den Rest merkt sich die App." />
          : <div className="card list overflow-hidden" role="list" aria-label="Verträge">
              {(vertraege ?? []).map((v) => {
                const st = v.cancelled_on ? ["Gekündigt", "chip-ok"] : FRIST[v.status ?? "ok"] ?? FRIST.ok;
                return (
                  <button key={v.id} role="listitem" aria-label={v.name} className={`row ${v.cancelled_on ? "opacity-55" : ""}`} onClick={() => setVertrag(v)}>
                    <span className="grid flex-1 min-w-0">
                      <span className="font-semibold truncate">{v.name}</span>
                      <span className="text-muted text-[12.5px] truncate">{v.counterparty}{v.cancellation_deadline && !v.cancelled_on ? ` · kündigen bis ${datum(v.cancellation_deadline)}` : ""}</span>
                    </span>
                    <span className="grid justify-items-end gap-0.5"><span className={`chip ${st[1]}`}>{st[0]}</span>
                      {v.days_left != null && !v.cancelled_on && v.days_left >= 0 && <span className="text-muted text-[12px]">noch {v.days_left} {v.days_left === 1 ? "Tag" : "Tage"}</span>}</span>
                  </button>
                );
              })}
            </div>}
      </Abschnitt>
      {fix && <FixSheet f={fix === "neu" ? null : fix} vertraege={vertraege ?? []} schliessen={() => setFix(null)} />}
      {vertrag && <VertragSheet v={vertrag === "neu" ? null : vertrag} schliessen={() => setVertrag(null)} />}
    </div>
  );
}

function FixSheet({ f, vertraege, schliessen }: { f: Fix | null; vertraege: Vertrag[]; schliessen: () => void }) {
  const { household } = useHaushalt();
  const aktion = useAktion();
  const bereiche = useBereiche();
  const [name, setName] = useState(f?.name ?? "");
  const [bereich, setBereich] = useState(f?.life_area_id ?? "");
  const [kategorie, setKategorie] = useState<string | null>(f?.category_id ?? null);
  const [topf, setTopf] = useState<string | null>(f?.cost_account_id ?? null);
  const [zahltVon, setZahltVon] = useState<string | null>(f?.pay_from_account_id ?? null);
  const [betrag, setBetrag] = useState(f ? String(Number(f.amount)) : "");
  const [haeufigkeit, setHaeufigkeit] = useState<Haeufigkeit>(f?.frequency ?? "monthly");
  const [faellig, setFaellig] = useState(f?.next_due_date ?? heute());
  const [klasse, setKlasse] = useState<"need" | "want" | "saving">(f?.spending_class ?? "need");
  const [vertrag, setVertrag] = useState<string | null>(f?.contract_id ?? null);
  const [aktiv, setAktiv] = useState(f?.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const speichern = async () => {
    setBusy(true);
    const ok = await aktion(async () => fixkostSpeichern(await db(), {
      id: f?.id, household, name, bereich, kategorie, topf: topf ?? "", zahltVon, betrag: zahl(betrag), haeufigkeit, faellig, klasse, vertrag, aktiv }), "Fixkost gespeichert");
    setBusy(false);
    if (ok) schliessen();
  };
  return (
    <Sheet offen onClose={schliessen} titel={f ? "Fixkost bearbeiten" : "Neue Fixkost"}>
      <div className="grid gap-4">
        <Feld label="Name"><input className="input" value={name} placeholder="z. B. Miete" onChange={(e) => setName(e.target.value)} /></Feld>
        <div className="grid grid-cols-2 gap-3">
          <Feld label="Betrag (CHF)"><input className="input mono" inputMode="decimal" value={betrag} placeholder="0.00" onChange={(e) => setBetrag(e.target.value)} /></Feld>
          <Feld label="Nächste Zahlung"><input className="input" type="date" value={faellig} onChange={(e) => setFaellig(e.target.value)} /></Feld>
        </div>
        <Feld gruppe label="Wie oft">
          <Seg label="Wie oft" wert={haeufigkeit} onChange={setHaeufigkeit} optionen={(Object.keys(HAEUFIGKEIT_TEXT) as Haeufigkeit[]).map((k) => [k, HAEUFIGKEIT_TEXT[k]])} />
        </Feld>
        <Feld gruppe label="Wessen Topf" hinweis="«Gemeinsam» teilt ihr zur Hälfte, ein persönlicher Topf trägt die Person allein."><TopfChips wert={topf} onChange={setTopf} label="Wessen Topf" /></Feld>
        <Feld gruppe label="Bezahlt von" hinweis="Von welchem Konto es abgebucht wird (heute oft ein Privatkonto)."><KontoSelect label="Bezahlt von" wert={zahltVon} onChange={setZahltVon} leer="Noch offen" nur={(k) => k.status === "active"} /></Feld>
        <Feld label="Lebensbereich">
          <select className="input" value={bereich} onChange={(e) => setBereich(e.target.value)}>
            <option value="">Bitte wählen …</option>{bereiche.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Feld>
        <Feld gruppe label="Kategorie (optional)">
          <KategorieWahl wert={kategorie} onChange={setKategorie} />
          {kategorie && <button type="button" className="btn btn-ghost !min-h-0 py-1.5 justify-self-start text-[13px]" onClick={() => setKategorie(null)}>Kategorie entfernen</button>}
        </Feld>
        <Feld gruppe label="Art"><Seg label="Art" wert={klasse} onChange={setKlasse} optionen={[["need", "Bedarf"], ["want", "Wunsch"], ["saving", "Sparen"]]} /></Feld>
        {vertraege.length > 0 && (
          <Feld label="Gehört zum Vertrag (optional)">
            <select className="input" value={vertrag ?? ""} onChange={(e) => setVertrag(e.target.value || null)}>
              <option value="">Kein Vertrag</option>{vertraege.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Feld>
        )}
        <Haken label="Aktiv" wert={aktiv} onChange={setAktiv} hinweis="Pausierte Fixkosten zählen nicht in der Monatssumme." />
        <button className="btn btn-primary btn-big" disabled={busy || !name.trim() || !betrag.trim()} onClick={speichern}><Icon name="haken" />Speichern</button>
        {f && f.is_active && <FixBuchen f={f} schliessen={schliessen} />}
        {f && <LoeschKnopf text="Fixkost löschen" frage="Die Fixkost löschen?" onJa={async () => { if (await aktion(async () => fixkostLoeschen(await db(), f.id), "Fixkost gelöscht")) schliessen(); }} />}
      </div>
    </Sheet>
  );
}

function VertragSheet({ v, schliessen }: { v: Vertrag | null; schliessen: () => void }) {
  const { household } = useHaushalt();
  const aktion = useAktion();
  const [name, setName] = useState(v?.name ?? "");
  const [partner, setPartner] = useState(v?.counterparty ?? "");
  const [nummer, setNummer] = useState(v?.contract_number ?? "");
  const [verlaengerung, setVerlaengerung] = useState(v?.renewal_date ?? "");
  const [periode, setPeriode] = useState(String(v?.renewal_period_months ?? 12));
  const [auto, setAuto] = useState(v?.auto_renews ?? true);
  const [frist, setFrist] = useState(String(v?.cancellation_notice_days ?? 90));
  const [monatsende, setMonatsende] = useState(v?.notice_to_month_end ?? false);
  const [notiz, setNotiz] = useState(v?.note ?? "");
  const [busy, setBusy] = useState(false);
  const speichern = async () => {
    setBusy(true);
    const ok = await aktion(async () => vertragSpeichern(await db(), {
      id: v?.id, household, name, partner, nummer, verlaengerung, periodeMonate: zahl(periode), autoVerlaengert: auto, fristTage: zahl(frist), bisMonatsende: monatsende, notiz }), "Vertrag gespeichert");
    setBusy(false);
    if (ok) schliessen();
  };
  return (
    <Sheet offen onClose={schliessen} titel={v ? "Vertrag bearbeiten" : "Neuer Vertrag"}>
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Feld label="Name"><input className="input" value={name} placeholder="z. B. Internet" onChange={(e) => setName(e.target.value)} /></Feld>
          <Feld label="Vertragspartner"><input className="input" value={partner} placeholder="z. B. Sunrise" onChange={(e) => setPartner(e.target.value)} /></Feld>
        </div>
        <Feld label="Nächste Verlängerung" hinweis="Das Datum, an dem der Vertrag ausläuft bzw. sich verlängert."><input className="input" type="date" value={verlaengerung} onChange={(e) => setVerlaengerung(e.target.value)} /></Feld>
        <div className="grid grid-cols-2 gap-3">
          <Feld label="Laufzeit (Monate)"><input className="input mono" inputMode="numeric" value={periode} onChange={(e) => setPeriode(e.target.value)} /></Feld>
          <Feld label="Kündigungsfrist (Tage)"><input className="input mono" inputMode="numeric" value={frist} onChange={(e) => setFrist(e.target.value)} /></Feld>
        </div>
        <Haken label="Verlängert sich automatisch" wert={auto} onChange={setAuto} />
        <Haken label="Kündigung muss bis Ende des Vormonats eintreffen" wert={monatsende} onChange={setMonatsende} hinweis="Typisch bei Krankenkassen." />
        <Feld label="Vertragsnummer (optional)"><input className="input mono" value={nummer} onChange={(e) => setNummer(e.target.value)} /></Feld>
        <Feld label="Notiz (optional)"><input className="input" value={notiz} onChange={(e) => setNotiz(e.target.value)} /></Feld>
        <button className="btn btn-primary btn-big" disabled={busy || !name.trim() || !partner.trim() || !verlaengerung} onClick={speichern}><Icon name="haken" />Speichern</button>
        {v && !v.cancelled_on && <button className="btn" onClick={async () => { if (await aktion(async () => vertragKuendigen(await db(), v.id, heute()), "Als gekündigt markiert")) schliessen(); }}><Icon name="haken" />Ich habe gekündigt</button>}
        {v?.cancelled_on && <button className="btn" onClick={async () => { if (await aktion(async () => vertragKuendigen(await db(), v.id, null), "Wieder aktiv")) schliessen(); }}>Doch nicht gekündigt</button>}
        {v && <LoeschKnopf text="Vertrag löschen" frage="Den Vertrag löschen? Fixkosten bleiben bestehen." onJa={async () => { if (await aktion(async () => vertragLoeschen(await db(), v.id), "Vertrag gelöscht")) schliessen(); }} />}
      </div>
    </Sheet>
  );
}

/** «Bezahlt»: bucht die Fixkost als Beleg (Rechnung) und rückt die Fälligkeit weiter */
function FixBuchen({ f, schliessen }: { f: Fix; schliessen: () => void }) {
  const { konten, ich } = useHaushalt();
  const aktion = useAktion();
  const [betrag, setBetrag] = useState(String(Number(f.amount)));
  const [tag, setTag] = useState(heute());
  const [busy, setBusy] = useState(false);
  const konto = konten.find((k) => k.id === f.pay_from_account_id);
  const kaeufer = konto && konto.owners.length === 1 ? konto.owners[0].person_id : ich ?? konto?.owners[0]?.person_id ?? "";
  return (
    <div className="card-flat p-3.5 grid gap-3" role="group" aria-label="Bezahlt buchen">
      <b className="text-[14.5px]">Bezahlt? Als Beleg buchen</b>
      {!konto && <p className="text-[13px] text-[var(--warn-ink)]">Trage oben bei «Bezahlt von» ein Konto ein und speichere, dann geht das Buchen.</p>}
      <div className="grid grid-cols-2 gap-3">
        <Feld label="Betrag (CHF)"><input className="input mono" inputMode="decimal" aria-label="Betrag buchen" value={betrag} onChange={(e) => setBetrag(e.target.value)} /></Feld>
        <Feld label="Datum"><input className="input" type="date" aria-label="Datum buchen" value={tag} onChange={(e) => setTag(e.target.value)} /></Feld>
      </div>
      <button className="btn btn-primary" disabled={busy || !konto || !(zahl(betrag) > 0)} onClick={async () => {
        setBusy(true);
        const ok = await aktion(async () => fixkostBuchen(await db(), { fixkost: f.id, datum: tag, betrag: zahl(betrag), kaeufer }), "Als Beleg gebucht");
        setBusy(false);
        if (ok) schliessen();
      }}><Icon name="haken" />Als bezahlt buchen{konto ? ` (von ${konto.name})` : ""}</button>
    </div>
  );
}
