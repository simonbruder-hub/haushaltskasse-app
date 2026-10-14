import type { Row } from "../db/types";

export interface Tombstone { id: number; table_name: string; row_id: string }

/** Gegenstelle der Synchronisation: Supabase (PostgREST) oder im Test ein Server-PGlite. */
export interface Remote {
  /** Zeilen einfügen oder überschreiben (ganze Zeilen, ohne generierte Spalten). */
  upsert(table: string, pk: string, rows: Row[]): Promise<void>;
  remove(table: string, pk: string, ids: string[]): Promise<void>;
  /** Geänderte Zeilen ab (updated_at, pk) > after, aufsteigend sortiert. */
  pull(table: string, pk: string, after: { ts: string; id: string } | null, limit: number): Promise<Row[]>;
  tombstones(afterId: number, limit: number): Promise<Tombstone[]>;
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T>;
}
