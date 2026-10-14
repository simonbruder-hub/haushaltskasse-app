# Blueprint v2 · Haushalt & Finanzen

Stand 14.10.2026 · Fundament für die Umsetzung Modul für Modul · noch **kein** Frontend-Code

**Was sich gegenüber v1 geändert hat (dein Feedback)**

| Thema | v1 | v2 |
|---|---|---|
| Teilung | 6 Methoden (Einkommen, Tage, Fixbetrag …) | **immer 50/50**. Jede Position gehört einem **Topf**: gemeinsam (50/50) oder eine Person (100 %). |
| Gutscheine | zählten als Beitrag der Person, der sie gehören | **kein Einfluss** auf die Beteiligung. Ein Gutschein wird anteilig wie der Einkauf verteilt. |
| Rückgaben | Status, Verknüpfung, Budget rückwirkend | **entfällt**. Geld, das zurückkommt, ist eine Gutschrift im Monat, in dem es eintrifft. |
| Budgets | Haushalt oder Person | **heute pro Person** (My Share). **Später pro Konto/Topf** – beides ist vorbereitet. |
| Konten | Zahlungsmittel pro Person | **Kontenmodell**: Privatkonten, Gemeinsam Leben, je Sparen und Freizeit, Kinder, weitere Zweck-Konten. Daueraufträge, Kontostände. |
| Gäste | Personen ohne Haushaltsmitgliedschaft | entfällt. Dafür gibt es **Kinder** als Personen, ihre Kosten tragen die Eltern 50/50. |

| Datei | Inhalt |
|---|---|
| `BLUEPRINT.md` | dieses Dokument: Entscheidungen, Formeln, Beispiele, Scanner-Pipeline |
| `schema.sql` | vollständiges PostgreSQL-Schema: 41 Tabellen, 11 Views, Rechenfunktionen, Trigger |
| `pruefen.mjs` | spielt alle Rechenbeispiele dieses Dokuments in einer echten Postgres-Instanz (PGlite) durch → **59/59 bestanden** |
| `scanner/receipt_extraction.schema.json` | JSON-Schema der Belegextraktion (Ausgabe des Vision-Modells) |
| `scanner/alias_resolution.schema.json` | JSON-Schema für die Zuordnung unbekannter Belegzeilen |
| `scanner/off_product.schema.json` | Antwort des EAN-Nachschlags inkl. Live-Preisvergleich |
| `scanner/qr_bill.schema.json` | Ergebnis des QR-Rechnungs-Parsers (SPC 0200, Swico S1) |
| `scanner/system_prompt_beleg.md` | Systemprompt für das Vision-Modell |
| `scanner/beispiele/migros_beispiel_A.json` | Beispielausgabe von Kanal 1 |
| `pruefen-scanner.mjs` | prüft Schemas, Summen, QR-Prüfziffern und den Mengen-Parser → **27/27 bestanden** |

---

## 0. Stack und Annahmen

Im Briefing war der Stack noch ein Platzhalter. Hier ist mein Vorschlag, passend zu dem, was heute schon läuft: «Kasse unterwegs» ist eine PWA auf Android, gehostet auf GitHub Pages, mit funktionierendem Dokumentscanner und Offline-Texterkennung.

| Schicht | Wahl | Warum |
|---|---|---|
| App | **Next.js** (App Router, statischer Export) + **TypeScript** + **Tailwind**, als installierbare PWA | Typsicherheit für die Geldlogik. Der statische Export läuft weiter auf GitHub Pages. |
| Daten | **Supabase**: Postgres 15+, Auth, Row Level Security, Storage für Belegbilder und PDFs, Edge Functions, pg_cron | `schema.sql` läuft dort unverändert. pg_cron bucht Daueraufträge und Sparraten. |
| Offline | **PowerSync**: lokale SQLite-Kopie im Browser, die mit Postgres synchronisiert (Alternative: Dexie + Outbox-Warteschlange) | Im Laden ist der Empfang oft schlecht, der Live-Preisvergleich braucht die Preise aber lokal. Tarif vor dem Entscheid prüfen. |
| Rechenlogik | Einmal in SQL als Quelle der Wahrheit (hier geprüft). Zusätzlich identisch als TypeScript-Paket `domain` für die Vorschau offline. | Beide Varianten laufen gegen dieselben Testfälle wie `pruefen.mjs`. |
| Scanner | BarcodeDetector-API (Android Chrome), ZXing als Fallback (iOS). Der bestehende Dokumentscanner und Tesseract werden übernommen. | Bereits erprobter Code, Tesseract bleibt der Offline-Weg. |
| KI | **Claude API** (`claude-opus-5-5`), nur serverseitig in einer Edge Function | Der API-Schlüssel kommt nie aufs Handy. |
| Produktdaten | OpenFoodFacts API v2, dazu Open Beauty Facts und Open Products Facts | frei, gute Abdeckung für Schweizer EANs |

**Annahmen**
- Ein Haushalt mit Simon und Eliana. **Kinder** kommen später als Personen dazu (`role = child`). Sie bezahlen nichts, ihre Kosten tragen die Eltern 50/50.
- **Teilung ist immer 50/50.** Etwas ist entweder gemeinsam oder gehört einer Person. Andere Verhältnisse gibt es nicht.
- Basiswährung CHF. Fremdwährungen werden mit dem EZB-Tageskurs umgerechnet. Den effektiven Kartenkurs kann man pro Beleg nachtragen.
- Mengen sind metrisch. Intern wird alles in **g, ml oder Stück** gerechnet.
- Alle Geldbeträge sind `numeric`, niemals Fliesskommazahlen.

**Vorschlag für die Reihenfolge der Module**

| # | Modul | Kern |
|---|---|---|
| M1 | Fundament | Schema, Auth, RLS, Sync, Personen, **Konten/Töpfe**, Lebensbereiche, Kategorien |
| M2 | Belege und Ausgleich | manuelle Erfassung, Topf pro Beleg und Position, Saldo, Ausgleichsvorschlag |
| M3 | Scanner Kanal 1 + 3 | Vision-Extraktion, Prüf-Dialog, Alias-Wörterbuch |
| M4 | Scanner Kanal 2 | EAN-Scan, OpenFoodFacts, Live-Preischeck, Preisalarme |
| M5 | Budget und Konten | Personenbudgets, Safe-to-Spend, Fixkosten, Verträge, Sinking Funds, Daueraufträge, Kontostände, 50/30/20 |
| M6 | Scanner Kanal 4 + Planung | QR-Rechnungen, Garantien, Smart Basket, Verbrauchszyklus |
| M7 | Import | Daten aus Haushaltskasse und Kasse unterwegs, Cumulus/Supercard |

---

## 1. Datenmodell

### 1.1 Überblick

