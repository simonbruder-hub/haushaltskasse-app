# Haushalt – neue App (Module 1 bis 3)

Läuft unter **https://simonbruder-hub.github.io/haushaltskasse-app/neu/** – parallel zur bisherigen App «Kasse unterwegs».
Quellcode in diesem Ordner, der fertige Build liegt in `../neu/`.

## Was M1 kann

- **Ersteinrichtung:** Haushalt mit zwei Erwachsenen, Konten/Töpfe, 17 Lebensbereiche, 36 Kategorien mit Standard-Topf.
- **Konten und Töpfe:**
  - Gemeinsam Leben (50/50), Privat, Sparen, Freizeit, Kinder, Zweck-Konten
  - virtuell oder als echtes Konto (IBAN mit Prüfziffer), mit Zahlungsmitteln (Karte, Twint …)
  - persönlicher Topf pro Person
- **Personen:** Farbe, Nettolohn mit Gültigkeitsdatum, Kinder mit eigenem Topf (Eltern je 50 %).
- **Kategorien:** Standard-Topf (gemeinsam oder persönlich), Klasse für 50/30/20, archivieren, eigene Lebensbereiche.
- **Offline zuerst:**
  - Die ganze Datenbank läuft im Browser (PGlite = PostgreSQL in WebAssembly, gespeichert in IndexedDB).
  - Die App startet ohne Netz (Service Worker).
- **Abgleich zwischen zwei Handys** über ein eigenes Supabase-Projekt:
  - Anmeldung per E-Mail-Code
  - Einladungscode für den Partner
  - Row Level Security pro Haushalt

## Was M2 kann

- **Erfassen in wenigen Sekunden** (runder Knopf in der Mitte der Leiste):
  - Betrag, Datum (Heute), Laden als Chips (die häufigsten zuerst, «Anderer …» legt einen neuen an)
  - Kategorie mit Vorschlägen, daraus der Topf («Lebensmittel» → Gemeinsam Leben); jederzeit änderbar
  - bezahlt von welchem Konto und womit (Karte, Twint, bar …)
  - Einkauf, Rechnung oder **Gutschrift** (Geld zurück, z. B. Rückgabe)
- **Positionen:** Teile eines Belegs in einen anderen Topf legen (Shampoo nur für Simon), mit Rabatt. Der Rest wird automatisch als «Übriges» im Topf des Belegs erfasst.
- **Gutscheine und Punkte** (Cumulus, Superpunkte, Reka, Lunch-Check): ändern die Beteiligung nicht, sie zählen für beide nach Anteil.
- **Fremdwährung** mit Kurs (der zuletzt verwendete wird vorgeschlagen).
- **Vorschau vor dem Speichern:** wer trägt wie viel, wer schuldet wem aus diesem Beleg.
- **Belege:** nach Monat mit Summen, Suche, Filter Gemeinsam / pro Person; Detail mit Anteilen, Positionen und Zahlungen; bearbeiten und löschen.
- **Ausgleich:** wer schuldet wem, wie sich das zusammensetzt, Verlauf mit laufendem Stand, Ausgleichszahlung buchen (Twint, Überweisung, bar).
- **Übersicht:** Ausgleich, dieser Monat nach Topf, zuletzt erfasste Belege.
- Konten, Kategorien, Personen und Einstellungen liegen jetzt unter **«Mehr»**.

## Was M3 kann

- **Beleg scannen:** Im Erfassen-Formular «Fotografieren» oder «Foto / PDF». Die App liest Laden, Datum, Uhrzeit, alle Positionen mit Menge und Rabatt, Rabatte auf den ganzen Einkauf, Rundung und Zahlungen (Karte über die letzten 4 Ziffern dem Konto zugeordnet, Gutscheine und Punkte ohne Konto).
- **Zwei Wege:**
  - **KI-Erkennung** mit Claude (Einstellungen → «Belege lesen»): sehr genau, schlägt pro Position Produkt und Kategorie vor, liest auch PDF-E-Belege. Braucht einen eigenen Anthropic-API-Schlüssel; Kosten je nach Modell von unter 1 Rappen (Haiku) bis etwa 10–15 Rappen (Opus) pro Beleg.
  - **Ohne KI / ohne Netz:** Texterkennung auf dem Handy (Tesseract aus «Kasse unterwegs»). Weniger genau, kostenlos, nach dem ersten Gebrauch auch offline.
