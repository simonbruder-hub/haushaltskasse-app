import { go } from "../lib/router";
import { Analyse } from "../budget/Analyse";
import { Budgets } from "../budget/Budgets";
import { Dauerauftraege } from "../budget/Dauerauftraege";
import { Fixkosten } from "../budget/Fixkosten";
import { Sparziele } from "../budget/Sparziele";
import { Seg, Seite } from "../ui/kit";

/** Budget und Planung (M5): Budgets · Fixkosten und Verträge · Sparziele · Daueraufträge · 50/30/20 */
const REITER = [["", "Budgets"], ["fixkosten", "Fixkosten"], ["sparziele", "Sparziele"], ["dauerauftraege", "Daueraufträge"], ["analyse", "50/30/20"]] as const;
type Reiter = (typeof REITER)[number][0];

export function Budget({ reiter = "" }: { reiter?: string }) {
  const aktuell: Reiter = REITER.some(([k]) => k === reiter) ? (reiter as Reiter) : "";
  return (
    <Seite eyebrow="Mehr" titel="Budget und Planung" zurueck="mehr">
      <Seg label="Bereich" wert={aktuell} onChange={(k) => go(k ? `budget/${k}` : "budget")} optionen={REITER.map(([k, t]) => [k, t] as [Reiter, string])} />
      {aktuell === "" && <Budgets />}
      {aktuell === "fixkosten" && <Fixkosten />}
      {aktuell === "sparziele" && <Sparziele />}
      {aktuell === "dauerauftraege" && <Dauerauftraege />}
      {aktuell === "analyse" && <Analyse />}
    </Seite>
  );
}
