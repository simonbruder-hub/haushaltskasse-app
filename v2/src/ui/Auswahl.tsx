import { useMemo, useState } from "react";
import { useQuery } from "../db/client";
import { useHaushalt } from "../lib/haushalt";
import { topfOptionen } from "../lib/auswahl";
import { Sheet } from "./kit";
import { Icon } from "./Icon";

export interface KategorieZeile { id: string; name: string; bereich: string; default_cost_account_id: string | null; n: number }

export function useKategorien(): KategorieZeile[] {
  const { household } = useHaushalt();
  return useQuery<KategorieZeile>(
    `select c.id, c.name, la.name as bereich, c.default_cost_account_id,
            (select count(*)::int from line_item l where l.category_id = c.id) as n
       from category c join life_area la on la.id = c.life_area_id
      where c.household_id = $1 and c.archived_at is null and la.archived_at is null
      order by la.sort, c.sort, c.name`, [household]) ?? [];
}

/** Kategorie wählen: häufige als Chips, alle im Blatt mit Suche */
export function KategorieWahl({ wert, onChange, label = "Kategorie" }: { wert: string | null; onChange: (id: string) => void; label?: string }) {
  const kats = useKategorien();
  const [offen, setOffen] = useState(false);
  const [suche, setSuche] = useState("");
  const aktuell = kats.find((k) => k.id === wert);
  const haeufig = useMemo(() => [...kats].filter((k) => k.n > 0).sort((a, b) => b.n - a.n).slice(0, 6), [kats]);
  const vorschlaege = haeufig.length >= 3 ? haeufig : kats.filter((k) => ["Lebensmittel", "Haushaltsartikel", "Restaurant", "Drogerie", "Kleider und Schuhe", "Hobby"].includes(k.name));
  const gefiltert = kats.filter((k) => !suche || (k.name + " " + k.bereich).toLowerCase().includes(suche.toLowerCase()));
  const gruppen = [...new Set(gefiltert.map((k) => k.bereich))];
  return (
    <div className="grid gap-2" role="group" aria-label={label}>
      <div className="flex flex-wrap gap-1.5">
        {vorschlaege.map((k) => (
          <button type="button" key={k.id} aria-pressed={k.id === wert} onClick={() => onChange(k.id)}
            className={`chip !text-[13.5px] !py-1.5 !px-3 border ${k.id === wert ? "bg-[var(--accent)] text-[var(--on-accent)] border-transparent" : "bg-[var(--card)] border-[var(--rule-strong)]"}`}>{k.name}</button>
        ))}
        <button type="button" className="chip !text-[13.5px] !py-1.5 !px-3 border border-dashed border-[var(--rule-strong)] bg-transparent" onClick={() => setOffen(true)}>
          {aktuell && !vorschlaege.some((k) => k.id === aktuell.id) ? <b>{aktuell.name}</b> : "Alle Kategorien …"}
        </button>
      </div>
      <Sheet offen={offen} onClose={() => setOffen(false)} titel="Kategorie">
        <div className="grid gap-3">
          <input className="input" placeholder="Suchen …" value={suche} onChange={(e) => setSuche(e.target.value)} />
          <div className="grid gap-3 max-h-[60dvh] overflow-auto">
            {gruppen.map((g) => (
              <div key={g} className="grid gap-1.5">
                <p className="eyebrow px-1">{g}</p>
                <div className="flex flex-wrap gap-1.5">
                  {gefiltert.filter((k) => k.bereich === g).map((k) => (
                    <button type="button" key={k.id} onClick={() => { onChange(k.id); setOffen(false); setSuche(""); }}
                      className={`chip !text-[14px] !py-2 !px-3 border ${k.id === wert ? "bg-[var(--accent)] text-[var(--on-accent)] border-transparent" : "bg-[var(--card)] border-[var(--rule-strong)]"}`}>{k.name}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Sheet>
    </div>
  );
}

/** Topf wählen: Gemeinsam · Personen · Kinder */
export function TopfChips({ wert, onChange, erben, label = "Für wen" }: { wert: string | null; onChange: (id: string | null) => void; erben?: string; label?: string }) {
  const { konten, personen } = useHaushalt();
  const opts = topfOptionen(konten, personen);
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {erben && (
        <button type="button" aria-pressed={wert === null} onClick={() => onChange(null)}
          className={`chip !text-[13px] !py-1.5 !px-2.5 border ${wert === null ? "bg-[var(--ink)] text-[var(--paper)] border-transparent" : "bg-[var(--card)] border-[var(--rule-strong)]"}`}>wie Beleg ({erben})</button>
      )}
      {opts.map((o) => (
        <button type="button" key={o.id} aria-pressed={o.id === wert} onClick={() => onChange(o.id)}
          className={`chip k-${o.kind} !text-[13.5px] !py-1.5 !px-3 border ${o.id === wert ? "bg-[var(--k)] text-white border-transparent" : "bg-[var(--card)] border-[var(--rule-strong)] text-[var(--ink)]"}`}>
          <Icon name={o.owners.length > 1 && o.kind !== "kind" ? "leben" : o.kind === "kind" ? "kind" : "person"} size={14} strokeWidth={2.2} />{o.label}
        </button>
      ))}
    </div>
  );
}
