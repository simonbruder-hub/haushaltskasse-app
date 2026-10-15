/** Fotos und PDFs der Belege bleiben auf dem Handy (IndexedDB). In der Datenbank steht nur der Verweis (attachment). */
const NAME = "haushalt-dateien", ABLAGE = "dateien";

let offen: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  offen ??= new Promise((ok, nein) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(ABLAGE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => { offen = null; nein(r.error); };
  });
  return offen;
}

function schritt<T>(modus: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then((d) => new Promise<T>((ok, nein) => {
    const t = d.transaction(ABLAGE, modus);
    const r = f(t.objectStore(ABLAGE));
    t.oncomplete = () => ok(r.result);
    t.onerror = () => nein(t.error);
    t.onabort = () => nein(t.error);
  }));
}

export const dateiSpeichern = (schluessel: string, blob: Blob) => schritt("readwrite", (s) => s.put(blob, schluessel)).then(() => undefined);
export const dateiLaden = (schluessel: string) => schritt<Blob | undefined>("readonly", (s) => s.get(schluessel)).then((b) => b ?? null);
