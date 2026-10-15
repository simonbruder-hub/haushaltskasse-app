# Übergabe · Stand 15. Oktober 2026

Dieses Dokument ist für einen neuen Chat gedacht. Es beschreibt den Stand der neuen App «Haushalt», wie wir arbeiten, was beim Bauen schon schiefging und was als Nächstes ansteht.

## 1. Stand

- **Veröffentlicht:** https://simonbruder-hub.github.io/haushaltskasse-app/neu/ (Branch `main`, GitHub Pages).
- **Fertig:** M1 Fundament, M2 Belege und Ausgleich, M3 Beleg-Scanner. Was die Module können, steht in `v2/README.md`.
- **Nutzung:** Zurzeit nur Simon, auf seinem Handy. Eliana ist als Person angelegt; er erfasst auch Belege, die sie bezahlt hat. Alles ist für zwei Handys und später ein gemeinsames Konto vorbereitet.
- **Offen bei Simon:**
  - Ob Supabase eingerichtet ist, wissen wir nicht. Falls ja, müssen die Migrationen bis `…_m3_scanner.sql` ausgeführt sein. Die App meldet es, wenn eine fehlt.
  - Ob er einen Anthropic-API-Schlüssel für die KI-Erkennung eingetragen hat, wissen wir auch nicht.
- **Alte App «Kasse unterwegs»:** liegt im Wurzelordner des Repositorys und bleibt in Gebrauch. Die neue App lädt von dort `ocr/` (Tesseract) und `bon.js` für die Offline-Texterkennung.

## 2. Wichtige Dateien (`v2/`)

| Bereich | Dateien |
|---|---|
| Datenbank | `db/schema.sql` (M1, nie ändern), `db/m2.sql`, `db/m3.sql` (gemeinsam), `db/client*.sql` (nur Browser), `db/server*.sql` (nur Supabase), `src/db/migrations.ts` |
| Supabase | `supabase/migrations/*.sql`, erzeugt mit `npm run migration` aus `scripts/migration.mjs` |
| Abgleich | `src/sync/engine.ts`, `src/sync/remote-supabase.ts`, `src/lib/sync.ts` |
| Abfragen und Speichern | `src/db/client.ts` (`useQuery`, `useLiveQuery`, `sichern`), `src/db/worker.ts` |
| Belege und Ausgleich | `src/lib/belege.ts`, `src/lib/belegliste.ts`, `src/lib/auswahl.ts` |
| Scanner | `src/scan/` (`ki.ts`, `schema.ts`, `pruefen.ts`, `entwurf.ts`, `ocr.ts`, `bild.ts`, `dateien.ts`, `einstellung.ts`), Prompt und Schema in `docs/scanner/` |
| Seiten | `src/pages/` (Uebersicht, Erfassen, Scannen, Belege, BelegDetail, Ausgleich, Mehr, Konten, Kategorien, Personen, Einstellungen) |
| Gestaltung | `src/styles.css` (Tokens, eigene Klassen in `@layer`), `src/ui/kit.tsx`, `src/ui/Icon.tsx` |
| Tests | `db/tests/*.test.ts` (Vitest), `tests/*.spec.ts` (Playwright) |

## 3. Befehle

In einem frischen Container:

```bash
cd v2 && npm ci
# PostgREST für die Supabase-Nachbau-Tests (PostgreSQL 16 liegt in /usr/lib/postgresql/16/bin)
mkdir -p /tmp/pgrst && curl -sSL https://github.com/PostgREST/postgrest/releases/download/v12.2.12/postgrest-v12.2.12-linux-static-x86-64.tar.xz | tar -xJ -C /tmp/pgrst
export POSTGREST_BIN=/tmp/pgrst/postgrest
export CHROMIUM=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1)

npx tsc --noEmit          # Typen
npx vite build            # Build nach ../neu (inkl. sw.js mit Syntaxprüfung)
npx vitest run            # 44 Datenbank-, Scanner- und Abgleichstests
npx playwright test       # 8 Browser-Tests (braucht den Build)
npm run migration         # Supabase-Migrationen aus db/*.sql neu erzeugen
```

**Veröffentlichen:**
1. Auf einem Branch arbeiten (z. B. `wip-m4`).
2. Alles grün → `git checkout main && git merge --ff-only wip-m4 && git push origin main`.
3. Den Deploy prüfen: GitHub Actions, Workflow «pages build and deployment». github.io selbst ist aus der Cloud-Umgebung nicht erreichbar.

Der Build in `neu/` wird mit eingecheckt.

## 4. Neue Datenbank-Version (Checkliste)

1. `db/mN.sql` (Browser und Server), `db/client_mN.sql` (Outbox-Trigger für neue Abgleichstabellen) und `db/server_mN.sql` (Stempel- und Löschprotokoll-Trigger) anlegen.
2. In `server_mN.sql` `app_schema_version()` auf N setzen.
3. Abgleich: `sync_tables()` vollständig neu definieren, Eltern vor Kindern. Neue Tabellen brauchen `household_id`, `updated_at` und einen `t_touch`-Trigger.
4. Werden Zeilen evtl. auf zwei Handys offline angelegt und haben einen Eindeutigkeitsschlüssel, dann feste IDs verwenden: `stabile_id('art', …)`.
5. In `src/db/migrations.ts` eintragen, außerdem in `scripts/migration.mjs` (dann `npm run migration`) und in `db/tests/hilfe.ts` (`server()`).
6. Tests ergänzen. Den Update-Test (`tests/update.spec.ts`) um die vorherige veröffentlichte Version erweitern.

