# Haushaltskasse-App · Hinweise für Claude

Zwei Apps in einem Repository. GitHub Pages veröffentlicht den Branch `main`.

- **Alte App «Kasse unterwegs»** im Wurzelordner (Vanilla-JS: `index.html`, `bon.js`, `ocr/` …).
  - Nicht kaputt machen: Die neue App lädt `../ocr/` und `../bon.js` für die Offline-Texterkennung.
  - Ihr `sw.js` ignoriert `/neu/` und `/v2/`.
- **Neue App «Haushalt»** in `v2/` (Vite, React, TypeScript, Tailwind 4, PGlite, eigener Abgleich mit Supabase).
  - Der Build landet in `neu/` und wird mit eingecheckt.
  - Veröffentlicht unter https://simonbruder-hub.github.io/haushaltskasse-app/neu/

Zuerst lesen: `v2/docs/UEBERGABE.md` (Stand, Befehle, Stolpersteine, offene Punkte), dann `v2/README.md` (Architektur) und `v2/docs/BLUEPRINT.md` (Entscheidungen, Formeln).

## Arbeitsweise

- **Sprache:** Mit Simon auf Deutsch in Schweizer Schreibweise («ss» statt «ß»). Beträge in CHF.
- **Ablauf pro Modul:** zuerst den Plan zeigen, auf ein kurzes OK warten, dann umsetzen.
- **Tokens sparen:** Simon will eine laufende App, alles andere ist Zusatz. Kurz antworten, keine Agenten oder Workflows ohne Bedarf, Tests nur am Modulende. M6 und M7 sind optional und nur auf Wunsch.
- **Stand:** M1–M5 fertig und veröffentlicht. Wo es weitergeht, steht in `v2/docs/UEBERGABE.md` §6.
- **Branches:** auf einem Branch arbeiten (`wip-mN`). Wenn alles grün ist, `main` per Fast-Forward nachziehen und pushen. Das ist die Veröffentlichung.
- **Deploy prüfen:** über GitHub Actions, Workflow «pages build and deployment».
- **Vor jedem Push in `v2/`:**
  - `npx tsc --noEmit`
  - `npx vite build`
  - `npx vitest run`
  - `npx playwright test`

  Umgebungsvariablen und PostgREST stehen in `v2/docs/UEBERGABE.md`.
- **Datenbank:** Änderungen nur als neue Migration (Checkliste in der Übergabe). `v2/db/schema.sql` bleibt unverändert.
