import { useEffect, useState } from "react";
import { db, useQuery } from "../db/client";
import { geld, kurzDatum, zahl } from "../lib/format";
import { useHaushalt } from "../lib/haushalt";
import { go } from "../lib/router";
import { ALARM_SQL, packungText, proEinheit, regalpreisLoeschen, type Alarm } from "../lib/preise";
import type { Einheit } from "../lib/belege";
import { VERGLEICH_TEXT } from "../produkte/menge";
import { KategorieWahl } from "../ui/Auswahl";
import { AlarmListe, PreisVergleich, Verbrauch } from "../ui/Preise";
import { Feld, Leer, Seg, Seite, Sheet, useAktion } from "../ui/kit";
import { Icon } from "../ui/Icon";

/** Ein Produkt: Preise pro Laden, Verlauf, Alarme, Verbrauch, Artikel; bearbeiten und zusammenführen */
type Vergleich = "per_1kg" | "per_100g" | "per_1l" | "per_100ml" | "per_piece";
interface Produkt { id: string; name: string; category_id: string | null; kategorie: string | null; comparison_unit: Vergleich; density_g_per_ml: string | null; deleted_at: string | null; merged_into: string | null }
interface Beobachtung { id: string; observed_on: string; laden: string; quelle: string; unit_paid_price: string; unit_regular_price: string; is_promo: boolean;
  unit_base_quantity: string | null; base_dimension: string | null; pro_einheit: string | null; shelf_price_id: string | null; line_item_id: string | null; transaction_id: string | null }
interface ArtikelZeile { id: string; name: string; brand: string | null; ean: string | null; laden: string | null; unit_size: string | null; unit_type: Einheit | null; pack_count: number; vorgaenger: string | null }