| Bereich | Tabellen |
|---|---|
| Mandant und Personen | `household`, `household_setting`, `app_user`, `household_member`, `person`, `person_income` |
| **Konten und Töpfe** | **`account`**, **`account_owner`**, **`standing_order`**, **`transfer`** |
| Währung | `currency`, `fx_rate` |
| Stammdaten | `merchant`, `merchant_branch`, `life_area`, `category`, `payment_method` |
| Katalog (2 Stufen) | `master_product` ← `merchant_product`, `off_cache`, **`receipt_alias_mapping`** |
| Belege | `transaction_header`, `transaction_payment`, **`line_item`**, `line_item_discount`, `line_item_allocation`, `payment_share`, `attachment` |
| Scanner | `scan_job`, `qr_bill`, `creditor_mapping` |
| Preise und Planung | `price_observation`, `price_alert`, `shopping_list`, `shopping_list_item` |
| Budget | `contract`, `fixed_cost`, `variable_budget`, **`sinking_fund`**, `sinking_fund_entry` |
| Garantie | `warranty` |

### 1.2 Beziehungen (Kern)

```
household ─┬─ person (adult | child) ── person_income
           │
           ├─ account (Konto/Topf) ─┬─ account_owner      wer trägt ihn: 1 Person 100 % oder 50/50
           │                        ├─ payment_method     Karte/Twint gehört zu einem Konto
           │                        ├─ standing_order     Dauerauftrag (Lohn → Töpfe)
           │                        └─ transfer           Einzahlung, Sparen, Ausgleich
           │
           ├─ transaction_header ──┬─ transaction_payment ── account (von welchem Konto) ── payment_share
           │   default_cost_account└─ line_item ──┬─ cost_account_id   Topf der Position (leer = Topf des Belegs)
           │   (Topf des Belegs)                  ├─ line_item_discount
           │                                      ├─ line_item_allocation   ERGEBNIS je Person (CHF)
           │                                      ├─ merchant_product → master_product
           │                                      └─ receipt_alias_mapping
           │
           ├─ master_product ─┬─ merchant_product (EAN, Marke, unit_size, unit_type, pack_count, replaces_id)
           │                  └─ price_observation → price_alert
           ├─ variable_budget (Person ODER Topf) · fixed_cost → Topf · sinking_fund → Konto + Topf
           └─ qr_bill ── creditor_mapping ── fixed_cost / Topf
```

### 1.3 Invarianten (vom Datenbank-Trigger beim Bestätigen erzwungen)

1. **Σ `line_item.final_price` = `total_amount` = Σ `transaction_payment.amount`**
2. `final_price = regular_price − item_discount`. Die Spalte wird generiert und lässt sich nicht von Hand setzen.
3. `item_discount` = Σ `line_item_discount.amount`. Ein Trigger hält das synchron.
4. Die Anteile eines Topfs ergeben genau 100 % (ein Topf mit 60/60 wird abgewiesen, getestet).
5. Pro Position gilt: Σ `line_item_allocation.amount` = `final_price`, auf den Rappen genau. Pro Zahlung gilt: Σ `payment_share` = Betrag.
6. Eine Zahlung mit Karte, Twint, bar oder per Überweisung braucht ein Konto. Nur Gutscheine und Punkte kommen ohne Konto aus.
7. Pro Haushalt und Händler ist jede `receipt_barcode_id` nur einmal erlaubt (eindeutiger Index).

`total_amount` ist bewusst der Betrag **vor** Gutscheinen. Ein Gutschein ist eine Zahlung (§2.2).

### 1.4 Wichtige Feldentscheidungen

| Feld | Entscheidung |
|---|---|
| `account.kind` | `privat` · `leben` · `sparen` · `freizeit` · `kind` · `zweck` (frei für noch unbekannte Zwecke) |
| `account.status` | `virtual` = Topf ohne eigenes Bankkonto (Kosten laufen über Privatkonten) · `active` = echtes Konto · `closed` |
| `account_owner.share` | 1.0 für eine Person, 0.5/0.5 für gemeinsam. Bei Kinder-Töpfen sind die Eltern Eigentümer und das Kind ist `beneficiary_person_id`. |
| `person.default_account_id` | persönlicher Topf: heute «Simon Privat», später «Simon Freizeit». Gilt als Vorschlag für private Positionen. |
| `category.default_cost_account_id` | Standard-Topf der Kategorie, z. B. Lebensmittel, Haushalt, Ferien → Gemeinsam Leben. Ist er leer, gilt der persönliche Topf der einkaufenden Person. |
| `transaction_header.default_cost_account_id` | Topf des Belegs. Positionen ohne eigenen Topf erben ihn. |
| `transaction_payment.account_id` | von welchem Konto bezahlt wurde (über `payment_method`). Bei Gutscheinen und Punkten leer. |
| `quantity`, `unit_size`, `pack_count`, `base_quantity` | wie v1: Snapshot der Packung, Basismenge in g, ml oder Stück (§2.1) |
| `regular_price` / `item_discount` / `final_price` | Betrag der Zeile vor Rabatt / Rabatt ≥ 0 / bezahlt. Eine Gutschrift ist negativ. |
| `line_item_allocation`, `payment_share` | Ergebnis **materialisiert** gespeichert. Budgets und Saldo lesen nur diese Tabellen. |
| `fx_rate` | CHF pro 1 Einheit Fremdwährung. `total_amount_base` wird generiert. |
| Primärschlüssel | uuid. Der Client erzeugt UUIDv7, damit Belege auch offline angelegt werden können. |

### 1.5 Sicherheit (RLS) und Sync

- Jede Fachtabelle trägt `household_id` direkt oder über den Beleg. Muster für die Policy:
  `using (household_id in (select household_id from household_member where user_id = auth.uid()))`.
- Für alle angemeldeten Personen nur lesbar: `currency`, `fx_rate`, `off_cache`, globale `merchant`.
- PowerSync-Buckets sind pro `household_id` organisiert. Bei Konflikten gewinnt die letzte Änderung pro Zeile (`updated_at`).
- `line_item_allocation`, `payment_share`, `price_observation` und `price_alert` schreibt der Server. Offline zeigt das `domain`-Paket eine Vorschau mit identischer Logik.
- Die Anteile eines Topfs ändert man nicht nachträglich. Für eine neue Aufteilung legt man einen neuen Topf an, damit alte Belege stimmen.

---

## 2. Rechenlogik

Alle Zahlen in diesem Kapitel stammen aus `pruefen.mjs` und wurden gegen das Schema gerechnet.

### 2.1 Einheitspreis-Normalisierung

**Basismenge einer Position** (`base_quantity`, Einheit g, ml oder Stück)

```
Offenverkauf (quantity_unit ≠ piece):   B = quantity × f(quantity_unit)
Packungsware mit Grösse:                 B = quantity × unit_size × f(unit_type) × pack_count
Stückware ohne Grösse:                   B = quantity × pack_count                 (Dimension «Stück»)
   mit f(kg) = f(l) = 1000, sonst 1
```

**Vergleichsmenge und Einheitspreis**

```
D = 100 (per_100g, per_100ml) · 1000 (per_1kg, per_1l) · 1 (per_piece)
V = B / D                                   wenn die Dimension passt
V = B × ρ / D   bzw.   V = B / ρ / D        g↔ml nur mit Dichte ρ (master_product.density_g_per_ml)
V = null                                    sonst: «nicht vergleichbar», es wird nie geraten

normalized_regular = regular_price / V      Regulärpreis pro Vergleichseinheit
normalized_paid    = final_price   / V      Aktionspreis bzw. bezahlter Preis pro Vergleichseinheit
```

