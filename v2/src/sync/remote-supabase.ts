import type { SupabaseClient } from "@supabase/supabase-js";
import type { Row } from "../db/types";
import type { Remote, Tombstone } from "./types";

/** Abgleich über die Supabase-REST-Schnittstelle (PostgREST). Row Level Security schützt jeden Haushalt. */
export class SupabaseRemote implements Remote {
  constructor(private client: SupabaseClient) {}

  async upsert(table: string, pk: string, rows: Row[]) {
    const { error } = await this.client.from(table).upsert(rows, { onConflict: pk });
    if (error) throw new Error(`${table}: ${error.message}`);
  }

  async remove(table: string, pk: string, ids: string[]) {
    const { error } = await this.client.from(table).delete().in(pk, ids);
    if (error) throw new Error(`${table}: ${error.message}`);
  }

  async pull(table: string, pk: string, after: { ts: string; id: string } | null, limit: number) {
    let q = this.client.from(table).select("*").order("updated_at", { ascending: true }).order(pk, { ascending: true }).limit(limit);
    if (after) {
      const ts = after.ts.replace("+00:00", "Z");
      q = q.or(`updated_at.gt.${ts},and(updated_at.eq.${ts},${pk}.gt.${after.id})`);
    }
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data ?? []) as Row[];
  }

  async tombstones(afterId: number, limit: number) {
    const { data, error } = await this.client.from("sync_tombstone").select("id,table_name,row_id").gt("id", afterId).order("id").limit(limit);
    if (error) throw new Error(`sync_tombstone: ${error.message}`);
    return (data ?? []) as Tombstone[];
  }

  async rpc<T>(fn: string, args: Record<string, unknown>) {
    const { data, error } = await this.client.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data as T;
  }
}
