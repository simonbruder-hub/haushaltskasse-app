import { useEffect, useState } from "react";
import { sichern, useLiveQuery, useQuery } from "./db/client";
import { KONTEN_SQL, type Konto, type Person } from "./lib/data";
import { HaushaltCtx } from "./lib/haushalt";
import { useRoute } from "./lib/router";
import { abgleichNeu, ausstehendMelden, jetztAbgleichen, syncPruefen } from "./lib/sync";
import { Shell } from "./ui/Shell";
import { ToastProvider } from "./ui/kit";
import { Start } from "./pages/Start";
import { Uebersicht } from "./pages/Uebersicht";
import { Preise } from "./pages/Preise";
import { Produkt } from "./pages/Produkt";
import { PreisPruefen } from "./pages/PreisPruefen";
import { Konten } from "./pages/Konten";
import { KontoDetail } from "./pages/KontoDetail";
import { Kategorien } from "./pages/Kategorien";
import { Personen } from "./pages/Personen";
import { Einstellungen } from "./pages/Einstellungen";
import { Erfassen } from "./pages/Erfassen";
import { Belege } from "./pages/Belege";
import { BelegDetail } from "./pages/BelegDetail";
import { Ausgleich } from "./pages/Ausgleich";
import { Mehr } from "./pages/Mehr";
import { Scannen } from "./pages/Scannen";

export function App() {
  const st = useLiveQuery<{ key: string; value: string }>(`select key, value from _sync_state where key in ('household_id', 'person_id')`);
  const household = st?.find((r) => r.key === "household_id")?.value ?? null;
  const ich = st?.find((r) => r.key === "person_id")?.value ?? null;
  return (
    <ToastProvider>
      <SyncAgent />
      <NeueVersion />
      {st === null ? <Laden /> : household ? <MitHaushalt household={household} ich={ich} /> : <Start />}
    </ToastProvider>
  );
}

/** Nach einem Update übernimmt der neue Service Worker; die offene Seite läuft noch mit der alten Version.
 *  Statt ungefragt neu zu laden (eine angefangene Erfassung ginge verloren) bietet die App das Neuladen an. */
function NeueVersion() {
  const [neu, setNeu] = useState(false);
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw?.controller) return;   // erster Start: keine alte Version
    const on = () => setNeu(true);
    sw.addEventListener("controllerchange", on);
    return () => sw.removeEventListener("controllerchange", on);
  }, []);
  if (!neu) return null;
  return (
    <button className="btn btn-primary fixed z-[55] left-1/2 -translate-x-1/2 top-[calc(12px+env(safe-area-inset-top))] shadow-lg !min-h-0 py-2.5 text-[14px]"
      onClick={() => location.reload()}>
      Neue Version bereit · Neu laden
    </button>
  );
}

function Laden() {
  const [lange, setLange] = useState(false);
  useEffect(() => { const t = setTimeout(() => setLange(true), 2500); return () => clearTimeout(t); }, []);
  return (
    <div className="min-h-dvh grid place-items-center p-6 text-center">
      <div className="grid gap-3 justify-items-center max-w-xs">
        <img src="./icon-192.png" alt="" width={64} height={64} className="rounded-2xl shadow animate-pulse" />
        <p className="text-muted">Daten werden geladen …</p>
        {lange && <p className="text-muted text-[13px]">Beim ersten Start richtet die App ihre Datenbank auf dem Handy ein. Das dauert einmalig ein paar Sekunden.</p>}
      </div>
    </div>
  );
}

function MitHaushalt({ household, ich }: { household: string; ich: string | null }) {
  const hh = useQuery<{ name: string }>(`select name from household where id = $1`, [household]);
  const personen = useQuery<Person>(`select id, display_name, role, birth_date::text, sort, color, archived_at::text from person where household_id = $1 order by sort`, [household]);
  const konten = useQuery<Konto>(KONTEN_SQL, [household]);
  const route = useRoute();
  if (!hh || !personen || !konten) return <Laden />;
  if (!hh.length) return <Warten />;
  const [seite, id] = route;
  let inhalt;
  switch (seite) {
    case "konten": inhalt = id ? <KontoDetail id={id} /> : <Konten />; break;
    case "kategorien": inhalt = <Kategorien />; break;
    case "personen": inhalt = <Personen />; break;
    case "einstellungen": inhalt = <Einstellungen />; break;
    case "erfassen": inhalt = <Erfassen key={id ?? "neu"} id={id} />; break;
    case "belege": inhalt = id ? <BelegDetail id={id} /> : <Belege />; break;
    case "ausgleich": inhalt = <Ausgleich />; break;
    case "mehr": inhalt = <Mehr />; break;
    case "scan": inhalt = <Scannen key={id ?? "datei"} kamera={id === "kamera"} />; break;
    case "preise": inhalt = id ? <Produkt key={id} id={id} /> : <Preise />; break;
    case "preis-pruefen": inhalt = <PreisPruefen key={id ?? "scan"} artikelId={id} />; break;
    default: inhalt = <Uebersicht />;
  }
  return (
    <HaushaltCtx.Provider value={{ household, name: hh[0].name, ich, personen, konten }}>
      <Shell seite={seite ?? ""}>{inhalt}</Shell>
    </HaushaltCtx.Provider>
  );
}

/** Nach dem Beitritt: Daten sind noch unterwegs */
function Warten() {
  return (
    <div className="min-h-dvh grid place-items-center p-6 text-center">
      <div className="grid gap-3 justify-items-center max-w-sm">
        <p className="font-bold text-lg">Haushalt wird geladen …</p>
        <p className="text-muted">Die Daten kommen vom Server. Das dauert beim ersten Mal ein paar Sekunden.</p>
        <button className="btn" onClick={() => abgleichNeu()}>Erneut versuchen</button>
      </div>
    </div>
  );
}

/** Hält den Abgleich am Laufen: beim Start, wenn das Netz zurückkommt, beim Zurückkehren in die App und nach Änderungen. */
function SyncAgent() {
  const outbox = useLiveQuery<{ n: number }>(`select count(*)::int as n from _outbox`);
  const n = outbox?.[0]?.n ?? 0;
  useEffect(() => {
    syncPruefen().then(() => jetztAbgleichen());
    const los = () => { jetztAbgleichen(); };
    // Geht die App in den Hintergrund, alles Ausstehende sofort in den Browser-Speicher schreiben
    const sichtbar = () => { if (document.visibilityState === "visible") los(); else sichern().catch(() => undefined); };
    addEventListener("online", los);
    document.addEventListener("visibilitychange", sichtbar);
    const t = setInterval(los, 5 * 60 * 1000);
    return () => { removeEventListener("online", los); document.removeEventListener("visibilitychange", sichtbar); clearInterval(t); };
  }, []);
  useEffect(() => {
    ausstehendMelden(n);
    if (!n) return;
    const t = setTimeout(() => { jetztAbgleichen(); }, 2500);
    return () => clearTimeout(t);
  }, [n]);
  return null;
}