Gespeichert wird beides (4 Nachkommastellen, in CHF) in `price_observation`, und zwar pro **Packung** bzw. pro kg oder l bei Offenverkauf. So lassen sich Beobachtungen von Belegen und aus dem Laden direkt vergleichen.

| Fall | Rechnung | Ergebnis |
|---|---|---|
| Kaffee 500 g, regulär 12.90, Aktion −3.90 | 12.90 / 0.5 · 9.00 / 0.5 | **25.80 /kg regulär · 18.00 /kg bezahlt** |
| Mineral 6 × 1.5 l, 5.70 | B = 9000 ml, V = 9 | **0.6333 /l** |
| Bananen 0.734 kg, 2.13 | B = 734 g | **2.9019 /kg** (2.90 laut Beleg, wenn `regular_unit_price` gedruckt ist) |
| Joghurt 500 ml, Vergleich per_100g, ρ = 1.03 | V = 500 · 1.03 / 100 | **0.3786 /100 g** |
| Joghurt 500 ml ohne Dichte | Dimension passt nicht | **null** (nicht vergleichbar) |

**Regeln**
- Gutscheine und Punkte verändern den Einheitspreis **nie** (§2.2).
- Ein Rabatt auf den ganzen Bon wird zuerst anteilig auf die Positionen verteilt. Danach zählt er wie ein Aktionspreis.
- `regular_known = false` gilt, wenn ein Artikel als Aktion markiert ist, aber kein Regulärpreis gedruckt war. Solche Beobachtungen zählen für Preisvergleiche, lösen aber **keine** Preisalarme aus.

### 2.2 Artikelrabatt vs. Gutschein

| | Artikelrabatt (`item_discount`, `is_promo`) | Gutschein oder Treue-Einlösung (`voucher_or_loyalty_redeemed`) |
|---|---|---|
| Erkennung | Aktion, −30 %, 2 für 1, 3 für 2, Mengenrabatt, Abschreibung, Kurz-MHD, Rabattzeile unter dem Artikel | Geschenkkarte, Gutschein, Cumulus-Bon, Superpunkte, Reka, Lunch-Check |
| Buchung | `line_item_discount` → `item_discount` der Position | `transaction_payment` ohne Konto (`kind` = voucher, gift_card, loyalty_points …) |
| Einkaufspreis bzw. `final_price` | **sinkt** | **unverändert** |
| Einheitspreis und Preisvergleich | Aktionspreis wird erfasst, der Regulärpreis bleibt Referenz | kein Einfluss |
| My Share und Budget | tiefer, weil der Einkauf wirklich billiger war | **unverändert** |
| Beteiligung (50/50) | – | **kein Einfluss**: Der Gutschein wird im gleichen Verhältnis verteilt wie der Einkauf. Niemand bekommt ihn allein gutgeschrieben. |
| Bericht | «gespart durch Aktionen» | «Gutscheine und Punkte eingelöst» |

**Bonrabatt** (z. B. 10 % auf alles) wird anteilig auf die Positionen verteilt (`basket_allocated`). **Rappenrundung** wird eine Gebührenzeile «Rundung» im Topf des Belegs. Dadurch geht Invariante 1 immer auf.

**Beispiel A** (Migros, 3.10.2026, Topf des Belegs = Gemeinsam Leben, Simon zahlt mit seiner Debitkarte)

| Pos. | Beleg | regulär | Rabatt | final | Topf | Simon | Eliana |
|---|---|---:|---:|---:|---|---:|---:|
| 1 | 2 x M-CL VOLLMI UHT 1L | 3.30 | | 3.30 | Gemeinsam | 1.65 | 1.65 |
| 2 | BONCAMPO BOHNEN 500G | 12.90 | 3.90 | 9.00 | Gemeinsam | 4.50 | 4.50 |
| 3 | BANANEN 0.734 kg | 2.13 | | 2.13 | Gemeinsam | **1.07** | **1.06** |
| 4 | SHAMPOO REPAIR 250ML | 6.95 | | 6.95 | Simon | 6.95 | |
| 5 | GESICHTSCREME 50ML | 15.80 | | 15.80 | Eliana | | 15.80 |
| | **Total** | | **3.90** | **37.18** | | **14.17** | **23.01** |

Bezahlt wurde mit einem Cumulus-Bon über 5.00 und 32.18 von «Simon Privat».
- Der Gutschein wird wie der Einkauf verteilt, also Simon 14.17/37.18 = **1.91** und Eliana **3.09**.
- **Saldo aus diesem Beleg:** Simon +19.92 (= 32.18 + 1.91 − 14.17), Eliana −19.92. Eliana schuldet also nur, was Simon für sie mit **echtem Geld** bezahlt hat.
- Der Kaffee kostet 18.00 /kg, mit oder ohne Gutschein. Vorher kostete er 23.00 /kg, das sind **+12.17 %** und damit ein Preissprung-Alarm (§2.7).

### 2.3 Töpfe und Konten (immer 50/50)

Jede Position gehört genau einem **Topf** (`account`). Ein Topf gehört entweder einer Person (100 %) oder beiden (50/50). Etwas anderes gibt es nicht. Mehr braucht die Teilung nicht:

```
Anteil_p an einer Position = final_price × account_owner.share(Topf, p)
My Share_p                 = Σ Anteile von p        (True Expense, Basis für Budgets und 50/30/20)
```

**Welcher Topf?** Für jede Position gilt die erste passende Regel:

1. von Hand gewählt (im Prüf-Dialog: *Gemeinsam · Simon · Eliana · Kind 1 …*)
2. Standard-Topf der Kategorie (Lebensmittel, Haushalt, Ferien → Gemeinsam Leben)
3. Topf des Belegs
4. persönlicher Topf der einkaufenden Person

**Rappen:** Bei 50/50 und einem ungeraden Rappenbetrag bekommt **abwechselnd** einmal Simon, einmal Eliana den Rappen, je nach Positionsnummer. Über viele Belege gleicht sich das aus.

**Fremdwährung:** CHF pro Position = `round(final × fx, 2)`. Der Rundungsrest des Belegs geht auf die grösste Position. Beispiel Lidl Konstanz: EUR 50.00 × 0.94 = CHF 47.00, Positionen 33.34 + 16.66 EUR → CHF 31.34 + 15.66 → je 15.67 + 7.83.

**Kontenplan: heute und später**

| Konto / Topf | Art | gehört | wofür | heute | später |
|---|---|---|---|---|---|
| Simon Privat · Eliana Privat | privat | je 100 % | Lohnkonto, persönliche Ausgaben | **aktiv** | bleibt Lohnkonto |
| Gemeinsam Leben | leben | 50/50 | Essen, Haushalt, Wohnen, Ferien, Ausgehen | **virtuell**: Kosten laufen über die Privatkonten, der Saldo zeigt den Ausgleich | **aktiv**: eigenes Konto mit Karte, beide zahlen per Dauerauftrag ein |
| Simon Sparen · Eliana Sparen | sparen | je 100 % | Sparen, Sinking Funds | virtuell | aktiv |
| Simon Freizeit · Eliana Freizeit | freizeit | je 100 % | persönliche Ausgaben, Hobby | – | aktiv (ersetzt «Privat» als persönlichen Topf) |
| Kind 1, Kind 2 … | kind | Eltern 50/50, Kind = Begünstigte | Kinderkosten oder Kindersparen | – | bei Bedarf |
| weitere | zweck | frei | noch unbekannte Zwecke (Auto, Haus …) | – | jederzeit |

