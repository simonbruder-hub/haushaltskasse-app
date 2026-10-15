import { useMemo, useState } from "react";
import { useQuery } from "../db/client";
import { heute, kurzDatum } from "../lib/format";
import { useHaushalt } from "../lib/haushalt";
import { ALARM_SQL, proEinheit, type Alarm } from "../lib/preise";
import { AlarmListe } from "../ui/Preise";
import { Leer, Seite } from "../ui/kit";
import { Icon } from "../ui/Icon";

/** Produkte und Preise: bester Preis pro Einheit, offene Preisalarme, «Preis prüfen» im Laden */
interface Zeile { id: string; name: string; kategorie: string | null; comparison_unit: string; laeden: number; kaeufe: number; zuletzt: string | null; bester_preis: string | null; bester_laden: string | null; alarme: number }

export function Preise() {
  const { household } = useHaushalt();
  const [suche, setSuche] = useState("");
  const produkte = useQuery<Zeile>(
    `select u.id, u.name, c.name as kategorie, u.comparison_unit::text, u.laeden, u.kaeufe, u.zuletzt::text, u.bester_preis::text, u.bester_laden, u.alarme
       from produkt_uebersicht($1, $2) u left join category c on c.id = u.category_id`, [household, heute()]);
  const alarme = useQuery<Alarm>(`${ALARM_SQL} and seen_at is null order by observed_on desc limit 20`, [household]) ?? [];
  const liste = useMemo(() => {
    const q = suche.trim().toLowerCase();
    return (produkte ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || (p.kategorie ?? "").toLowerCase().includes(q));
  }, [produkte, suche]);
  return (
    <Seite eyebrow="Mehr" titel="Produkte und Preise" zurueck="mehr">
      <a href="#/preis-pruefen" className="btn btn-primary btn-big no-underline"><Icon name="strichcode" />Preis prüfen</a>
      {alarme.length > 0 && (
        <div className="grid gap-2">
          <h2 className="text-[16px] font-bold px-1 flex items-center gap-2"><Icon name="alarm" size={18} />Preisalarme</h2>
          <AlarmListe alarme={alarme} />
        </div>
      )}
      {produkte && produkte.length === 0
        ? <Leer icon="preis" titel="Noch keine Produkte" text="Produkte entstehen beim Scannen von Belegen und mit «Preis prüfen» im Laden." />
        : <>
            <label className="relative">
              <Icon name="suche" size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
              <input className="input pl-10" type="search" aria-label="Produkt suchen" placeholder="Produkt oder Kategorie suchen" value={suche} onChange={(e) => setSuche(e.target.value)} />
            </label>
            <div className="card list overflow-hidden" role="list" aria-label="Produkte">
              {liste.map((p) => (
                <a key={p.id} href={`#/preise/${p.id}`} role="listitem" aria-label={p.name} className="row no-underline text-ink">
                  <span className="grid flex-1 min-w-0">
                    <span className="font-semibold truncate">{p.name}{p.alarme > 0 && <span className="chip chip-crit !text-[11px] !py-0 ml-1.5 align-middle">{p.alarme} Alarm{p.alarme === 1 ? "" : "e"}</span>}</span>
                    <span className="text-muted text-[12.5px] truncate">
                      {[p.kategorie, p.laeden ? `${p.laeden} ${p.laeden === 1 ? "Laden" : "Läden"}` : null, p.zuletzt ? `zuletzt ${kurzDatum(p.zuletzt)}` : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="grid justify-items-end">
                    {p.bester_preis ? <><span className="num font-semibold">{proEinheit(p.bester_preis, p.comparison_unit)}</span><span className="text-muted text-[12px]">{p.bester_laden}</span></>
                      : <span className="text-muted text-[12.5px]">kein Preis</span>}
                  </span>
                </a>
              ))}
              {!liste.length && <p className="p-4 text-muted text-[14px]">Nichts gefunden.</p>}
            </div>
          </>}
    </Seite>
  );
}
