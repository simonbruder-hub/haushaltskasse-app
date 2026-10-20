import { useState } from "react";
import { useQuery } from "../db/client";
import { geld, heute, monatName } from "../lib/format";
import { useHaushalt } from "../lib/haushalt";
import { Avatar, farbe } from "../ui/kit";
import { Icon } from "../ui/Icon";
import { Fortschritt } from "./bausteine";

/** 50/30/20 pro Person: Bedarf, Wünsche, Sparen gegen das Einkommen (Blueprint §2.6, gerechnet mit My Share) */
interface Zeile { id: string; display_name: string; sort: number; color: string | null; income: string; needs: string; wants: string; saved_to_accounts: string; unallocated: string; needs_pct: string | null; wants_pct: string | null; savings_pct: string | null }

const monatVerschieben = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

export function Analyse() {
  const { household } = useHaushalt();
  const [monat, setMonat] = useState(heute().slice(0, 7));
  const zeilen = useQuery<Zeile>(
    `select p.id, p.display_name, p.sort, p.color, a.income::text, a.needs::text, a.wants::text, a.saved_to_accounts::text, a.unallocated::text,
            a.needs_pct::text, a.wants_pct::text, a.savings_pct::text
       from person p cross join lateral analysis_50_30_20(p.id, ($2 || '-01')::date) a
      where p.household_id = $1 and p.role = 'adult' and p.archived_at is null order by p.sort`, [household, monat]);
  return (
    <div className="grid gap-4">
      <p className="text-ink-2 text-[14px] -mt-1">Die Faustregel: höchstens 50 % fürs Nötige, 30 % für Wünsche, mindestens 20 % sparen. Gerechnet mit dem, was jede Person wirklich trägt.</p>
      <div className="flex items-center justify-between gap-2">
        <button className="icon-btn" aria-label="Vorheriger Monat" onClick={() => setMonat(monatVerschieben(monat, -1))}><Icon name="links" size={22} /></button>
        <b className="text-[16px]" aria-live="polite">{monatName(monat)}</b>
        <button className="icon-btn" aria-label="Nächster Monat" disabled={monat >= heute().slice(0, 7)} onClick={() => setMonat(monatVerschieben(monat, 1))}><Icon name="rechts" size={22} /></button>
      </div>
      {(zeilen ?? []).map((p) => {
        const einkommen = Number(p.income), bedarf = Number(p.needs), wunsch = Number(p.wants), gespart = Number(p.saved_to_accounts);
        const pct = (x: number) => (einkommen > 0 ? x / einkommen : 0);
        const zeilenAnzeige: [string, number, number, string, "gut" | "warn" | "schlecht"][] = [
          ["Bedarf", bedarf, 0.5, "höchstens 50 %", pct(bedarf) > 0.5 ? "schlecht" : "gut"],
          ["Wünsche", wunsch, 0.3, "höchstens 30 %", pct(wunsch) > 0.3 ? "schlecht" : "gut"],
          ["Gespart", gespart, 0.2, "mindestens 20 %", pct(gespart) >= 0.2 ? "gut" : "warn"],
        ];
        return (
          <section key={p.id} className="card p-4 grid gap-3.5" aria-label={`50/30/20 ${p.display_name}`}>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2.5"><Avatar name={p.display_name} color={farbe(p)} size={34} /><b className="text-[17px]">{p.display_name}</b></span>
              <span className="grid justify-items-end"><span className="text-muted text-[12px]">Einkommen</span><span className="num text-[18px]" data-testid={`einkommen-${p.display_name}`}>{einkommen ? geld(einkommen) : "–"}</span></span>
            </div>
            {einkommen > 0 ? (
              <>
                {zeilenAnzeige.map(([name, betrag, ziel, text, art]) => (
                  <div key={name} className="grid gap-1.5">
                    <div className="flex items-baseline justify-between gap-2"><span className="font-semibold text-[14.5px]">{name}</span>
                      <span className="text-[13.5px]"><b className="num">{geld(betrag)}</b> <span className="text-muted">· {(pct(betrag) * 100).toLocaleString("de-CH", { maximumFractionDigits: 1 })} % ({text})</span></span></div>
                    <Fortschritt anteil={pct(betrag) / ziel} art={art} label={`${name} ${p.display_name}`} />
                  </div>
                ))}
                <div className="flex items-baseline justify-between text-[14px] pt-1 border-t border-[var(--rule)]"><span className="text-ink-2">Nicht verplant</span><b className="num">{geld(p.unallocated)}</b></div>
              </>
            ) : <p className="text-[13.5px] text-ink-2">Für {p.display_name} ist kein Nettolohn erfasst. <a href="#/personen" className="text-accent-ink font-semibold">Lohn eintragen</a></p>}
          </section>
        );
      })}
      <p className="text-muted text-[12.5px] px-1">«Gespart» zählt Überweisungen auf eigene Sparkonten (Dauerauftrag oder einmalig). Fixkosten zählen beim Bedarf, sobald sie als Beleg gebucht sind.</p>
    </div>
  );
}
