import type { Db, Queryable, Row } from "../db/types";
import type { Remote } from "./types";

/**
 * Abgleich zwischen der lokalen Datenbank (PGlite) und dem Server.
 *
 * Push: Jede lokale Änderung steht in _outbox (Trigger). Upserts gehen in Tabellen-Reihenfolge an den Server,
 *       Löschungen in umgekehrter Reihenfolge. Erfolgreich gesendete Einträge verschwinden aus der Outbox.
 * Pull: Pro Tabelle alle Zeilen mit updated_at > Cursor (Server-Zeit, mit Überlappung), dann das Löschprotokoll.
 *       Übernommen wird mit session_replication_role = replica: keine Trigger, keine Outbox-Einträge,
 *       keine Probleme mit der Reihenfolge von Fremdschlüsseln.
 * Konflikte: Die letzte Änderung gewinnt. Lokale, noch nicht gesendete Änderungen werden nie überschrieben.
 */

export interface SyncTable { ord: number; name: string; pk: string }
export interface SyncResult { pushed: number; pulled: number; deleted: number; error?: string }

const BATCH = 200;
const OVERLAP_MS = 30 * 1000;   // Überlappung gegen Transaktionen, die mit älterem Zeitstempel später sichtbar werden

export class SyncEngine {
  private tables: SyncTable[] = [];
  private columns = new Map<string, string[]>();
  private running: Promise<SyncResult> | null = null;
  private serverGeprueft = false;

  constructor(private db: Db, private remote: Remote) {}

  private async init() {
    if (this.tables.length) return;
    this.tables = (await this.db.query<SyncTable>(`select ord, name, pk from sync_tables() order by ord`)).rows;
    for (const t of this.tables) {
      const { rows } = await this.db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER' order by ordinal_position`, [t.name]);
      this.columns.set(t.name, rows.map((r) => r.column_name));
    }
  }

  /** Mehrfachaufrufe teilen sich denselben Lauf. */
  sync(): Promise<SyncResult> {
    if (!this.running) this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }

  async pending(): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(`select count(*)::int as n from _outbox`);
    return rows[0].n;
  }

  private async run(): Promise<SyncResult> {
    await this.init();
    const result: SyncResult = { pushed: 0, pulled: 0, deleted: 0 };
    try {
      await this.pruefeServer();
      result.pushed = await this.push();
      const p = await this.pull();
      result.pulled = p.pulled;
      result.deleted = p.deleted;
      await this.setState("last_sync", new Date().toISOString());
      await this.setState("last_error", "");
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e);
      await this.setState("last_error", result.error);
    }
    return result;
  }

  /** Der Server muss mindestens den Datenbank-Stand dieses Handys haben, sonst fehlen dort neue Spalten. */
  private async pruefeServer() {
    if (this.serverGeprueft) return;
    const lokal = (await this.db.query<{ v: number }>(`select coalesce(max(version), 0)::int as v from _schema_version`)).rows[0].v;
    let server = 1;   // M1 kannte die Funktion noch nicht
    try {
      server = Number(await this.remote.rpc<number>("app_schema_version", {}));
    } catch (e) {
      if (!/app_schema_version/i.test(e instanceof Error ? e.message : String(e))) throw e;   // z. B. kein Netz
    }
    if (server < lokal) throw new Error(`SERVER_VERALTET: Server auf Stand ${server}, App auf Stand ${lokal}`);
    this.serverGeprueft = true;
  }

  // ---------- Push ----------
  private async push(): Promise<number> {
    const { rows: entries } = await this.db.query<{ table_name: string; row_id: string; op: string; seq: number }>(
      `select table_name, row_id::text, op, seq::int from _outbox order by seq`);
    if (!entries.length) return 0;
    let count = 0;
    const ordered = [...this.tables];
    // Upserts: Eltern vor Kindern
    for (const t of ordered) {
      const mine = entries.filter((e) => e.table_name === t.name && e.op === "upsert");
      for (let i = 0; i < mine.length; i += BATCH) {
        const part = mine.slice(i, i + BATCH);
        const rows = await this.readRows(this.db, t, part.map((e) => e.row_id));
        if (rows.length) await this.remote.upsert(t.name, t.pk, rows);
        await this.clearOutbox(t.name, part);
        count += part.length;
      }
    }
    // Löschungen: Kinder vor Eltern
    for (const t of [...ordered].reverse()) {
      const mine = entries.filter((e) => e.table_name === t.name && e.op === "delete");
      for (let i = 0; i < mine.length; i += BATCH) {
        const part = mine.slice(i, i + BATCH);
        await this.remote.remove(t.name, t.pk, part.map((e) => e.row_id));
        await this.clearOutbox(t.name, part);
        count += part.length;
      }
    }
    return count;
  }

  private async readRows(q: Queryable, t: SyncTable, ids: string[]): Promise<Row[]> {
    const cols = this.columns.get(t.name)!;
    const { rows } = await q.query<{ r: Row }>(
      `select to_jsonb(x) as r from ${ident(t.name)} x where ${ident(t.pk)} = any($1::uuid[])`, [ids]);
    return rows.map(({ r }) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
  }

  private async clearOutbox(table: string, part: { row_id: string; seq: number }[]) {
    // Nur löschen, wenn seit dem Lesen nichts mehr geändert wurde (seq gleich)
    await this.db.query(
      `delete from _outbox o using unnest($2::uuid[], $3::bigint[]) as s(row_id, seq)
        where o.table_name = $1 and o.row_id = s.row_id and o.seq = s.seq`,
      [table, part.map((p) => p.row_id), part.map((p) => p.seq)]);
  }

  // ---------- Pull ----------
  private async pull(): Promise<{ pulled: number; deleted: number }> {
    let pulled = 0;
    const changed: Record<string, string[]> = {};
    const merke = (table: string, ids: string[]) => { if (ids.length) (changed[table] ??= []).push(...ids); };
    for (const t of this.tables) {
      const cursorRaw = await this.getState(`cursor:${t.name}`);
      let after: { ts: string; id: string } | null = cursorRaw
        ? { ts: new Date(Date.parse(cursorRaw) - OVERLAP_MS).toISOString(), id: "00000000-0000-0000-0000-000000000000" }
        : null;
      let newest = cursorRaw;
      for (;;) {
        const rows = await this.remote.pull(t.name, t.pk, after, BATCH);
        if (!rows.length) break;
        const ids = await this.apply(t, rows);
        pulled += ids.length;
        merke(t.name, ids);
        const last = rows[rows.length - 1];
        after = { ts: String(last.updated_at), id: String(last[t.pk]) };
        if (!newest || Date.parse(after.ts) > Date.parse(newest)) newest = after.ts;
        if (rows.length < BATCH) break;
      }
      if (newest && newest !== cursorRaw) await this.setState(`cursor:${t.name}`, newest);
    }
    // Löschprotokoll
    let deleted = 0;
    let afterId = Number((await this.getState("cursor:tombstone")) ?? 0);
    for (;;) {
      const stones = await this.remote.tombstones(afterId, BATCH);
      if (!stones.length) break;
      deleted += await this.db.transaction(async (tx) => {
        await tx.exec(`set local session_replication_role = replica`);
        let n = 0;
        for (const s of stones) {
          const t = this.tables.find((x) => x.name === s.table_name);
          if (!t) continue;
          const pending = await tx.query(`select 1 from _outbox where table_name = $1 and row_id = $2 and op = 'upsert'`, [t.name, s.row_id]);
          if (pending.rows.length) continue;
          const r = await tx.query(`delete from ${ident(t.name)} where ${ident(t.pk)} = $1 returning 1`, [s.row_id]);
          n += r.rows.length;
          if (r.rows.length) merke(t.name, [s.row_id]);
        }
        return n;
      });
      afterId = stones[stones.length - 1].id;
      await this.setState("cursor:tombstone", String(afterId));
      if (stones.length < BATCH) break;
    }
    // Abgeleitete Daten (Anteile, Preise) der betroffenen Belege lokal neu rechnen
    if (Object.keys(changed).length && (await this.hatNachbearbeitung())) {
      await this.db.query(`select sync_after_pull($1::jsonb)`, [JSON.stringify(changed)]);
    }
    return { pulled, deleted };
  }

  private nachbearbeitung: boolean | null = null;
  private async hatNachbearbeitung(): Promise<boolean> {
    if (this.nachbearbeitung === null) {
      const { rows } = await this.db.query<{ f: string | null }>(`select to_regprocedure('sync_after_pull(jsonb)')::text as f`);
      this.nachbearbeitung = !!rows[0]?.f;
    }
    return this.nachbearbeitung;
  }

  /** Übernimmt Serverzeilen; liefert die IDs der Zeilen, die sich lokal wirklich geändert haben. */
  private async apply(t: SyncTable, rows: Row[]): Promise<string[]> {
    const cols = this.columns.get(t.name)!;
    const list = cols.map(ident).join(", ");
    const rest = cols.filter((c) => c !== t.pk);
    const updates = rest.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(", ");
    const anders = `(${rest.map((c) => `t.${ident(c)}`).join(", ")}) is distinct from (${rest.map((c) => `excluded.${ident(c)}`).join(", ")})`;
    const clean = rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
    return this.db.transaction(async (tx) => {
      await tx.exec(`set local session_replication_role = replica`);
      const { rows: res } = await tx.query(
        `insert into ${ident(t.name)} as t (${list})
         select ${list} from jsonb_populate_recordset(null::${ident(t.name)}, $1::jsonb) x
          where not exists (select 1 from _outbox o where o.table_name = $2 and o.row_id = x.${ident(t.pk)})
         on conflict (${ident(t.pk)}) do update set ${updates} where ${anders}
         returning ${ident(t.pk)}::text as id`, [JSON.stringify(clean), t.name]);
      return (res as { id: string }[]).map((r) => r.id);
    });
  }

  // ---------- Zustand ----------
  async getState(key: string): Promise<string | null> {
    const { rows } = await this.db.query<{ value: string }>(`select value from _sync_state where key = $1`, [key]);
    return rows[0]?.value ?? null;
  }
  async setState(key: string, value: string) {
    await this.db.query(`insert into _sync_state (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value`, [key, value]);
  }
}

function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Ungültiger Name: ${name}`);
  return `"${name}"`;
}
