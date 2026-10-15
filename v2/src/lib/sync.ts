import { useSyncExternalStore } from "react";
import { db, refreshAll, sichern } from "../db/client";
import { SyncEngine } from "../sync/engine";
import { SupabaseRemote } from "../sync/remote-supabase";
import { supabase, verbindung } from "./supabase";
import { setState, state } from "./data";
import { abgleichFehler } from "../sync/meldung";
export { abgleichFehler };

/** Zustand des Abgleichs für die Oberfläche */
export interface SyncZustand {
  modus: "lokal" | "abgemeldet" | "bereit" | "laeuft" | "fehler";
  email?: string;
  userId?: string;
  letzter?: string | null;
  ausstehend: number;
  fehler?: string | null;
}
let zustand: SyncZustand = { modus: "lokal", ausstehend: 0 };
const hoerer = new Set<() => void>();
function setze(z: Partial<SyncZustand>) { zustand = { ...zustand, ...z }; hoerer.forEach((h) => h()); }
export function useSync(): SyncZustand {
  return useSyncExternalStore((h) => { hoerer.add(h); return () => hoerer.delete(h); }, () => zustand);
}

let engine: SyncEngine | null = null;
async function motor(): Promise<SyncEngine | null> {
  const c = supabase();
  if (!c) return null;
  if (!engine) engine = new SyncEngine(await db(), new SupabaseRemote(c));
  return engine;
}

/** Beim Start und nach Änderungen an der Verbindung aufrufen. */
export async function syncPruefen() {
  const c = supabase();
  engine = null;
  const d = await db();
  const ausstehend = (await d.query<{ n: number }>(`select count(*)::int as n from _outbox`)).rows[0].n;
  if (!c) { setze({ modus: "lokal", email: undefined, userId: undefined, ausstehend, fehler: null }); return; }
  const { data } = await c.auth.getSession();
  const user = data.session?.user;
  if (!user) { setze({ modus: "abgemeldet", email: undefined, userId: undefined, ausstehend }); return; }
  setze({ modus: "bereit", email: user.email ?? undefined, userId: user.id, ausstehend, letzter: await state("last_sync"), fehler: abgleichFehler(await state("last_error")) });
}

let aktuell: Promise<boolean> | null = null;
/** Abgleich starten. Läuft schon einer, wird auf diesen gewartet (kein zweiter parallel). */
export function jetztAbgleichen(): Promise<boolean> {
  if (aktuell) return aktuell;
  if (zustand.modus !== "bereit" && zustand.modus !== "fehler") return Promise.resolve(false);
  if (!navigator.onLine) return Promise.resolve(false);
  aktuell = (async () => {
    const m = await motor();
    if (!m) return false;
    setze({ modus: "laeuft" });
    try {
      await mitgliedschaftSichern();
      const r = await m.sync();
      if (localStorage.getItem("haushalt-debug")) console.info("Abgleich", JSON.stringify(r));
      if (r.pulled || r.deleted) await refreshAll();
      setze({ modus: r.error ? "fehler" : "bereit", fehler: abgleichFehler(r.error), letzter: await state("last_sync"), ausstehend: await m.pending() });
      return !r.error;
    } catch (e) {
      setze({ modus: "fehler", fehler: abgleichFehler(e instanceof Error ? e.message : String(e)) });
      return false;
    }
  })().finally(() => { aktuell = null; });
  return aktuell;
}

/** Für Aktionen der Person (Beitreten, Login, «Jetzt abgleichen»): einen laufenden Abgleich abwarten, dann frisch abgleichen. */
export async function abgleichNeu(): Promise<boolean> {
  if (aktuell) await aktuell.catch(() => false);
  return jetztAbgleichen();
}

export function ausstehendMelden(n: number) { if (n !== zustand.ausstehend) setze({ ausstehend: n }); }

// ---------- Anmeldung per Code aus der E-Mail ----------
export async function codeSenden(email: string) {
  const c = supabase();
  if (!c) throw new Error("Zuerst die Verbindung zu Supabase eintragen.");
  const { error } = await c.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
  if (error) throw new Error(error.message);
}

export async function codePruefen(email: string, code: string) {
  const c = supabase();
  if (!c) throw new Error("Keine Verbindung eingetragen.");
  const { data, error } = await c.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
  if (error || !data.user) throw new Error(error?.message ?? "Code ungültig");
  return data.user.id;
}

/**
 * Vor jedem Abgleich: Ist dieser Login Mitglied des Haushalts auf diesem Handy?
 * - schon lokal eingetragen → nichts zu tun
 * - auf dem Server schon Mitglied (z. B. nach einem Beitritt) → kommt mit dem Abgleich
 * - noch nirgends Mitglied → als Eigentümer eintragen (der Haushalt wird gleich hochgeladen)
 * - Mitglied eines ANDEREN Haushalts → abbrechen, nichts überschreiben
 */
async function mitgliedschaftSichern() {
  const c = supabase();
  if (!c) return;
  const household = await state("household_id");
  if (!household) return;
  const { data: s } = await c.auth.getSession();
  const uid = s.session?.user.id;
  if (!uid) return;
  const d = await db();
  if ((await d.query(`select 1 from household_member where household_id = $1 and user_id = $2`, [household, uid])).rows.length) return;
  const { data: mitglied, error } = await c.from("household_member").select("household_id").eq("user_id", uid);
  if (error) throw new Error(error.message);
  if ((mitglied ?? []).some((m) => m.household_id === household)) return;
  if ((mitglied ?? []).length) throw new Error("Dieser Login gehört schon zu einem anderen Haushalt. Auf diesem Handy neu beginnen und «Einem Haushalt beitreten» wählen.");
  await d.query(`insert into household_member (household_id, user_id, role, person_id) values ($1, $2, 'owner', $3)
                 on conflict (household_id, user_id) do nothing`, [household, uid, await state("person_id")]);
}

/** Nach der Anmeldung: Mitgliedschaft prüfen und sofort abgleichen. */
export async function haushaltVerbinden() {
  await syncPruefen();
  if (!(await abgleichNeu())) throw new Error(zustand.fehler || "Abgleich fehlgeschlagen");
}

/** Wer benutzt dieses Handy? Auch im eigenen Mitglieds-Eintrag vermerken (für das andere Handy sichtbar). */
export async function ichBin(personId: string) {
  await setState("person_id", personId);
  const uid = zustand.userId;
  const household = await state("household_id");
  if (uid && household) {
    const d = await db();
    await d.query(`update household_member set person_id = $1 where household_id = $2 and user_id = $3 and person_id is distinct from $1`, [personId, household, uid]);
  }
  await sichern();
}

/** Beitritt mit Einladungscode auf einem neuen Gerät: Haushalt vom Server holen. */
export async function beitreten(code: string) {
  const c = supabase();
  if (!c) throw new Error("Keine Verbindung eingetragen.");
  const { data, error } = await c.rpc("join_household", { p_code: code.trim() });
  if (error) throw new Error(error.message.includes("ungültig") ? "Der Code ist ungültig oder abgelaufen." : error.message);
  await setState("household_id", data as string);
  await syncPruefen();
  await abgleichNeu();
  return data as string;
}

export async function einladen(household: string): Promise<string> {
  const c = supabase();
  if (!c) throw new Error("Keine Verbindung eingetragen.");
  const { data, error } = await c.rpc("create_invite", { p_household: household });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function abmelden() {
  const c = supabase();
  if (c) await c.auth.signOut();
  await syncPruefen();
}

export const istVerbunden = () => !!verbindung();
