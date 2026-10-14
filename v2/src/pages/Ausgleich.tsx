import { useEffect, useMemo, useState } from "react";
import { db, useQuery } from "../db/client";
import { geld, heute, kurzDatum, zahl } from "../lib/format";
import { ausgleichBuchen, ueberweisungLoeschen } from "../lib/belege";
import { useHaushalt } from "../lib/haushalt";
import { go } from "../lib/router";
import { Avatar, farbe, Feld, Leer, LoeschKnopf, Seg, Seite, Sheet, useAktion } from "../ui/kit";
import { Icon } from "../ui/Icon";
import { LadenMarke } from "./Belege";

interface Stand { person_id: string; display_name: string; paid_total: number; my_share: number; transfers_net: number; balance: number }
interface Eintrag { art: "beleg" | "transfer"; id: string; datum: string; wirkung: number; titel: string; chain_key: string | null; notiz: string | null;
  betrag: number; von: string | null; an: string | null; stand: number }

export const SALDO_SQL = `select person_id, display_name, paid_total::float8 as paid_total, my_share::float8 as my_share,
  transfers_net::float8 as transfers_net, balance::float8 as balance from v_settlement_balance where household_id = $1 order by display_name`;

/** Wer schuldet wem? (bei zwei Personen genau eine Zahlung) */
export function schuld(stand: Stand[]) {
  const schuldner = [...stand].filter((s) => s.balance < -0.004).sort((a, b) => a.balance - b.balance)[0];
  const glaeubiger = [...stand].filter((s) => s.balance > 0.004).sort((a, b) => b.balance - a.balance)[0];
  if (!schuldner || !glaeubiger) return null;
  return { von: schuldner, an: glaeubiger, betrag: Math.min(-schuldner.balance, glaeubiger.balance) };
}

const MITTEL: [string, string][] = [["Twint", "Twint"], ["Überweisung", "Überweisung"], ["Bar", "Bar"]];

