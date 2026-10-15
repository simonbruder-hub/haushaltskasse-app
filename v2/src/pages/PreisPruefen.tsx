import { useEffect, useState } from "react";
import { db, useQuery } from "../db/client";
import { zahl } from "../lib/format";
import { useHaushalt } from "../lib/haushalt";
import { go } from "../lib/router";
import { ALARM_SQL, artikelLaden, artikelZurEan, eanSpeichern, packungText, produktVorschlaege, type Alarm, type Artikel } from "../lib/preise";
import type { Einheit } from "../lib/belege";
import { istLadenCode } from "../produkte/ean";
import { EanScanner } from "../produkte/EanScanner";
import { offSuchen, type OffErgebnis } from "../produkte/off";
import { KategorieWahl } from "../ui/Auswahl";
import { AlarmListe, PreisVergleich, RegalpreisFormular, Verbrauch } from "../ui/Preise";
import { Feld, Seite, useAktion } from "../ui/kit";
import { Icon } from "../ui/Icon";

/**
 * Preis prüfen im Laden (Blueprint §3.2): Strichcode scannen → bekannter Artikel sofort, sonst OpenFoodFacts →
 * einem Produkt zuordnen → Preise pro Laden, Alarme, Verbrauch und «Regalpreis erfassen».
 */
type Phase =
  | { art: "scan" }
  | { art: "suche"; ean: string }
  | { art: "zuordnen"; ean: string; off: OffErgebnis | null }
  | { art: "karte"; artikel: Artikel };

export function PreisPruefen({ artikelId }: { artikelId?: string }) {
  const { household } = useHaushalt();
  const [phase, setPhase] = useState<Phase>(artikelId ? { art: "suche", ean: "" } : { art: "scan" });

  useEffect(() => {
    if (!artikelId) return;
    (async () => { const a = await artikelLaden(await db(), artikelId); setPhase(a ? { art: "karte", artikel: a } : { art: "scan" }); })();
  }, [artikelId]);

  async function nachschlagen(ean: string) {
    setPhase({ art: "suche", ean });
    const d = await db();
    const a = await artikelZurEan(d, household, ean);
    if (a) { setPhase({ art: "karte", artikel: a }); return; }
    const off = istLadenCode(ean) ? null : await offSuchen(d, ean);
    setPhase({ art: "zuordnen", ean, off });
  }

  if (phase.art === "scan") {
    return (
      <Seite eyebrow="Preise" titel="Preis prüfen">
        <EanScanner titel="Preis prüfen" onCode={nachschlagen} onAbbrechen={() => go("preise")} />
      </Seite>
    );
  }
  if (phase.art === "suche") {
    return (
      <Seite eyebrow="Preise" titel="Preis prüfen">
        <div className="card p-5 grid gap-2 justify-items-center text-center">
          <Icon name="strichcode" size={36} className="text-muted animate-pulse" />
          <p className="font-semibold" role="status">{phase.ean ? "Wird nachgeschlagen …" : "Wird geladen …"}</p>
          {phase.ean && <p className="font-mono text-muted text-[13px]">{phase.ean}</p>}
        </div>
      </Seite>
    );
  }
  if (phase.art === "zuordnen") {
    return <Zuordnen ean={phase.ean} off={phase.off} onFertig={(a) => setPhase({ art: "karte", artikel: a })} onNeu={() => setPhase({ art: "scan" })} />;
  }
  return <Karte artikel={phase.artikel} onWeiter={() => setPhase({ art: "scan" })} />;
}