- **Prüf-Dialog:** jede Position mit Ampel (gelernt · Vorschlag · KI · neu · prüfen), Kategorie und Topf mit einem Tipp änderbar, Summenkontrolle, Vorschau wer wem schuldet. Gebucht wird erst nach «Bestätigen».
- **Lernt eure Kürzel:** Jede bestätigte Position kommt ins Wörterbuch (Laden + Belegtext → Produkt + Kategorie). Beim nächsten Beleg ist sie vorausgefüllt; ab der fünften Bestätigung gilt sie als sicher. Ohne Kategorie nimmt die App die bei diesem Laden übliche, bei Supermärkten «Lebensmittel».
- **Belegfoto** bleibt auf dem Handy und ist im Beleg mit einem Tipp sichtbar. Ein zweites Mal dasselbe Foto oder derselbe Einkauf (Laden, Datum, Total) wird erkannt.

## Architektur

```
Browser (Handy)                              Supabase (eigenes Projekt)
┌───────────────────────────┐                ┌────────────────────────────┐
│ React-Oberfläche          │                │ PostgreSQL                 │
│   ↕ Abfragen              │   PostgREST    │   db/schema.sql (dasselbe) │
│ PGlite im Web Worker      │ ◄────────────► │   db/server.sql            │
│   db/schema.sql           │ Push: _outbox  │   (RLS, Einladungen,       │
│   db/client.sql (_outbox) │ Pull: Cursor   │    Löschprotokoll)         │
└───────────────────────────┘                └────────────────────────────┘
```

- **Eine Rechenlogik:** Dasselbe `db/schema.sql` läuft im Browser und auf dem Server. Teilung, Budget und Preise rechnen also überall gleich, auch offline.
- **Abgleich** (`src/sync/engine.ts`):
  - Lokale Änderungen landen per Trigger in `_outbox`.
  - Push: Upserts in Tabellenreihenfolge, Löschungen umgekehrt.
  - Pull: Zeilen mit `updated_at` (Serverzeit) nach dem Cursor, mit 30 s Überlappung, dazu das Löschprotokoll `sync_tombstone`.
  - Übernommen wird ohne Trigger (`session_replication_role = replica`). Unveränderte Zeilen werden übersprungen.
  - Bei Konflikten gewinnt die letzte Änderung. Lokale, noch nicht gesendete Änderungen werden nie überschrieben.
- **Abgeleitete Tabellen** (Anteile, Zahlungsanteile, Preisbeobachtungen) werden nicht synchronisiert. Jedes Handy berechnet sie nach dem Abgleich selbst (`sync_after_pull`).
- **Aktualisierung der Oberfläche** (`src/db/client.ts`): Jede lokale Änderung schreibt in `_outbox`, jeder Abgleich meldet sich. Auf dieses eine Signal laden die Abfragen der Seiten neu. Das ist rund zehnmal schneller als eine Live-Abfrage pro Komponente.
- **Datenbank-Versionen** (`src/db/migrations.ts`): Beim Start spielt die App fehlende Versionen ein (v1 = M1, v2 = M2). Vorhandene Daten bleiben erhalten.
- **Sicher speichern** (`src/db/worker.ts`): Abfragen warten nicht auf IndexedDB (sonst wäre jede rund 0,3 s langsamer). Nach jeder Benutzeraktion schreibt die App aber alles fest; erst dann erscheint «Gespeichert». Geht die App in den Hintergrund, schreibt sie ebenfalls.
- **Scanner** (`src/scan/`): `ki.ts` ruft die Claude-API direkt vom Handy auf (offizielles SDK, Structured Outputs nach `docs/scanner/receipt_extraction.schema.json`, Systemprompt `docs/scanner/system_prompt_beleg.md`, eine Reparatur-Runde bei falschen Summen). `pruefen.ts` prüft deterministisch, `entwurf.ts` baut den Prüf-Dialog und lernt beim Speichern (`produkt_sichern`, `confirm_alias`). `ocr.ts` lädt bei Bedarf `../ocr/` und `../bon.js` der alten App. Fotos liegen in IndexedDB (`dateien.ts`), in der Datenbank steht nur der Verweis (`attachment`).
- **Server-Stand** (`app_schema_version()`): Vor dem Abgleich prüft die App, ob die Datenbank auf Supabase mindestens ihren Stand hat. Fehlt eine Migration, sendet sie nichts und sagt, welche Datei auszuführen ist.

