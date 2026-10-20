import { useState } from "react";
import { db, useQuery } from "../db/client";
import { datum, geld, heute, zahl } from "../lib/format";
import { budgetLoeschen, budgetSpeichern, UEBERTRAG_TEXT, type Uebertrag } from "../lib/budget";
import { useHaushalt } from "../lib/haushalt";
import { KategorieWahl, useKategorien } from "../ui/Auswahl";
import { TopfChips } from "../ui/Auswahl";
import { Feld, Leer, LoeschKnopf, Seg, Sheet, useAktion } from "../ui/kit";
import { Icon } from "../ui/Icon";
import { Fortschritt, PersonWahl, TEMPO, useBereiche } from "./bausteine";

/** Budgets: pro Person (My Share) oder pro Topf, mit Safe-to-Spend (Blueprint §2.6) */
interface Zeile {
  id: string; name: string; scope: "person" | "account"; person_id: string | null; person: string | null; account_id: string | null; konto: string | null;
  life_area_id: string | null; bereich: string | null; category_id: string | null; kategorie: string | null; monthly_amount: string; rollover_mode: Uebertrag;
  valid_from: string; valid_to: string | null; laeuft: boolean;
  available: string | null; month_spent: string | null; remaining_days: number | null; safe_per_day: string | null; left_today: string | null;
  projected_month_spend: string | null; pace: string | null;
}

export function Budgets() {
  const { household } = useHaushalt();
  const [bearbeiten, setBearbeiten] = useState<Zeile | "neu" | null>(null);
  const zeilen = useQuery<Zeile>(
    `select b.id, b.name, b.scope::text, b.person_id, p.display_name as person, b.account_id, a.name as konto, b.life_area_id, la.name as bereich,
            b.category_id, c.name as kategorie, b.monthly_amount::text, b.rollover_mode::text, b.valid_from::text, b.valid_to::text,
            s.budget_id is not null as laeuft, s.available::text, s.month_spent::text, s.remaining_days, s.safe_per_day::text, s.left_today::text,
            s.projected_month_spend::text, s.pace
       from variable_budget b
       left join person p on p.id = b.person_id left join account a on a.id = b.account_id
       left join life_area la on la.id = b.life_area_id left join category c on c.id = b.category_id
       left join budget_status($1, $2) s on s.budget_id = b.id
      where b.household_id = $1 order by s.budget_id is null, p.sort nulls last, b.name`, [household, heute()]);
  return (
    <div className="grid gap-4">
      <p className="text-ink-2 text-[14px] -mt-1">Pro Person zählt, was jemand wirklich trägt: die Hälfte des Gemeinsamen und alles Eigene. Pro Topf zählen alle Kosten des Topfs.</p>
      <button className="btn btn-primary" onClick={() => setBearbeiten("neu")}><Icon name="plus" />Budget</button>
      {zeilen && !zeilen.length && <Leer icon="zweck" titel="Noch kein Budget" text="Lege z. B. «Lebensmittel» für jede Person an. Die App rechnet dir aus, wie viel du heute noch ausgeben kannst." />}
      <div className="grid gap-3" role="list" aria-label="Budgets">
        {(zeilen ?? []).map((b) => <BudgetKarte key={b.id} b={b} onClick={() => setBearbeiten(b)} />)}
      </div>
      {bearbeiten && <BudgetSheet b={bearbeiten === "neu" ? null : bearbeiten} schliessen={() => setBearbeiten(null)} />}
    </div>
  );
}

function wofuer(b: Zeile) {
  const was = b.kategorie ?? b.bereich ?? "alle Ausgaben";
  return `${b.scope === "person" ? b.person : b.konto} · ${was}`;
}

function BudgetKarte({ b, onClick }: { b: Zeile; onClick: () => void }) {
  const [tempo, art, chip] = TEMPO[b.pace ?? ""] ?? ["", "gut", ""];
  const verfuegbar = Number(b.available ?? b.monthly_amount), ausgegeben = Number(b.month_spent ?? 0);
  return (
    <button className="card p-4 grid gap-3 text-left" role="listitem" aria-label={b.name} onClick={onClick}>
      <div className="flex items-start justify-between gap-3">
        <span className="grid min-w-0"><b className="text-[16.5px] truncate">{b.name}</b><span className="text-muted text-[13px] truncate">{wofuer(b)}</span></span>
        {b.laeuft ? <span className={`chip ${chip}`}>{tempo}</span>
          : <span className="chip chip-virtuell">{b.valid_to && b.valid_to < heute() ? `bis ${datum(b.valid_to)}` : `ab ${datum(b.valid_from)}`}</span>}
      </div>
      {b.laeuft ? (
        <>
          <Fortschritt anteil={verfuegbar ? ausgegeben / verfuegbar : 1} art={art} label={`${b.name}: ausgegeben`} />
          <div className="flex items-end justify-between gap-3">
            <span className="grid"><span className="text-muted text-[12px]">Heute noch</span>
              <span className={`num text-[22px] leading-tight ${Number(b.left_today) < 0 ? "text-crit" : ""}`} data-testid="heute-noch">{geld(b.left_today)}</span></span>
            <span className="grid justify-items-end text-[13px] text-ink-2">
              <span>{geld(ausgegeben)} von {geld(verfuegbar)}</span>
              <span className="text-muted">{geld(b.safe_per_day)} pro Tag · noch {b.remaining_days} {b.remaining_days === 1 ? "Tag" : "Tage"}</span>
            </span>
          </div>
        </>
      ) : <span className="text-muted text-[13px]">CHF {geld(b.monthly_amount)} pro Monat</span>}
    </button>
  );
}

