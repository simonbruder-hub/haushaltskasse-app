# Kasse unterwegs

Offline-Begleit-App zur **Haushaltskasse** von Simon und Eliana: Einkaufsliste mit Laden-Tipp, Vorrat, **Quittungen scannen** (Kantenerkennung, automatische Aufnahme, Zuschneiden) und auslesen, **Ablage mit durchsuchbaren PDFs**, Preise über alle Läden vergleichen und ein **Monatsbudget** mit Excel-Export – alles auch ohne Netz.

**In diesem Repository liegt nur Programmcode.** Alle Daten (Einkäufe, Preise, Fotos, Budget) bleiben auf dem Handy und gehen nur per Datei an die Haushaltskasse.

## Installieren (Android)

1. In Chrome öffnen: <https://simonbruder-hub.github.io/haushaltskasse-app/>
2. Oben in der App auf **Installieren** tippen – oder Chrome-Menü (⋮) → **App installieren**.
   Steht dort nur «Zum Startbildschirm hinzufügen», ist schon eine alte Verknüpfung vorhanden: diese vom Startbildschirm entfernen, Seite neu laden, dann erscheint «Installieren».
3. Einmal mit Netz öffnen – danach läuft die App auch offline. Nach einem Update die App einmal ganz schliessen und neu öffnen.
4. Lange auf das App-Symbol tippen: Verknüpfungen «Scannen», «Liste», «Budget».

## Die Register

| Register | Was es kann |
|---|---|
| **Liste** | Einkaufsliste nach Warengruppen, beim Artikel der günstigste bekannte Laden, «Wo heute einkaufen?», Vorrat zu Hause |
| **Preise** | Alle Produkte mit letztem Grundpreis (pro kg, l oder Stück) je Laden, Filter nach Warengruppe, Preis im Laden notieren |
| **Kamera (Mitte)** | Quittung fotografieren und auf dem Handy auslesen, prüfen, speichern; von Hand erfassen; Gekocht |
| **Budget** | Einnahmen, feste und variable Kosten, Rückstellungen, Sparen – pro Monat, pro Person, Jahresplan, Ist-Vergleich, Faustregeln, Excel-Export |
| **Abgleich** | Stand aus der Haushaltskasse laden, Erfasstes senden, aufräumen, Einstellungen |

## Quittung scannen und auslesen

**Scannen** öffnet die Kamera direkt in der App (die App bleibt offen, nichts geht verloren):

- **Kantenerkennung** – die App sucht die Quittung im Bild (geglättete Helligkeit und «Papierfarbe», Sobel-Gradient, Hough-Linien getrennt nach Richtung des Helligkeitssprungs, Prüfung auf hellere Papierseite). Funktioniert auch auf hellem Stein oder Holz.
- **Automatische Aufnahme** – sobald die Quittung erkannt ist und das Handy ruhig ist, löst die App aus (Ring um den Auslöser). «Manuell» schaltet das ab. Lange Quittungen Teil für Teil.
- **Entzerren** – die vier Ecken werden auf ein Rechteck abgebildet (Perspektivkorrektur), als hätte man genau von oben fotografiert.
- **Verbessern** – «Kontrast» rechnet Schatten und ungleichmässiges Licht heraus, «S/W» macht reines Schwarz-Weiss, «Farbe» lässt das Bild wie es ist.
- **Zuschneiden** – jedes Foto (auch aus der Galerie) lässt sich mit Ecken und Kanten anpassen, mit Lupe. Den Kopf mit Adresse wegzuschneiden hilft der Texterkennung.

Danach liest die App Laden, Datum, Total, Artikel und Preise (Texterkennung mit Tesseract, ohne Internet) und zeigt eine digitale Quittung mit «Wofür ausgegeben» und Preisvergleich. Gescannte Quittungen liest sie deutlich besser und schneller als normale Fotos.

- Gelb markierte Zeilen waren unsicher – mit dem Bon vergleichen und mit ✓ bestätigen.
- Weicht die Summe der Artikel vom Total ab, steht das in der Quittung.
- Beim ersten Auslesen lädt die App die Texterkennung einmalig (rund 5 MB). Ein Foto braucht etwa eine halbe bis eine Minute.

## Ablage

Beim Speichern einer gescannten Quittung kommt sie (wenn angehakt) in die **Ablage** auf dem Handy: Bild in hoher JPEG-Qualität und erkannter Text. Die Ablage ist durchsuchbar (Laden, Artikel, Betrag); jede Quittung lässt sich als **PDF mit unsichtbarer Textebene** teilen oder speichern – im PDF-Leser kann man darin suchen und Text kopieren.

## Nichts geht verloren

Android beendet Apps im Hintergrund. Deshalb sichert die App alle ungespeicherten Eingaben, Fotos und gelesenen Quittungen laufend und stellt sie beim nächsten Start wieder her («Wiederhergestellt – noch nicht gespeichert»).

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
| `bon.js` | Quittungen auslesen: Bild aufbereiten, Texterkennung in zwei Durchgängen, Artikel/Preise/Total, Kopf/Adresse ausfiltern |
| `bild.js`, `scan-worker.js` | Bildverarbeitung: Kantenerkennung, Perspektive entzerren, Kontrast/Schwarz-Weiss, drehen (Erkennung im Hintergrund-Worker) |
| `scanner.js` | Kamera in der App mit automatischer Aufnahme, Zuschneide-Editor mit Lupe |
| `ablage.js`, `pdf.js` | Ablage der Quittungen, durchsuchbares PDF ohne Bibliothek |
| `entwurf.js` | Ungespeicherte Eingaben laufend sichern und wiederherstellen |
| `excel.js` | Excel-Datei erzeugen (ohne Bibliothek, offline) |
| `ocr/` | [Tesseract.js](https://github.com/naptha/tesseract.js) 6.0.1 mit Core 6.0.0 und deutschem Sprachmodell (`tessdata_best`), Apache-2.0 (siehe `ocr/LICENSE-*`) |
| `fonts/` | Bricolage Grotesque und IBM Plex Mono, SIL Open Font License (siehe `fonts/LICENSE-*`) |
| `sw.js` | Service Worker – hält die App offline verfügbar. Bei Änderungen `VERSION` erhöhen; bei neuen Dateien in `ocr/` zusätzlich `OCR_CACHE`. |
| `manifest.webmanifest`, `icon-*.png`, `screenshot-*.png` | Installation (mit Screenshots für den Installationsdialog), App-Icons, Verknüpfungen |
