# Kasse unterwegs

Offline-Begleit-App zur **Haushaltskasse** von Simon und Eliana: Einkaufsliste, Vorrat, Preise nachschlagen, Einkäufe und Quittungsfotos erfassen – auch ohne Netz.

**In diesem Repository liegt nur Programmcode.** Alle Daten (Einkäufe, Preise, Fotos) bleiben auf dem Handy und gehen nur per Datei an die Haushaltskasse.

## Installieren (Android)

1. In Chrome öffnen: <https://simonbruder-hub.github.io/haushaltskasse-app/>
2. Chrome-Menü (⋮) → **App installieren** (oder «Zum Startbildschirm hinzufügen»).
3. Einmal mit Netz öffnen – danach läuft die App auch offline.

## Abgleich mit der Haushaltskasse

1. Haushaltskasse → Übersicht → **Stand fürs Handy speichern** → in der App unter *Abgleich* laden.
2. Unterwegs erfassen (auch offline).
3. In der App unter *Abgleich* → **Datei erstellen** → in der Haushaltskasse **Vom Handy importieren**. Quittungsfotos liest dort Claude aus.
4. In der App **Gesendetes entfernen** und einen neuen Stand laden.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | die ganze App |
| `sw.js` | Service Worker – hält die App offline verfügbar. Bei Änderungen `VERSION` erhöhen. |
| `manifest.webmanifest` | Name, Farben, Icons für die Installation |
| `icon-*.png`, `apple-touch-icon.png` | App-Icons |

## GitHub Pages einschalten

Settings → Pages → *Build and deployment*: Source **Deploy from a branch**, Branch **main**, Ordner **/ (root)** → Save.
