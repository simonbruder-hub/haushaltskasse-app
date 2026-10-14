import { PGlite } from "@electric-sql/pglite";
import { live } from "@electric-sql/pglite/live";
import { worker } from "@electric-sql/pglite/worker";
import { migrate } from "./migrations";
import type { Db } from "./types";

/**
 * Die Datenbank läuft in einem Worker (die Oberfläche bleibt flüssig). Mehrere Tabs teilen sich eine Instanz.
 *
 * Schnell und trotzdem sicher:
 * - relaxedDurability: Abfragen warten nicht, bis IndexedDB geschrieben ist (sonst dauert jede Abfrage rund 0,3 s länger).
 * - Nachricht «haushalt-sichern»: schreibt alles und meldet sich erst danach. Die Oberfläche schickt sie nach jeder
 *   Benutzeraktion (sichern() in client.ts): «Gespeichert» erscheint erst, wenn nichts mehr verloren gehen kann.
 */
let schreiben: (() => Promise<void>) | null = null;

worker({
  async init() {
    const db = await PGlite.create("idb://haushalt", { relaxedDurability: true, extensions: { live } });
    await migrate(db as unknown as Db);
    const fs = (db as unknown as { fs: { syncToFs(relaxed?: boolean): Promise<void> } }).fs;
    schreiben = () => fs.syncToFs(false);
    return db;
  },
});

let reihe: Promise<void> = Promise.resolve();   // nacheinander, nicht doppelt gleichzeitig
addEventListener("message", (e: MessageEvent) => {
  if (e.data?.type !== "haushalt-sichern") return;
  const id = e.data.id;
  reihe = reihe.then(() => schreiben?.()).catch((fehler) => console.error(fehler))
    .then(() => postMessage({ type: "haushalt-gesichert", id }));
});
