import type { Konto, Person } from "./data";

export const istGemeinsam = (k: Konto) => k.owners.length > 1;
/** Töpfe nach Zugehörigkeit gruppieren: Gemeinsam · je Person · Kinder */
export function gruppieren(konten: Konto[], personen: Person[]) {
  const offen = konten.filter((k) => k.status !== "closed");
  const kinder = offen.filter((k) => k.kind === "kind");
  const gemeinsam = offen.filter((k) => k.kind !== "kind" && istGemeinsam(k));
  const proPerson = personen.filter((p) => p.role === "adult" && !p.archived_at).map((p) => ({
    person: p,
    konten: offen.filter((k) => k.kind !== "kind" && !istGemeinsam(k) && k.owners[0]?.person_id === p.id),
  }));
  const geschlossen = konten.filter((k) => k.status === "closed");
  return { gemeinsam, proPerson, kinder, geschlossen };
}
export function besitzText(k: Konto, personen: Person[]): string {
  if (k.kind === "kind") {
    const kind = personen.find((p) => p.id === k.beneficiary_person_id);
    return `für ${kind?.display_name ?? "ein Kind"} · Eltern je 50 %`;
  }
  if (k.owners.length > 1) return k.owners.map((o) => `${o.name} ${Math.round(o.share * 100)} %`).join(" · ");
  return k.owners[0] ? `gehört ${k.owners[0].name}` : "ohne Eigentümer";
}