export function Ausgleich() {
  const { household, personen, ich } = useHaushalt();
  const aktion = useAktion();
  const stand = useQuery<Stand>(SALDO_SQL, [household]);
  const erwachsene = personen.filter((p) => p.role === "adult" && !p.archived_at);
  const sicht = erwachsene.find((p) => p.id === ich) ?? erwachsene[0];
  const verlauf = useQuery<Eintrag>(`
    with ein as (
      select 'beleg'::text as art, h.id, h.booking_date as datum, h.created_at, e.effect::float8 as wirkung,
             coalesce(m.name, (select l.raw_text from line_item l where l.transaction_id = h.id order by l.position limit 1), 'Beleg') as titel,
             m.chain_key, h.notes as notiz, h.total_amount::float8 as betrag, null::text as von, null::text as an
        from v_txn_effect e join transaction_header h on h.id = e.transaction_id left join merchant m on m.id = h.merchant_id
       where e.household_id = $1 and e.person_id = $2
      union all
      select 'transfer', t.id, t.transfer_date, t.created_at,
             ((select coalesce(sum(o.share), 0) from account_owner o where o.account_id = t.from_account_id and o.person_id = $2)
            - (select coalesce(sum(o.share), 0) from account_owner o where o.account_id = t.to_account_id and o.person_id = $2))::float8 * t.amount::float8,
             t.kind::text, null, t.note, t.amount::float8, fa.name, ta.name
        from transfer t join account fa on fa.id = t.from_account_id join account ta on ta.id = t.to_account_id
       where t.household_id = $1)
    select art, id, datum::text, wirkung, titel, chain_key, notiz, betrag, von, an,
           sum(wirkung) over (order by datum, created_at, id rows unbounded preceding) as stand
      from ein where abs(wirkung) >= 0.005 order by datum desc, created_at desc, id desc`, [household, sicht?.id]);
  const [erfassen, setErfassen] = useState(false);
  const [anzahl, setAnzahl] = useState(30);
  const [gewaehlt, setGewaehlt] = useState<Eintrag | null>(null);
  const s = stand ? schuld(stand) : null;
  const person = (id: string) => personen.find((p) => p.id === id);

  if (!stand) return null;
  return (
    <Seite eyebrow="Ausgleich" titel="Wer schuldet wem">
      <div className="hero p-5 grid gap-3">
        {s ? (
          <>
            <div className="flex items-center gap-2">
              <Avatar name={s.von.display_name} color={farbe(person(s.von.person_id) ?? {})} size={34} />
              <Icon name="pfeil" size={22} />
              <Avatar name={s.an.display_name} color={farbe(person(s.an.person_id) ?? {})} size={34} />
            </div>
            <p className="text-[17px] font-semibold"><span data-testid="saldo-text">{s.von.display_name} schuldet {s.an.display_name}</span></p>
            <p className="num text-[38px] leading-none" data-testid="saldo-betrag">CHF {geld(s.betrag)}</p>
            <button className="btn bg-white/95 text-[#12291f] border-transparent mt-1" onClick={() => setErfassen(true)}><Icon name="ausgleich" />Ausgleich erfassen</button>
          </>
        ) : (
          <>
            <span className="grid place-items-center size-12 rounded-full bg-white/15"><Icon name="haken" size={26} strokeWidth={2.4} /></span>
            <p className="text-[24px] font-extrabold" data-testid="saldo-text">Ihr seid quitt</p>
            <p className="text-[14px] opacity-90">Niemand schuldet jemandem etwas. Sobald jemand privat für Gemeinsames bezahlt, erscheint hier der Betrag.</p>
          </>
        )}
      </div>

      <div className="card p-4 grid gap-2.5">
        <h2 className="font-bold">So setzt sich das zusammen</h2>
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1.5 text-[13.5px] items-center">
          <span />
          <span className="text-muted text-[11.5px] text-right">bezahlt</span>
          <span className="text-muted text-[11.5px] text-right">getragen</span>
          <span className="text-muted text-[11.5px] text-right">Saldo</span>
          {stand.map((r) => (
            <Zeile key={r.person_id} r={r} p={person(r.person_id)} />
          ))}
        </div>
        {stand.some((r) => Math.abs(r.transfers_net) > 0.004) && (
          <p className="text-muted text-[12.5px]">«bezahlt» enthält auch Ausgleichszahlungen und Einzahlungen auf gemeinsame Konten.</p>
        )}
        <p className="text-muted text-[12.5px]">Jede Person trägt ihren Anteil an jedem Beleg: Gemeinsames je 50 %, Persönliches 100 %. Wer mehr bezahlt als getragen hat, bekommt den Unterschied. Gutscheine und Punkte zählen für beide nach Anteil.</p>
      </div>

      <div className="grid gap-2">
        <div className="flex items-end justify-between px-1">
          <h2 className="text-[16px] font-bold">Verlauf</h2>
          {sicht && <span className="text-muted text-[12px]">Stand aus Sicht von {sicht.display_name}</span>}
        </div>
        {verlauf && !verlauf.length && <Leer icon="ausgleich" titel="Noch nichts zum Ausgleichen" text="Belege, die jemand privat für Gemeinsames bezahlt, erscheinen hier." />}
        {verlauf && verlauf.length > 0 && (
          <div className="card list overflow-hidden">
            {verlauf.slice(0, anzahl).map((e) => (
              <button key={e.art + e.id} className="row !items-center" onClick={() => e.art === "beleg" ? go(`belege/${e.id}`) : setGewaehlt(e)}>
                {e.art === "beleg" ? <LadenMarke name={e.titel} chain={e.chain_key} />
                  : <span className="k-ico k-leben"><Icon name="ausgleich" /></span>}
                <span className="grid flex-1 min-w-0">
                  <b className="truncate">{e.art === "beleg" ? e.titel : e.titel === "settlement" ? "Ausgleichszahlung" : "Überweisung"}</b>
                  <span className="text-muted text-[12.5px] truncate">{kurzDatum(e.datum)}{e.art === "transfer" ? ` · ${e.von} → ${e.an}${e.notiz ? ` · ${e.notiz}` : ""}` : ""}</span>
                </span>
                <span className="grid justify-items-end">
                  <span className={`num text-[14.5px] ${e.wirkung > 0 ? "text-[var(--accent-ink)]" : "text-crit"}`}>{e.wirkung > 0 ? "+" : "−"}{geld(Math.abs(e.wirkung))}</span>
                  <span className="num text-muted text-[11.5px]">Stand {geld(e.stand)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        {verlauf && verlauf.length > anzahl && <button className="btn" onClick={() => setAnzahl(anzahl + 50)}>Mehr anzeigen</button>}
      </div>

      <AusgleichErfassen offen={erfassen} schliessen={() => setErfassen(false)} vorschlag={s} />
      <Sheet offen={!!gewaehlt} onClose={() => setGewaehlt(null)} titel={gewaehlt?.titel === "settlement" ? "Ausgleichszahlung" : "Überweisung"}>
        {gewaehlt && (
          <div className="grid gap-3">
            <div className="card-flat p-4 grid gap-1">
              <span className="num text-[28px]">CHF {geld(gewaehlt.betrag)}</span>
              <span className="text-ink-2">{gewaehlt.von} → {gewaehlt.an}</span>
              <span className="text-muted text-[13px]">{kurzDatum(gewaehlt.datum)}{gewaehlt.notiz ? ` · ${gewaehlt.notiz}` : ""}</span>
            </div>
            <LoeschKnopf text="Zahlung löschen" frage="Diese Zahlung löschen? Der Saldo wird neu berechnet."
              onJa={async () => { if (await aktion(async () => ueberweisungLoeschen(await db(), gewaehlt.id), "Zahlung gelöscht")) setGewaehlt(null); }} />
          </div>
        )}
      </Sheet>
    </Seite>
  );
}

function Zeile({ r, p }: { r: Stand; p?: { display_name: string; color: string | null; sort: number } }) {
  return (
    <>
      <span className="flex items-center gap-2 min-w-0"><Avatar name={r.display_name} color={farbe(p ?? {})} size={24} /><b className="truncate">{r.display_name}</b></span>
      <span className="num text-right">{geld(r.paid_total + r.transfers_net)}</span>
      <span className="num text-right">{geld(r.my_share)}</span>
      <span className={`num text-right font-semibold ${r.balance > 0.004 ? "text-[var(--accent-ink)]" : r.balance < -0.004 ? "text-crit" : ""}`}>{r.balance > 0.004 ? "+" : ""}{geld(r.balance)}</span>
    </>
  );
}

function AusgleichErfassen({ offen, schliessen, vorschlag }: { offen: boolean; schliessen: () => void; vorschlag: ReturnType<typeof schuld> }) {
  const { household, personen } = useHaushalt();
  const aktion = useAktion();
  const erwachsene = personen.filter((p) => p.role === "adult" && !p.archived_at);
  const [von, setVon] = useState("");
  const [an, setAn] = useState("");
  const [betrag, setBetrag] = useState("");
  const [datum, setDatum] = useState(heute());
  const [mittel, setMittel] = useState("Twint");
  useEffect(() => {
    if (!offen) return;
    setVon(vorschlag?.von.person_id ?? erwachsene[0]?.id ?? "");
    setAn(vorschlag?.an.person_id ?? erwachsene[1]?.id ?? "");
    setBetrag(vorschlag ? vorschlag.betrag.toFixed(2) : "");
    setDatum(heute());
  }, [offen]); // eslint-disable-line react-hooks/exhaustive-deps
  const optionen = useMemo(() => erwachsene.map((p) => [p.id, p.display_name] as [string, string]), [erwachsene]);
  const buchen = async () => {
    const ok = await aktion(async () => {
      if (von === an) throw new Error("Bitte zwei verschiedene Personen wählen.");
      await ausgleichBuchen(await db(), { household, von, an, betrag: zahl(betrag), datum, mittel });
    }, "Ausgleich gebucht");
    if (ok) schliessen();
  };
  return (
    <Sheet offen={offen} onClose={schliessen} titel="Ausgleich erfassen">
      <div className="grid gap-4">
        <Feld gruppe label="Wer zahlt"><Seg label="Wer zahlt" wert={von} optionen={optionen} onChange={(v) => { setVon(v); if (v === an) setAn(erwachsene.find((p) => p.id !== v)?.id ?? ""); }} /></Feld>
        {erwachsene.length > 2
          ? <Feld gruppe label="An wen"><Seg label="An wen" wert={an} optionen={optionen.filter(([v]) => v !== von)} onChange={setAn} /></Feld>
          : <p className="flex items-center gap-2 text-ink-2 -mt-1"><Icon name="pfeil" size={18} />an <b>{erwachsene.find((p) => p.id === an)?.display_name}</b></p>}
        <Feld label="Betrag (CHF)"><input className="input mono text-[20px]" inputMode="decimal" value={betrag} onChange={(e) => setBetrag(e.target.value)} /></Feld>
        <div className="grid grid-cols-2 gap-3">
          <Feld label="Datum"><input className="input" type="date" value={datum} onChange={(e) => setDatum(e.target.value)} /></Feld>
          <Feld label="Wie"><select className="input" value={mittel} onChange={(e) => setMittel(e.target.value)}>{MITTEL.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></Feld>
        </div>
        <p className="text-muted text-[13px]">Wird als Zahlung zwischen den Privatkonten gebucht. Die Überweisung selbst machst du wie gewohnt per Twint oder E-Banking.</p>
        <button className="btn btn-primary btn-big" disabled={zahl(betrag) <= 0 || !von || !an} onClick={buchen}><Icon name="haken" />Ausgleich buchen</button>
      </div>
    </Sheet>
  );
}
