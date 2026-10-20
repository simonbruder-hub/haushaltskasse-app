# Übergabe · Stand 20. Oktober 2026

Dieses Dokument ist für einen neuen Chat gedacht. Es beschreibt den Stand der neuen App «Haushalt», wie wir arbeiten, was beim Bauen schon schiefging und was als Nächstes ansteht.

## 1. Stand

- **Veröffentlicht:** https://simonbruder-hub.github.io/haushaltskasse-app/neu/ (Branch `main`, GitHub Pages).
- **Fertig:** M1 Fundament, M2 Belege und Ausgleich, M3 Beleg-Scanner (mit Live-Dokumentscanner, ähnlichen Kürzeln, Kosten pro Scan), M4 Produkte und Preise, M5 Budget und Konten. Was die Module können, steht in `v2/README.md`.
- **Bewusst nicht gebaut:** M6 (QR-Rechnungen, Garantien, Einkaufsliste) und M7 (Übernahme alter Daten). Simon will zuerst eine laufende App; beides ist optional (siehe §6). Nur auf Wunsch angehen.
- **Nutzung:** Zurzeit nur Simon, auf seinem Handy. Eliana ist als Person angelegt; er erfasst auch Belege, die sie bezahlt hat. Alles ist für zwei Handys und später ein gemeinsames Konto vorbereitet.
- **Offen bei Simon:**
  - Ob Supabase eingerichtet ist, wissen wir nicht. Falls ja, müssen die Migrationen bis `…_m5_budget.sql` ausgeführt sein. Die App meldet es und nennt die fehlenden Dateien.
  - Ob er einen Anthropic-API-Schlüssel für die KI-Erkennung eingetragen hat, wissen wir auch nicht.
- **Alte App «Kasse unterwegs»:** liegt im Wurzelordner des Repositorys und bleibt in Gebrauch. Die neue App lädt von dort `ocr/` (Tesseract) und `bon.js` für die Offline-Texterkennung.

## 2. Wichtige Dateien (`v2/`)

