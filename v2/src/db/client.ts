import { PGliteWorker } from "@electric-sql/pglite/worker";
import { live, type PGliteWithLive } from "@electric-sql/pglite/live";
import { useEffect, useRef, useState } from "react";
import type { Db } from "./types";

type LiveDb = PGliteWorker & PGliteWithLive;
let instance: Promise<LiveDb> | null = null;

export function openDb(): Promise<LiveDb> {
  if (!instance) {
    instance = PGliteWorker.create(new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }), {
      extensions: { live },
    }) as Promise<LiveDb>;
  }
  return instance;
}
export const db = async (): Promise<Db> => (await openDb()) as unknown as Db;

// Nach einem Abgleich (Übernahme ohne Trigger) alle Live-Abfragen neu laden
const active = new Set<() => Promise<void>>();
export async function refreshAll() { await Promise.all([...active].map((r) => r().catch(() => undefined))); }

/** Live-Abfrage: aktualisiert sich selbst, sobald sich die Daten ändern. null = lädt noch. */
export function useQuery<T>(sql: string, params: unknown[] = []): T[] | null {
  const [rows, setRows] = useState<T[] | null>(null);
  const key = sql + "\u0000" + JSON.stringify(params);
  const keyRef = useRef(key);
  keyRef.current = key;
  useEffect(() => {
    let alive = true;
    let stop: (() => Promise<void>) | undefined;
    let refresh: (() => Promise<void>) | undefined;
    openDb().then(async (d) => {
      const q = await d.live.query<T>(sql, params as unknown[], (res) => { if (alive) setRows(res.rows); });
      if (!alive) { await q.unsubscribe(); return; }
      setRows(q.initialResults.rows);
      stop = q.unsubscribe;
      refresh = () => q.refresh();
      active.add(refresh);
    }).catch((e) => { console.error(e); if (alive) setRows([]); });
    return () => { alive = false; if (refresh) active.delete(refresh); stop?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return rows;
}

export function useOne<T>(sql: string, params: unknown[] = []): T | null | undefined {
  const rows = useQuery<T>(sql, params);
  return rows === null ? undefined : rows[0] ?? null;
}
