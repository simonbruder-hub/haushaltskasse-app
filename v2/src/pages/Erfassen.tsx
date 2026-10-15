import { useEffect, useMemo, useState } from "react";
import { db, useQuery } from "../db/client";
import { geld, heute, kurzDatum, zahl } from "../lib/format";
import { BELEG_ART, belegLaden, belegSpeichern, ladenAnlegen, type Beleg, type BelegArt, type Position } from "../lib/belege";
import { LADEN_FARBE, persoenlich, topfOptionen, vorschau, zahlKonten } from "../lib/auswahl";
import { useHaushalt } from "../lib/haushalt";
import { go } from "../lib/router";
import { scanDateiSetzen } from "../scan/einstellung";
import { KategorieWahl, TopfChips, useKategorien } from "../ui/Auswahl";
import { Avatar, farbe, Feld, Seg, Seite, useAktion } from "../ui/kit";
import { Icon } from "../ui/Icon";

// Aus einem gescannten Beleg: Typ, Produkt, Kürzel, Artikel, Packung und Menge laufen beim Bearbeiten unverändert mit
interface PosForm { text: string; betrag: string; rabatt: string; kategorie: string | null; topf: string | null; mit?: Partial<Position> }
interface Laden { id: string; name: string; chain_key: string; n: number }
const ZAHLARTEN: [string, string][] = [["debit_card", "Karte"], ["twint", "Twint"], ["cash", "Bar"], ["bank_transfer", "Überweisung"], ["credit_card", "Kreditkarte"]];
const GUTSCHEINE: [string, string][] = [["loyalty_points", "Punkte"], ["voucher", "Gutschein"], ["gift_card", "Geschenkkarte"], ["reka", "Reka"], ["lunch_check", "Lunch-Check"]];
const STANDARD_LAEDEN = ["migros", "coop", "lidl", "denner", "aldi", "volg"];

