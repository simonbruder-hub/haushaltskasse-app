/** Supabase-Migration pro Datenbank-Stand (scripts/migration.mjs) */
const SERVER_MIGRATIONEN: Record<number, string> = {
  2: "20261015000000_m2_belege.sql", 3: "20261016000000_m3_scanner.sql", 4: "20261017000000_m4_produkte.sql", 5: "20261018000000_m5_budget.sql",
};

/** Meldungen des Servers verständlich machen. Typischer Fall nach einem App-Update: die Datenbank auf Supabase
 *  hat die neuen Spalten noch nicht, weil die neueste Migration noch nicht ausgeführt wurde. */
export function abgleichFehler(m: string | null | undefined): string | null {
  if (!m) return null;
  if (/SERVER_VERALTET/.test(m)) {
    const [, server, app] = m.match(/Stand (\d+), App auf Stand (\d+)/) ?? [];
    const fehlen = Object.entries(SERVER_MIGRATIONEN).filter(([v]) => Number(v) > Number(server) && Number(v) <= Number(app)).map(([, f]) => f);
    const liste = fehlen.length > 1 ? `${fehlen.slice(0, -1).join(", ")} und ${fehlen[fehlen.length - 1]}` : fehlen[0];
    return liste
      ? `Die App ist neuer als die Datenbank auf Supabase. Bitte in Supabase im SQL-Editor ${fehlen.length > 1 ? "nacheinander" : "die Datei"} ${liste} aus «v2/supabase/migrations» ausführen. Bis dahin bleibt alles auf diesem Handy gespeichert.`
      : "Die App ist neuer als die Datenbank auf Supabase. Bitte in Supabase im SQL-Editor die neueste Datei aus «v2/supabase/migrations» ausführen (siehe Anleitung). Bis dahin bleibt alles auf diesem Handy gespeichert.";
  }
  if (/schema cache|does not exist|PGRST20[45]|42703|42P01/i.test(m)) {
    return `Der Server ist noch nicht auf dem neuesten Stand: In Supabase im SQL-Editor die neueste Datei aus «v2/supabase/migrations» ausführen (siehe Anleitung). Meldung: ${m.slice(0, 120)}`;
  }
  return m;
}
