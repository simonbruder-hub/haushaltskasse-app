import schema from "../../db/schema.sql?raw";
import stammdaten from "../../db/stammdaten.sql?raw";
import client from "../../db/client.sql?raw";
import m2 from "../../db/m2.sql?raw";
import clientM2 from "../../db/client_m2.sql?raw";
import m3 from "../../db/m3.sql?raw";
import clientM3 from "../../db/client_m3.sql?raw";
import m4 from "../../db/m4.sql?raw";
import clientM4 from "../../db/client_m4.sql?raw";
import type { Db } from "./types";

/** Datenbank im Browser. Jede Version läuft genau einmal, in einer Transaktion. */
export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  { version: 1, name: "M1 Fundament", sql: [schema, stammdaten, client].join("\n") },
  { version: 2, name: "M2 Belege und Ausgleich", sql: [m2, clientM2].join("\n") },
  { version: 3, name: "M3 Beleg-Scanner", sql: [m3, clientM3].join("\n") },
  { version: 4, name: "M4 Produkte und Preise", sql: [m4, clientM4].join("\n") },
];

export async function schemaVersion(db: Db): Promise<number> {
  const { rows } = await db.query<{ t: string | null }>(`select to_regclass('_schema_version')::text as t`);
  if (!rows[0]?.t) return 0;
  const v = await db.query<{ v: number | null }>(`select max(version) as v from _schema_version`);
  return v.rows[0]?.v ?? 0;
}

export async function migrate(db: Db): Promise<number> {
  let current = await schemaVersion(db);
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.query(`insert into _schema_version (version) values ($1)`, [m.version]);
    });
    current = m.version;
  }
  return current;
}