export function Erfassen({ id }: { id?: string }) {
  const { household, ich, konten, personen } = useHaushalt();
  const aktion = useAktion();
  const kats = useKategorien();
  const laeden = useQuery<Laden>(`select m.id, m.name, m.chain_key, count(h.id)::int as n from merchant m
      left join transaction_header h on h.merchant_id = m.id and h.household_id = $1
     where m.household_id is null or m.household_id = $1 group by m.id order by n desc, m.name`, [household]) ?? [];
  const zm = useQuery<{ id: string; account_id: string; kind: string; label: string; card_last4: string | null }>(
    `select id, account_id, kind, label, card_last4 from payment_method where household_id = $1 and archived_at is null order by label`, [household]) ?? [];
  const bezahlKonten = zahlKonten(konten);
  const eigenesKonto = bezahlKonten.find((k) => k.kind === "privat" && k.owners.length === 1 && k.owners[0].person_id === ich)?.id ?? bezahlKonten[0]?.id ?? null;

  const [art, setArt] = useState<BelegArt>("purchase");
  const [betrag, setBetrag] = useState("");
  const [datum, setDatum] = useState(heute());
  const [laden, setLaden] = useState<string | null>(null);
  const [ladenFrei, setLadenFrei] = useState(false);
  const [ladenText, setLadenText] = useState("");
  const [kategorie, setKategorie] = useState<string | null>(null);
  const [topfWahl, setTopfWahl] = useState<string | null>(null);
  const [konto, setKonto] = useState<string | null>(null);
  const [zahlart, setZahlart] = useState("debit_card");
  const [zahlungsmittel, setZahlungsmittel] = useState<string | null>(null);
  const [gutscheine, setGutscheine] = useState<{ art: string; betrag: string }[]>([]);
  const [aufteilen, setAufteilen] = useState(false);
  const [positionen, setPositionen] = useState<PosForm[]>([]);
  const [notiz, setNotiz] = useState("");
  const [waehrung, setWaehrung] = useState("CHF");
  const [kurs, setKurs] = useState("1");
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState(false);

  // Bearbeiten: gespeicherten Beleg laden
  useEffect(() => {
    if (!id) return;
    (async () => {
      const b = await belegLaden(await db(), id);
      if (!b) return;
      setArt(b.art); setBetrag(String(b.total)); setDatum(b.datum); setLaden(b.laden); setKategorie(b.kategorie); setTopfWahl(b.topf);
      setNotiz(b.notiz ?? ""); setWaehrung(b.waehrung ?? "CHF"); setKurs(String(b.kurs ?? 1));
      const haupt = b.zahlungen.find((z) => z.konto) ?? null;
      if (haupt) { setKonto(haupt.konto); setZahlart(haupt.art); setZahlungsmittel(haupt.zahlungsmittel ?? null); }
      setGutscheine(b.zahlungen.filter((z) => !z.konto).map((z) => ({ art: z.art, betrag: String(z.betrag) })));
      if (b.positionen.length) {
        setAufteilen(true); setDetails(true);
        setPositionen(b.positionen.map((p) => ({ text: p.text, betrag: String(p.betrag), rabatt: p.rabatt ? String(p.rabatt) : "", kategorie: p.kategorie, topf: p.topf,
          mit: { typ: p.typ, produkt: p.produkt, kuerzel: p.kuerzel, artikel: p.artikel, packung: p.packung, menge: p.menge, einheit: p.einheit, einzelpreis: p.einzelpreis } })));
      }
      if (b.waehrung && b.waehrung !== "CHF") setDetails(true);
    })();
  }, [id]);

  // Kurs für Fremdwährung: zuletzt verwendeter, sonst Richtwert
  useEffect(() => {
    if (waehrung === "CHF") { setKurs("1"); return; }
    if (id) return;
    (async () => {
      const d = await db();
      const r = (await d.query<{ k: string }>(`select fx_rate::text k from transaction_header where currency = $1 order by booking_date desc limit 1`, [waehrung])).rows[0];
      setKurs(r?.k ?? (waehrung === "EUR" ? "0.94" : "0.80"));
    })();
  }, [waehrung, id]);

  const kontoAktiv = konto ?? eigenesKonto;
  const zahlerPerson = konten.find((k) => k.id === kontoAktiv)?.owners.length === 1 ? konten.find((k) => k.id === kontoAktiv)!.owners[0].person_id : ich;
  const katObj = kats.find((k) => k.id === kategorie);
  const vorschlagTopf = katObj?.default_cost_account_id ?? persoenlich(konten, zahlerPerson) ?? persoenlich(konten, ich) ?? topfOptionen(konten, personen)[0]?.id ?? null;
  const topf = topfWahl ?? vorschlagTopf;
  const opts = topfOptionen(konten, personen);
  const topfName = opts.find((o) => o.id === topf)?.label ?? "–";

  const total = zahl(betrag);
  const k = waehrung === "CHF" ? 1 : zahl(kurs) || 1;
  const gutscheinSumme = gutscheine.reduce((s, g) => s + zahl(g.betrag), 0);
  const posSumme = positionen.reduce((s, p) => s + zahl(p.betrag), 0);
  const rest = Math.round((total - (aufteilen ? posSumme : 0)) * 100) / 100;

  const v = art === "refund" ? -1 : 1;   // Gutschrift: Geld fliesst zurück
  const vs = useMemo(() => {
    const f = v * k;
    const zeilen = aufteilen
      ? [...positionen.map((p) => ({ betrag: zahl(p.betrag) * f, topf: (p.topf ?? topf)! })), ...(rest > 0 ? [{ betrag: rest * f, topf: topf! }] : [])]
      : [{ betrag: total * f, topf: topf! }];
    const zahlungen = [...gutscheine.map((g) => ({ betrag: zahl(g.betrag) * f, konto: null })), { betrag: (total - gutscheinSumme) * f, konto: kontoAktiv }];
    return vorschau(zeilen.filter((z) => z.topf), zahlungen, konten);
  }, [aufteilen, positionen, total, topf, gutscheine, gutscheinSumme, kontoAktiv, konten, rest, k, v]);
  const erwachsene = personen.filter((p) => p.role === "adult");
  const wirkung = erwachsene.map((p) => ({ p, w: (vs[p.id]?.bezahlt ?? 0) - (vs[p.id]?.anteil ?? 0) }));
  const glaeubiger = wirkung.find((x) => x.w > 0.005), schuldner = wirkung.find((x) => x.w < -0.005);

  const ladenListe = laeden.filter((l) => l.n > 0).slice(0, 8);
  const ladenChips = ladenListe.length >= 4 ? ladenListe : [...ladenListe, ...laeden.filter((l) => STANDARD_LAEDEN.includes(l.chain_key) && !ladenListe.some((x) => x.id === l.id))].slice(0, 8);
  const ladenAktuell = laeden.find((l) => l.id === laden);

  const speichern = async () => {
    setBusy(true);
    let neu = "";
    const ok = await aktion(async () => {
      const rp = (x: number) => Math.round(x * 100);
      if (rp(gutscheinSumme) > rp(total)) throw new Error("Die Gutscheine sind höher als das Total.");
      if (!kontoAktiv && rp(gutscheinSumme) < rp(total)) throw new Error("Bitte wählen, von welchem Konto bezahlt wurde.");
      const d = await db();
      let ladenId = laden;
      if (ladenFrei && ladenText.trim()) ladenId = await ladenAnlegen(d, household, ladenText);
      const ladenName = ladenFrei ? ladenText.trim() : ladenAktuell?.name;
      const b: Beleg = {
        id, household, art, datum, laden: ladenFrei && !ladenText.trim() ? null : ladenId, bezeichnung: notiz.trim() || ladenName || katObj?.name || null,
        total, waehrung, kurs: k, topf: topf!, kaeufer: zahlerPerson ?? erwachsene[0].id, kategorie,
        positionen: aufteilen ? positionen.map((p) => ({ ...p.mit, text: p.text, betrag: zahl(p.betrag), rabatt: zahl(p.rabatt) || undefined, kategorie: p.kategorie ?? kategorie, topf: p.topf })) : [],
        zahlungen: [
          ...gutscheine.map((g) => ({ art: g.art, betrag: zahl(g.betrag), konto: null, label: GUTSCHEINE.find(([v]) => v === g.art)?.[1] ?? null })),
          { art: zahlart, betrag: Math.round((total - gutscheinSumme) * 100) / 100, konto: kontoAktiv, zahlungsmittel },
        ],
        notiz: notiz.trim() || null,
      };
      neu = await belegSpeichern(d, b);
    }, id ? "Änderung gespeichert" : "Gespeichert");
    setBusy(false);
    if (ok && location.hash.startsWith("#/erfassen")) go(id ? `belege/${neu}` : "belege");   // nur, wenn man noch hier ist
  };

  const scanWahl = (ev: React.ChangeEvent<HTMLInputElement>) => { const f = ev.target.files?.[0]; ev.target.value = ""; if (f) { scanDateiSetzen(f); go("scan"); } };
  return (
    <Seite eyebrow={id ? "Beleg bearbeiten" : "Erfassen"} titel={BELEG_ART[art]} zurueck={id ? `belege/${id}` : undefined}>
      {!id && (
        <div className="grid grid-cols-2 gap-2">
          <a href="#/scan/kamera" className="btn btn-soft no-underline text-[var(--accent-ink)]"><Icon name="kamera" />Fotografieren</a>
          <label className="btn cursor-pointer"><Icon name="blatt" />Foto / PDF
            <input type="file" accept="image/*,application/pdf" className="hidden" aria-label="Beleg aus Datei" onChange={scanWahl} /></label>
        </div>
      )}
      <Seg label="Art" wert={art} onChange={setArt} optionen={[["purchase", "Einkauf"], ["bill", "Rechnung"], ["refund", "Gutschrift"]]} />

      <div className="card p-4 grid gap-2">
        <label className="flex items-baseline gap-2">
          <span className="text-muted font-semibold">{waehrung}</span>
          <input aria-label="Betrag" className="num w-full bg-transparent border-0 outline-none text-[40px] leading-none tracking-tight" inputMode="decimal"
            placeholder="0.00" value={betrag} onChange={(e) => setBetrag(e.target.value)} autoFocus={!id} />
        </label>
        <div className="flex items-center justify-between gap-2 text-[13px] text-muted">
          <label className="relative chip !text-[13px] !py-1.5 !px-3 bg-[var(--paper-2)] text-ink-2 cursor-pointer">
            <Icon name="kalender" size={15} />{datum === heute() ? "Heute" : kurzDatum(datum)}
            <input type="date" aria-label="Datum" className="absolute inset-0 opacity-0 cursor-pointer" value={datum}
              onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* nicht überall erlaubt */ } }}
              onChange={(e) => setDatum(e.target.value || heute())} />
          </label>
          {art === "refund" && <span>Geld, das zurückkommt</span>}
          {waehrung !== "CHF" && total > 0 && <span className="num">≈ CHF {geld(total * k)}</span>}
        </div>
      </div>

      <Feld gruppe label={art === "bill" ? "Von wem" : "Wo"}>
        <div className="flex flex-wrap gap-1.5">
          {ladenChips.map((l) => (
            <button type="button" key={l.id} aria-pressed={!ladenFrei && laden === l.id} onClick={() => { setLaden(l.id); setLadenFrei(false); }}
              className={`chip !text-[13.5px] !py-1.5 !px-3 border ${!ladenFrei && laden === l.id ? "text-white border-transparent" : "bg-[var(--card)] border-[var(--rule-strong)]"}`}
              style={!ladenFrei && laden === l.id ? { background: LADEN_FARBE[l.chain_key] ?? "var(--accent)" } : undefined}>{l.name}</button>
          ))}
          {ladenAktuell && !ladenChips.some((l) => l.id === laden) && !ladenFrei && (
            <span className="chip !text-[13.5px] !py-1.5 !px-3 bg-[var(--accent)] text-[var(--on-accent)]">{ladenAktuell.name}</span>
          )}
          <button type="button" aria-pressed={ladenFrei} onClick={() => setLadenFrei(true)}
            className={`chip !text-[13.5px] !py-1.5 !px-3 border border-dashed ${ladenFrei ? "border-[var(--accent)]" : "border-[var(--rule-strong)]"}`}>Anderer …</button>
        </div>
        {ladenFrei && (
          <>
            <input className="input" list="laeden" placeholder="Name des Ladens" value={ladenText} onChange={(e) => setLadenText(e.target.value)} autoFocus />
            <datalist id="laeden">{laeden.map((l) => <option key={l.id} value={l.name} />)}</datalist>
          </>
        )}
      </Feld>

      <Feld gruppe label="Was"><KategorieWahl wert={kategorie} onChange={setKategorie} /></Feld>

      <Feld gruppe label="Für wen" hinweis={topfWahl ? undefined : katObj ? `Vorschlag aus «${katObj.name}»` : "Vorschlag: persönlicher Topf der zahlenden Person"}>
        <TopfChips wert={topf} onChange={(v) => setTopfWahl(v)} />
      </Feld>

      <Feld gruppe label={art === "refund" ? "Zurück auf" : "Bezahlt von"}>
        <div className="flex flex-wrap gap-1.5">
          {bezahlKonten.map((a) => (
            <button type="button" key={a.id} aria-pressed={kontoAktiv === a.id} onClick={() => { setKonto(a.id); setZahlungsmittel(null); }}
              className={`chip !text-[13.5px] !py-1.5 !px-3 border ${kontoAktiv === a.id ? "bg-[var(--ink)] text-[var(--paper)] border-transparent" : "bg-[var(--card)] border-[var(--rule-strong)]"}`}>
              {a.owners.length === 1 && <Avatar name={a.owners[0].name} color={farbe(a.owners[0])} size={18} />}{a.name}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {zm.filter((z) => z.account_id === kontoAktiv).map((z) => (
            <button type="button" key={z.id} aria-pressed={zahlungsmittel === z.id} onClick={() => { setZahlungsmittel(z.id); setZahlart(z.kind); }}
              className={`chip !text-[12.5px] border ${zahlungsmittel === z.id ? "bg-[var(--accent-wash)] text-accent-ink border-[var(--accent)]" : "bg-transparent border-[var(--rule-strong)]"}`}>
              <Icon name="karte" size={13} />{z.label}{z.card_last4 ? ` ··${z.card_last4}` : ""}
            </button>
          ))}
          {ZAHLARTEN.map(([v, t]) => (
            <button type="button" key={v} aria-pressed={!zahlungsmittel && zahlart === v} onClick={() => { setZahlart(v); setZahlungsmittel(null); }}
              className={`chip !text-[12.5px] border ${!zahlungsmittel && zahlart === v ? "bg-[var(--accent-wash)] text-accent-ink border-[var(--accent)]" : "bg-transparent border-[var(--rule-strong)]"}`}>{t}</button>
          ))}
        </div>
        {gutscheine.map((g, i) => (
          <div key={i} className="grid grid-cols-[1fr_7.5rem_auto] gap-2 items-center">
            <select className="input" aria-label="Art des Gutscheins" value={g.art} onChange={(e) => setGutscheine(gutscheine.map((x, j) => j === i ? { ...x, art: e.target.value } : x))}>
              {GUTSCHEINE.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
            <input className="input mono" inputMode="decimal" aria-label="Betrag des Gutscheins" placeholder="0.00" value={g.betrag}
              onChange={(e) => setGutscheine(gutscheine.map((x, j) => j === i ? { ...x, betrag: e.target.value } : x))} />
            <button type="button" className="icon-btn" aria-label="Gutschein entfernen" onClick={() => setGutscheine(gutscheine.filter((_, j) => j !== i))}><Icon name="x" /></button>
          </div>
        ))}
        <button type="button" className="btn btn-ghost !justify-start !px-1 !min-h-0 text-[13.5px]" onClick={() => setGutscheine([...gutscheine, { art: "loyalty_points", betrag: "" }])}>
          <Icon name="plus" size={16} />Gutschein / Punkte
        </button>
        {gutscheine.length > 0 && <small>Vom Konto: {waehrung} {geld(Math.max(total - gutscheinSumme, 0))}. Gutscheine ändern die Beteiligung nicht.</small>}
      </Feld>

      {total > 0 && topf && (
        <div className="card-flat p-3.5 grid gap-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {erwachsene.map((p) => (
              <span key={p.id} className="flex items-center gap-1.5 text-[14px]"><Avatar name={p.display_name} color={farbe(p)} size={22} />
                {p.display_name} {v < 0 ? "bekommt" : "trägt"} <b className="num">{geld(Math.abs(vs[p.id]?.anteil ?? 0))}</b></span>
            ))}
          </div>
          <p className="text-[13.5px] text-ink-2">
            {glaeubiger && schuldner ? <>{v < 0 ? "Aus dieser Gutschrift" : "Aus diesem Beleg"} schuldet <b>{schuldner.p.display_name}</b> {glaeubiger.p.display_name} <b className="num">CHF {geld(glaeubiger.w)}</b>.</> : "Kein Ausgleich nötig."}
          </p>
        </div>
      )}

      <button type="button" className="btn btn-ghost !justify-between" onClick={() => setDetails(!details)} aria-expanded={details}>
        <span>Positionen, Notiz, Währung</span><Icon name={details ? "x" : "plus"} size={18} />
      </button>

      {details && (
        <div className="grid gap-4">
          <label className="card-flat p-3.5 flex items-center gap-3">
            <input type="checkbox" className="size-5 accent-[var(--accent)]" checked={aufteilen}
              onChange={(e) => { setAufteilen(e.target.checked); if (e.target.checked && !positionen.length) setPositionen([{ text: "", betrag: "", rabatt: "", kategorie: null, topf: null }]); }} />
            <span className="grid"><b>In Positionen aufteilen</b><span className="text-muted text-[13px]">Wenn ein Teil in einen anderen Topf gehört, z. B. Shampoo nur für dich.</span></span>
          </label>
          {aufteilen && (
            <div className="grid gap-2.5">
              {positionen.map((p, i) => (
                <div key={i} className="card p-3.5 grid gap-2.5">
                  <div className="grid grid-cols-[1fr_6.5rem_auto] gap-2 items-center">
                    <input className="input" aria-label={`Position ${i + 1}`} placeholder="z. B. Shampoo" value={p.text} onChange={(e) => setPositionen(positionen.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} />
                    <input className="input mono" inputMode="decimal" aria-label={`Betrag Position ${i + 1}`} placeholder="0.00" value={p.betrag} onChange={(e) => setPositionen(positionen.map((x, j) => j === i ? { ...x, betrag: e.target.value } : x))} />
                    <button type="button" className="icon-btn" aria-label={`Position ${i + 1} entfernen`} onClick={() => setPositionen(positionen.filter((_, j) => j !== i))}><Icon name="muell" /></button>
                  </div>
                  <TopfChips label={`Topf Position ${i + 1}`} wert={p.topf} erben={topfName} onChange={(v) => setPositionen(positionen.map((x, j) => j === i ? { ...x, topf: v } : x))} />
                  <div className="grid grid-cols-[1fr_6.5rem] gap-2">
                    <select className="input" aria-label={`Kategorie Position ${i + 1}`} value={p.kategorie ?? ""} onChange={(e) => setPositionen(positionen.map((x, j) => j === i ? { ...x, kategorie: e.target.value || null } : x))}>
                      <option value="">Kategorie wie Beleg</option>
                      {kats.map((c) => <option key={c.id} value={c.id}>{c.bereich} · {c.name}</option>)}
                    </select>
                    <input className="input mono" inputMode="decimal" aria-label={`Rabatt Position ${i + 1}`} placeholder="Rabatt" value={p.rabatt} onChange={(e) => setPositionen(positionen.map((x, j) => j === i ? { ...x, rabatt: e.target.value } : x))} />
                  </div>
                </div>
              ))}
              <button type="button" className="btn" onClick={() => setPositionen([...positionen, { text: "", betrag: "", rabatt: "", kategorie: null, topf: null }])}><Icon name="plus" />Position</button>
              <p className={`text-[13.5px] px-1 ${rest < 0 ? "text-crit font-semibold" : "text-muted"}`}>
                {rest < 0 ? `Die Positionen sind ${geld(-rest)} höher als das Total.` : rest > 0 ? `Rest ${geld(rest)} → wird als «Übriges» in «${topfName}» erfasst.` : "Positionen und Total stimmen überein."}
              </p>
            </div>
          )}
          <Feld label="Notiz"><input className="input" placeholder="z. B. Wocheneinkauf" value={notiz} onChange={(e) => setNotiz(e.target.value)} /></Feld>
          <div className="grid grid-cols-2 gap-3">
            <Feld label="Währung"><select className="input" value={waehrung} onChange={(e) => setWaehrung(e.target.value)}><option>CHF</option><option>EUR</option><option>USD</option></select></Feld>
            {waehrung !== "CHF" && <Feld label={`Kurs (CHF pro ${waehrung})`}><input className="input mono" inputMode="decimal" value={kurs} onChange={(e) => setKurs(e.target.value)} /></Feld>}
          </div>
        </div>
      )}

      <div className="sticky bottom-[calc(78px+env(safe-area-inset-bottom))] z-20 -mx-4 px-4 pt-3 pb-4 bg-[linear-gradient(to_top,var(--paper)_75%,transparent)]">
        <button className="btn btn-primary btn-big w-full shadow-lg" disabled={busy || total <= 0 || !topf || (aufteilen && rest < 0)} onClick={speichern}>
          <Icon name="haken" />{id ? "Änderung speichern" : "Speichern"}{total > 0 ? ` · ${waehrung} ${geld(total)}` : ""}
        </button>
      </div>
    </Seite>
  );
}
