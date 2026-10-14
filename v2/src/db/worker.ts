import { PGlite } from "@electric-sql/pglite";
import { live } from "@electric-sql/pglite/live";
import { worker } from "@electric-sql/pglite/worker";
import { migrate } from "./migrations";
import type { Db } from "./types";

// Die Datenbank läuft in einem Worker (die Oberfläche bleibt flüssig). Mehrere Tabs teilen sich eine Instanz.
worker({
  async init() {
    const db = await PGlite.create("idb://haushalt", { relaxedDurability: true, extensions: { live } });
    await migrate(db as unknown as Db);
    return db;
  },
});
