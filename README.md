# Kasse unterwegs

Offline-Begleit-App zur **Haushaltskasse** von Simon und Eliana: Einkaufsliste mit Laden-Tipp, Vorrat, **Quittungen per Foto auslesen**, Preise über alle Läden vergleichen und ein **Monatsbudget** mit Excel-Export – alles auch ohne Netz.

**In diesem Repository liegt nur Programmcode.** Alle Daten (Einkäufe, Preise, Fotos, Budget) bleiben auf dem Handy und gehen nur per Datei an die Haushaltskasse.

## Installieren (Android)

1. In Chrome öffnen: <https://simonbruder-hub.github.io/haushaltskasse-app/>
2. Chrome-Menü (⋮) → **App installieren** (oder «Zum Startbildschirm hinzufügen»).
3. Einmal mit Netz öffnen – danach läuft die App auch offline. Nach einem Update die App einmal ganz schliessen und neu öffnen.

## Die Register

| Register | Was es kann |
|---|---|
| **Liste** | Einkaufsliste nach Warengruppen, beim Artikel der günstigste bekannte Laden, «Wo heute einkaufen?», Vorrat zu Hause |
| **Preise** | Alle Produkte mit letztem Grundpreis (pro kg, l oder Stück) je Laden, Filter nach Warengruppe, Preis im Laden notieren |
| **Kamera (Mitte)** | Quittung fotografieren und auf dem Handy auslesen, prüfen, speichern; von Hand erfassen; Gekocht |
| **Budget** | Einnahmen, feste und variable Kosten, Rückstellungen, Sparen – pro Monat, pro Person, Jahresplan, Ist-Vergleich, Faustregeln, Excel-Export |
| **Abgleich** | Stand aus der Haushaltskasse laden, Erfasstes senden, aufräumen, Einstellungen |

## Quittung auslesen

Foto aufnehmen (oder aus der Galerie). Die App liest Laden, Datum, Total, Artikel und Preise direkt auf dem Handy (Texterkennung mit Tesseract, ohne Internet) und zeigt eine digitale Quittung mit «Wofür ausgegeben» und Preisvergleich.

- Gelb markierte Zeilen waren unsicher – mit dem Bon vergleichen und mit ✓ bestätigen.
- Weicht die Summe der Artikel vom Total ab, steht das in der Quittung.
- Beim ersten Auslesen lädt die App die Texterkennung einmalig (rund 5 MB). Ein Foto braucht etwa eine halbe bis eine Minute.

## Gleiche Produkte, verschiedene Namen

Jeder Laden schreibt anders: «Hähnchen-Brustfilet XXL» (Lidl), «M-Classic Pouletbrust» (Migros), «Naturafarm Poulet-Brüstli» (Coop). Damit Preise vergleichbar werden, ordnet die App jeden Bon-Text einem **Grundprodukt** zu (`produkte.js`, rund 160 Produkte in 12 Warengruppen):

1. **Gelernt** – was ihr schon einmal zugeordnet habt (auf dem Handy und aus der Haushaltskasse), gewinnt immer.
2. **Katalog** – Stichwörter und Synonyme (Hähnchen = Poulet, Karotten = Rüebli, Sahne = Rahm …), Markennamen werden ignoriert, kleine Lesefehler toleriert.
3. **Selbst wählen** – Produktnamen antippen, suchen, wählen. Die App merkt sich die Wahl für diesen Bon-Text.

Bio wird als eigene Qualität geführt («Gurke (Bio)»), damit Bio nicht mit konventionell verglichen wird. Verglichen wird der **Grundpreis**: dafür im Feld «Packung» die Grösse eintragen (z. B. «500 g», «1 l», «6 Stk») – auch das merkt sich die App.

## Budget und Excel

Gliederung wie in Schweizer Budgetvorlagen: Einnahmen · Wohnen & Energie · Versicherungen · Steuern · Mobilität · Haushalt & Essen · Persönliches & Freizeit · Rückstellungen · Sparen & Vorsorge. Jeder Posten hat Betrag, «wie oft» (monatlich, wöchentlich, vierteljährlich, halbjährlich, jährlich), «wer» (gemeinsam, Simon, Eliana) und bei Jahresrechnungen den Fälligkeitsmonat.

**Als Excel-Tabelle speichern** erzeugt direkt auf dem Handy eine `.xlsx` mit Formeln (Übersicht, Budget, Jahresplan, Ist-Vergleich, Anleitung). Eine leere Vorlage liegt als `Haushaltsbudget-Vorlage.xlsx` bei. Das Budget geht beim Abgleich an die Haushaltskasse und von dort mit dem nächsten Stand aufs andere Handy.

## Abgleich mit der Haushaltskasse

1. Haushaltskasse → Übersicht → **Stand fürs Handy speichern** → in der App unter *Abgleich* laden.
2. Unterwegs erfassen (auch offline).
3. In der App unter *Abgleich* → **Datei erstellen** → in der Haushaltskasse **Vom Handy importieren**.
4. In der App **Gesendetes entfernen** und einen neuen Stand laden.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | Gerüst und Gestaltung |
| `kern.js` | Hilfen, Symbole, Speicher (IndexedDB), Register, Stand, Preisvergleich |
| `liste.js`, `preise.js`, `erfassen.js`, `budget.js`, `abgleich.js` | die Register |
| `produkte.js` | Produktkatalog: Bon-Text → Grundprodukt, Warengruppe, Bio, Packungsgrösse |
| `bon.js` | Quittungen auslesen: Bild aufbereiten, Texterkennung in zwei Durchgängen, Artikel/Preise/Total |
| `excel.js` | Excel-Datei erzeugen (ohne Bibliothek, offline) |
| `ocr/` | [Tesseract.js](https://github.com/naptha/tesseract.js) 6.0.1 mit Core 6.0.0 und deutschem Sprachmodell (`tessdata_best`), Apache-2.0 (siehe `ocr/LICENSE-*`) |
| `fonts/` | Bricolage Grotesque und IBM Plex Mono, SIL Open Font License (siehe `fonts/LICENSE-*`) |
| `sw.js` | Service Worker – hält die App offline verfügbar. Bei Änderungen `VERSION` erhöhen; bei neuen Dateien in `ocr/` zusätzlich `OCR_CACHE`. |
| `manifest.webmanifest`, `icon-*.png` | Installation und App-Icons |
