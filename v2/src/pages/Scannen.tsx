import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../db/client";
import { geld, heute, kurzDatum, zahl } from "../lib/format";
import { persoenlich, topfOptionen, vorschau, zahlKonten } from "../lib/auswahl";
import { useHaushalt } from "../lib/haushalt";
import { go } from "../lib/router";
import { bildVorbereiten, sha256, zuBase64 } from "../scan/bild";
import { entwurfBauen, entwurfSpeichern, topfFuer, zeilenSumme, type ScanEntwurf, type ScanZeile } from "../scan/entwurf";
import { kiEinstellung, scanDateiNehmen } from "../scan/einstellung";
import { KiFehler, kiLesen, MODELLE, type Teil } from "../scan/ki";
import { ocrLesen } from "../scan/ocr";
import { Kamera } from "../scan/dokument/Kamera";
import { zusammensetzen } from "../scan/dokument/seite";
import { packungText, vergleichFuer } from "../produkte/menge";
import type { Einheit } from "../lib/belege";
import { KategorieWahl, TopfChips, useKategorien } from "../ui/Auswahl";
import { Avatar, farbe, Feld, Seg, Seite, Sheet, useAktion } from "../ui/kit";
import { Icon } from "../ui/Icon";
import { ZAHLART_TEXT } from "./BelegDetail";
import type { Abweichung } from "../scan/pruefen";

type Phase = { art: "waehlen" } | { art: "kamera" } | { art: "lesen"; text: string; anteil: number | null } | { art: "fehler"; text: string; offlineMoeglich: boolean } | { art: "pruefen" };

const STATUS: Record<ScanZeile["status"], [string, string]> = {
  sicher: ["var(--accent)", "gelernt"], bekannt: ["var(--gold)", "Vorschlag"], ki: ["var(--k-zweck)", "KI"], neu: ["var(--rule-strong)", "neu"], pruefen: ["var(--crit)", "prüfen"],
};

/** Was gelesen wird: eine gewählte Datei (Foto oder PDF) oder die Seiten aus dem Dokumentscanner (von oben nach unten) */
type Quelle = { datei: File } | { seiten: Blob[] };

