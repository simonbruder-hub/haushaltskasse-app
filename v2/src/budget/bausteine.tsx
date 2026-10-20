import type { ReactNode } from "react";
import { useQuery } from "../db/client";
import type { Konto } from "../lib/data";
import { useHaushalt } from "../lib/haushalt";
import { Avatar, farbe } from "../ui/kit";

/** Kleine Bausteine für die Budget-Seiten */

/** Balken von 0 bis 100 % (Anteil 0..1; darüber voll und rot) */
export function Fortschritt({ anteil, art = "gut", label }: { anteil: number; art?: "gut" | "warn" | "schlecht"; label?: string }) {
  const p = Math.max(0, Math.min(1, Number.isFinite(anteil) ? anteil : 0));
  const farbeVar = art === "schlecht" ? "var(--crit)" : art === "warn" ? "var(--gold)" : "var(--accent)";
  return (
    <div className="split" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)}>
      <span className="block h-full rounded-[6px]" style={{ width: `${p * 100}%`, background: farbeVar }} />
    </div>
  );
}

/** Konto oder Topf aus einer Liste wählen; «leer» ergänzt eine Option ohne Wert (z. B. «von aussen») */
export function KontoSelect({ wert, onChange, label, leer, nur }: { wert: string | null; onChange: (id: string | null) => void; label: string; leer?: string; nur?: (k: Konto) => boolean }) {
  const { konten } = useHaushalt();
  const liste = konten.filter((k) => k.status !== "closed" && (!nur || nur(k)));
  return (
    <select className="input" aria-label={label} value={wert ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      {leer !== undefined && <option value="">{leer}</option>}
      {leer === undefined && !wert && <option value="">Bitte wählen …</option>}
      {liste.map((k) => <option key={k.id} value={k.id}>{k.name}{k.status === "virtual" ? " (Topf)" : ""}</option>)}
    </select>
  );
}

/** Erwachsene als Chips (für Budgets «pro Person») */
export function PersonWahl({ wert, onChange, label = "Person" }: { wert: string | null; onChange: (id: string) => void; label?: string }) {
  const { personen } = useHaushalt();
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {personen.filter((p) => p.role === "adult" && !p.archived_at).map((p) => (
        <button type="button" key={p.id} aria-pressed={p.id === wert} onClick={() => onChange(p.id)}
          className={`chip !text-[13.5px] !py-1.5 !px-3 border ${p.id === wert ? "bg-[var(--ink)] text-[var(--paper)] border-transparent" : "bg-[var(--card)] border-[var(--rule-strong)]"}`}>
          <Avatar name={p.display_name} color={farbe(p)} size={18} />{p.display_name}
        </button>
      ))}
    </div>
  );
}

/** Lebensbereiche des Haushalts */
export function useBereiche() {
  const { household } = useHaushalt();
  return useQuery<{ id: string; name: string }>(`select id, name from life_area where household_id = $1 and archived_at is null order by sort, name`, [household]) ?? [];
}

export function Haken({ label, wert, onChange, hinweis }: { label: string; wert: boolean; onChange: (b: boolean) => void; hinweis?: ReactNode }) {
  return (
    <label className="flex items-start gap-2.5 text-[14.5px]">
      <input type="checkbox" className="size-5 mt-0.5 accent-[var(--accent)]" checked={wert} onChange={(e) => onChange(e.target.checked)} />
      <span className="grid"><span>{label}</span>{hinweis && <small className="text-muted text-[12.5px]">{hinweis}</small>}</span>
    </label>
  );
}

/** Statusfarbe zum Tempo eines Budgets */
export const TEMPO: Record<string, [string, "gut" | "warn" | "schlecht", string]> = {
  on_track: ["Auf Kurs", "gut", "chip-ok"],
  warning: ["Knapp", "warn", "chip-warn"],
  over: ["Über Budget", "schlecht", "chip-crit"],
};