| Bereich | Dateien |
|---|---|
| Datenbank | `db/schema.sql` (M1, nie ändern), `db/m2.sql` … `db/m4.sql` (gemeinsam), `db/client*.sql` (nur Browser), `db/server*.sql` (nur Supabase), `src/db/migrations.ts` |
| Supabase | `supabase/migrations/*.sql`, erzeugt mit `npm run migration` aus `scripts/migration.mjs` |
| Abgleich | `src/sync/engine.ts`, `src/sync/remote-supabase.ts`, `src/lib/sync.ts` |
| Abfragen und Speichern | `src/db/client.ts` (`useQuery`, `useLiveQuery`, `sichern`), `src/db/worker.ts` |
| Belege und Ausgleich | `src/lib/belege.ts`, `src/lib/belegliste.ts`, `src/lib/auswahl.ts` |
| Scanner | `src/scan/` (`ki.ts`, `schema.ts`, `pruefen.ts`, `entwurf.ts`, `ocr.ts`, `bild.ts`, `dateien.ts`, `einstellung.ts`), Prompt und Schema in `docs/scanner/` |
| Dokumentscanner | `src/scan/dokument/` (`bild.js` aus der alten App, `kanten.worker.ts`, `Kamera.tsx`, `Zuschneiden.tsx`, `seite.ts`) |
| Budget und Planung | `db/m5.sql`, `src/lib/budget.ts`, `src/budget/` (Budgets, Fixkosten, Sparziele, Dauerauftraege, Analyse, bausteine), Seite `src/pages/Budget.tsx` (Route `#/budget/<reiter>`) |
| Produkte und Preise | `db/m4.sql`, `src/produkte/` (`strichcode.ts`, `EanScanner.tsx`, `off.ts`, `menge.ts`, `ean.ts`), `src/lib/preise.ts`, `src/ui/Preise.tsx` |
| Seiten | `src/pages/` (Uebersicht, Erfassen, Scannen, Belege, BelegDetail, Ausgleich, Mehr, Konten, Kategorien, Personen, Einstellungen, Preise, Produkt, PreisPruefen, Budget) |
| Gestaltung | `src/styles.css` (Tokens, eigene Klassen in `@layer`), `src/ui/kit.tsx`, `src/ui/Icon.tsx` |
| Tests | `db/tests/*.test.ts` und `src/**/*.test.ts` (Vitest), `tests/*.spec.ts` (Playwright), Testvideos für die künstliche Kamera in `tests/fixtures/` |

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
npx vitest run            # 106 Datenbank-, Scanner-, Preis-, Budget- und Abgleichstests
npx playwright test       # 14 Browser-Tests (braucht den Build)
npm run migration         # Supabase-Migrationen aus db/*.sql neu erzeugen
```

**Veröffentlichen:**
1. Auf einem Branch arbeiten (z. B. `wip-m5`; in Claude-Code-Sitzungen gibt die Sitzung den Branch vor).
2. Alles grün → `git checkout main && git merge --ff-only wip-m5 && git push origin main`.
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
- **Tailwind-Klassennamen:** Eigene Klassen dürfen nicht wie Tailwind-Hilfsklassen heissen. `ring` zeichnete einen 1-px-Rahmen um den Auslöser (heute `sc-ring`).
- **Testbilder:** Mit `isMobile` (Pixel 7) baut Chromium eine Seite 980 px breit auf und verkleinert sie. Testbilder deshalb in einem eigenen Kontext mit `isMobile: false` zeichnen. `browser.newContext()` übernimmt sonst die `use`-Einstellungen aus der Konfiguration.
- **Künstliche Kamera:** `--use-file-for-fake-video-capture=…mjpeg` (eine JPEG-Datei genügt) plus `--use-fake-ui-for-media-stream`, siehe `tests/kamera.spec.ts` und `tests/m4.spec.ts`. Chromium unter Linux hat keinen `BarcodeDetector`, dort testet man ZXing.
- **Abgeleitete Daten nach dem Abgleich:** Die Reihenfolge, in der ein Handy Belege nachrechnet, ist beliebig. Alles, was vom Vorgänger abhängt (Preisalarme), pro Produkt in fester Reihenfolge neu aufbauen. Löschweitergaben (`on delete cascade`) laufen beim Übernehmen nicht (`replica`), Reste räumt `sync_after_pull` auf.
- **Views auf Supabase** brauchen `security_invoker = true`, sonst umgehen sie über die REST-Schnittstelle die RLS. Seit M4 gesetzt (`server_m4.sql`), neue Views ebenso.
- **`sync_tables()` immer komplett neu definieren** (jede Migration ersetzt die ganze Liste, Eltern vor Kindern). M5 hat `standing_order` vor `transfer` und `contract` vor `fixed_cost` eingeordnet; die aktuelle Liste steht in `db/m5.sql`.
- **Automatisch gebuchte Zeilen brauchen feste IDs** (`stabile_id`), sonst bucht jedes Handy dieselbe Zeile mit eigener ID und der Eindeutigkeitsschlüssel blockiert den Abgleich. Daueraufträge und Sparraten buchen beim App-Start (`faelligesBuchen`, `src/App.tsx`), nur Fälliges, höchstens 36 Monate zurück. Ein Dauerauftrag mit Buchungen lässt sich nur beenden, nicht löschen.
- **Tests mit `getByLabel`:** `Feld gruppe` und das Steuerelement darin tragen oft denselben Namen (z. B. «Nach»). Dann mit `locator("select[aria-label=…]")` oder über Rolle und Namen eindeutig machen.
- **Exit-Code bei Pipes:** `npx vitest run | tail` meldet immer Erfolg. Vor einem Commit den Exit-Code des Tests selbst prüfen.

## 6. Nächste Schritte

**Simons Haltung:** Er braucht eine laufende App, alles andere ist Zusatz. Wenig Tokens verbrauchen, keine Workflows oder Agenten ohne Bedarf, kurz antworten. Vor jedem Modul den Plan zeigen und auf OK warten (CLAUDE.md).

**Zuerst, braucht Simon (kein Code):**
- **Supabase:** Falls eingerichtet, die Migrationen bis `…_m5_budget.sql` im SQL-Editor ausführen. Die App nennt sonst die fehlenden Dateien und speichert bis dahin nur auf dem Handy.
- **Auf dem Handy ausprobieren** (bisher nur im Browser mit künstlicher Kamera getestet): Kamera-Scanner, EAN-Scan, erster echter KI-Scan (Kosten stehen im Beleg), OpenFoodFacts live (CORS und Namen), Budget-Seiten.
- **Cumulus-/Supercard-Export:** Für einen CSV-Import (Blueprint §3.1) braucht es einen echten Export von Simon.

**In M5 nicht per Browsertest abgedeckt** (Datenbank und Rechenlogik sind getestet): Sparziele-Seite samt Einträgen, «Fixkost bezahlt buchen», Vertrags-Formular, einmalige Überweisung. Das Update von M4 auf M5 prüft nur indirekt `tests/update.spec.ts` (M3 → aktuell migriert v3 bis v5). Wer das absichern will: Test um die Vorversion `a642acf` erweitern.

**M6 Rechnungen und Planung (nicht begonnen, wird Datenbank-Version 6, Datei `20261019000000_m6_…sql`).** Schema, Rechenfunktionen und Spezifikation stehen: `qr_bill`, `creditor_mapping`, `warranty`, `shopping_list(_item)`, `smart_basket()`, `v_consumption_cycle`, `v_warranty_status` in `db/schema.sql`; Parser-Spezifikation in `docs/BLUEPRINT.md` §3.4 und `docs/scanner/qr_bill.schema.json`. Zu bauen:
- Datenbank nach Checkliste §4: `updated_at` und `t_touch` für die fünf Tabellen, `household_id` plus Füll-Trigger für `shopping_list_item` (und alte RLS-Regel ersetzen), Freitext-Spalte für Listeneinträge (`master_product_id` dann optional), alle Tabellen in `sync_tables()` (nach `fixed_cost`), feste IDs (`stabile_id` für Rechnung aus Hash, Gläubiger aus IBAN, Liste, Listenposition, Garantie), `sync_after_pull` erweitern (Rechnung wieder offen, wenn ihr Beleg gelöscht wurde).
- QR-Parser `src/rechnung/qr.ts`: SPC 0200, Swico S1, IBAN mod 97, QRR-Prüfziffer mod 10, SCOR mod 97; Text vor dem Hash normalisieren (NFC, CRLF → LF), zusätzlich Doppelprüfung über IBAN + Referenz + Betrag, weil Android und ZXing Umlaute nicht immer gleich lesen. Die SIX-Beispiele aus dem Blueprint als Testvektoren.
- Lesen: `src/produkte/strichcode.ts` kann nur EAN-Formate; QR-Code ergänzen, Kamera mit höherer Auflösung (die QR-Rechnung hat bis zu 997 Zeichen), Foto/Screenshot. PDF-Rechnungen brauchen `pdfjs-dist` (mehrere hundert KB, lädt jedes Handy beim Update): erst nach Kamera und Foto entscheiden.
- «Bezahlt» erzeugt einen Beleg `kind = bill` (Vorlage: `fixkostBuchen` in `src/lib/budget.ts`), setzt `qr_bill.transaction_id`; Verknüpfung mit Fixkosten über `creditor_mapping`.
- Garantien: Formular, Liste mit `v_warranty_status`, Einstieg aus `BelegDetail.tsx`, Karte auf der Übersicht. Einkaufsliste mit «auf die Liste» (Produkt-Seite, Preis prüfen) und Smart Basket. `smart_basket()` und `v_consumption_cycle` sind schwer: nicht bei jedem Neuladen der Seite rechnen.
- Geplant oder Impulskauf (`purchase_intent`) braucht feste Reihenfolge beim Neurechnen, sonst hängt das Ergebnis vom Handy ab.

**M7 Übernahme alter Daten (nicht begonnen).** Wichtigste Vorarbeit:
- Die alte App speichert in der IndexedDB `kasse-unterwegs` (Version 2, Stores `kv`, `fotos`, `ablage`; `kern.js`). Beide Apps liegen unter `simonbruder-hub.github.io`, IndexedDB trennt nur nach Ursprung: `/neu/` kann sie direkt und **nur lesend** öffnen. Nie schreiben oder die Version erhöhen, sonst bricht die alte App. Auf iOS hat die installierte App getrennte Daten vom Safari-Tab; dann Datei-Export als Plan B.
- Auf dem Handy liegen nur ungesendete Einträge, notierte Preise, Fotos, Zuordnungen und der letzte Stand. Die Beleg-Historie liegt in der «Haushaltskasse» (gehört nicht zu diesem Repository; die alte App tauscht nur zwei JSON-Dateien aus: `haushaltskasse-stand` rein, `haushaltskasse-handy` raus, `kern.js` und `abgleich.js`). Dafür braucht es von Simon eine Exportdatei mit allen Einträgen; ohne sie ist nur Teil A (Kasse unterwegs) möglich.
- Eintrag der alten App: `{pwaId, typ 'einkauf'|'auswaerts', datum, ort, betrag, bezahlt 'Simon'|'Eliana', teilung 'geteilt'|'allein', notiz, artikel[]}`; 12 Warengruppen (`produkte.js`) müssen auf die neuen Kategorien abgebildet werden; «geteilt» → Topf Gemeinsam Leben, «allein» → Topf der Person.
- Import muss wiederholbar sein (feste IDs auch für Positionen, Zahlungen und Läden), eine Vorschau mit Kategorien- und Saldovergleich zeigen und in Blöcken buchen (PGlite ist langsam). Notierte Preise nicht als künstliche 1-kg-Packung einspielen (sie lösen sonst falsche Alarme aus).
- Offene Fragen an Simon: Was genau ist die «Haushaltskasse» und kann sie alles als Datei ausgeben? Wie weit zurück importieren, mit welchem Anfangsstand beim Ausgleich? Wie lange läuft die alte App parallel?

**Weitere offene Punkte:**
- **OpenFoodFacts:** aus der Cloud-Umgebung nicht erreichbar, in Tests simuliert.
- **Korb-Modus** (Blueprint §3.2): EANs aus dem Laden mit den Zeilen des späteren Belegs paaren.
- **Kantenerkennung** meldet auf einem leeren Tisch mit starkem Lichtverlauf manchmal eine Fläche (auch in der alten App).
- **Belegfotos** liegen nur auf dem Handy, das sie aufgenommen hat (später Supabase Storage). Die KI-Erkennung könnte über eine Edge Function laufen, dann bliebe der Schlüssel auf dem Server.

## 7. Start-Prompt für einen neuen Chat

Neuen Chat in Claude Code mit dem Repository **simonbruder-hub/haushaltskasse-app** starten und schreiben:

> Wir entwickeln die Haushalts-App weiter (neue App in `v2/`, veröffentlicht unter https://simonbruder-hub.github.io/haushaltskasse-app/neu/). Lies zuerst `CLAUDE.md`, `v2/docs/UEBERGABE.md` und `v2/README.md`. M1–M5 sind fertig, M6 und M7 sind bewusst offen. Ich möchte [z. B. M6 «Rechnungen und Planung» / einen Fehler beheben / etwas Neues]. Zeig mir zuerst kurz den Plan und warte auf mein OK. Verbrauche möglichst wenig Tokens.
