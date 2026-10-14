import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Verbindung zum eigenen Supabase-Projekt. Ohne Eintrag läuft die App rein lokal. */
export interface Verbindung { url: string; key: string }
const SPEICHER = "haushalt-supabase";

export function verbindung(): Verbindung | null {
  try {
    const v = JSON.parse(localStorage.getItem(SPEICHER) || "null");
    if (v?.url && v?.key) return v;
  } catch { /* leer */ }
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return url && key ? { url, key } : null;
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