**Umstellung auf echte Konten ohne Umbau:**
1. Konto auf `active` setzen, IBAN und Eröffnungsdatum eintragen.
2. Karte bzw. Twint (`payment_method`) dem Konto zuordnen.
3. Daueraufträge erfassen (`standing_order`), z. B. Lohn → Leben 2000, → Sparen 500, → Freizeit 300.
4. Den persönlichen Topf von «Privat» auf «Freizeit» umstellen und die Budgets bei Bedarf von Person auf Topf umstellen (§2.6).

Alte Belege bleiben, wie sie sind. Die Saldo-Formel (§2.4) gilt in beiden Phasen unverändert.

### 2.4 Cashflow, My Share und Saldo

```
Zahlung von Konto K       → wird den Eigentümern von K nach Anteil zugerechnet (payment_share)
Gutschein/Punkte          → im Verhältnis der Kostenanteile des Belegs (neutral)
Überweisung von K nach Z  → verschiebt für jede Person: Betrag × (Anteil_p an K − Anteil_p an Z)
Einnahme von aussen       → neutral (Lohn, Kinderzulage)

Saldo_p = Σ zugerechnete Zahlungen_p − My Share_p + Σ Überweisungseffekte_p
          > 0: p hat für den anderen mitbezahlt · < 0: p schuldet · Σ über beide = 0
```

Das funktioniert heute (alles läuft über Privatkonten) genauso wie später (fast alles läuft über das gemeinsame Konto):
- Zahlt das gemeinsame Konto gemeinsame Kosten, entsteht kein Saldo.
- Zahlen beide gleich viel ein, entsteht auch keiner.
- Ein Saldo entsteht nur, wenn jemand privat für den gemeinsamen Topf bezahlt oder ungleich einzahlt.

**Phase 1 (heute):** nur Privatkonten, Topf «Gemeinsam Leben» virtuell

| Datum | Beleg | Topf | bezahlt von | Saldo Simon |
|---|---|---|---|---:|
| 20.08. | Ferienhaus Tessin 1400.00 | Gemeinsam | Simon Privat | +700.00 |
| 01.09. | Migros Milch 3.30 | Gemeinsam | Simon Privat | +1.65 |
| 15.09. | Migros 450.00 | Gemeinsam | Eliana Privat | −225.00 |
| 20.09. | Dentalhygiene 280.00 | Simon | Simon Privat | 0.00 |
| 28.09. | Bratpfanne 79.90 | Gemeinsam | Simon Privat | +39.95 |
| 03.10. | Beispiel A 37.18 (inkl. Cumulus 5.00) | gemischt | Simon Privat | +19.92 |
| 05.10. | Gutschrift Bratpfanne −79.90 | Gemeinsam | auf Simon Privat | −39.95 |
| 10.10. | Coop 95.40 | Gemeinsam | Eliana Privat | −47.70 |
| 11.10. | Restaurant 96.00 inkl. Trinkgeld | Gemeinsam | Simon Privat | +48.00 |
| 12.10. | Lidl Konstanz EUR 50.00 = CHF 47.00 | Gemeinsam | Eliana Privat | −23.50 |
| | **Saldo** | | | **+473.37** |
| 13.10. | Ausgleich Twint Eliana → Simon 300.00 | | | −300.00 |
| | **offen** | | | **+173.37** |

**Phase 2 (später):** gemeinsames Konto aktiv, Spar- und Freizeitkonten, ein Kind

| Datum | Vorgang | Saldo Simon |
|---|---|---:|
| 01.11. | Daueraufträge: Simon → Leben 2000, Eliana → Leben **1800** | +100.00 |
| 01.11. | Daueraufträge auf eigene Spar- und Freizeitkonten | 0.00 |
| 05.11. | Migros 120.00, Topf Gemeinsam, **Karte Leben** | 0.00 |
| 07.11. | Velohelm 59.90, Topf Simon Freizeit, Karte Simon Freizeit | 0.00 |
| 08.11. | Coop 40.00, Topf Gemeinsam, aus Versehen **Simons Privatkarte** | +20.00 |
| 10.11. | Windeln 30.00, Topf «Kind 1», Karte Leben (Eltern tragen je 15.00) | 0.00 |
| | **offen** (inkl. 173.37 aus Phase 1) | **+293.37** |

**Ausgleichsvorschlag** (`suggest_settlements`): Eliana → Simon **293.37**. Gleichwertig wäre: Eliana zahlt **586.74** zusätzlich aufs Leben-Konto, die Hälfte davon gehört ja ihr.

**Kontostände** (`v_account_balance`, Phase 2): Gemeinsam Leben **3650.00** (3800 eingezahlt − 150 ausgegeben) · Simon Freizeit **240.10** · Simon Sparen **500.00**. Für Privatkonten gibt es keinen sinnvollen Kontostand, weil dort der Lohn nicht erfasst ist.

**Cashflow** pro Konto und Monat (`v_account_flow_month`): Leben im November hatte 3800 Eingang und 150 Ausgang.

### 2.5 Rückvergütungen und Gutschriften

Rückgaben werden nicht mehr verfolgt. **Geld, das zurückkommt, ist eine Gutschrift an dem Tag, an dem es eintrifft:**
- Beleg mit `kind = 'refund'` und einer Position mit negativem Betrag, Kategorie nach Wahl (meist die des Einkaufs)
- eine negative Zahlung auf das Konto, das das Geld erhält
- der Topf wie beim Einkauf, sodass ein gemeinsamer Einkauf auch gemeinsam zurückkommt

**Beispiel:** Bratpfanne 79.90 im September, Gutschrift im Oktober. Das Budget Haushalt von Simon zeigt im September 39.95. Im Oktober steht −32.25, nämlich −39.95 Gutschrift + 7.70 WC-Papier. Der Saldo gleicht sich automatisch aus (+39.95 und −39.95).

### 2.6 Budget

**Lebensbereiche** (`life_area`) enthalten Kategorien. Jede Ausgabe ist über ihre Kategorie genau einem Lebensbereich zugeordnet.

#### Variable Budgets: heute pro Person, später pro Topf

| `scope` | belastet mit | Beispiel |
|---|---|---|
| `person` (heute) | **My Share** der Person: die Hälfte aller gemeinsamen Kosten + 100 % ihrer eigenen | «Lebensmittel Simon» 300/Monat |
| `account` (später) | **alle Kosten eines Topfs** | «Leben: Lebensmittel» 800/Monat · «Simon Freizeit» 300/Monat · «Kind 1» 200/Monat |

Beide Varianten gelten für einen Lebensbereich, eine Kategorie oder alles. Sie können auch gleichzeitig bestehen.

```
verfügbar_m      = Budget_m + Übertrag_(m−1)
Übertrag         none: 0 · surplus_only: max(verfügbar − ausgegeben, 0) · surplus_and_deficit: verfügbar − ausgegeben
Safe-to-Spend    = (verfügbar − ausgegeben bis gestern) / verbleibende Tage inkl. heute   → auf 0.05 abgerundet
heute noch       = Safe-to-Spend − heute ausgegeben
Burn-Rate        = ausgegeben inkl. heute / Tag im Monat
Hochrechnung     = Burn-Rate × Tage im Monat
Tempo            on_track (≤ verfügbar) · warning (≤ 110 %) · over
```

