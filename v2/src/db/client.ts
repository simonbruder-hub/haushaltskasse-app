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

// ---------- Datenstand ----------
// Jede lokale Änderung an einer synchronisierten Tabelle schreibt in _outbox (mit neuer seq); nach jedem Abgleich ruft
// sync.ts refreshAll() auf. Auf dieses eine Signal hören alle Abfragen der Seiten und laden neu. Das ist viel schneller als
// eine Live-Abfrage pro Komponente (jede baut eine temporäre Ansicht und Trigger auf, nacheinander in einer Transaktion).
let stand = 0;
const hoerer = new Set<() => void>();
function geaendert() { stand++; for (const h of [...hoerer]) h(); }
let signal: Promise<unknown> | null = null;
function signalStarten() {
  signal ??= openDb().then((d) => {
    let erste = true;
    return d.live.query(`select count(*)::int as n, coalesce(max(seq), 0)::text as s from _outbox`, [], () => {
      if (erste) { erste = false; return; }
      geaendert();
    });
  }).catch((e) => { console.error(e); signal = null; });
}

// Live-Abfragen (nur für den Gerätezustand) und Datenstand nach einem Abgleich neu laden
const active = new Set<() => Promise<void>>();
export async function refreshAll() {
  geaendert();
  await Promise.all([...active].map((r) => r().catch(() => undefined)));
}

/** Abfrage für Seiten: lädt neu, sobald sich irgendwo Daten ändern (lokal oder durch den Abgleich). null = lädt noch. */
export function useQuery<T>(sql: string, params: unknown[] = []): T[] | null {
  const [rows, setRows] = useState<T[] | null>(null);
  const [n, setN] = useState(stand);
  const key = sql + "\u0000" + JSON.stringify(params);
  useEffect(() => {
    signalStarten();
    const h = () => setN(stand);
    hoerer.add(h);
    h();
    return () => { hoerer.delete(h); };
  }, []);
  useEffect(() => {
    let alive = true;
    openDb().then((d) => d.query<T>(sql, params.map((p) => (p === undefined ? null : p))))
      .then((r) => { if (alive) setRows(r.rows); })
      .catch((e) => { console.error(e); if (alive) setRows([]); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, n]);
  return rows;
}

/** Echte Live-Abfrage der PGlite-Erweiterung: nur für Tabellen ohne Outbox (_sync_state, _outbox). */
export function useLiveQuery<T>(sql: string, params: unknown[] = []): T[] | null {
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
