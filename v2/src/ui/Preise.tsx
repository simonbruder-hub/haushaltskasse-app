import { useState } from "react";
import { db, useQuery } from "../db/client";
import { geld, heute, kurzDatum, zahl } from "../lib/format";
import { useHaushalt } from "../lib/haushalt";
import { ladenAnlegen } from "../lib/belege";
import { alarmText, packungText, proEinheit, regalpreisSpeichern, type Alarm } from "../lib/preise";
import type { Einheit } from "../lib/belege";
import { LadenMarke } from "../pages/Belege";
import { Feld, useAktion } from "./kit";
import { Icon } from "./Icon";

/** Bausteine für Produkte und Preise (M4) */

interface PreisZeile {
  merchant_id: string; laden: string; chain_key: string | null; merchant_product_id: string | null; artikel: string | null; ean: string | null;
  unit_size: string | null; unit_type: Einheit | null; pack_count: number | null; beobachtet: string; quelle: string;
  packungspreis: string; normalpreis: string; aktion: boolean; pro_einheit: string | null; alt: boolean; guenstigster: boolean;
}

/** Aktueller Preis pro Laden (und Packung), nach Preis pro Einheit sortiert; der günstigste ist hervorgehoben */
export function PreisVergleich({ produktId, vergleich }: { produktId: string; vergleich: string }) {
  const { household } = useHaushalt();
  const zeilen = useQuery<PreisZeile>(
    `select p.merchant_id, p.laden, m.chain_key, p.merchant_product_id, p.artikel, p.ean, p.unit_size::text, p.unit_type::text, p.pack_count,
            p.beobachtet::text, p.quelle::text, p.packungspreis::text, p.normalpreis::text, p.aktion, p.pro_einheit::text, p.alt, p.guenstigster
       from produkt_preise($1, $2, $3) p join merchant m on m.id = p.merchant_id`, [household, produktId, heute()]);
  if (!zeilen) return null;
  if (!zeilen.length) return <p className="card-flat p-4 text-muted text-[14px]">Noch kein Preis. Preise kommen aus gescannten Belegen oder vom Regal («Regalpreis erfassen»).</p>;
  return (
    <div className="card list overflow-hidden" role="list" aria-label="Preise pro Laden">
      {zeilen.map((z) => {
        const pk = z.unit_size != null && z.unit_type ? packungText({ groesse: Number(z.unit_size), einheit: z.unit_type, anzahl: z.pack_count ?? 1 }) : null;
        return (
          <div key={`${z.merchant_id}-${z.merchant_product_id}`} role="listitem" aria-label={z.laden}
            className={`row !cursor-default ${z.guenstigster ? "bg-[var(--good-wash)]" : ""} ${z.alt ? "opacity-60" : ""}`}>
            <LadenMarke name={z.laden} chain={z.chain_key} />
            <span className="grid flex-1 min-w-0">
              <span className="font-semibold truncate">{z.laden}{z.guenstigster && <span className="chip chip-ok !text-[11px] !py-0 ml-1.5 align-middle">günstigster</span>}</span>
              <span className="text-muted text-[12.5px]">
                {[pk, kurzDatum(z.beobachtet), z.quelle === "ean_live_check" ? "Regal" : "Beleg", z.aktion ? `statt ${geld(z.normalpreis)}` : null, z.alt ? "älter als 60 Tage" : null].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="grid justify-items-end flex-none">
              <span className="num font-semibold whitespace-nowrap">{proEinheit(z.pro_einheit, vergleich)}</span>
              <span className="text-[12px] text-muted num whitespace-nowrap">
                {z.aktion ? <span className="text-[var(--accent-ink)] font-semibold">Aktion {geld(z.packungspreis)}</span> : geld(z.packungspreis)}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Preisalarme mit «Gelesen» */
export function AlarmListe({ alarme, mitProdukt = true }: { alarme: Alarm[]; mitProdukt?: boolean }) {
  const { household } = useHaushalt();
  const aktion = useAktion();
  if (!alarme.length) return null;
  return (
    <div className="card list overflow-hidden" role="list" aria-label="Preisalarme">
      {alarme.map((a) => {
        const t = alarmText(a);
        const hoch = a.kind !== "price_drop";
        return (
          <div key={a.id} role="listitem" aria-label={`${t.titel}: ${a.produkt}`} className={`row !cursor-default !items-start ${a.seen_at ? "opacity-60" : ""}`}>
            <span className={`k-ico small ${hoch ? "bg-[var(--crit-wash)] text-[var(--crit-ink)]" : "bg-[var(--good-wash)] text-[var(--accent-ink)]"}`}>
              <Icon name={a.kind === "shrinkflation" ? "waage" : hoch ? "trend_hoch" : "trend_runter"} size={17} />
            </span>
            <a href={`#/preise/${a.master_product_id}`} className="grid flex-1 min-w-0 no-underline text-ink">
              <span className="font-semibold truncate">{t.titel}{mitProdukt ? `: ${a.produkt}` : ""}</span>
              <span className="text-[13px] text-ink-2">{t.text}</span>
              <span className="text-muted text-[12px]">{[a.laden, kurzDatum(a.observed_on)].filter(Boolean).join(" · ")}</span>
            </a>
            {!a.seen_at && (
              <button className="btn !min-h-0 py-1.5 px-3 text-[13px]" aria-label={`${a.produkt} gelesen`}
                onClick={() => aktion(async () => { await (await db()).query(`select alarm_gelesen($1, $2, $3)`, [household, a.kind, a.source_id]); }, "Als gelesen markiert")}>
                <Icon name="haken" size={16} />Gelesen
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Laden wählen ----------
interface Laden { id: string; name: string; chain_key: string; n: number }
const STANDARD = ["migros", "coop", "lidl", "denner", "aldi", "volg"];
const LETZTER = "haushalt-regal-laden";
export type LadenAuswahl = { id: string } | { neu: string } | null;
export const letzterLaden = (): string | null => { try { return sessionStorage.getItem(LETZTER); } catch { return null; } };

/** Häufige Läden als Chips, sonst «Anderer …». Im Laden bleibt die Wahl für die nächsten Scans stehen. */
export function LadenWahl({ wert, onChange }: { wert: LadenAuswahl; onChange: (l: LadenAuswahl) => void }) {
  const { household } = useHaushalt();
  const laeden = useQuery<Laden>(`select m.id, m.name, m.chain_key, (count(h.id) + count(s.id))::int as n from merchant m
      left join transaction_header h on h.merchant_id = m.id and h.household_id = $1
      left join shelf_price s on s.merchant_id = m.id and s.household_id = $1
     where m.household_id is null or m.household_id = $1 group by m.id order by n desc, m.name`, [household]) ?? [];
  const genutzt = laeden.filter((l) => l.n > 0).slice(0, 8);
  const chips = genutzt.length >= 4 ? genutzt : [...genutzt, ...laeden.filter((l) => STANDARD.includes(l.chain_key) && !genutzt.some((x) => x.id === l.id))].slice(0, 8);
  const gewaehlt = wert && "id" in wert ? laeden.find((l) => l.id === wert.id) : null;
  if (gewaehlt && !chips.some((c) => c.id === gewaehlt.id)) chips.unshift(gewaehlt);
  const frei = !!wert && "neu" in wert;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Laden">
        {chips.map((l) => (
          <button type="button" key={l.id} aria-pressed={!!gewaehlt && gewaehlt.id === l.id} onClick={() => onChange({ id: l.id })}
            className={`chip !text-[13.5px] !py-1.5 !px-3 border ${gewaehlt?.id === l.id ? "bg-[var(--ink)] text-[var(--paper)] border-transparent" : "bg-[var(--card)] border-[var(--rule-strong)]"}`}>{l.name}</button>
        ))}
        <button type="button" aria-pressed={frei} onClick={() => onChange({ neu: "" })}
          className={`chip !text-[13.5px] !py-1.5 !px-3 border border-dashed ${frei ? "border-[var(--accent)]" : "border-[var(--rule-strong)]"}`}>Anderer …</button>
      </div>
      {frei && (
        <>
          <input className="input" list="regal-laeden" aria-label="Name des Ladens" placeholder="Name des Ladens" autoFocus
            value={(wert as { neu: string }).neu} onChange={(e) => onChange({ neu: e.target.value })} />
          <datalist id="regal-laeden">{laeden.map((l) => <option key={l.id} value={l.name} />)}</datalist>
        </>
      )}
    </div>
  );
}

/** Preis am Regal festhalten: Laden, Preis, Aktion (mit Normalpreis, wenn angeschrieben) */
export function RegalpreisFormular({ artikel, onGespeichert }: { artikel: string; onGespeichert?: () => void }) {
  const { household } = useHaushalt();
  const aktion = useAktion();
  const [laden, setLaden] = useState<LadenAuswahl>(() => { const l = letzterLaden(); return l ? { id: l } : null; });
  const [preis, setPreis] = useState("");
  const [istAktion, setIstAktion] = useState(false);
  const [normal, setNormal] = useState("");
  const [busy, setBusy] = useState(false);
  const ladenOk = !!laden && ("id" in laden || laden.neu.trim() !== "");
  const speichern = async () => {
    setBusy(true);
    const ok = await aktion(async () => {
      const d = await db();
      const id = "id" in laden! ? laden.id : await ladenAnlegen(d, household, laden!.neu);
      await regalpreisSpeichern(d, { household, laden: id, artikel, datum: heute(), preis: zahl(preis), aktion: istAktion, normalpreis: normal ? zahl(normal) : null });
      try { sessionStorage.setItem(LETZTER, id); } catch { /* egal */ }
      setLaden({ id });
    }, "Preis gespeichert");
    setBusy(false);
    if (ok) { setPreis(""); setNormal(""); setIstAktion(false); onGespeichert?.(); }
  };
  return (
    <div className="card p-4 grid gap-3.5">
      <h2 className="text-[16px] font-bold flex items-center gap-2"><Icon name="preis" size={18} />Regalpreis erfassen</h2>
      <Feld gruppe label="Laden"><LadenWahl wert={laden} onChange={setLaden} /></Feld>
      <div className="grid grid-cols-2 gap-2">
        <Feld label={istAktion ? "Aktionspreis" : "Preis"}>
          <input className="input mono" inputMode="decimal" placeholder="0.00" value={preis} onChange={(e) => setPreis(e.target.value)} />
        </Feld>
        {istAktion && (
          <Feld label="Normalpreis (falls angeschrieben)">
            <input className="input mono" inputMode="decimal" placeholder="optional" value={normal} onChange={(e) => setNormal(e.target.value)} />
          </Feld>
        )}
      </div>
      <label className="flex items-center gap-2.5 text-[14.5px]">
        <input type="checkbox" className="size-5 accent-[var(--accent)]" checked={istAktion} onChange={(e) => setIstAktion(e.target.checked)} />Aktion
      </label>
      <button className="btn btn-primary" disabled={busy || !ladenOk || !(zahl(preis) > 0)} onClick={speichern}><Icon name="haken" />Preis speichern</button>
    </div>
  );
}

/** «zuletzt vor 12 Tagen, Zyklus 16 Tage» (ab drei Käufen) */
export function Verbrauch({ produktId }: { produktId: string }) {
  const v = useQuery<{ purchases: number; last_purchase: string; median_interval_days: number | null; next_expected: string | null }>(
    `select purchases::int, last_purchase::text, median_interval_days, next_expected::text from v_consumption_cycle where master_product_id = $1`, [produktId])?.[0];
  const letzter = useQuery<{ d: string | null; n: number }>(
    `select max(h.booking_date)::text d, count(distinct h.id)::int n from line_item l join transaction_header h on h.id = l.transaction_id
      where l.master_product_id = $1 and h.status = 'confirmed' and h.deleted_at is null and l.deleted_at is null`, [produktId])?.[0];
  if (!letzter?.d) return null;
  const tage = Math.round((Date.parse(heute()) - Date.parse(letzter.d)) / 86400000);
  const vor = tage <= 0 ? "heute" : tage === 1 ? "gestern" : `vor ${tage} Tagen`;
  return (
    <p className="card-flat p-3.5 text-[14px] flex items-start gap-2.5" data-testid="verbrauch">
      <Icon name="kalender" size={18} className="mt-0.5 text-muted" />
      <span>Zuletzt gekauft {vor}{v?.median_interval_days != null
        ? <> · Zyklus <b>{Math.round(v.median_interval_days)} Tage</b>{v.next_expected ? <> · nächster Kauf etwa {kurzDatum(v.next_expected)}</> : null}</>
        : <span className="text-muted"> · {letzter.n} {letzter.n === 1 ? "Kauf" : "Käufe"}; den Zyklus rechnet die App ab drei Käufen</span>}</span>
    </p>
  );
}