Kategorien mit einem aktiven Sinking Fund (gleicher Topf und gleiche Kategorie) belasten den **Fonds statt das Budget**.

**Beispiel «Lebensmittel Simon»** (Person, 300/Monat, Übertrag nur bei Überschuss), Stand 14.10.2026:

| Monat | verfügbar | ausgegeben (Simons Hälfte) | Übertrag |
|---|---:|---:|---:|
| Sep. | 300.00 | 226.65 | 73.35 |
| Okt. | 373.35 | 70.72 | |

Safe-to-Spend = (373.35 − 70.72) / 18 Tage = 16.81 → **16.80 pro Tag**. Burn-Rate 5.05, Hochrechnung 156.55 → `on_track`.
**Kosmetik Eliana** (Person) sieht nur ihre Creme (15.80), nicht Simons Shampoo.
**Topf-Budgets im November:** Leben/Lebensmittel 160.00 (120 + 40) · Simon Freizeit 59.90 · Kind 1 30.00.

#### Fixkosten und Verträge

```
Monatsäquivalent  = amount × Faktor (wöchentlich 52/12 · monatlich 1 · quartalsweise 1/3 · halbjährlich 1/6 · jährlich 1/12)
Anteil je Person  = Monatsäquivalent × Anteil am Topf
nächste Verlängerung  = renewal_date + k × renewal_period_months   (kleinstes k ≥ 0, sodass das Datum ≥ heute ist; k > 0 nur bei auto_renews)
Kündigungstermin      = nächste Verlängerung − cancellation_notice_days
   mit notice_to_month_end: auf den letzten Tag des Vormonats vorziehen
Erinnerung            = Kündigungstermin − 30 Tage · Status ok · remind · last_chance (≤ 7 Tage) · missed
```

**Beispiele**
- Miete 2400 im Topf Gemeinsam Leben → je **1200.00**.
- Halbtax 190/Jahr im Topf Simon → **15.83**/Monat. Simon trägt damit 1215.83, Eliana 1200.00.
- Jede Fixkost hat einen Topf (`cost_account_id`) und ein bezahlendes Konto (`pay_from_account_id`). Heute ist das oft ein Privatkonto, später das Leben-Konto.

| Vertrag | Verlängerung | Frist | Kündigen bis | Erinnerung |
|---|---|---|---|---|
| Internet (Verlängerung 1.3.) | 2027-03-01 | 60 Tage | **2026-12-31** | 2026-12-01 |
| Grundversicherung (1.1., Monatsende) | 2027-01-01 | 31 Tage | **2026-11-30** | 2026-10-31 |

#### Sinking Funds

Ein Fonds hat ein **Konto, auf dem das Geld liegt** (z. B. Simon Sparen), und einen **Topf mit Kategorie, dessen Ausgaben ihn belasten** (z. B. Simon/Zahnarzt oder Gemeinsam/Ferien).

```
Stand            = Σ Einzahlungen − Σ Ausgaben im Topf und in der Kategorie (Rest bleibt im Fonds = Rollover)
nötige Rate      = ⌈ max(Ziel − Stand, 0) / Monate bis Ziel inkl. ⌉ auf 0.05 · auf Kurs = Monatsrate ≥ nötige Rate
```

**Beispiel «Zahnarzt Simon»:**
- Ziel 1200 bis 31.03.2027, Rate 150 seit Juli
- 600 eingezahlt, davon 280 für die Dentalhygiene ausgegeben → Stand **320**
- es bleiben 6 Monate, nötig sind **146.70**, die Rate liegt also auf Kurs (26.7 %)

#### 50/30/20 pro Person

Die Klasse einer Ausgabe bestimmt das erste gesetzte Feld in dieser Reihenfolge: Position → MasterProduct → Kategorie → Lebensbereich. Gerechnet wird mit My Share.

```
Bedarf = Σ «need» · Wünsche = Σ «want» · gespart = Überweisungen auf eigene Sparkonten · nicht verplant = Rest
```

**Beispiel Simon, November:**

| Posten | Betrag | Zusammensetzung |
|---|---:|---|
| Einkommen | 6500 | |
| Bedarf | 95.00 | 60 + 20 Lebensmittel + 15 Windeln |
| Wünsche | 59.90 | Velohelm |
| gespart | 500.00 | Dauerauftrag auf Simon Sparen |
| nicht verplant | 5845.10 | |

Fixkosten zählen, sobald sie als Beleg erfasst sind. Für die Planung gibt es zusätzlich `v_fixed_cost_person_monthly`.

### 2.7 Preis-Intelligenz

**Preisbeobachtungen** entstehen automatisch, wenn ein Beleg bestätigt wird. Dazu kommen Beobachtungen aus dem Laden (EAN-Scan mit Regalpreis).

**Shrinkflation** gilt für das gleiche Produkt oder seinen Vorgänger (`merchant_product.replaces_id`), wenn beide Bedingungen zutreffen:

```
neue Packung < alte × (1 − 2 %)   UND   neuer Packungspreis ≥ alter × (1 − 2 %)
Veränderung = (Preis_neu / B_neu) / (Preis_alt / B_alt) − 1
```

Beispiel: Zweifel Nature 300 g → 280 g, beide 4.95 → 1.65 → 1.7679 /100 g = **+7.14 %**.

**Preissprung:** gleicher Händler, gleiche Packung, letzter bekannter Regulärpreis, |Veränderung| ≥ X % (Standard 10). Beispiel Kaffee: **+12.17 %**. Bei einem Rückgang entsteht der Alarm `price_drop`.

**Verbrauchszyklus** pro MasterProduct, ab 3 Käufen:

- Intervall = Median der Tage zwischen zwei Käufen
- nächster Kauf ≈ letzter Kauf + Median
- Tagesverbrauch = Menge ohne letzten Kauf / Zeitspanne

Beispiel Milch (1.9., 15.9., 3.10.) → Median 16 Tage → nächster Kauf **19.10.**

**Smart Basket.** Für jedes Produkt der Liste und jeden Händler gilt der günstigste frische Preis:

- eine Aktion zählt, wenn sie höchstens 7 Tage alt ist, sonst der Regulärpreis
- ein Preis ist frisch, solange er höchstens 60 Tage alt ist
- der Preis wird mit der Vergleichsmenge der Liste multipliziert

Fehlt ein Preis, wird konservativ der **teuerste** bekannte Preis eingesetzt und als «ungeprüft» markiert.

- Einzelladen: Σ pro Händler.
- Zwei Läden: Σ min(Preis A, Preis B). Ein Paar zählt nur, wenn es günstiger ist als jeder der beiden Läden allein.
- **Aufteilen lohnt sich**, wenn die Ersparnis ≥ max(CHF 5, 5 % des besten Einzelladens) ist.