/** Neuer Artikel: Angaben von OpenFoodFacts übernehmen oder kurz von Hand, dann einem Produkt zuordnen */
function Zuordnen({ ean, off, onFertig, onNeu }: { ean: string; off: OffErgebnis | null; onFertig: (a: Artikel) => void; onNeu: () => void }) {
  const { household } = useHaushalt();
  const aktion = useAktion();
  const p = off?.status === "found" ? off.produkt : null;
  const [name, setName] = useState(p?.name ?? "");
  const [marke, setMarke] = useState(p?.marke ?? "");
  const [groesse, setGroesse] = useState(p?.packung ? String(p.packung.groesse) : "");
  const [einheit, setEinheit] = useState<Einheit>(p?.packung?.einheit ?? "g");
  const [anzahl, setAnzahl] = useState(String(p?.packung?.anzahl ?? 1));
  const [produktId, setProduktId] = useState<string | null>(null);
  const [produktName, setProduktName] = useState(p?.gattung ?? "");
  const [kategorie, setKategorie] = useState<string | null>(null);
  const [vorschlaege, setVorschlaege] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const alle = useQuery<{ id: string; name: string }>(`select id, name from master_product where household_id = $1 and deleted_at is null order by name`, [household]) ?? [];

  useEffect(() => {
    (async () => {
      const d = await db();
      const v = [...await produktVorschlaege(d, household, p?.gattung ?? ""), ...await produktVorschlaege(d, household, p?.name ?? "")];
      setVorschlaege(v.filter((x, i) => v.findIndex((y) => y.id === x.id) === i).slice(0, 6));
    })();
  }, [household, p?.gattung, p?.name]);

  const meldung = istLadenCode(ean) ? "Ladeninterner Code (Gewicht oder Preis im Code): bitte kurz von Hand erfassen."
    : !off ? null
    : off.status === "found" ? `Gefunden bei ${off.produkt.quelle === "off" ? "OpenFoodFacts" : off.produkt.quelle === "obf" ? "Open Beauty Facts" : "Open Products Facts"}. Bitte prüfen und einem Produkt zuordnen.`
    : off.status === "not_found" ? "Nicht bei OpenFoodFacts. Bitte kurz erfassen – die App merkt sich den Artikel."
    : off.text;
  const packung = zahl(groesse) > 0 ? { groesse: zahl(groesse), einheit, anzahl: Math.max(1, Math.round(zahl(anzahl)) || 1) } : null;
  const produktOk = !!produktId || produktName.trim() !== "";

  const speichern = async () => {
    setBusy(true);
    let a: Artikel | null = null;
    const ok = await aktion(async () => {
      a = await eanSpeichern(await db(), { household, ean, produktId, produktName, kategorie, name: name || produktName, marke, packung, bild: p?.bild ?? null });
    }, "Artikel gespeichert");
    setBusy(false);
    if (ok && a && location.hash.startsWith("#/preis-pruefen")) onFertig(a);
  };

  return (
    <Seite eyebrow="Neuer Artikel" titel={p?.name ?? "Artikel erfassen"} zurueck="preise">
      <div className="card p-3.5 flex gap-3.5 items-center">
        {p?.bild ? <img src={p.bild} alt="" className="w-16 h-16 object-contain rounded-lg bg-white" /> : <span className="k-ico k-zweck"><Icon name="strichcode" /></span>}
        <div className="grid min-w-0">
          <span className="font-mono text-[13px] text-muted">EAN {ean}</span>
          {p?.menge && <span className="text-[13px] text-ink-2">Packung laut OpenFoodFacts: {p.menge}</span>}
        </div>
      </div>
      {meldung && <p className={`card-flat p-3.5 text-[13.5px] ${off?.status === "found" ? "" : "bg-[var(--warn-wash)] border-transparent text-[var(--warn-ink)]"}`} role="status">{meldung}</p>}

      <div className="card p-4 grid gap-3.5">
        <Feld label="Bezeichnung auf der Packung"><input className="input" value={name} placeholder="z. B. Caffè Crema Bohnen" onChange={(e) => setName(e.target.value)} /></Feld>
        <Feld label="Marke"><input className="input" value={marke} placeholder="optional" onChange={(e) => setMarke(e.target.value)} /></Feld>
        <Feld gruppe label="Packung" hinweis="Für den Preis pro kg, l oder Stück.">
          <div className="grid grid-cols-[1fr_6.5rem_5.5rem] gap-2">
            <input className="input mono" inputMode="decimal" aria-label="Packungsgrösse" placeholder="z. B. 500" value={groesse} onChange={(e) => setGroesse(e.target.value)} />
            <select className="input" aria-label="Einheit der Packung" value={einheit} onChange={(e) => setEinheit(e.target.value as Einheit)}>
              <option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">l</option><option value="piece">Stück</option>
            </select>
            <label className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">×</span>
              <input className="input mono pl-7" inputMode="numeric" aria-label="Anzahl im Pack" value={anzahl} onChange={(e) => setAnzahl(e.target.value)} /></label>
          </div>
        </Feld>
      </div>

      <div className="card p-4 grid gap-3.5">
        <h2 className="text-[16px] font-bold">Zu welchem Produkt gehört das?</h2>
        <p className="text-muted text-[13.5px] -mt-2">Ein Produkt fasst gleichwertige Artikel zusammen, z. B. «Kaffeebohnen» von verschiedenen Marken. So vergleicht die App die Preise.</p>
        {vorschlaege.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Vorschläge">
            {vorschlaege.map((v) => (
              <button type="button" key={v.id} aria-pressed={produktId === v.id} onClick={() => setProduktId(produktId === v.id ? null : v.id)}
                className={`chip !text-[13.5px] !py-1.5 !px-3 border ${produktId === v.id ? "bg-[var(--ink)] text-[var(--paper)] border-transparent" : "bg-[var(--card)] border-[var(--rule-strong)]"}`}>{v.name}</button>
            ))}
          </div>
        )}
        {!produktId && <>
          <Feld label="Produkt" hinweis="Bestehendes wählen oder einen neuen Gattungsnamen eingeben, z. B. «Kaffeebohnen».">
            <input className="input" list="produkte" aria-label="Produkt" value={produktName} placeholder="Gattungsname" onChange={(e) => {
              setProduktName(e.target.value);
              const treffer = alle.find((x) => x.name.toLowerCase() === e.target.value.trim().toLowerCase());
              if (treffer) { setProduktId(treffer.id); setProduktName(""); }
            }} />
            <datalist id="produkte">{alle.map((x) => <option key={x.id} value={x.name} />)}</datalist>
          </Feld>
          <Feld gruppe label="Kategorie"><KategorieWahl wert={kategorie} onChange={setKategorie} /></Feld>
        </>}
        <button className="btn btn-primary btn-big" disabled={busy || !produktOk} onClick={speichern}><Icon name="haken" />Speichern</button>
        <button className="btn btn-ghost" onClick={onNeu}><Icon name="strichcode" />Anderen Strichcode scannen</button>
      </div>
    </Seite>
  );
}