**Abweichungen vom Blueprint v2** (siehe `docs/BLUEPRINT.md`):

| Blueprint | M1 | Grund |
|---|---|---|
| Next.js | **Vite + React + TypeScript + Tailwind** | Reine Browser-App ohne Server-Seiten; schlanker und offline einfacher. |
| PowerSync | **PGlite im Browser + eigener Abgleich** | Kein zusätzlicher Dienst und keine Kosten. Dieselbe SQL-Logik läuft auch offline. |
| `person.default_account_id` | `account.is_personal_default` | Vermeidet gegenseitige Fremdschlüssel; der Abgleich bleibt in fester Reihenfolge. |
| `account_owner`, `person_income` ohne `household_id` | mit `id` + `household_id` | Einheitlicher Abgleich und einfache RLS |
| `app_user` | entfällt | `household_member.user_id` zeigt direkt auf Supabase-Auth |
| Scan über Edge Function | **direkter Aufruf vom Handy**, Schlüssel nur auf dem Gerät | Funktioniert ohne Supabase; die Logik in `src/scan/` lässt sich später unverändert in eine Edge Function verschieben. |
| Alias-Vorschlag mit eigenem Modellaufruf | **Produkt und Kategorie im selben Aufruf** wie die Belegerkennung | Ein Aufruf statt zwei; das Wörterbuch lernt aus den Bestätigungen. |

## Supabase einrichten (einmalig, ca. 10 Minuten)

1. Auf [supabase.com](https://supabase.com) ein Konto anlegen und ein **neues Projekt** erstellen. Den kostenlosen Plan wählen, als Region eine möglichst nahe (z. B. Zürich oder Frankfurt). Das Datenbank-Passwort gut aufbewahren.
2. **SQL Editor** → «New query» → den Inhalt von `supabase/migrations/20261014000000_m1_fundament.sql` einfügen → **Run**. Danach genauso `…_m2_belege.sql` und `…_m3_scanner.sql`, in dieser Reihenfolge.
   - Wer schon eingerichtet hat, führt nur die noch fehlenden Dateien aus. Fehlt eine, sagt die App beim Abgleich, welche.
3. **Authentication → Email Templates:**
   - In den Vorlagen **«Confirm signup»** und **«Magic Link»** den Code einfügen, z. B. `<p>Dein Code: <b>{{ .Token }}</b></p>`.
   - Die App meldet mit diesem Code an, nicht mit dem Link.
4. **Project Settings → API:** «Project URL» und den **anon/publishable key** kopieren.
5. In der App: **Einstellungen → Abgleich** → URL und Schlüssel eintragen → mit der E-Mail anmelden → Code eingeben.
6. **Partner einladen:**
   - Einstellungen → «Partner einladen» zeigt einen 8-stelligen Code.
   - Auf dem anderen Handy: App öffnen → «Einem Haushalt beitreten» → anmelden → Code eingeben.

Hinweis: Kostenlose Supabase-Projekte werden nach rund einer Woche ohne Nutzung pausiert. Das Fortsetzen geht im Dashboard mit einem Klick. Die Daten bleiben auf den Handys und kommen beim nächsten Abgleich wieder hoch.

## Entwickeln und prüfen

```bash
npm install
npm run dev            # Entwicklungsserver
npm run build          # Typprüfung + Build nach ../neu
npm test               # Datenbank-Tests (Rechnen 60 Prüfungen, Belege, Scanner, Abgleich, RLS)
npm run e2e            # Browser-Tests (Playwright)
npm run migration      # supabase/migrations/… aus db/*.sql neu erzeugen
```

Mit lokalem PostgreSQL und PostgREST (`POSTGREST_BIN=/pfad/postgrest`) laufen zusätzlich:
- `db/tests/supabase.test.ts`: die echte Migration, RLS und der Abgleich über PostgREST und supabase-js
- `tests/abgleich.spec.ts`: zwei Handys im Browser gegen diesen Nachbau (inklusive Beleg, Ausgleich und Korrektur)

Weitere Browser-Tests: `m3.spec.ts` (Scanner mit simulierter Claude-API und echter Offline-Erkennung), `pages.spec.ts` (Aufbau wie GitHub Pages, Texterkennung offline), `update.spec.ts` (Update von M1 mit vorhandenen Daten).