| Rang | Option (2 kg Kaffee, 6 l Milch, 1 kg Bananen, 3 l Olivenöl) | Total | Ersparnis | Empfehlung |
|---:|---|---:|---:|---|
| 1 | Coop + Lidl | 56.02 | 9.12 | ✅ aufteilen lohnt sich |
| 2 | Lidl | 65.14 | – | bester Einzelladen |
| 3 | Coop + Migros | 75.30 | | |
| 4 | Coop | 75.60 | | |
| 5 | Migros | 92.90 | | |

**Geplant oder Impulskauf** (`purchase_intent`): Eine Position gilt als **geplant**, wenn

- ihr MasterProduct auf der aktiven Einkaufsliste stand, oder
- es laut Verbrauchszyklus fällig war (≥ 70 % des Medianintervalls).

Sonst schlägt die App einen **Impulskauf** vor, man kann das überschreiben. Der Bericht zeigt den Anteil der Impulskäufe pro Monat und Kategorie.

**Garantie-Tracker:** `warranty.expires_on` = Kaufdatum + Monate (Standard 24). Der Beleg ist mit einem Tipp erreichbar (`receipt_attachment_id`). Beim Bestätigen eines Belegs fragt die App bei Positionen ab CHF 50 in Geräte-Kategorien «Garantie erfassen?».

---

## 3. 4-Kanal-Hybrid-Scanner

### 3.0 Gemeinsame Pipeline

```
Kamera / Datei / Teilen-Menü
   │
   ├─ Dokumentscanner (bestehend): Kanten → Entzerren → Kontrast → JPEG ≤ 2576 px
   ├─ Barcode-Erkennung im Bild (BarcodeDetector/ZXing): EAN · QR (SPC) · Beleg-Barcode
   │
   ▼
Edge Function /scan  ──►  scan_job (queued → processing → needs_review | duplicate | failed)
   │  1 Datei-Hash      → Duplikat?           (attachment.sha256)
   │  2 Kanal wählen    → Beleg-Bild/PDF · CSV · EAN · QR-Rechnung
   │  3 Extraktion      → JSON nach Schema (Modell oder deterministischer Parser)
   │  4 Prüfen          → Summen, Plausibilität, ggf. Reparatur-Runde
   │  5 Abgleich        → Alias-Wörterbuch, EAN, Vorschläge
   │  6 Dedup           → Beleg-Barcode · dedup_key · QR-Payload
   ▼
Prüf-Dialog (Client): Zeilen mit Ampel, Topf (Gemeinsam · Simon · Eliana …), Kategorien → «Bestätigen»
   ▼
transaction_header.status = confirmed → Trigger: Anteile · Prüfung · Preisbeobachtungen · Alarme
```

Jeder Kanal liefert einen **Entwurf**. Gebucht wird erst, wenn eine Person bestätigt. Positionen, die das Alias-Wörterbuch sicher erkennt, sind vorausgefüllt und grau, sie brauchen keinen Blick.

### 3.1 Kanal 1: Belegfoto, PDF und CSV

**Ablauf**
1. **Bild vorbereiten:** Der Dokumentscanner liefert das Bild entzerrt und kontrastverstärkt als JPEG (Qualität 85), lange Seite ≤ 2576 px.
   Ist ein Beleg sehr lang (Höhe/Breite > 3.5), wird er in **überlappende Abschnitte** zerlegt: Höhe ≈ 2.2 × Breite, 15 % Überlappung. Die Abschnitte gehen der Reihe nach als mehrere Bilder in **einen** Request.
2. **Beleg-Barcode** lokal lesen (Code 128, ITF oder QR). Daraus wird `receipt_barcode_id = chain_key:payload` für die Dedup-Prüfung, noch bevor Kosten entstehen.
3. **Modellaufruf** in der Edge Function (Schlüssel als Secret):

```ts
// supabase/functions/scan-receipt (Ausschnitt, Backend)
const res = await client.beta.messages.create({
  model: Deno.env.get("RECEIPT_MODEL") ?? "claude-opus-5-5",
  max_tokens: 16000,
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",                       // lehnt das Modell ab, beantwortet ein Ersatzmodell denselben Request
  thinking: { type: "adaptive" },
  output_config: { effort: "medium", format: { type: "json_schema", schema: RECEIPT_SCHEMA } },
  system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
  messages: [{ role: "user", content: [
    ...abschnitte.map(data => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } })),
    // E-Beleg: { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
    { type: "text", text: kontext },   // «Haushaltswährung CHF · heute 2026-10-14 · Barcode 0012… · 3 überlappende Abschnitte»
  ]}],
});
if (res.stop_reason === "refusal")    → scan_job failed → Offline-Entwurf (Tesseract) oder manuell
if (res.stop_reason === "max_tokens") → einmal mit höherem max_tokens wiederholen
const beleg = JSON.parse(res.content.find(b => b.type === "text").text);
```

   - **Promptstruktur:** Der Systemprompt (`scanner/system_prompt_beleg.md`) ist stabil und wird gecacht. Er enthält Grundsätze, Positionsregeln, die **Rabatt-/Gutschein-Regel**, Summenkontrolle und Kopfdaten.
   - Der User-Turn bringt nur Bilder bzw. das PDF und einen kurzen Kontext mit.
   - Structured Outputs (`output_config.format`) garantieren gültiges JSON nach `receipt_extraction.schema.json`.
4. **Deterministisch prüfen** (Server, ohne Modell):
   - Σ `final_price` − Σ `basket_discounts` + `rounding` = `total` (±0.01)
   - Σ `payments` = `total` (±0.01)
   - pro Zeile: `regular − discount = final`, `quantity × unit_price ≈ regular_price` (±0.02)
   - Datum nicht in der Zukunft und nicht älter als 2 Jahre, Währung passt zum Land, keine Zeile doppelt aus der Überlappung
5. **Reparatur-Runde** (höchstens 1): Schlägt eine Prüfung fehl, geht der gleiche Verlauf zurück ans Modell.
   - Dazu wird die Antwort des Modells **unverändert** als Assistant-Turn angehängt, dann ein User-Turn mit den konkreten Abweichungen («Σ Positionen 36.78 ≠ Total 37.18; prüfe Zeilen 3–5»).
   - Bleibt eine Differenz, markiert die App die Zeilen im Prüf-Dialog gelb, und die Person korrigiert sie.
6. **In die Datenbank abbilden:**
   - `line_items` → `line_item`
   - Artikelrabatte → `line_item_discount (promo)`
   - `basket_discounts` → anteilig `basket_allocated`
   - `rounding` → Gebührenzeile «Rundung»
   - `payments` → `transaction_payment`; Karte über `card_last4` → `payment_method` → **Konto**. Gutscheine und Punkte ohne Konto.
   - Topf pro Position: Standard der Kategorie, sonst Topf des Belegs (§2.3). Im Prüf-Dialog mit einem Tipp änderbar.
   - `pack_size_hint` → `unit_size/unit_type`, wenn das Alias-Wörterbuch nichts Genaueres kennt
7. **Offline:** Der Scan bleibt in der Warteschlange (`queued`), und die bestehende Tesseract-Erkennung liefert sofort einen Entwurf. Sobald wieder Netz da ist, läuft der Modellaufruf. Abweichungen zum Offline-Entwurf zeigt der Prüf-Dialog an.
8. **Cumulus/Supercard:**
   - **PDF-E-Belege** laufen über denselben Weg (document-Block).
   - **CSV-Exporte** liest ein deterministischer Adapter **ohne Modell**: Spaltenprofil pro Programm, gruppiert nach Datum, Zeit und Filiale bzw. Transaktion, `source_channel = loyalty_csv`, `alias_source = loyalty_import`.
   - Das genaue Spaltenformat bitte mit einem echten Export verifizieren (§5).
   - Gibt es denselben Einkauf auch als Foto, werden beide zusammengeführt: Positionen aus der CSV, Bild als Anhang.

