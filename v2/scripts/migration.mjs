// Baut die Supabase-Migration aus den gemeinsamen SQL-Dateien: schema + stammdaten + server.
// Aufruf: npm run migration  → supabase/migrations/20261014000000_m1_fundament.sql
import { readFileSync, writeFileSync } from "node:fs";
const lies = (f) => readFileSync(new URL(`../db/${f}`, import.meta.url), "utf8");
const kopf = `-- Haushalt · Supabase-Migration M1 (Fundament)
-- Erzeugt aus db/schema.sql, db/stammdaten.sql und db/server.sql – nicht von Hand ändern.
-- Einspielen: Supabase → SQL Editor → diesen Inhalt einfügen → Run (oder: supabase db push)
`;
const sql = [kopf, lies("schema.sql"), lies("stammdaten.sql"), lies("server.sql")].join("\n\n");
const ziel = new URL("../supabase/migrations/20261014000000_m1_fundament.sql", import.meta.url);
writeFileSync(ziel, sql);
console.log(`${ziel.pathname} (${Math.round(sql.length / 1024)} KB)`);