export function Scannen({ kamera: mitKamera = false }: { kamera?: boolean }) {
  const { household, konten, personen, ich } = useHaushalt();
  const kats = useKategorien();
  const aktion = useAktion();
  const ki = kiEinstellung();
  const [phase, setPhase] = useState<Phase>(mitKamera ? { art: "kamera" } : { art: "waehlen" });
  const [entwurf, setEntwurf] = useState<ScanEntwurf | null>(null);
  const [vorschauBild, setVorschauBild] = useState<string | null>(null);
  const [konto, setKonto] = useState<string | null>(null);
  const [bearbeiten, setBearbeiten] = useState<number | null>(null);
  const [gross, setGross] = useState(false);
  const [busy, setBusy] = useState(false);
  const letzte = useRef<Quelle | null>(null);
  const kamera = useRef<HTMLInputElement>(null), datei = useRef<HTMLInputElement>(null);

  useEffect(() => { const f = scanDateiNehmen(); if (f) lesen({ datei: f }); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (vorschauBild) URL.revokeObjectURL(vorschauBild); }, [vorschauBild]);

  const eigenesKonto = zahlKonten(konten).find((k) => k.kind === "privat" && k.owners.length === 1 && k.owners[0].person_id === ich)?.id ?? zahlKonten(konten)[0]?.id ?? null;

  async function lesen(q: Quelle, erzwingeOffline = false) {
    letzte.current = q;
    const f = "datei" in q ? q.datei : null;
    const pdf = !!f && (f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    setEntwurf(null);
    setPhase({ art: "lesen", text: "Bild wird vorbereitet …", anteil: null });
    try {
      // Mehrere Seiten: jede einzeln an die Erkennung, für die Ablage untereinander zu einem Bild
      const seiten = "seiten" in q ? await Promise.all(q.seiten.map((b) => bildVorbereiten(b))) : null;
      const vorb = pdf ? null : seiten
        ? { ablage: seiten.length === 1 ? seiten[0].ablage : await zusammensetzen(seiten.map((x) => x.ablage)), abschnitte: seiten.flatMap((x) => x.abschnitte) }
        : await bildVorbereiten(f!);
      const sha = await sha256(pdf ? f! : vorb!.ablage);
      if (vorb) setVorschauBild(URL.createObjectURL(vorb.ablage));
      const d = await db();
      // direkt aus der Datenbank: beim Öffnen der Seite sind die Kategorien im Hook evtl. noch nicht geladen
      const katNamen = (await d.query<{ name: string }>(`select c.name from category c join life_area la on la.id = c.life_area_id
         where c.household_id = $1 and c.archived_at is null and la.archived_at is null order by la.sort, c.sort`, [household])).rows.map((k) => k.name);
      // Bekannte Produkte (die häufigsten zuerst): die KI übernimmt deren Namen, so entstehen keine Doppelten
      const produkte = (await d.query<{ name: string }>(`select p.name from master_product p left join line_item l on l.master_product_id = p.id
         where p.household_id = $1 and p.deleted_at is null group by p.id, p.name order by count(l.id) desc, p.name limit 200`, [household])).rows.map((p) => p.name);
      let extraktion, abweichungen: Abweichung[] = [], quelle: "ki" | "ocr" = "ki", protokoll: ScanEntwurf["protokoll"] = null;
      const kiMoeglich = ki && navigator.onLine && !erzwingeOffline;
      if (kiMoeglich) {
        try {
          const teile: Teil[] = pdf ? [{ art: "pdf", daten: await zuBase64(f!) }] : await Promise.all(vorb!.abschnitte.map(async (b) => ({ art: "bild" as const, daten: await zuBase64(b) })));
          const r = await kiLesen({ teile, kategorien: katNamen, produkte, heute: heute(), schluessel: ki.schluessel, modell: ki.modell, status: (t) => setPhase({ art: "lesen", text: t, anteil: null }) });
          extraktion = r.extraktion; abweichungen = r.abweichungen;
          protokoll = { modell: r.modell, requestId: r.requestId, tokensIn: r.tokensIn, tokensOut: r.tokensOut, kostenUsd: r.kostenUsd, roh: r.roh, parsed: r.extraktion };
        } catch (e) {
          if (pdf || !(e instanceof KiFehler && e.offline)) throw e;
          quelle = "ocr";   // kein Netz: offline weiterlesen
        }
      }
      if (!extraktion) {
        if (pdf) throw new KiFehler("PDF-Belege liest nur die KI-Erkennung. Bitte in den Einstellungen einrichten oder ein Foto aufnehmen.");
        quelle = "ocr";
        setPhase({ art: "lesen", text: "Texterkennung auf dem Handy …", anteil: 0 });
        extraktion = await ocrLesen(seiten ? seiten.map((x) => x.ablage) : [vorb!.ablage], (a) => setPhase({ art: "lesen", text: "Texterkennung auf dem Handy …", anteil: a }));
      }
      const e = await entwurfBauen(d, {
        household, extraktion, quelle, kanal: pdf ? "receipt_pdf" : "receipt_image", abweichungen, heute: heute(),
        datei: { blob: pdf ? f! : vorb!.ablage, sha, mime: pdf ? "application/pdf" : "image/jpeg" }, protokoll,
      });
      if (quelle === "ocr" && ki && !erzwingeOffline) e.hinweise.unshift("Ohne Internet gelesen (Texterkennung auf dem Handy). Bitte Positionen prüfen.");
      setEntwurf(e);
      setKonto(e.zahlungen.find((z) => z.konto)?.konto ?? eigenesKonto);
      setPhase({ art: "pruefen" });
    } catch (e) {
      console.error(e);
      setPhase({ art: "fehler", text: e instanceof Error ? e.message : String(e), offlineMoeglich: !pdf && !erzwingeOffline });
    }
  }

  const waehlen = (ev: React.ChangeEvent<HTMLInputElement>) => { const f = ev.target.files?.[0]; ev.target.value = ""; if (f) lesen({ datei: f }); };
  const eingaben = (
    <>
      <input ref={kamera} type="file" accept="image/*" capture="environment" className="hidden" aria-label="Foto aufnehmen" onChange={waehlen} />
      <input ref={datei} type="file" accept="image/*,application/pdf" className="hidden" aria-label="Foto oder PDF wählen" onChange={waehlen} />
    </>
  );

  if (phase.art === "kamera") {
    return (
      <Seite eyebrow="Beleg scannen" titel="Kamera">
        {eingaben}
        <Kamera onAbbrechen={() => (mitKamera ? go("erfassen") : setPhase({ art: "waehlen" }))}
          onOhneKamera={() => kamera.current?.click()}
          onFertig={(seiten) => { lesen({ seiten: seiten.map((x) => x.blob) }); seiten.forEach((x) => URL.revokeObjectURL(x.url)); }} />
      </Seite>
    );
  }
  if (phase.art === "waehlen") {
    return (
      <Seite eyebrow="Beleg scannen" titel="Foto oder PDF" zurueck="erfassen">
        {eingaben}
        <div className="grid gap-3">
          <button className="btn btn-primary btn-big" onClick={() => setPhase({ art: "kamera" })}><Icon name="kamera" />Beleg fotografieren</button>
          <button className="btn btn-big" onClick={() => datei.current?.click()}><Icon name="blatt" />Foto oder PDF wählen</button>
        </div>
        <KiHinweis />
      </Seite>
    );
  }
  if (phase.art === "lesen") {
    return (
      <Seite eyebrow="Beleg scannen" titel="Wird gelesen …">
        <div className="card p-4 grid gap-4 justify-items-center text-center">
          {vorschauBild ? <img src={vorschauBild} alt="Beleg" className="max-h-[46dvh] rounded-xl shadow animate-pulse" /> : <Icon name="beleg" size={48} className="text-muted" />}
          <p className="font-semibold" role="status">{phase.text}</p>
          {phase.anteil != null && (
            <div className="w-full h-2 rounded-full bg-[var(--paper-2)] overflow-hidden"><div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${Math.round(phase.anteil * 100)}%` }} /></div>
          )}
        </div>
      </Seite>
    );
  }
  if (phase.art === "fehler") {
    return (
      <Seite eyebrow="Beleg scannen" titel="Nicht gelesen" zurueck="erfassen">
        {eingaben}
        <div className="card-flat p-4 grid gap-2 border-[var(--crit)]"><p className="text-crit font-semibold">{phase.text}</p></div>
        <div className="grid gap-2">
          <button className="btn btn-primary" onClick={() => letzte.current && lesen(letzte.current)}><Icon name="aktualisieren" />Nochmals versuchen</button>
          {phase.offlineMoeglich && <button className="btn" onClick={() => letzte.current && lesen(letzte.current, true)}><Icon name="wolke_aus" />Ohne KI auf dem Handy lesen</button>}
          <button className="btn" onClick={() => datei.current?.click()}><Icon name="blatt" />Anderes Foto wählen</button>
          <button className="btn btn-ghost" onClick={() => go("erfassen")}>Von Hand erfassen</button>
        </div>
      </Seite>
    );
  }
  if (!entwurf) return null;
  return <Pruefen e={entwurf} setE={setEntwurf} konto={konto} setKonto={setKonto} bild={vorschauBild} gross={gross} setGross={setGross}
    bearbeiten={bearbeiten} setBearbeiten={setBearbeiten} busy={busy}
    speichern={async () => {
      setBusy(true);
      let id = "";
      const ok = await aktion(async () => { id = await entwurfSpeichern(await db(), entwurf, { household, konto: konto ?? eigenesKonto!, konten, ich, kategorien: kats }); }, "Beleg gespeichert");
      setBusy(false);
      if (ok && location.hash.startsWith("#/scan")) go(`belege/${id}`);   // nur, wenn man noch hier ist
    }}
    kats={kats} personen={personen} />;
}

function KiHinweis() {
  const ki = kiEinstellung();
  const m = MODELLE.find((x) => x.id === ki?.modell);
  return ki
    ? <p className="text-muted text-[13.5px] px-1"><Icon name="haken" size={14} className="inline -mt-0.5 text-accent-ink" /> KI-Erkennung aktiv ({m?.name ?? ki.modell}). Ohne Internet liest das Handy selbst.</p>
    : <p className="text-muted text-[13.5px] px-1">Ohne KI liest das Handy den Beleg selbst (Texterkennung). Genauer und mit Kategorien geht es mit der KI-Erkennung: <a href="#/einstellungen" className="text-accent-ink font-semibold">einrichten</a>.</p>;
}

function Pruefen({ e, setE, konto, setKonto, bild, gross, setGross, bearbeiten, setBearbeiten, busy, speichern, kats, personen }: {
  e: ScanEntwurf; setE: (e: ScanEntwurf) => void; konto: string | null; setKonto: (k: string) => void; bild: string | null; gross: boolean; setGross: (b: boolean) => void;
  bearbeiten: number | null; setBearbeiten: (i: number | null) => void; busy: boolean; speichern: () => void;
  kats: ReturnType<typeof useKategorien>; personen: ReturnType<typeof useHaushalt>["personen"];
}) {
  const { konten, ich } = useHaushalt();
  const opts = topfOptionen(konten, personen);
  const kontoObj = konten.find((k) => k.id === konto);
  const kaeufer = kontoObj && kontoObj.owners.length === 1 ? kontoObj.owners[0].person_id : ich;
  const eigener = persoenlich(konten, kaeufer);
  const katTopf = (k: string | null) => kats.find((c) => c.id === k)?.default_cost_account_id ?? null;
  const haupt = useMemo(() => {
    const m = new Map<string, number>();
    for (const z of e.zeilen) if (z.kategorie) m.set(z.kategorie, (m.get(z.kategorie) ?? 0) + Math.abs(z.betrag));
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }, [e.zeilen]);
  const topfVon = (z: ScanZeile) => topfFuer(z, katTopf, eigener, haupt);
  const topfName = (id: string | null) => opts.find((o) => o.id === id)?.label ?? konten.find((k) => k.id === id)?.name ?? "–";
  const summe = zeilenSumme(e);
  const diff = Math.round((e.total - summe) * 100) / 100;
  const aendern = (i: number, z: Partial<ScanZeile>) => setE({ ...e, zeilen: e.zeilen.map((x, j) => (j === i ? { ...x, ...z } : x)) });
  const gutscheine = e.zahlungen.filter((z) => !z.konto && ["voucher", "gift_card", "loyalty_points", "reka", "lunch_check"].includes(z.art));
  const vs = vorschau(
    e.zeilen.map((z) => ({ betrag: (e.art === "refund" ? -1 : 1) * z.betrag * e.kurs, topf: topfVon(z)! })).filter((z) => z.topf),
    [...gutscheine.map((g) => ({ betrag: (e.art === "refund" ? -1 : 1) * g.betrag * e.kurs, konto: null })),
      { betrag: (e.art === "refund" ? -1 : 1) * (e.total - gutscheine.reduce((s, g) => s + g.betrag, 0)) * e.kurs, konto }], konten);
  const erwachsene = personen.filter((p) => p.role === "adult");
  const wirkung = erwachsene.map((p) => ({ p, w: (vs[p.id]?.bezahlt ?? 0) - (vs[p.id]?.anteil ?? 0) }));
  const plus = wirkung.find((x) => x.w > 0.005), minus = wirkung.find((x) => x.w < -0.005);
  const z = bearbeiten != null ? e.zeilen[bearbeiten] : null;

  return (
    <Seite eyebrow={e.quelle === "ki" ? `Beleg prüfen · KI (${MODELLE.find((m) => e.protokoll?.modell?.startsWith(m.id))?.name ?? "Claude"})` : "Beleg prüfen · auf dem Handy gelesen"}
      titel={e.ladenName || "Beleg"} zurueck="erfassen">
      <div className="card p-3.5 flex gap-3.5 items-start">
        {bild ? <button className="flex-none" onClick={() => setGross(true)} aria-label="Foto gross anzeigen"><img src={bild} alt="Beleg" className="w-16 h-20 object-cover object-top rounded-lg border border-[var(--rule)]" /></button>
          : <span className="k-ico k-zweck"><Icon name="beleg" /></span>}
        <div className="grid gap-1.5 flex-1 min-w-0">
          <input className="input !min-h-0 py-1.5 font-semibold" aria-label="Laden" value={e.ladenName} placeholder="Laden" onChange={(x) => setE({ ...e, ladenName: x.target.value, laden: null })} />
          <div className="flex items-center gap-2 flex-wrap">
            <label className="relative chip !text-[13px] !py-1 !px-2.5 bg-[var(--paper-2)] text-ink-2 cursor-pointer">
              <Icon name="kalender" size={14} />{kurzDatum(e.datum)}{e.zeit ? ` · ${e.zeit}` : ""}
              <input type="date" aria-label="Datum" className="absolute inset-0 opacity-0" value={e.datum} onChange={(x) => x.target.value && setE({ ...e, datum: x.target.value })} />
            </label>
            {e.art === "refund" && <span className="chip chip-ok">Gutschrift</span>}
          </div>
        </div>
        <div className="grid justify-items-end">
          <span className="text-muted text-[12px]">Total</span>
          <span className="num text-[22px] leading-tight">{e.waehrung !== "CHF" ? e.waehrung + " " : ""}{geld(e.total)}</span>
        </div>
      </div>

      {(e.hinweise.length > 0 || e.abweichungen.length > 0) && (
        <div className="card-flat p-3.5 grid gap-1 bg-[var(--warn-wash)] border-transparent text-[13.5px] text-[var(--warn-ink)]">
          {[...e.hinweise, ...e.abweichungen].map((h, i) => <p key={i}>{h}</p>)}
        </div>
      )}

      <div className={`card-flat p-3 flex items-center gap-3 text-[14px] ${diff === 0 ? "" : "border-[var(--crit)]"}`} data-testid="summe">
        {diff === 0
          ? <><Icon name="haken" className="text-accent-ink" /><span className="flex-1">{e.zeilen.length} Positionen · Summe stimmt</span></>
          : <>
              <Icon name="info" className="text-crit" />
              <span className="flex-1">Positionen <b className="num">{geld(summe)}</b> · Total <b className="num">{geld(e.total)}</b>
                <br /><span className="text-muted text-[12.5px]">{diff > 0 ? `Rest ${geld(diff)} wird als «Übriges» gebucht.` : `Die Positionen sind ${geld(-diff)} zu hoch.`}</span></span>
              <button className="btn !min-h-0 py-1.5 text-[13px]" onClick={() => setE({ ...e, total: summe })}>Total = {geld(summe)}</button>
            </>}
      </div>

      <div className="grid gap-2">
        <div className="flex items-end justify-between px-1">
          <h2 className="text-[16px] font-bold">Positionen</h2>
          <span className="flex gap-2 text-[11.5px] text-muted">
            {(["sicher", "bekannt", "ki", "neu", "pruefen"] as const).filter((s) => e.zeilen.some((x) => x.status === s)).map((s) => (
              <span key={s} className="flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: STATUS[s][0] }} />{STATUS[s][1]}</span>
            ))}
          </span>
        </div>
        <div className="card list overflow-hidden" role="list" aria-label="Positionen">
          {e.zeilen.map((x, i) => {
            const t = topfVon(x);
            const o = opts.find((y) => y.id === t);
            return (
              <div key={x.key} className="row !items-start !cursor-default" role="listitem" aria-label={x.name}>
                <span className="mt-2 size-2.5 rounded-full flex-none" style={{ background: STATUS[x.status][0] }} title={STATUS[x.status][1]} />
                <button className="grid flex-1 min-w-0 text-left gap-0.5 bg-transparent border-0 p-0 cursor-pointer" onClick={() => setBearbeiten(i)} aria-label={`${x.name} bearbeiten`}>
                  <span className="font-semibold truncate">{x.name}</span>
                  <span className="font-mono text-[11.5px] text-muted truncate">{x.raw}{x.menge ? ` · ${x.menge} ${x.einheit === "piece" ? "×" : x.einheit}${x.einzelpreis ? " à " + geld(x.einzelpreis) : ""}` : ""}{x.packung ? ` · ${packungText(x.packung)}` : ""}</span>
                  {x.hinweis && <span className={`text-[12px] ${x.status === "pruefen" ? "text-crit" : "text-[var(--warn-ink)]"}`}>{x.hinweis}</span>}
                  <span className="flex flex-wrap gap-1 mt-1">
                    {x.typ === "product"
                      ? <span className="chip !text-[11px] !px-2 !py-0.5 bg-[var(--paper-2)]">{kats.find((k) => k.id === x.kategorie)?.name ?? "Kategorie wählen"}</span>
                      : <span className="chip !text-[11px] !px-2 !py-0.5 bg-[var(--paper-2)]">{x.typ === "deposit_or_fee" ? "Depot / Gebühr" : "Retoure"}</span>}
                    <span className={`chip k-tag k-${o?.kind ?? "zweck"} !text-[11px] !px-2 !py-0.5`}>{topfName(t)}</span>
                  </span>
                </button>
                <span className="grid justify-items-end">
                  <span className="num">{geld(x.betrag)}</span>
                  {x.rabatt + x.korbRabatt > 0 && <span className="text-[11.5px] text-accent-ink">− {geld(x.rabatt + x.korbRabatt)}</span>}
                </span>
              </div>
            );
          })}
        </div>
        <button className="btn" onClick={() => {
          setE({ ...e, zeilen: [...e.zeilen, { key: "neu-" + Date.now(), raw: "Position", name: "Position", typ: "product", betrag: 0, rabatt: 0, rabattText: null, korbRabatt: 0, korbText: null,
            menge: null, einheit: null, einzelpreis: null, packung: null, vergleich: "per_piece", kategorie: haupt, topf: null, status: "neu", vorschlag: null, hinweis: null }] });
          setBearbeiten(e.zeilen.length);
        }}><Icon name="plus" />Position</button>
      </div>

      <Feld gruppe label={e.art === "refund" ? "Zurück auf" : "Bezahlt von"}>
        <div className="flex flex-wrap gap-1.5">
          {zahlKonten(konten).map((a) => (
            <button type="button" key={a.id} aria-pressed={konto === a.id} onClick={() => setKonto(a.id)}
              className={`chip !text-[13.5px] !py-1.5 !px-3 border ${konto === a.id ? "bg-[var(--ink)] text-[var(--paper)] border-transparent" : "bg-[var(--card)] border-[var(--rule-strong)]"}`}>
              {a.owners.length === 1 && <Avatar name={a.owners[0].name} color={farbe(a.owners[0])} size={18} />}{a.name}
            </button>
          ))}
        </div>
        {e.zahlungen.length > 0 && (
          <div className="grid gap-1 text-[13px] text-ink-2">
            {e.zahlungen.map((p, i) => (
              <div key={i} className="flex justify-between gap-2">
                <span className="truncate">{p.label || ZAHLART_TEXT[p.art] || p.art}{p.last4 ? ` ··${p.last4}` : ""}{gutscheine.includes(p) ? " · zählt für beide nach Anteil" : ""}</span>
                <span className="num">{geld(p.betrag)}</span>
              </div>
            ))}
          </div>
        )}
      </Feld>

      <div className="card-flat p-3.5 grid gap-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {erwachsene.map((p) => (
            <span key={p.id} className="flex items-center gap-1.5 text-[14px]"><Avatar name={p.display_name} color={farbe(p)} size={22} />
              {p.display_name} {e.art === "refund" ? "bekommt" : "trägt"} <b className="num">{geld(Math.abs(vs[p.id]?.anteil ?? 0))}</b></span>
          ))}
        </div>
        <p className="text-[13.5px] text-ink-2">{plus && minus ? <>Aus diesem Beleg schuldet <b>{minus.p.display_name}</b> {plus.p.display_name} <b className="num">CHF {geld(plus.w)}</b>.</> : "Kein Ausgleich nötig."}</p>
      </div>

      <div className="sticky bottom-[calc(78px+env(safe-area-inset-bottom))] z-20 -mx-4 px-4 pt-3 pb-4 bg-[linear-gradient(to_top,var(--paper)_75%,transparent)]">
        <button className="btn btn-primary btn-big w-full shadow-lg" disabled={busy || diff < 0 || !konto} onClick={speichern}>
          <Icon name="haken" />Bestätigen · {e.waehrung} {geld(e.total)}
        </button>
      </div>

      <Sheet offen={gross} onClose={() => setGross(false)} titel="Beleg">
        {bild && <img src={bild} alt="Beleg gross" className="w-full rounded-xl" />}
      </Sheet>
      <Sheet offen={z != null} onClose={() => setBearbeiten(null)} titel="Position">
        {z && bearbeiten != null && (
          <div className="grid gap-4" key={z.key}>
            <p className="font-mono text-[12px] text-muted">{z.raw}</p>
            <div className="grid grid-cols-[1fr_7rem] gap-2">
              <Feld label="Produkt"><input className="input" value={z.name} onChange={(x) => aendern(bearbeiten, { name: x.target.value })} /></Feld>
              <Feld label="Betrag"><input className="input mono" inputMode="decimal" defaultValue={String(z.betrag)} onChange={(x) => aendern(bearbeiten, { betrag: zahl(x.target.value) })} /></Feld>
            </div>
            <Seg label="Art der Position" wert={z.typ} onChange={(v) => aendern(bearbeiten, { typ: v })}
              optionen={[["product", "Ware"], ["deposit_or_fee", "Depot / Gebühr"], ["refund_or_return", "Retoure"]]} />
            {z.typ === "product" && !(z.menge && z.einheit !== "piece") && <PackungFeld z={z} aendern={(v) => aendern(bearbeiten, v)} />}
            {z.typ === "product" && <Feld gruppe label="Kategorie"><KategorieWahl wert={z.kategorie} onChange={(v) => aendern(bearbeiten, { kategorie: v, topf: null })} /></Feld>}
            <Feld gruppe label="Für wen"><TopfChips wert={topfVon(z)} onChange={(v) => aendern(bearbeiten, { topf: v })} /></Feld>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-danger" onClick={() => { setE({ ...e, zeilen: e.zeilen.filter((_, j) => j !== bearbeiten) }); setBearbeiten(null); }}><Icon name="muell" />Entfernen</button>
              <button className="btn btn-primary" onClick={() => setBearbeiten(null)}><Icon name="haken" />Fertig</button>
            </div>
          </div>
        )}
      </Sheet>
    </Seite>
  );
}

/** Packungsgrösse einer Position: Grundlage für den Preis pro kg, l oder Stück */
function PackungFeld({ z, aendern }: { z: ScanZeile; aendern: (v: Partial<ScanZeile>) => void }) {
  const [groesse, setGroesse] = useState(z.packung ? String(z.packung.groesse) : "");
  const [einheit, setEinheit] = useState<Einheit>(z.packung?.einheit ?? "g");
  const [anzahl, setAnzahl] = useState(String(z.packung?.anzahl ?? 1));
  const setzen = (g: string, e: Einheit, a: string) => {
    setGroesse(g); setEinheit(e); setAnzahl(a);
    const wert = zahl(g), n = Math.max(1, Math.round(zahl(a)) || 1);
    aendern(wert > 0 ? { packung: { groesse: wert, einheit: e, anzahl: n }, vergleich: vergleichFuer(e) } : { packung: null });
  };
  return (
    <Feld gruppe label="Packung" hinweis="Für den Preisvergleich pro kg, l oder Stück. Leer lassen, wenn unbekannt.">
      <div className="grid grid-cols-[1fr_6.5rem_5.5rem] gap-2">
        <input className="input mono" inputMode="decimal" aria-label="Packungsgrösse" placeholder="z. B. 500" value={groesse} onChange={(x) => setzen(x.target.value, einheit, anzahl)} />
        <select className="input" aria-label="Einheit der Packung" value={einheit} onChange={(x) => setzen(groesse, x.target.value as Einheit, anzahl)}>
          <option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">l</option><option value="piece">Stück</option>
        </select>
        <label className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">×</span>
          <input className="input mono pl-7" inputMode="numeric" aria-label="Anzahl im Pack" value={anzahl} onChange={(x) => setzen(groesse, einheit, x.target.value)} /></label>
      </div>
    </Feld>
  );
}
