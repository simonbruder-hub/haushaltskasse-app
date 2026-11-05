import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Verbindung zum Supabase-Projekt. Ohne Verbindung läuft die App rein lokal. */
export interface Verbindung { url: string; key: string }
const SPEICHER = "haushalt-supabase";

/**
 * Gemeinsames Projekt der Apps auf simonbruder-hub.github.io (Taktwerk, Haushalt, später Kochbuch). Der öffentliche
 * Schlüssel darf in der App stehen: Die Daten schützt Row Level Security, wer ein Konto anlegen darf, regelt eine
 * Liste im Projekt. Einrichtung: Repo apps, konten/README.md.
 */
export const GEMEINSAM: Verbindung = {
  url: "https://xlbddpaxwjgseqxaicuf.supabase.co",
  key: "sb_publishable_HawYMwgitp0Jo9CmA31oIA_tA3Hd-ik",
};
const WEBSITE = "simonbruder-hub.github.io";

/** Auf der veröffentlichten Website das gemeinsame Projekt; lokal und in den Tests keins, dort bleibt die App lokal. */
export function standardVerbindung(host = typeof location === "undefined" ? "" : location.hostname): Verbindung | null {
  return host === WEBSITE ? GEMEINSAM : null;
}

/** Selbst eingetragene Verbindung (Einstellungen → Verbindung ändern), sie hat Vorrang */
export function eigeneVerbindung(): Verbindung | null {
  try {
    const v = JSON.parse(localStorage.getItem(SPEICHER) || "null");
    if (v?.url && v?.key) return v;
  } catch { /* leer */ }
  return null;
}

/** Selbst eingetragen, sonst aus den Build-Variablen, sonst auf der Website das gemeinsame Projekt */
export function verbindung(): Verbindung | null {
  const eigen = eigeneVerbindung();
  if (eigen) return eigen;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return url && key ? { url, key } : standardVerbindung();
}
export function verbindungSpeichern(v: Verbindung | null) {
  if (v) localStorage.setItem(SPEICHER, JSON.stringify(v)); else localStorage.removeItem(SPEICHER);
  client = null;
}

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient | null {
  const v = verbindung();
  if (!v) return null;
  if (!client) client = createClient(v.url, v.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  return client;
}
