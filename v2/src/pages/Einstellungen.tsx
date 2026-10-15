import { useEffect, useState } from "react";
import { openDb, useQuery } from "../db/client";
import { datum, monatName } from "../lib/format";
import { sicherung } from "../lib/data";
import { useHaushalt } from "../lib/haushalt";
import { verbindung, verbindungSpeichern } from "../lib/supabase";
import { abgleichNeu, abmelden, einladen, haushaltVerbinden, ichBin, syncPruefen, useSync } from "../lib/sync";
import { Abschnitt, Avatar, farbe, Feld, Seite, Sheet, useAktion, useToast } from "../ui/kit";
import { kiEinstellung, kiSpeichern } from "../scan/einstellung";
import { kostenText, MODELLE, STANDARD_MODELL } from "../scan/ki";
import { Icon } from "../ui/Icon";
import { CodeLogin, VerbindungFormular } from "../ui/Anmeldung";

declare const __BUILD__: string;

export function Einstellungen() {
  const { household, ich, personen } = useHaushalt();
  const aktion = useAktion();
  return (
    <Seite eyebrow="Einstellungen" titel="Gerät und Abgleich">
      <Abschnitt titel="Dieses Handy gehört">
        <div className="flex gap-2 flex-wrap">
          {personen.filter((p) => p.role === "adult").map((p) => (
            <button key={p.id} className={`btn ${p.id === ich ? "btn-soft" : ""}`} aria-pressed={p.id === ich} onClick={() => aktion(() => ichBin(p.id))}>
              <Avatar name={p.display_name} color={farbe(p)} size={24} />{p.display_name}{p.id === ich && <Icon name="haken" size={18} />}
            </button>
          ))}
        </div>
      </Abschnitt>
      <KiErkennung />
      <Abgleich household={household} />
      <Daten household={household} />
      <Abschnitt titel="Über die App">
        <div className="card p-4 grid gap-1.5 text-[14px]">
          <p><b>Haushalt</b> · Module 1–3 (Fundament, Belege und Ausgleich, Beleg-Scanner)</p>
          <p className="text-muted">Stand {typeof __BUILD__ === "string" ? __BUILD__ : "Entwicklung"}. Daten liegen in einer Datenbank auf diesem Handy und werden – wenn eingerichtet – mit eurem eigenen Supabase-Projekt abgeglichen.</p>
          <a className="text-accent-ink font-semibold" href="../">Zur bisherigen App «Kasse unterwegs»</a>
        </div>
      </Abschnitt>
      <Gefahr />
    </Seite>
  );
}