/** Preis-Check: Preise pro Laden, Alarme, Verbrauch, Regalpreis erfassen */
function Karte({ artikel, onWeiter }: { artikel: Artikel; onWeiter: () => void }) {
  const { household } = useHaushalt();
  const p = useQuery<{ comparison_unit: string; kategorie: string | null }>(
    `select p.comparison_unit::text, c.name as kategorie from master_product p left join category c on c.id = p.category_id where p.id = $1`, [artikel.produkt_id])?.[0];
  const alarme = useQuery<Alarm>(`${ALARM_SQL} and master_product_id = $2 and seen_at is null order by observed_on desc`, [household, artikel.produkt_id]) ?? [];
  return (
    <Seite eyebrow={p?.kategorie ?? "Preis prüfen"} titel={artikel.produkt} zurueck="preise">
      <div className="card p-3.5 flex gap-3.5 items-center">
        {artikel.bild ? <img src={artikel.bild} alt="" className="w-16 h-16 object-contain rounded-lg bg-white" /> : <span className="k-ico k-zweck"><Icon name="strichcode" /></span>}
        <div className="grid min-w-0 flex-1">
          <b className="truncate">{artikel.name}</b>
          <span className="text-[13px] text-ink-2">{[artikel.marke, packungText(artikel.packung)].filter(Boolean).join(" · ")}</span>
          {artikel.ean && <span className="font-mono text-[12px] text-muted">EAN {artikel.ean}</span>}
        </div>
      </div>
      <AlarmListe alarme={alarme} mitProdukt={false} />
      {p && <PreisVergleich produktId={artikel.produkt_id} vergleich={p.comparison_unit} />}
      <Verbrauch produktId={artikel.produkt_id} />
      <RegalpreisFormular artikel={artikel.id} />
      <div className="grid grid-cols-2 gap-2">
        <button className="btn" onClick={onWeiter}><Icon name="strichcode" />Nächster Artikel</button>
        <a className="btn no-underline text-ink" href={`#/preise/${artikel.produkt_id}`}><Icon name="rechts" />Zum Produkt</a>
      </div>
    </Seite>
  );
}
