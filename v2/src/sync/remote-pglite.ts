import type { Db, Row } from "../db/types";
import type { Remote, Tombstone } from "./types";

/**
 * Test-Gegenstelle: ein Server-PGlite mit server.sql. Jeder Aufruf läuft wie bei PostgREST als Rolle
 * «authenticated» mit der Benutzer-ID im JWT – Row Level Security greift also genau wie bei Supabase.
 */
export class PGliteRemote implements Remote {
  constructor(private server: Db, private userId: string) {}

  private as<T>(fn: (q: Db) => Promise<T>): Promise<T> {
    return this.server.transaction(async (tx) => {
      await tx.exec(`set local role authenticated`);
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [this.userId]);
      return fn(tx as Db);
    });
  }

  private async cols(table: string): Promise<string[]> {
    const { rows } = await this.server.query<{ c: string }>(
      `select column_name as c from information_schema.columns where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER' order by ordinal_position`, [table]);
    return rows.map((r) => r.c);
  }

  async upsert(table: string, pk: string, rows: Row[]) {
    const cols = await this.cols(table);
    const list = cols.map((c) => `"${c}"`).join(", ");
    const upd = cols.filter((c) => c !== pk).map((c) => `"${c}" = excluded."${c}"`).join(", ");
    await this.as((q) => q.query(
      `insert into "${table}" (${list}) select ${list} from jsonb_populate_recordset(null::"${table}", $1::jsonb)
       on conflict ("${pk}") do update set ${upd}`, [JSON.stringify(rows)]));
  }

  async remove(table: string, pk: string, ids: string[]) {
    await this.as((q) => q.query(`delete from "${table}" where "${pk}" = any($1::uuid[])`, [ids]));
  }

  async pull(table: string, pk: string, after: { ts: string; id: string } | null, limit: number) {
    return this.as(async (q) => {
      const { rows } = await q.query<{ r: Row }>(
        `select to_jsonb(t) as r from "${table}" t
          where $1::timestamptz is null or (t.updated_at, t."${pk}") > ($1::timestamptz, $2::uuid)
          order by t.updated_at, t."${pk}" limit $3`, [after?.ts ?? null, after?.id ?? null, limit]);
      return rows.map((r) => r.r);
    });
  }

  async tombstones(afterId: number, limit: number) {
    return this.as(async (q) => (await q.query<Tombstone>(
      `select id::int, table_name, row_id::text from sync_tombstone where id > $1 order by id limit $2`, [afterId, limit])).rows);
  }

  async rpc<T>(fn: string, args: Record<string, unknown>) {
    const names = Object.keys(args);
    return this.as(async (q) => {
      const { rows } = await q.query<{ r: T }>(
        `select "${fn}"(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`, names.map((n) => args[n]));
      return rows[0].r;
    });
  }
}