**Kosten (Schätzung, mit echten `usage`-Werten nachmessen):**
- Eingabe: Bild bis ~4800 Tokens pro Abschnitt, Systemprompt aus dem Cache
- Ausgabe: ~2–6k Tokens inkl. Denken
- Preis bei 4 $ / 20 $ pro Million Tokens (Ein-/Ausgabe): **≈ CHF 0.08–0.15 pro Beleg**, bei 40 Belegen im Monat ≈ CHF 3–6
- Das Modell ist eine Konfigurationsvariable (`RECEIPT_MODEL`).

### 3.2 Kanal 2: Produkt-EAN und OpenFoodFacts

```
Scan (ean_13/ean_8/upc_a/upc_e) → Prüfziffer (GTIN mod 10) ─✗→ neu scannen
   ├─ Präfix 20–29 → ladeninterner Gewichts-/Preis-Code: KEIN OFF-Abruf, nur lokal (kind = in_store_variable)
   ├─ 1 lokal: merchant_product.ean (offline, sofort)
   ├─ 2 off_cache (Server, geteilt, 30 Tage gültig; «not_found» 7 Tage)
   ├─ 3 OFF:  GET https://world.openfoodfacts.org/api/v2/product/{ean}
   │          ?fields=code,product_name,product_name_de,product_name_fr,brands,quantity,
   │                  product_quantity,product_quantity_unit,image_front_small_url,categories_tags,nutriscore_grade
   │          Header User-Agent: «<App>/<Version> (<Kontaktadresse>)» · status 1 = gefunden, 0 = nicht gefunden
   ├─ 4 Fallback: Open Beauty Facts / Open Products Facts (gleiche API) für Drogerie und Haushalt
   └─ 5 nicht gefunden → Kurzformular (Name, Grösse, Foto) → wird lokal gespeichert
```

**Packungsgrösse** aus `quantity` (in `pruefen-scanner.mjs` getestet):

| Eingabe | Ergebnis |
|---|---|
| «6 x 1.5 l» | 1.5 l × 6 |
| «4x125g» | 125 g × 4 |
| «75 cl» | 750 ml |
| «1,5 L» | 1.5 l |
| «10 Stück» | 10 Stück |
| «environ 1 kg» | null → Rückfrage |

Fehlt die Angabe, gilt `product_quantity` + `product_quantity_unit` (Gesamtmenge) ÷ Multipack.

**MasterProduct zuordnen:** Die App vergleicht den Namen mit den MasterProducts des Haushalts und schaut auf `categories_tags`. Die Wahl wird am `merchant_product` gespeichert, die Frage kommt also nur einmal pro EAN.

**Live-Preischeck im Laden** (Antwort nach `off_product.schema.json`):
- Produkt, Grösse und Bild
- letzter Preis pro Händler, nach CHF pro Vergleichseinheit sortiert, mit dem günstigsten Händler hervorgehoben
- Alarme (Shrinkflation, Preissprung)
- Verbrauch: «zuletzt vor 12 Tagen, Zyklus 16 Tage»
- Knöpfe: «Regalpreis erfassen» (`price_observation`, source `ean_live_check`, Aktion ja/nein) · «auf die Liste» · «in den Korb»

**Korb-Modus lernt Aliase:** Die im Laden gescannten EANs bilden eine Sitzung. Wird danach ein Beleg desselben Händlers bestätigt, paart die App unbekannte Belegzeilen mit den gescannten EANs, und zwar über gleichen Einzelpreis und die Reihenfolge. Daraus entstehen Alias-Vorschläge mit `source = ean_scan` und exakter Packungsgrösse.

### 3.3 Kanal 3: Selbstlernendes Alias-Wörterbuch

**Schlüssel** (`alias_key`, getestet). Die Packungsgrösse bleibt Teil der Identität, «1L» ist nicht «0.5L».

| Belegtext | Schlüssel |
|---|---|
| `M-CL VOLLMI UHT 1L     1.65 A` | `M-CL VOLLMI UHT 1L` |
| `2 x ZWEIFEL CHIPS NATURE 280G` | `ZWEIFEL CHIPS NATURE 280G` |
| `BANANEN 0.734 kg x 2.90/kg 2.13` | `BANANEN` |
| `Müsli Bircher* AKTION` | `MUESLI BIRCHER` |

**Kaskade pro Belegzeile** (nur `item_type = product`):
1. Hat die Zeile eine EAN, wird das `merchant_product` direkt übernommen.
2. Exakter Treffer `(Haushalt, Händler, Schlüssel)`:
   - automatisch übernommen bei `confidence ≥ 0.85` **und** `times_confirmed ≥ 2`
   - sonst als Vorschlag
3. Ähnlicher Schlüssel beim gleichen Händler (Trigramm-Ähnlichkeit ≥ 0.55, `pg_trgm`) → Vorschlag.
4. Modell-Vorschlag: Alle unbekannten Zeilen eines Belegs gehen gesammelt in **einem** Aufruf an das Modell, zusammen mit ≤ 40 Kandidaten-MasterProducts. Die Antwort folgt `alias_resolution.schema.json`, `source = llm_suggested`.
5. Sonst wählt die Person ein MasterProduct oder legt ein neues an.

**Plausibilität:** Weicht der Einzelpreis um mehr als 50 % von `last_unit_price` ab, wird die Zeile **immer** zur Prüfung vorgelegt. So fallen z. B. Bio-Varianten oder Grossgebinde auf.

**Lernen** (`confirm_alias`), bei jeder Bestätigung:
- `times_seen + 1`
- `times_confirmed + 1`, wenn der Vorschlag stimmte, sonst `times_corrected + 1` und das neue Ziel wird übernommen
- `confidence = (bestätigt + 1) / (gesehen + 2)` (Laplace). Zwei Bestätigungen ergeben 0.75, drei ergeben 0.80, vier ergeben 0.83, ab der fünften wird die Zeile automatisch übernommen (≥ 0.85).

### 3.4 Kanal 4: Swiss QR-Rechnung (SPC)

Der QR-Inhalt besteht aus Textzeilen, getrennt durch CR/LF, in UTF-8, mit höchstens 997 Zeichen. Der Parser ist **deterministisch** und braucht kein Modell.

