import { useMemo, useState } from "react";
import { geld, kurzDatum, monatName } from "../lib/format";
import { LADEN_FARBE, topfOptionen } from "../lib/auswahl";
import { topfZuordnung, useBelege, type BelegZeile } from "../lib/belegliste";
import { useHaushalt } from "../lib/haushalt";
import { Avatar, farbe, Leer, Seite } from "../ui/kit";
import { Icon } from "../ui/Icon";

export function Belege() {
  const { household, personen, konten } = useHaushalt();
  const [filter, setFilter] = useState("alle");
  const [suche, setSuche] = useState("");
  const [anzahl, setAnzahl] = useState(300);
  const belege = useBelege(household, "order by h.booking_date desc, h.created_at desc limit $2", [anzahl]);
  const erwachsene = personen.filter((p) => p.role === "adult" && !p.archived_at);
  const zu = useMemo(() => topfZuordnung(konten), [konten]);

  const sichtbar = useMemo(() => {
    if (!belege) return [];
    const s = suche.trim().toLowerCase();
    const eigene = filter !== "alle" && filter !== "gemeinsam" ? zu.vonPerson(filter) : null;
    return belege.filter((b) =>
      (filter === "alle" || (filter === "gemeinsam" ? b.toepfe.some((t) => zu.gemeinsam.has(t)) : b.toepfe.some((t) => eigene!.has(t))))
      && (!s || [b.titel, b.kategorie, b.notes, b.konto].some((x) => x?.toLowerCase().includes(s))));
  }, [belege, filter, suche, zu]);

  const monate = useMemo(() => {
    const m = new Map<string, BelegZeile[]>();
    for (const b of sichtbar) { const k = b.datum.slice(0, 7); m.set(k, [...(m.get(k) ?? []), b]); }
    return [...m.entries()];
  }, [sichtbar]);

  return (
    <Seite eyebrow="Belege" titel="Ausgaben"
      aktion={<a href="#/erfassen" className="btn btn-soft no-underline"><Icon name="plus" />Neu</a>}>
      <div className="grid gap-2.5">
        <label className="relative block">
          <Icon name="suche" size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input !pl-10" type="search" placeholder="Laden, Kategorie, Notiz …" aria-label="Suchen" value={suche} onChange={(e) => setSuche(e.target.value)} />
        </label>
        <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-1" role="group" aria-label="Filter">
          {[["alle", "Alle"], ["gemeinsam", "Gemeinsam"], ...erwachsene.map((p) => [p.id, p.display_name])].map(([v, t]) => (
            <button type="button" key={v} aria-pressed={filter === v} onClick={() => setFilter(v)}
              className={`chip !text-[13.5px] !py-1.5 !px-3.5 border ${filter === v ? "bg-[var(--ink)] text-[var(--paper)] border-transparent" : "bg-[var(--card)] border-[var(--rule-strong)]"}`}>{t}</button>
          ))}
        </div>
      </div>

      {belege && !belege.length && (
        <Leer icon="beleg" titel="Noch keine Belege" text="Erfasse den ersten Einkauf. Die App rechnet aus, wer was trägt und wer wem etwas schuldet.">
          <a href="#/erfassen" className="btn btn-primary no-underline mt-1"><Icon name="plus" />Ersten Beleg erfassen</a>
        </Leer>
      )}
      {belege && belege.length > 0 && !sichtbar.length && <p className="text-muted px-1">Keine Belege für diese Auswahl.</p>}

      {monate.map(([monat, liste]) => {
        const summe = liste.reduce((s, b) => s + b.total_chf, 0);
        return (
          <div key={monat} className="grid gap-2">
            <div className="flex items-end justify-between gap-3 px-1">
              <h2 className="text-[16px] font-bold capitalize">{monatName(monat)}</h2>
              <span className="num text-[14px] text-ink-2">CHF {geld(summe)}</span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-1 -mt-1 text-[12.5px] text-muted">
              {erwachsene.map((p) => <span key={p.id}>{p.display_name} trägt <span className="num">{geld(liste.reduce((s, b) => s + (b.anteil[p.id] ?? 0), 0))}</span></span>)}
            </div>
            <div className="card list overflow-hidden">{liste.map((b) => <BelegEintrag key={b.id} b={b} />)}</div>
          </div>
        );
      })}

      {belege && belege.length >= anzahl && <button className="btn" onClick={() => setAnzahl(anzahl + 300)}>Ältere Belege laden</button>}
    </Seite>
  );
}

export function BelegEintrag({ b }: { b: BelegZeile }) {
  const { konten, personen } = useHaushalt();
  const opts = topfOptionen(konten, personen);
  const toepfe = b.toepfe.map((t) => opts.find((o) => o.id === t) ?? konten.filter((k) => k.id === t).map((k) => ({ id: k.id, label: k.name, kind: k.kind }))[0]).filter(Boolean);
  const gutschrift = b.kind === "refund";
  return (
    <a href={`#/belege/${b.id}`} className="row no-underline text-ink !items-start">
      <LadenMarke name={b.titel} chain={b.chain_key} />
      <span className="grid flex-1 min-w-0 gap-0.5">
        <span className="flex items-center gap-1.5 min-w-0"><b className="truncate">{b.titel}</b>{gutschrift && <span className="chip chip-ok">Gutschrift</span>}</span>
        <span className="text-muted text-[12.5px] truncate">{kurzDatum(b.datum)}{b.kategorie ? ` · ${b.kategorie}` : ""}{b.konto ? ` · ${b.konto}` : ""}</span>
        <span className="flex flex-wrap gap-1 mt-0.5">
          {toepfe.map((t) => <span key={t!.id} className={`chip k-tag k-${t!.kind} !text-[11px] !px-2 !py-0.5`}>{t!.label}</span>)}
        </span>
      </span>
      <span className="grid justify-items-end gap-0.5">
        <span className={`num text-[15.5px] ${gutschrift ? "text-[var(--accent-ink)]" : ""}`}>{b.currency !== "CHF" ? `${b.currency} ` : ""}{geld(b.total)}</span>
        <Wirkung w={b.wirkung} />
      </span>
    </a>
  );
}

/** Kleine Anzeige, wem der Beleg im Ausgleich etwas gutschreibt */
function Wirkung({ w }: { w: Record<string, number> }) {
  const { personen } = useHaushalt();
  const plus = Object.entries(w).find(([, v]) => v > 0.005);
  if (!plus) return null;
  const p = personen.find((x) => x.id === plus[0]);
  if (!p) return null;
  return <span className="flex items-center gap-1 text-[11.5px] text-muted" title={`${p.display_name} hat ${geld(plus[1])} für andere bezahlt`}>
    <Avatar name={p.display_name} color={farbe(p)} size={15} /><span className="num">+{geld(plus[1])}</span></span>;
}

export function LadenMarke({ name, chain, gross }: { name: string; chain: string | null; gross?: boolean }) {
  const f = chain ? LADEN_FARBE[chain] : undefined;
  const s = gross ? 46 : 38;
  return (
    <span className="grid place-items-center rounded-xl font-extrabold flex-none"
      style={{ width: s, height: s, fontSize: s * 0.42, background: f ?? "var(--paper-2)", color: f ? "#fff" : "var(--ink-2)" }}>
      {f || chain ? name.slice(0, 1).toUpperCase() : <Icon name="beleg" size={s * 0.5} />}
    </span>
  );
}
