// Baut die Supabase-Migration aus den gemeinsamen SQL-Dateien: schema + stammdaten + server.
// Aufruf: npm run migration  → supabase/migrations/20261014000000_m1_fundament.sql
import { readFileSync, writeFileSync } from "node:fs";
const lies = (f) => readFileSync(new URL(`../db/${f}`, import.meta.url), "utf8");
const kopf = `-- Haushalt · Supabase-Migration M1 (Fundament)
-- Erzeugt aus db/schema.sql, db/stammdaten.sql und db/server.sql – nicht von Hand ändern.
-- Einspielen: Supabase → SQL Editor → diesen Inhalt einfügen → Run (oder: supabase db push)
`;
const dateien = [
  ["20261014000000_m1_fundament.sql", "M1 (Fundament)", ["schema.sql", "stammdaten.sql", "server.sql"]],
  ["20261015000000_m2_belege.sql", "M2 (Belege und Ausgleich)", ["m2.sql", "server_m2.sql"]],
  ["20261016000000_m3_scanner.sql", "M3 (Beleg-Scanner)", ["m3.sql", "server_m3.sql"]],
  ["20261017000000_m4_produkte.sql", "M4 (Produkte und Preise)", ["m4.sql", "server_m4.sql"]],
  ["20261018000000_m5_budget.sql", "M5 (Budget und Konten)", ["m5.sql", "server_m5.sql"]],
];
for (const [name, titel, teile] of dateien) {
  const sql = [kopf.replace("M1 (Fundament)", titel).replace("db/schema.sql, db/stammdaten.sql und db/server.sql", teile.map((t) => "db/" + t).join(", ")), ...teile.map(lies)].join("\n\n");
  const ziel = new URL(`../supabase/migrations/${name}`, import.meta.url);
  writeFileSync(ziel, sql);
  console.log(`${ziel.pathname} (${Math.round(sql.length / 1024)} KB)`);
}
