import { useState } from "react";
import { Feld, useAktion } from "./kit";
import { Icon } from "./Icon";
import { verbindung, verbindungSpeichern } from "../lib/supabase";
import { codePruefen, codeSenden, syncPruefen } from "../lib/sync";

/** Verbindung zum eigenen Supabase-Projekt eintragen */
export function VerbindungFormular({ fertig }: { fertig: () => void }) {
  const v = verbindung();
  const [url, setUrl] = useState(v?.url ?? "");
  const [key, setKey] = useState(v?.key ?? "");
  const aktion = useAktion();
  const ok = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url.trim()) && key.trim().length > 30;
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); aktion(async () => { verbindungSpeichern({ url: url.trim().replace(/\/$/, ""), key: key.trim() }); await syncPruefen(); fertig(); }, "Verbindung gespeichert"); }}>
      <Feld label="Projekt-URL" hinweis="Supabase → Project Settings → API → Project URL">
        <input className="input mono" inputMode="url" autoCapitalize="off" autoCorrect="off" placeholder="https://xyz.supabase.co" value={url} onChange={(e) => setUrl(e.target.value)} />
      </Feld>
      <Feld label="Öffentlicher Schlüssel (anon / publishable)" hinweis="Dieser Schlüssel darf in der App stehen – geschützt wird über die Anmeldung.">
        <textarea className="input mono text-[12.5px]" rows={3} autoCapitalize="off" autoCorrect="off" value={key} onChange={(e) => setKey(e.target.value)} />
      </Feld>
      <button className="btn btn-primary" disabled={!ok}>Verbindung speichern</button>
    </form>
  );
}

/** Anmeldung mit dem Code aus der E-Mail (kein Passwort) */
export function CodeLogin({ fertig }: { fertig: (userId: string) => void }) {
  const [email, setEmail] = useState("");
  const [gesendet, setGesendet] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const aktion = useAktion();
  if (!gesendet) {
    return (
      <form className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); setBusy(true); if (await aktion(() => codeSenden(email))) setGesendet(true); setBusy(false); }}>
        <Feld label="E-Mail" hinweis="Du bekommst einen Code per E-Mail. Ein Passwort braucht es nicht.">
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Feld>
        <button className="btn btn-primary" disabled={busy || !/.+@.+\..+/.test(email)}><Icon name="mail" />Code senden</button>
      </form>
    );
  }
  return (
    <form className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); setBusy(true); let uid = ""; if (await aktion(async () => { uid = await codePruefen(email, code); await syncPruefen(); })) fertig(uid); setBusy(false); }}>
      <p className="text-[14px] text-ink-2">Code an <b>{email}</b> gesendet. Er ist eine Stunde gültig.</p>
      <Feld label="Code aus der E-Mail">
        <input className="input mono text-center text-[22px] tracking-[.3em]" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
      </Feld>
      <button className="btn btn-primary" disabled={busy || code.length < 6}>Anmelden</button>
      <button type="button" className="btn btn-ghost" onClick={() => { setGesendet(false); setCode(""); }}>Andere E-Mail</button>
    </form>
  );
}