function BudgetSheet({ b, schliessen }: { b: Zeile | null; schliessen: () => void }) {
  const { household, ich } = useHaushalt();
  const aktion = useAktion();
  const kats = useKategorien();
  const bereiche = useBereiche();
  const [name, setName] = useState(b?.name ?? "");
  const [scope, setScope] = useState<"person" | "account">(b?.scope ?? "person");
  const [person, setPerson] = useState<string | null>(b?.person_id ?? ich);
  const [topf, setTopf] = useState<string | null>(b?.account_id ?? null);
  const [umfang, setUmfang] = useState<"alles" | "bereich" | "kategorie">(b?.category_id ? "kategorie" : b?.life_area_id ? "bereich" : "alles");
  const [bereich, setBereich] = useState<string | null>(b?.life_area_id ?? null);
  const [kategorie, setKategorie] = useState<string | null>(b?.category_id ?? null);
  const [betrag, setBetrag] = useState(b ? String(Number(b.monthly_amount)) : "");
  const [uebertrag, setUebertrag] = useState<Uebertrag>(b?.rollover_mode ?? "none");
  const [von, setVon] = useState(b?.valid_from ?? heute().slice(0, 8) + "01");
  const [bis, setBis] = useState(b?.valid_to ?? "");
  const [busy, setBusy] = useState(false);
  const vorschlag = (umfang === "kategorie" ? kats.find((k) => k.id === kategorie)?.name : umfang === "bereich" ? bereiche.find((x) => x.id === bereich)?.name : "Alles") ?? "";

  const speichern = async () => {
    setBusy(true);
    const ok = await aktion(async () => {
      if (umfang === "kategorie" && !kategorie) throw new Error("Bitte eine Kategorie wählen.");
      if (umfang === "bereich" && !bereich) throw new Error("Bitte einen Lebensbereich wählen.");
      const wer = scope === "person" ? (await (await db()).query<{ n: string }>(`select display_name n from person where id = $1`, [person])).rows[0]?.n : null;
      await budgetSpeichern(await db(), {
        id: b?.id, household, name: name.trim() || [vorschlag, wer].filter(Boolean).join(" "), scope, person, account: topf,
        bereich: umfang === "bereich" ? bereich : null, kategorie: umfang === "kategorie" ? kategorie : null,
        betrag: zahl(betrag), uebertrag, von, bis: bis || null,
      });
    }, "Budget gespeichert");
    setBusy(false);
    if (ok) schliessen();
  };
  return (
    <Sheet offen onClose={schliessen} titel={b ? "Budget bearbeiten" : "Neues Budget"}>
      <div className="grid gap-4">
        <Feld gruppe label="Gilt für">
          <Seg label="Gilt für" wert={scope} onChange={setScope} optionen={[["person", "Eine Person"], ["account", "Einen Topf"]]} />
        </Feld>
        {scope === "person"
          ? <Feld gruppe label="Person" hinweis="Zählt, was diese Person trägt: ihre Hälfte vom Gemeinsamen und alles Eigene."><PersonWahl wert={person} onChange={setPerson} /></Feld>
          : <Feld gruppe label="Topf" hinweis="Zählt alle Kosten des Topfs, z. B. «Gemeinsam Leben»."><TopfChips wert={topf} onChange={setTopf} label="Topf" /></Feld>}
        <Feld gruppe label="Wofür">
          <Seg label="Wofür" wert={umfang} onChange={setUmfang} optionen={[["alles", "Alles"], ["bereich", "Lebensbereich"], ["kategorie", "Kategorie"]]} />
        </Feld>
        {umfang === "bereich" && (
          <select className="input" aria-label="Lebensbereich" value={bereich ?? ""} onChange={(e) => setBereich(e.target.value || null)}>
            <option value="">Bitte wählen …</option>{bereiche.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        )}
        {umfang === "kategorie" && <KategorieWahl wert={kategorie} onChange={setKategorie} />}
        <div className="grid grid-cols-2 gap-3">
          <Feld label="Pro Monat (CHF)"><input className="input mono" inputMode="decimal" value={betrag} placeholder="300" onChange={(e) => setBetrag(e.target.value)} /></Feld>
          <Feld label="Name"><input className="input" value={name} placeholder={vorschlag || "z. B. Lebensmittel"} onChange={(e) => setName(e.target.value)} /></Feld>
        </div>
        <Feld gruppe label="Was übrig bleibt" hinweis={UEBERTRAG_TEXT[uebertrag][1]}>
          <Seg label="Übertrag" wert={uebertrag} onChange={setUebertrag} optionen={(Object.keys(UEBERTRAG_TEXT) as Uebertrag[]).map((k) => [k, UEBERTRAG_TEXT[k][0]])} />
        </Feld>
        <div className="grid grid-cols-2 gap-3">
          <Feld label="Gültig ab"><input className="input" type="date" value={von} onChange={(e) => setVon(e.target.value)} /></Feld>
          <Feld label="Bis (optional)"><input className="input" type="date" value={bis} onChange={(e) => setBis(e.target.value)} /></Feld>
        </div>
        <button className="btn btn-primary btn-big" disabled={busy || !(zahl(betrag) >= 0) || betrag.trim() === ""} onClick={speichern}><Icon name="haken" />Speichern</button>
        {b && <LoeschKnopf text="Budget löschen" frage="Das Budget löschen? Belege bleiben unverändert." onJa={async () => { if (await aktion(async () => budgetLoeschen(await db(), b.id), "Budget gelöscht")) schliessen(); }} />}
      </div>
    </Sheet>
  );
}
