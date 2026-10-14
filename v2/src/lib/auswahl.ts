import type { Konto, Person } from "./data";

/** Töpfe, die beim Erfassen zur Wahl stehen: gemeinsame, persönliche (mit Personenname), Kinder */
export interface TopfOption { id: string; label: string; kind: string; owners: { person_id: string; share: number }[] }
export function topfOptionen(konten: Konto[], personen: Person[]): TopfOption[] {
  const offen = konten.filter((k) => k.status !== "closed");
  const out: TopfOption[] = [];
  for (const k of offen.filter((k) => k.owners.length > 1 && k.kind !== "kind")) out.push({ id: k.id, label: k.name, kind: k.kind, owners: k.owners });
  for (const p of personen.filter((p) => p.role === "adult" && !p.archived_at)) {
    const k = offen.find((x) => x.is_personal_default && x.owners.length === 1 && x.owners[0].person_id === p.id);
    if (k) out.push({ id: k.id, label: p.display_name, kind: k.kind, owners: k.owners });
  }
  for (const k of offen.filter((k) => k.kind === "kind")) out.push({ id: k.id, label: k.name, kind: k.kind, owners: k.owners });
  return out;
}

/** Persönlicher Topf einer Person */
export function persoenlich(konten: Konto[], personId: string | null | undefined): string | null {
  if (!personId) return null;
  return konten.find((k) => k.status !== "closed" && k.is_personal_default && k.owners.length === 1 && k.owners[0].person_id === personId)?.id ?? null;
}

/** Konten, von denen bezahlt werden kann: echte Konten (aktiv) */
export function zahlKonten(konten: Konto[]): Konto[] {
  return konten.filter((k) => k.status === "active").sort((a, b) => (a.owners.length > 1 ? -1 : 0) - (b.owners.length > 1 ? -1 : 0) || a.sort - b.sort);
}

/** Vorschau der Aufteilung (Rappengenauigkeit macht danach die Datenbank) */
export function vorschau(
  zeilen: { betrag: number; topf: string }[], zahlungen: { betrag: number; konto: string | null }[], konten: Konto[],
): Record<string, { anteil: number; bezahlt: number }> {
  const r: Record<string, { anteil: number; bezahlt: number }> = {};
  const add = (p: string, f: "anteil" | "bezahlt", v: number) => { (r[p] ??= { anteil: 0, bezahlt: 0 })[f] += v; };
  const owners = (id: string | null) => konten.find((k) => k.id === id)?.owners ?? [];
  for (const z of zeilen) for (const o of owners(z.topf)) add(o.person_id, "anteil", z.betrag * o.share);
  const gesamt = zeilen.reduce((s, z) => s + z.betrag, 0);
  for (const z of zahlungen) {
    if (z.konto) for (const o of owners(z.konto)) add(o.person_id, "bezahlt", z.betrag * o.share);
    else for (const [p, v] of Object.entries(r)) if (gesamt) add(p, "bezahlt", (z.betrag * v.anteil) / gesamt);
  }
  return r;
}

export const LADEN_FARBE: Record<string, string> = {
  migros: "#eb6834", migrolino: "#eb6834", coop: "#2a78d6", coop_pronto: "#2a78d6", lidl: "#1baf7a", denner: "#d39300", aldi: "#1f3d7a",
  volg: "#c73a3a", spar: "#2f8f4e", manor: "#b8467a", ikea: "#1f5fae", landi: "#3d7a2a",
};