function Abgleich({ household }: { household: string }) {
  const s = useSync();
  const aktion = useAktion();
  const [verbindungZeigen, setVerbindungZeigen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const v = verbindung();
  return (
    <Abschnitt titel="Abgleich zwischen euren Handys" text="Über euer eigenes Supabase-Projekt (kostenlos). Ohne Abgleich bleibt alles nur auf diesem Handy.">
      <div className="card p-5 grid gap-4">
        {s.modus === "lokal" && (
          <>
            <div className="flex gap-3 items-start"><span className="k-ico k-privat"><Icon name="wolke_aus" /></span>
              <div className="grid"><b>Nur auf diesem Handy</b><span className="text-muted text-[13.5px]">Änderungen werden gesammelt ({s.ausstehend}) und beim ersten Abgleich hochgeladen.</span></div></div>
            <VerbindungFormular fertig={() => undefined} />
          </>
        )}
        {s.modus === "abgemeldet" && (
          <>
            <div className="flex gap-3 items-start"><span className="k-ico k-sparen"><Icon name="schluessel" /></span>
              <div className="grid"><b>Anmelden</b><span className="text-muted text-[13.5px]">Verbunden mit {v?.url.replace("https://", "")}. Jetzt mit deiner E-Mail anmelden.</span></div></div>
            <CodeLogin fertig={() => aktion(haushaltVerbinden, "Verbunden und abgeglichen")} />
          </>
        )}
        {(s.modus === "bereit" || s.modus === "laeuft" || s.modus === "fehler") && (
          <>
            <div className="flex gap-3 items-start">
              <span className={`k-ico ${s.modus === "fehler" ? "k-kind" : "k-leben"}`}><Icon name={s.modus === "fehler" ? "wolke_aus" : "wolke"} /></span>
              <div className="grid gap-0.5 min-w-0">
                <b>{s.modus === "laeuft" ? "Gleicht ab …" : s.modus === "fehler" ? "Abgleich gestört" : "Verbunden"}</b>
                <span className="text-muted text-[13.5px] truncate">{s.email}</span>
                <span className="text-muted text-[13.5px]">Letzter Abgleich: {s.letzter ? `${datum(s.letzter)}, ${new Date(s.letzter).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}` : "noch nie"} · {s.ausstehend} ausstehend</span>
                {s.fehler && <span className="text-crit text-[13px]">{s.fehler}</span>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-primary" disabled={s.modus === "laeuft"} onClick={() => aktion(async () => { if (!(await abgleichNeu())) throw new Error(navigator.onLine ? "Abgleich fehlgeschlagen – Details oben." : "Kein Netz – es wird später erneut versucht."); }, "Abgeglichen")}><Icon name="aktualisieren" />Jetzt abgleichen</button>
              <button className="btn" onClick={() => aktion(async () => setCode(await einladen(household)))}><Icon name="link" />Partner einladen</button>
            </div>
            <button className="btn btn-ghost" onClick={() => aktion(abmelden, "Abgemeldet")}>Abmelden</button>
          </>
        )}
        {v && <button className="btn btn-ghost text-[13.5px]" onClick={() => setVerbindungZeigen(true)}>Verbindung ändern</button>}
      </div>
      <Sheet offen={verbindungZeigen} onClose={() => setVerbindungZeigen(false)} titel="Verbindung">
        <div className="grid gap-4">
          <VerbindungFormular fertig={() => setVerbindungZeigen(false)} />
          <button className="btn btn-danger" onClick={async () => { await abmelden().catch(() => undefined); verbindungSpeichern(null); await syncPruefen(); setVerbindungZeigen(false); }}>Verbindung entfernen</button>
        </div>
      </Sheet>
      <Sheet offen={!!code} onClose={() => setCode(null)} titel="Partner einladen">
        <div className="grid gap-4 text-center">
          <p className="text-ink-2">Auf dem anderen Handy die App öffnen → «Einem Haushalt beitreten» → diesen Code eingeben. Er ist 7 Tage gültig und funktioniert einmal.</p>
          <p className="num text-[36px] tracking-[.18em] font-bold select-all">{code}</p>
          {"share" in navigator && <button className="btn btn-primary" onClick={() => navigator.share({ text: `Einladung in unseren Haushalt: ${code}\nApp: ${location.href.split("#")[0]}` }).catch(() => undefined)}>Code teilen</button>}
        </div>
      </Sheet>
    </Abschnitt>
  );
}

function Daten({ household }: { household: string }) {
  const [speicher, setSpeicher] = useState<{ dauerhaft: boolean; mb: number } | null>(null);
  useEffect(() => {
    (async () => {
      const dauerhaft = (await navigator.storage?.persisted?.()) ?? false;
      const est = await navigator.storage?.estimate?.();
      setSpeicher({ dauerhaft, mb: Math.round(((est?.usage ?? 0) / 1048576) * 10) / 10 });
    })();
  }, []);
  const aktion = useAktion();
  return (
    <Abschnitt titel="Daten">
      <div className="card p-4 grid gap-3">
        <p className="text-[14px] text-ink-2">
          {speicher ? `${speicher.mb} MB auf diesem Handy · ${speicher.dauerhaft ? "dauerhaft gespeichert" : "der Browser darf bei Platzmangel löschen – App installieren hilft"}` : "…"}
        </p>
        <button className="btn" onClick={() => aktion(async () => {
          const blob = await sicherung(household);
          const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `haushalt-sicherung-${new Date().toISOString().slice(0, 10)}.json`; a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 30000);
        }, "Sicherung erstellt")}><Icon name="download" />Sicherung herunterladen</button>
      </div>
    </Abschnitt>
  );
}

function Gefahr() {
  const [sicher, setSicher] = useState(0);
  return (
    <Abschnitt titel="Neu beginnen">
      <div className="card-flat p-4 grid gap-3">
        <p className="text-muted text-[13.5px]">Löscht alle Daten auf diesem Handy. Was schon abgeglichen ist, bleibt auf dem Server.</p>
        <button className="btn btn-danger" onClick={async () => {
          if (sicher < 1) { setSicher(1); return; }
          const d = await openDb(); await d.close().catch(() => undefined);
          await new Promise((r) => { const q = indexedDB.deleteDatabase("/pglite/haushalt"); q.onsuccess = q.onerror = q.onblocked = r; });
          localStorage.removeItem("haushalt-supabase");
          location.hash = ""; location.reload();
        }}>{sicher ? "Wirklich alles auf diesem Handy löschen" : "Alle Daten auf diesem Handy löschen"}</button>
      </div>
    </Abschnitt>
  );
}

/** Belege lesen mit Claude: Schlüssel und Modell bleiben auf diesem Handy */
function KiErkennung() {
  const toast = useToast();
  const [ki, setKi] = useState(kiEinstellung());
  const [schluessel, setSchluessel] = useState("");
  const [modell, setModell] = useState(ki?.modell ?? STANDARD_MODELL);
  const neu = schluessel.trim();
  const ungueltig = neu !== "" && !/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(neu);
  const speichern = () => {
    const v = { schluessel: neu || ki!.schluessel, modell };
    kiSpeichern(v); setKi(v); setSchluessel("");
    toast("KI-Erkennung gespeichert");
  };
  return (
    <Abschnitt titel="Belege lesen (KI)" text="Claude von Anthropic liest Fotos und PDFs: Positionen, Rabatte, Zahlungen und passende Kategorien. Ohne KI liest das Handy selbst, aber weniger genau.">
      <div className="card p-4 grid gap-3.5">
        <p className="flex items-center gap-2 text-[14.5px]">
          {ki ? <><Icon name="haken" className="text-accent-ink" /><b>Aktiv</b><span className="text-muted">· Schlüssel …{ki.schluessel.slice(-4)}</span></> : <><Icon name="info" className="text-muted" />Noch nicht eingerichtet</>}
        </p>
        <div className="grid gap-1.5" role="radiogroup" aria-label="Genauigkeit">
          {MODELLE.map((m) => (
            <label key={m.id} className={`card-flat p-3 flex gap-3 items-center cursor-pointer ${modell === m.id ? "border-[var(--accent)] bg-[var(--accent-wash)]" : ""}`}>
              <input type="radio" name="ki-modell" className="accent-[var(--accent)] size-4" checked={modell === m.id} onChange={() => setModell(m.id)} />
              <span className="grid"><b>{m.name}</b><span className="text-muted text-[12.5px]">{m.text}</span></span>
            </label>
          ))}
        </div>
        <Feld label={ki ? "Neuer API-Schlüssel (optional)" : "API-Schlüssel"} hinweis="Auf console.anthropic.com → API Keys erstellen und Guthaben laden. Der Schlüssel bleibt auf diesem Handy und wird nicht abgeglichen.">
          <input className="input mono" type="password" autoComplete="off" placeholder="sk-ant-…" value={schluessel} onChange={(e) => setSchluessel(e.target.value)} />
        </Feld>
        {ungueltig && <p className="text-crit text-[13px]">Das sieht nicht wie ein Anthropic-Schlüssel aus (beginnt mit «sk-ant-»).</p>}
        <button className="btn btn-primary" disabled={(!ki && !neu) || ungueltig || (!!ki && !neu && modell === ki.modell)} onClick={speichern}>Speichern</button>
        {ki && <button className="btn btn-ghost" onClick={() => { kiSpeichern(null); setKi(null); toast("KI-Erkennung ausgeschaltet"); }}>KI-Erkennung ausschalten</button>}
        <KiKosten />
        <p className="text-muted text-[12.5px]">Datenschutz: Das Belegfoto geht zur Erkennung an Anthropic und wird über dein Anthropic-Konto abgerechnet. Belegfotos bleiben sonst nur auf diesem Handy.</p>
      </div>
    </Abschnitt>
  );
}

/** Was die KI-Erkennung auf diesem Handy bisher gekostet hat (aus den Token-Zahlen der Antworten) */
function KiKosten() {
  const { household } = useHaushalt();
  const r = useQuery<{ monat: string; n: number; usd: string | null }>(
    `select to_char(created_at at time zone 'Europe/Zurich', 'YYYY-MM') as monat, count(*)::int as n, sum(cost_usd)::text as usd
       from scan_job where household_id = $1 and model like 'claude%' group by 1 order by 1 desc limit 3`, [household]);
  if (!r?.length) return null;
  return (
    <div className="card-flat p-3 grid gap-1 text-[13px]" data-testid="ki-kosten">
      <span className="font-semibold">Gelesene Belege</span>
      {r.map((m) => (
        <span key={m.monat} className="flex justify-between gap-2">
          <span>{monatName(m.monat)} · {m.n} {m.n === 1 ? "Beleg" : "Belege"}</span>
          <span className="num">{kostenText(m.usd) ?? "–"}</span>
        </span>
      ))}
      <span className="text-muted text-[12px]">Geschätzt aus den Tokens zum Listenpreis (1 USD ≈ 0.80 CHF). Massgebend ist die Abrechnung auf console.anthropic.com.</span>
    </div>
  );
}