## 5. Stolpersteine, die schon passiert sind

- **CSS:** Eigene Regeln müssen in `@layer base` bzw. `@layer components` stehen. Sonst übersteuern sie Tailwind-Klassen, etwa die Textfarbe auf Knöpfen.
- **Live-Abfragen von PGlite sind langsam,** etwa 0,2 s pro Abfrage, nacheinander ausgeführt. Seiten verwenden `useQuery`, das bei jeder Änderung über ein gemeinsames Signal neu lädt. `useLiveQuery` nur für `_sync_state` und `_outbox` verwenden.
- **Speichern:**
  - `relaxedDurability` hält die Abfragen schnell.
  - Nach jeder Benutzeraktion wartet `sichern()`, bis IndexedDB geschrieben ist (`useAktion` macht das). Erst dann erscheint die Bestätigung (Toast).
  - Tests müssen vor einem Neuladen auf den Toast warten.
  - `syncToFs()` nie überschreiben: PGliteWorker ruft es nach jeder Abfrage auf.
- **Service Worker:**
  - `sw.js` wird in `vite.config.ts` als Text erzeugt. Darin keine Regex-Literale mit Backslash verwenden.
  - Der Build prüft die Syntax. Ein kaputter Service Worker hätte die alte Version für immer installiert gelassen.
- **Playwright:**
  - `page.route` sieht keine Anfragen des Service Workers. In solchen Tests `serviceWorkers: "block"` setzen.
  - Text-Locators matchen Teiltexte: lieber Überschriften oder Rollen prüfen.
- **Nach asynchronem Speichern** nur weiterleiten, wenn man noch auf der Seite ist (`location.hash` prüfen).
- **Supabase-Upsert** prüft immer auch die Insert-Policy (RLS).
- **Server-Trigger** dürfen den Abgleich nie blockieren, denn Kopf, Positionen und Zahlungen kommen nacheinander an.
- **Fremdschlüssel aus lokalen Tabellen** auf `transaction_header` brauchen `on delete set null`, sonst kann man Belege nicht mehr löschen.
- **SQL-Parameter in PGlite:** Ein Parameter hat genau einen Typ. Wird `$1` als Text und als UUID gebraucht, an beiden Stellen ausdrücklich casten.

## 6. Offene Punkte

**Nacharbeiten M3:**
- **Erster echter KI-Scan:** Die Claude-API ist in den Tests nur simuliert. Den ersten Beleg mit Simons Schlüssel genau anschauen: Kategorien, Summen, Reparatur-Runde. Kosten pro Beleg über `scan_job.tokens_in/out` nachmessen.
- **Offline-Erkennung auf dem Handy prüfen:** Auf GitHub Pages im Browser getestet (`tests/pages.spec.ts`), auf iPhone und Android noch nicht.
- **Live-Dokumentscanner** mit Kantenerkennung und Zuschneiden aus der alten App (`scanner.js`, `bild.js`, `scan-worker.js`) ist noch nicht übernommen. Heute läuft ein normales Kamerafoto.
- **Cumulus-/Supercard-CSV-Import:** Zuerst einen echten Export von Simon holen (Blueprint §3.1).
- **Ähnliche Kürzel** (Trigramm, `pg_trgm`) und **Modell-Vorschlag** für unbekannte Zeilen (Blueprint §3.3, Schritte 3–4) fehlen noch. Heute kommen Produkt und Kategorie aus der Belegerkennung selbst.
- **Belegfotos** liegen nur auf dem Handy, das sie aufgenommen hat. Später ginge das über Supabase Storage.
- **Edge Function:** Optional könnte die KI-Erkennung über eine Supabase Edge Function laufen; dann bliebe der Schlüssel auf dem Server. Die Logik in `src/scan/` lässt sich übernehmen.

**Nächste Module (Blueprint):**
- **M4 Produkte und Preise:** EAN-Scan (BarcodeDetector, ZXing), OpenFoodFacts, Preisvergleich pro Einheit, Shrinkflation, Preisalarme.
- **M5 Budget und Konten:** Safe-to-Spend, Fixkosten, Verträge, Sparziele (Sinking Funds), Daueraufträge, 50/30/20 pro Person.
- **M6 Rechnungen und Planung:** Swiss-QR-Rechnungen, Garantien, Smart Basket.
- **M7 Übernahme:** Daten aus «Haushaltskasse» und «Kasse unterwegs».

## 7. Start-Prompt für einen neuen Chat

Neuen Chat in Claude Code mit dem Repository **simonbruder-hub/haushaltskasse-app** starten und schreiben:

> Wir entwickeln die Haushalts-App weiter (neue App in `v2/`, veröffentlicht unter https://simonbruder-hub.github.io/haushaltskasse-app/neu/). Lies zuerst `CLAUDE.md`, `v2/docs/UEBERGABE.md` und `v2/README.md`. M1–M3 sind fertig. Als Nächstes möchte ich [z. B. M4 «Produkte und Preise» / die Nacharbeiten zu M3]. Zeig mir zuerst kurz den Plan und warte auf mein OK.
