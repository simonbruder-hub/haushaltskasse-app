import schemaText from "../../docs/scanner/receipt_extraction.schema.json?raw";
import promptText from "../../docs/scanner/system_prompt_beleg.md?raw";

// Ergänzung zum Systemprompt aus dem Blueprint: Zuordnung zu Produkt und Kategorie in derselben Anfrage.
// Bleibt unverändert, damit der Prompt-Cache greift; die Kategorien des Haushalts stehen im Schema.
const ZUSATZ = `

## Zuordnung
- product_name: kurzer deutscher Gattungsname des Artikels, ohne Marke, Packungsgrösse und Abkürzungen, z. B. «Vollmilch», «Bananen», «Shampoo», «Kartoffelchips». Bei Depot, Gebühren und Retouren null.
- category: die passendste Kategorie aus der vorgegebenen Liste, sonst null. Lieber null als eine unpassende Kategorie.
- Nennt der Kontext «Bekannte Produkte» und passt eines davon, übernimm für product_name genau diesen Namen (gleiche Schreibweise). Sonst ein neuer Gattungsname nach der Regel oben.`;

/** Systemprompt: alles nach der Trennlinie (davor steht nur die Beschreibung der Datei) */
export const SYSTEMPROMPT = promptText.split(/\n---\n/)[1].trim() + ZUSATZ;

type Json = { [k: string]: unknown };

/** $ref auf $defs auflösen (Structured Outputs braucht das nicht zwingend, so ist das Schema aber eindeutig) */
function aufloesen(knoten: unknown, defs: Json): unknown {
  if (Array.isArray(knoten)) return knoten.map((k) => aufloesen(k, defs));
  if (!knoten || typeof knoten !== "object") return knoten;
  const o = knoten as Json;
  if (typeof o.$ref === "string") {
    const ziel = defs[o.$ref.replace("#/$defs/", "")];
    const { $ref: _, ...rest } = o;
    return { ...(aufloesen(ziel, defs) as Json), ...rest };
  }
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, aufloesen(v, defs)]));
}

/** Schema für output_config.format: Kopfangaben entfernt, $ref aufgelöst, pro Position product_name und category ergänzt */
export function anfrageSchema(kategorien: string[]): Json {
  const roh = JSON.parse(schemaText) as Json;
  const { $schema: _a, $id: _b, title: _c, $defs, ...rest } = roh;
  const s = aufloesen(rest, ($defs ?? {}) as Json) as Json;
  const zeile = ((s.properties as Json).line_items as Json).items as Json;
  const namen = [...new Set(kategorien.filter(Boolean))];
  (zeile.properties as Json).product_name = { anyOf: [{ type: "string" }, { type: "null" }], description: "Gattungsname, z. B. «Vollmilch»" };
  (zeile.properties as Json).category = namen.length
    ? { anyOf: [{ type: "string", enum: namen }, { type: "null" }], description: "Kategorie des Haushalts" }
    : { type: "null" };
  zeile.required = [...(zeile.required as string[]), "product_name", "category"];
  return s;
}
