import type Anthropic from "@anthropic-ai/sdk";
import { anfrageSchema, SYSTEMPROMPT } from "./schema";
import { pruefen, reparaturText, type Abweichung } from "./pruefen";
import type { Extraktion } from "./typen";

/** Belegerkennung mit Claude (Kanal 1). Der API-Schlüssel liegt nur auf diesem Handy; die App ruft die API direkt auf. */
export const MODELLE: { id: string; name: string; text: string; fallback: boolean }[] = [
  { id: "claude-opus-5-5", name: "Genau", text: "Claude Opus 5.5 · etwa CHF 0.08–0.15 pro Beleg", fallback: true },
  { id: "claude-sonnet-5-5", name: "Ausgewogen", text: "Claude Sonnet 5.5 · etwa CHF 0.04–0.08 pro Beleg", fallback: false },
  { id: "claude-haiku-5-5", name: "Günstig", text: "Claude Haiku 5.5 · unter CHF 0.01 pro Beleg", fallback: false },
];
export const STANDARD_MODELL = MODELLE[0].id;

/** Listenpreise in USD pro Million Tokens (Stand Oktober 2026). Cache-Schreiben kostet das 1.25-Fache der Eingabe. */
const PREISE: Record<string, { ein: number; aus: number; cache: number }> = {
  "claude-opus-5-5": { ein: 4, aus: 20, cache: 0.2 },
  "claude-sonnet-5-5": { ein: 2, aus: 10, cache: 0.2 },
  "claude-haiku-5-5": { ein: 0.1, aus: 0.5, cache: 0.01 },
};
/** Ungefährer Wechselkurs für die Anzeige in CHF */
export const USD_CHF = 0.8;
/** «Claude Opus 5.5» aus der Modell-ID der Antwort */
export const modellName = (id: string | null | undefined) =>
  !id ? "?" : id === "tesseract" ? "Texterkennung auf dem Handy" : id.replace(/^claude-([a-z]+)-(\d+)-(\d+).*$/, (_, n: string, a: string, b: string) => `Claude ${n[0].toUpperCase()}${n.slice(1)} ${a}.${b}`);
/** Kosten in CHF, gerundet auf Rappen; kleine Beträge als «unter 1 Rp.» */
export const kostenText = (usd: number | string | null | undefined) => {
  if (usd == null || usd === "") return null;
  const chf = Number(usd) * USD_CHF;
  return chf < 0.005 ? "unter 1 Rp." : `ca. CHF ${chf.toFixed(2)}`;
};

/** Kosten einer Antwort in USD; null, wenn das Modell (z. B. ein Ersatzmodell) keinen hinterlegten Preis hat */
export function kostenUsd(modell: string, u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }): number | null {
  const p = PREISE[Object.keys(PREISE).find((k) => modell.startsWith(k)) ?? ""];
  if (!p) return null;
  return (u.input_tokens * p.ein + (u.cache_creation_input_tokens ?? 0) * p.ein * 1.25 + (u.cache_read_input_tokens ?? 0) * p.cache + u.output_tokens * p.aus) / 1e6;
}

export interface Teil { art: "bild" | "pdf"; daten: string }   // daten = base64
export interface KiErgebnis {
  extraktion: Extraktion; abweichungen: Abweichung[]; modell: string; requestId: string | null;
  tokensIn: number; tokensOut: number; kostenUsd: number | null; roh: unknown; reparatur: boolean;
}

/** Verständliche Fehler; offline = true heisst: später nochmals versuchen bzw. offline lesen */
export class KiFehler extends Error {
  constructor(message: string, public offline = false) { super(message); }
}