| Zeile | Element | → Feld | Prüfung |
|---:|---|---|---|
| 1 | QRType | – | = `SPC` |
| 2 | Version | `version` | `02xx` |
| 3 | Coding | – | = `1` |
| 4 | IBAN | `iban`, `is_qr_iban` | CH/LI, 21 Zeichen, mod 97 = 1. QR-IBAN, wenn IID (Stellen 5–9) 30000–31999 |
| 5–11 | Zahlungsempfänger: Adresstyp, Name, Strasse, Hausnr., PLZ, Ort, Land | `creditor_*` | Typ S (seit Nov. 2025 Pflicht). Typ K bei älteren Rechnungen trotzdem lesen. |
| 12–18 | Endgültiger Zahlungsempfänger | – | leer |
| 19 | Betrag | `amount` | leer oder 0.01–999 999 999.99 |
| 20 | Währung | `currency` | CHF / EUR |
| 21–27 | Endgültiger Zahlungspflichtiger | `debtor_*` | optional |
| 28 | Referenztyp | `reference_type` | QRR nur **mit** QR-IBAN, SCOR/NON nur **ohne** |
| 29 | Referenz | `reference` | QRR: 27 Ziffern, Prüfziffer Modulo 10 rekursiv. SCOR: `RF..`, ISO 11649 mod 97. NON: leer |
| 30 | Mitteilung | `unstructured_message` | ≤ 140 |
| 31 | Trailer | – | = `EPD` |
| 32 | Rechnungsinformationen | `bill_information` → `swico` | Swico S1, siehe unten |
| 33–34 | Alternative Verfahren | `alt_procedures` | höchstens 2 |

**Swico S1** (`//S1/10/…/11/…/40/…`):

| Code | Inhalt |
|---|---|
| `/10/` | Rechnungsnummer |
| `/11/` | Rechnungsdatum (JJMMTT) |
| `/20/` | Kundenreferenz |
| `/30/` | UID (→ CHE-xxx.xxx.xxx) |
| `/32/` | MWST-Sätze |
| `/40/` | Zahlungsbedingungen `Skonto:Tage;…` |

**Fälligkeit** = Rechnungsdatum + Tage bei 0 % Skonto. Beispiel `/11/261001` + `/40/0:30` ergibt den **31.10.2026** (getestet, ebenso die QRR-Prüfziffer `…9017`, QR-IBAN und SCOR `RF18…`).

**Ablauf**
1. Scannen (Kamera oder QR aus einer PDF-Rechnung) → parsen → prüfen.
2. Dedup über `payload_sha256` (eindeutig), zusätzlich über IBAN + Referenz + Betrag.
3. `creditor_mapping` nach IBAN suchen → Kategorie, Fixkosten und Topf vorschlagen. Beim ersten Mal fragt die App, danach wird die Zuordnung gelernt.
4. Status `open` mit Fälligkeit und Erinnerung. Ist kein Betrag angegeben, fragt die App danach.
5. «Bezahlt» erzeugt einen Beleg mit `kind = bill`, bezahlt vom gewählten Konto (heute privat, später Leben), und einer Position, verknüpft mit `fixed_cost` bzw. `contract`. IBAN und Referenz lassen sich für die Bank-App kopieren.

### 3.5 Duplikate erkennen (alle Kanäle)

| Stufe | Merkmal | Wirkung |
|---|---|---|
| 1 | gleiche Datei (`attachment.sha256`) | blockiert, noch vor dem Modellaufruf |
| 2 | gleicher Beleg-Barcode (`receipt_barcode_id` pro Händler, eindeutiger Index) | blockiert (getestet) |
| 3 | gleicher QR-Inhalt (`qr_bill.payload_sha256`) | blockiert |
| 4 | `dedup_key` = Kette, Datum, HH:MM, Total | Warnung «Zusammenführen?» |
| 5 | gleicher Händler, Datum, Total ±0.01, Zeit ±10 min, anderer Kanal (z. B. CSV + Foto) | Warnung «Zusammenführen?»: CSV-Positionen und Foto als Anhang |

---

## 4. Was geprüft ist

**`pruefen.mjs`, 59/59 bestanden.** Das Schema läuft fehlerfrei in PostgreSQL (PGlite). Folgendes ist mit echten Zahlen nachgerechnet:

- Normalisierung inkl. Multipack, Offenverkauf, Dichte und «nicht vergleichbar»
- Rabatt vs. Gutschein:
  - Beispiel A
  - der Gutschein ändert My Share nicht und wird anteilig verteilt
- Töpfe:
  - gemeinsam 50/50, privat 100 %, Kind (Eltern 50/50)
  - ungerader Rappen abwechselnd, Fremdwährung
- Phase 1 (Privatkonten + virtueller Topf) und Phase 2 (gemeinsames Konto, Spar-/Freizeitkonten, Kind):
  - Saldo, Ausgleich, Ausgleichsvorschlag
  - Daueraufträge (idempotent), Kontostände, Geldfluss
- Gutschrift im Monat des Eingangs
- Budgets:
  - pro Person (My Share) und pro Topf
  - Übertrag, Safe-to-Spend
- Fixkosten je Topf und je Person, Kündigungstermine, Sinking Fund, 50/30/20 pro Person
- Preise und Planung: Preissprung, Shrinkflation, Verbrauchszyklus, Smart Basket
- Alias-Schlüssel und Lernen, Garantie
- Schutzregeln:
  - Topf mit Anteilen ≠ 100 %
  - Kartenzahlung ohne Konto
  - doppelter Kassenbon
  - Summenprüfung beim Bestätigen

**`pruefen-scanner.mjs`, 27/27 bestanden.**
- Alle 4 Schemas kompilieren.
- Die beiden Schemas, die ans Modell gehen, halten die Regeln für Structured Outputs ein.
- Beispiel A geht auf.
- QR-Rechnung: Prüfziffern und Swico-Fälligkeit stimmen.
- Der Mengen-Parser für OpenFoodFacts und die GTIN-Prüfziffer funktionieren.

Noch **nicht** geprüft, weil es Netz oder echte Dateien braucht: ein Modellaufruf mit echten Belegfotos, OFF-Live-Abfragen und das Format echter Cumulus- bzw. Supercard-Exporte.

---

## 5. Offene Punkte für dein OK

1. **Stack:** Next.js + TypeScript + Tailwind (PWA), Supabase und PowerSync. Passt das?
2. **Konten:** Stimmen die Töpfe für den Start? Vorgeschlagen sind Simon Privat, Eliana Privat (aktiv) und Gemeinsam Leben (virtuell). Sparen und Freizeit lege ich als virtuelle Töpfe schon an.
3. **Kategorien → Topf:** Vorschlag:
   - **gemeinsam:** Lebensmittel, Haushalt, Wohnen, Ferien, Ausgehen, Kinder
   - **persönlich:** Kleider, Körperpflege/Kosmetik, Hobby, Gesundheit, Handy/Abos

   Was soll anders sein?
4. **Modell und Kosten:** Für Kanal 1 ist `claude-opus-5-5` mit `fallbacks: "default"` vorgesehen, das kostet ≈ CHF 0.08–0.15 pro Beleg.
5. **Cumulus/Supercard:** Bitte einen echten CSV- bzw. PDF-Export bereitstellen (Beträge dürfen geschwärzt sein).
6. **Bestehende Daten:** Der Import ist so gedacht:

   | Bisher | Neu |
   |---|---|
   | Einträge der Haushaltskasse | Belege |
   | Teilung «geteilt» | Topf Gemeinsam Leben |
   | Teilung «allein» | Topf der Person |
   | notierte Preise | `price_observation` |
   | Einkaufsliste | `shopping_list` |
   | Zuordnungen | `receipt_alias_mapping` |

→ Nach deinem OK starte ich mit **M1 Fundament**.