export function Produkt({ id }: { id: string }) {
  const { household } = useHaushalt();
  const aktion = useAktion();
  const p = useQuery<Produkt>(`select p.id, p.name, p.category_id, c.name as kategorie, p.comparison_unit::text, p.density_g_per_ml::text, p.deleted_at::text, p.merged_into
      from master_product p left join category c on c.id = p.category_id where p.id = $1`, [id])?.[0];
  const alarme = useQuery<Alarm>(`${ALARM_SQL} and master_product_id = $2 order by seen_at nulls first, observed_on desc limit 20`, [household, id]) ?? [];
  const verlauf = useQuery<Beobachtung>(
    `select o.id, o.observed_on::text, m.name as laden, o.source::text as quelle, o.unit_paid_price::text, o.unit_regular_price::text, o.is_promo,
            o.unit_base_quantity::text, o.base_dimension, o.normalized_paid_base::text as pro_einheit, o.shelf_price_id, o.line_item_id, l.transaction_id
       from price_observation o join merchant m on m.id = o.merchant_id left join line_item l on l.id = o.line_item_id
      where o.master_product_id = $1 order by o.observed_on desc, coalesce(o.line_item_id, o.shelf_price_id) desc limit 30`, [id]) ?? [];
  const artikel = useQuery<ArtikelZeile>(
    `select a.id, a.name, a.brand, a.ean, m.name as laden, a.unit_size::text, a.unit_type::text, a.pack_count, v.name as vorgaenger
       from merchant_product a left join merchant m on m.id = a.merchant_id left join merchant_product v on v.id = a.replaces_id
      where a.master_product_id = $1 and a.deleted_at is null order by a.ean nulls last, m.name, a.name`, [id]) ?? [];
  const [bearbeiten, setBearbeiten] = useState(false);
  const [zusammen, setZusammen] = useState(false);

  const ziel = p?.merged_into;
  useEffect(() => { if (ziel) go(`preise/${ziel}`); }, [ziel]);   // zusammengeführt: zum neuen Produkt

  if (p === undefined || ziel) return null;
  if (!p) return <Seite titel="Produkt" zurueck="preise"><Leer icon="preis" titel="Produkt nicht gefunden" /></Seite>;

  return (
    <Seite eyebrow={p.kategorie ?? "Produkt"} titel={p.name} zurueck="preise"
      aktion={<button className="icon-btn" aria-label="Produkt bearbeiten" onClick={() => setBearbeiten(true)}><Icon name="stift" /></button>}>
      <p className="text-muted text-[13.5px] -mt-2 px-0.5">Preise verglichen pro {VERGLEICH_TEXT[p.comparison_unit]}</p>
      <AlarmListe alarme={alarme} mitProdukt={false} />
      <PreisVergleich produktId={id} vergleich={p.comparison_unit} />
      <Verbrauch produktId={id} />

      {verlauf.length > 0 && (
        <div className="grid gap-2">
          <h2 className="text-[16px] font-bold px-1">Verlauf</h2>
          <div className="card list overflow-hidden" role="list" aria-label="Preisverlauf">
            {verlauf.map((o) => (
              <div key={o.id} role="listitem" className="row !cursor-default !min-h-0 py-2.5">
                <span className="grid flex-1 min-w-0">
                  <span className="text-[14px] truncate"><b>{o.laden}</b> · {kurzDatum(o.observed_on)}</span>
                  <span className="text-muted text-[12px] truncate">{[o.quelle === "ean_live_check" ? "Regal" : "Beleg", menge(o), o.is_promo ? "Aktion" : null].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="grid justify-items-end">
                  <span className="num">{geld(o.unit_paid_price)}</span>
                  <span className="text-muted text-[12px] num">{proEinheit(o.pro_einheit, p.comparison_unit)}</span>
                </span>
                {o.shelf_price_id
                  ? <button className="icon-btn !w-9 !h-9" aria-label={`Regalpreis vom ${kurzDatum(o.observed_on)} löschen`}
                      onClick={() => aktion(async () => regalpreisLoeschen(await db(), o.shelf_price_id!), "Preis gelöscht")}><Icon name="muell" size={17} /></button>
                  : o.transaction_id ? <a className="icon-btn !w-9 !h-9" href={`#/belege/${o.transaction_id}`} aria-label="Beleg öffnen"><Icon name="beleg" size={17} /></a> : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {artikel.length > 0 && (
        <div className="grid gap-2">
          <h2 className="text-[16px] font-bold px-1">Artikel</h2>
          <div className="card list overflow-hidden" role="list" aria-label="Artikel">
            {artikel.map((a) => (
              <div key={a.id} role="listitem" className="row !cursor-default !min-h-0 py-2.5">
                <span className="k-ico small k-zweck"><Icon name={a.ean ? "strichcode" : "beleg"} size={16} /></span>
                <span className="grid flex-1 min-w-0">
                  <span className="text-[14px] font-semibold truncate">{a.brand ? `${a.brand} · ` : ""}{a.name}</span>
                  <span className="text-muted text-[12px] truncate">
                    {[a.ean ? `EAN ${a.ean}` : a.laden ? `Beleg ${a.laden}` : null,
                      a.unit_size && a.unit_type ? packungText({ groesse: Number(a.unit_size), einheit: a.unit_type, anzahl: a.pack_count }) : "Packung unbekannt",
                      a.vorgaenger ? `ersetzt «${a.vorgaenger}»` : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {a.ean && <a className="icon-btn !w-9 !h-9" href={`#/preis-pruefen/${a.id}`} aria-label={`Preis für ${a.name} erfassen`}><Icon name="preis" size={17} /></a>}
              </div>
            ))}
          </div>
        </div>
      )}

      <button className="btn btn-ghost" onClick={() => setZusammen(true)}><Icon name="link" />Mit anderem Produkt zusammenführen</button>
      <Sheet offen={bearbeiten} onClose={() => setBearbeiten(false)} titel="Produkt bearbeiten">
        {bearbeiten && <Bearbeiten p={p} fertig={() => setBearbeiten(false)} />}
      </Sheet>
      <Sheet offen={zusammen} onClose={() => setZusammen(false)} titel="Zusammenführen">
        {zusammen && <Zusammenfuehren p={p} fertig={() => setZusammen(false)} />}
      </Sheet>
    </Seite>
  );
}

function menge(o: Beobachtung) {
  if (!o.unit_base_quantity) return null;
  const n = Number(o.unit_base_quantity);
  if (o.base_dimension === "count") return `${n} Stk.`;
  const vol = o.base_dimension === "volume";
  return n >= 1000 ? `${n / 1000} ${vol ? "l" : "kg"}` : `${n} ${vol ? "ml" : "g"}`;
}

function Bearbeiten({ p, fertig }: { p: Produkt; fertig: () => void }) {
  const aktion = useAktion();
  const [name, setName] = useState(p.name);
  const [kat, setKat] = useState<string | null>(p.category_id);
  const [vergleich, setVergleich] = useState<Vergleich>(p.comparison_unit);
  const [dichte, setDichte] = useState(p.density_g_per_ml ?? "");
  const speichern = () => aktion(async () => {
    const d = await db();
    await d.transaction(async (tx) => {
      if (!name.trim()) throw new Error("Bitte einen Namen eingeben.");
      await tx.query(`update master_product set name = $2, category_id = $3 where id = $1 and (name, category_id) is distinct from ($2, $3)`, [p.id, name.trim(), kat]);
      await tx.query(`select vergleich_setzen($1, $2, $3)`, [p.id, vergleich, dichte ? zahl(dichte) : null]);
    });
    fertig();
  }, "Produkt gespeichert");
  return (
    <div className="grid gap-4">
      <Feld label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Feld>
      <Feld gruppe label="Kategorie"><KategorieWahl wert={kat} onChange={setKat} /></Feld>
      <Feld gruppe label="Preise vergleichen pro">
        <Seg label="Vergleich" wert={vergleich} onChange={setVergleich}
          optionen={[["per_1kg", "kg"], ["per_100g", "100 g"], ["per_1l", "l"], ["per_100ml", "100 ml"], ["per_piece", "Stück"]]} />
      </Feld>
      <Feld label="Dichte (g pro ml), optional" hinweis="Nur nötig, wenn ein Teil der Packungen in g und ein Teil in ml angeschrieben ist, z. B. Joghurt 1.03.">
        <input className="input mono" inputMode="decimal" placeholder="z. B. 1.03" value={dichte} onChange={(e) => setDichte(e.target.value)} />
      </Feld>
      <button className="btn btn-primary" onClick={speichern}><Icon name="haken" />Speichern</button>
    </div>
  );
}

function Zusammenfuehren({ p, fertig }: { p: Produkt; fertig: () => void }) {
  const { household } = useHaushalt();
  const aktion = useAktion();
  const [suche, setSuche] = useState("");
  const [ziel, setZiel] = useState<{ id: string; name: string } | null>(null);
  const andere = useQuery<{ id: string; name: string }>(
    `select id, name from master_product where household_id = $1 and deleted_at is null and id <> $2 order by aehnlichkeit(name, $3) desc, name limit 200`,
    [household, p.id, p.name]) ?? [];
  const liste = andere.filter((x) => !suche.trim() || x.name.toLowerCase().includes(suche.trim().toLowerCase())).slice(0, 12);
  return (
    <div className="grid gap-3">
      <p className="text-ink-2 text-[14px]">«{p.name}» geht im gewählten Produkt auf: Belegpositionen, Kürzel, Artikel und Preise wandern mit. Belege und Beträge bleiben unverändert.</p>
      <input className="input" type="search" aria-label="Zielprodukt suchen" placeholder="Produkt suchen" value={suche} onChange={(e) => setSuche(e.target.value)} />
      <div className="card list overflow-hidden" role="radiogroup" aria-label="Zielprodukt">
        {liste.map((x) => (
          <label key={x.id} className="row">
            <input type="radio" name="ziel" className="size-4 accent-[var(--accent)]" checked={ziel?.id === x.id} onChange={() => setZiel(x)} />
            <span className="flex-1">{x.name}</span>
          </label>
        ))}
        {!liste.length && <p className="p-4 text-muted text-[14px]">Kein anderes Produkt gefunden.</p>}
      </div>
      <button className="btn btn-primary" disabled={!ziel} onClick={async () => {
        if (!ziel) return;
        const ok = await aktion(async () => { await (await db()).query(`select produkte_zusammenfuehren($1, $2, $3)`, [household, p.id, ziel.id]); }, "Zusammengeführt");
        if (ok) { fertig(); if (location.hash.startsWith("#/preise/")) go(`preise/${ziel.id}`); }
      }}><Icon name="link" />{ziel ? `In «${ziel.name}» zusammenführen` : "Zielprodukt wählen"}</button>
    </div>
  );
}