function lesen(res: Anthropic.Beta.Messages.BetaMessage): Extraktion {
  const text = res.content.find((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")?.text;
  if (!text) throw new KiFehler("Die KI hat keinen Beleg geliefert.");
  return JSON.parse(text) as Extraktion;
}

export async function kiLesen(o: {
  teile: Teil[]; kategorien: string[]; heute: string; schluessel: string; modell?: string; status?: (t: string) => void;
  produkte?: string[];   // bekannte Produkte des Haushalts: die KI soll deren Namen wiederverwenden, statt Doppelte anzulegen
}): Promise<KiErgebnis> {
  const { default: Sdk } = await import("@anthropic-ai/sdk");
  const client = new Sdk({ apiKey: o.schluessel, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 180_000 });
  const modell = MODELLE.find((m) => m.id === o.modell) ?? MODELLE[0];
  const bilder = o.teile.filter((t) => t.art === "bild").length;
  const kontext = [
    `Haushaltswährung CHF · heute ${o.heute}`,
    o.teile.some((t) => t.art === "pdf") ? "E-Beleg als PDF" : bilder > 1 ? `${bilder} überlappende Abschnitte eines langen Belegs, von oben nach unten` : "ein Foto",
  ].join(" · ") + (o.produkte?.length ? `\nBekannte Produkte: ${o.produkte.join(", ")}` : "");
  const inhalt: Anthropic.Beta.Messages.BetaContentBlockParam[] = [
    ...o.teile.map((t): Anthropic.Beta.Messages.BetaContentBlockParam => t.art === "pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: t.daten } }
      : { type: "image", source: { type: "base64", media_type: "image/jpeg", data: t.daten } }),
    { type: "text", text: kontext },
  ];
  const basis = {
    model: modell.id,
    max_tokens: 16000,
    system: [{ type: "text" as const, text: SYSTEMPROMPT, cache_control: { type: "ephemeral" as const } }],
    output_config: { effort: "medium" as const, format: { type: "json_schema" as const, schema: anfrageSchema(o.kategorien) } },
    // Lehnt das Modell ab, beantwortet ein Ersatzmodell dieselbe Anfrage (nur bei Opus dokumentiert)
    ...(modell.fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  };
  const senden = async (messages: Anthropic.Beta.Messages.BetaMessageParam[], max = basis.max_tokens) => {
    try {
      return await client.beta.messages.create({ ...basis, max_tokens: max, messages });
    } catch (e) {
      if (e instanceof Sdk.AuthenticationError || e instanceof Sdk.PermissionDeniedError) throw new KiFehler("Der API-Schlüssel stimmt nicht oder hat keinen Zugriff.");
      if (e instanceof Sdk.RateLimitError) throw new KiFehler("Zu viele Anfragen oder kein Guthaben mehr. Bitte später nochmals versuchen.");
      if (e instanceof Sdk.APIConnectionError) throw new KiFehler("Keine Verbindung zur KI.", true);
      if (e instanceof Sdk.APIError) throw new KiFehler(`Die KI-Erkennung meldet einen Fehler (${e.status ?? "?"}): ${e.message}`);
      throw e;
    }
  };

  o.status?.("Beleg wird gelesen …");
  const frage: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: "user", content: inhalt }];
  let res = await senden(frage);
  if (res.stop_reason === "max_tokens") res = await senden(frage, 32000);
  if (res.stop_reason === "refusal") throw new KiFehler("Die KI hat diesen Beleg nicht gelesen.");
  let extraktion = lesen(res);
  let abweichungen = pruefen(extraktion, o.heute);
  let tokensIn = res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
  let tokensOut = res.usage.output_tokens;
  let kosten = kostenUsd(res.model, res.usage);
  let reparatur = false;

  // Reparatur-Runde (höchstens eine): Antwort unverändert zurück, dazu die konkreten Abweichungen
  if (abweichungen.length) {
    o.status?.("Summen werden nachgeprüft …");
    try {
      const res2 = await senden([...frage,
        { role: "assistant", content: res.content as unknown as Anthropic.Beta.Messages.BetaContentBlockParam[] },
        { role: "user", content: [{ type: "text", text: reparaturText(abweichungen) }] }]);
      tokensIn += res2.usage.input_tokens + (res2.usage.cache_read_input_tokens ?? 0) + (res2.usage.cache_creation_input_tokens ?? 0);
      tokensOut += res2.usage.output_tokens;
      const k2 = kostenUsd(res2.model, res2.usage);
      kosten = kosten == null || k2 == null ? null : kosten + k2;
      if (res2.stop_reason !== "refusal" && res2.stop_reason !== "max_tokens") {
        const e2 = lesen(res2);
        const a2 = pruefen(e2, o.heute);
        if (a2.length <= abweichungen.length) { extraktion = e2; abweichungen = a2; res = res2; reparatur = true; }
      }
    } catch (e) {
      console.warn("Reparatur-Runde übersprungen", e);   // erste Antwort bleibt, der Prüf-Dialog zeigt die Abweichungen
    }
  }
  return {
    extraktion, abweichungen, modell: res.model, requestId: (res as { _request_id?: string | null })._request_id ?? null,
    tokensIn, tokensOut, kostenUsd: kosten, roh: res, reparatur,
  };
}
