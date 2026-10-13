# Kasse unterwegs

Offline-Begleit-App zur **Haushaltskasse** von Simon und Eliana: Einkaufsliste, Vorrat, Preise nachschlagen, Einkäufe erfassen und **Quittungen per Foto auslesen** – auch ohne Netz.

**In diesem Repository liegt nur Programmcode.** Alle Daten (Einkäufe, Preise, Fotos) bleiben auf dem Handy und gehen nur per Datei an die Haushaltskasse.

## Installieren (Android)

1. In Chrome öffnen: <https://simonbruder-hub.github.io/haushaltskasse-app/>
2. Chrome-Menü (⋮) → **App installieren** (oder «Zum Startbildschirm hinzufügen»).
3. Einmal mit Netz öffnen – danach läuft die App auch offline.

## Quittung auslesen

*Erfassen* → **Foto aufnehmen** (oder *Aus Galerie*). Die App liest Laden, Datum, Total, Artikel und Preise direkt auf dem Handy (Texterkennung mit Tesseract, ohne Internet) und füllt das Formular *Prüfen & speichern* aus:

- Gelb markierte Zeilen waren unsicher – mit dem Bon vergleichen und mit ✓ bestätigen.
- Weicht die Summe der Artikel vom Total ab, steht das unter der Artikelliste.
- Namen vom Bon werden auf eure gewohnten Produktnamen abgebildet (aus dem Stand der Haushaltskasse), der Preisvergleich zeigt sofort, was teurer oder anderswo günstiger ist.
- Nach dem Speichern wird das Foto verworfen. Wer lieber Claude lesen lässt: *Nur das Foto aufheben*.

Beim ersten Auslesen lädt die App die Texterkennung einmalig (rund 5 MB), danach läuft alles offline. Ein Foto braucht etwa eine halbe bis eine Minute.

## Abgleich mit der Haushaltskasse

1. Haushaltskasse → Übersicht → **Stand fürs Handy speichern** → in der App unter *Abgleich* laden.
2. Unterwegs erfassen (auch offline).
3. In der App unter *Abgleich* → **Datei erstellen** → in der Haushaltskasse **Vom Handy importieren**. Quittungsfotos liest dort Claude aus.
4. In der App **Gesendetes entfernen** und einen neuen Stand laden.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | die ganze App |
| `bon.js` | Quittungen auslesen: Bild aufbereiten, Texterkennung in zwei Durchgängen, Artikel/Preise/Total herauslesen |
| `ocr/` | Texterkennung [Tesseract.js](https://github.com/naptha/tesseract.js) 6.0.1 mit Core 6.0.0 und deutschem Sprachmodell (`tessdata_best`), alles Apache-2.0 (siehe `ocr/LICENSE-*`) |
| `sw.js` | Service Worker – hält die App offline verfügbar. Bei Änderungen `VERSION` erhöhen; bei neuen Dateien in `ocr/` zusätzlich `OCR_CACHE`. |
| `manifest.webmanifest` | Name, Farben, Icons für die Installation |
| `icon-*.png`, `apple-touch-icon.png` | App-Icons |

## GitHub Pages einschalten

Settings → Pages → *Build and deployment*: Source **Deploy from a branch**, Branch **main**, Ordner **/ (root)** → Save.
