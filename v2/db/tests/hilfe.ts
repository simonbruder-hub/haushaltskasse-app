import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { migrate } from "../../src/db/migrations";
import type { Db } from "../../src/db/types";

const lies = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

/** Server wie Supabase: auth-Schema mit auth.uid(), Rolle «authenticated», schema + stammdaten + server.sql.
 *  nurM1: Server auf dem Stand von M1 (für den Fall, dass die neue Migration noch nicht eingespielt ist). */
export async function server(opt: { nurM1?: boolean } = {}): Promise<Db> {
  const db = new PGlite();
  await db.exec(`
    create role authenticated nologin; create role anon nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  await db.exec(lies("schema.sql"));
  await db.exec(lies("stammdaten.sql"));
  await db.exec(`grant usage on schema public to authenticated;
    grant all on all tables in schema public to authenticated;
    grant all on all sequences in schema public to authenticated;`);
  await db.exec(lies("server.sql"));
  // Spätere Module in derselben Reihenfolge wie die Supabase-Migrationen
  if (!opt.nurM1) {
    await db.exec(lies("m2.sql"));
    await db.exec(lies("server_m2.sql"));
    await db.exec(lies("m3.sql"));
    await db.exec(lies("server_m3.sql"));
    await db.exec(lies("m4.sql"));
    await db.exec(lies("server_m4.sql"));
    await db.exec(lies("m5.sql"));
    await db.exec(lies("server_m5.sql"));
  }
  await db.exec(`grant all on all tables in schema public to authenticated;
    grant all on all sequences in schema public to authenticated;`);
  return db as unknown as Db;
}

/** Handy: frische PGlite mit allen Migrationen. */
export async function handy(): Promise<Db> {
  const db = new PGlite() as unknown as Db;
  await migrate(db);
  return db;
}

/** Inhalt aller synchronisierten Tabellen, vergleichbar zwischen Geräten. */
export async function abbild(db: Db, household: string): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  const { rows: tabs } = await db.query<{ name: string; pk: string }>(`select name, pk from sync_tables() order by ord`);
  for (const t of tabs) {
    const col = t.name === "household" ? "id" : "household_id";
    const { rows } = await db.query<{ r: Record<string, unknown> }>(
      `select to_jsonb(x) - 'updated_at' - 'created_at' - 'created_by' as r from "${t.name}" x where "${col}" = $1 order by "${t.pk}"`, [household]);
    out[t.name] = rows.map((r) => r.r);
  }
  return out;
}
