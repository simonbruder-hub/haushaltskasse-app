import { useEffect, useState } from "react";
import { db, useQuery } from "../db/client";
import { dateiLaden } from "../scan/dateien";
import { datum, geld } from "../lib/format";
import { BELEG_ART, belegLoeschen } from "../lib/belege";
import { topfOptionen } from "../lib/auswahl";
import { useHaushalt } from "../lib/haushalt";
import { go } from "../lib/router";
import { Avatar, farbe, Leer, LoeschKnopf, Seite, Sheet, useAktion } from "../ui/kit";
import { Icon } from "../ui/Icon";
import { LadenMarke } from "./Belege";

export const ZAHLART_TEXT: Record<string, string> = {
  cash: "Bar", debit_card: "Debitkarte", credit_card: "Kreditkarte", twint: "Twint", bank_transfer: "Überweisung", ebill: "eBill",
  voucher: "Gutschein", gift_card: "Geschenkkarte", loyalty_points: "Punkte", reka: "Reka", lunch_check: "Lunch-Check", other: "Andere",
};

interface Kopf { id: string; kind: "purchase" | "bill" | "refund"; datum: string; total: number; total_chf: number; currency: string; kurs: number;
  notes: string | null; topf: string; laden: string | null; chain_key: string | null; erfasst: string; geaendert: string;
  quelle: string; sha: string | null; mime: string | null }
interface Pos { id: string; raw_text: string; betrag: number; rabatt: number; topf: string; eigener_topf: boolean; kategorie: string | null }
interface Zahl { id: string; kind: string; betrag: number; betrag_chf: number | null; label: string | null; konto: string | null; mittel: string | null }
interface Eff { person_id: string; paid: number; share: number; effect: number }

export function BelegDetail({ id }: { id: string }) {
  const { konten, personen } = useHaushalt();
  const aktion = useAktion();
  const kopf = useQuery<Kopf>(`select h.id, h.kind, h.booking_date::text as datum, h.total_amount::float8 as total, h.total_amount_base::float8 as total_chf,
      h.currency, h.fx_rate::float8 as kurs, h.notes, h.default_cost_account_id as topf, m.name as laden, m.chain_key,
      h.created_at::text as erfasst, h.updated_at::text as geaendert, h.source_channel::text as quelle, a.sha256 as sha, a.mime_type as mime
    from transaction_header h left join merchant m on m.id = h.merchant_id left join attachment a on a.id = h.receipt_attachment_id
   where h.id = $1 and h.deleted_at is null`, [id]);
  const pos = useQuery<Pos>(`select l.id, l.raw_text, l.final_price::float8 as betrag, l.item_discount::float8 as rabatt,
      coalesce(l.cost_account_id, h.default_cost_account_id) as topf, l.cost_account_id is not null as eigener_topf, c.name as kategorie
    from line_item l join transaction_header h on h.id = l.transaction_id left join category c on c.id = l.category_id
    where l.transaction_id = $1 order by l.position`, [id]);
  const zahlungen = useQuery<Zahl>(`select tp.id, tp.kind, tp.amount::float8 as betrag, tp.amount_base::float8 as betrag_chf, tp.label, a.name as konto, pm.label as mittel
    from transaction_payment tp left join account a on a.id = tp.account_id left join payment_method pm on pm.id = tp.payment_method_id
    where tp.transaction_id = $1 order by tp.position`, [id]);
  const eff = useQuery<Eff>(`select person_id, paid::float8 as paid, share::float8 as share, effect::float8 as effect from v_txn_effect where transaction_id = $1`, [id]);

  if (!kopf || !pos || !zahlungen || !eff) return null;
  const h = kopf[0];
  if (!h) return <Seite titel="Nicht gefunden" zurueck="belege"><Leer icon="beleg" titel="Diesen Beleg gibt es nicht (mehr)." /></Seite>;

  const opts = topfOptionen(konten, personen);
  const topf = (tid: string) => opts.find((o) => o.id === tid) ?? konten.filter((k) => k.id === tid).map((k) => ({ id: k.id, label: k.name, kind: k.kind }))[0];
  const erwachsene = personen.filter((p) => p.role === "adult");
  const plus = eff.find((e) => e.effect > 0.005), minus = eff.find((e) => e.effect < -0.005);
  const name = (pid?: string) => personen.find((p) => p.id === pid)?.display_name ?? "?";
  const titel = h.laden ?? pos[0]?.raw_text ?? BELEG_ART[h.kind];
  const fremd = h.currency !== "CHF";

  return (
    <Seite eyebrow={`${BELEG_ART[h.kind]} · ${datum(h.datum)}`} titel={titel} zurueck="belege"
      aktion={<a href={`#/erfassen/${h.id}`} className="btn btn-soft no-underline"><Icon name="stift" size={17} />Bearbeiten</a>}>
      <div className="card p-4 flex items-center gap-3.5">
        <LadenMarke name={titel} chain={h.chain_key} gross />
        <div className="grid flex-1 min-w-0">
          <span className="text-muted text-[13px]">{h.kind === "refund" ? "Gutschrift (Geld zurück)" : "Total"}</span>
          <span className="num text-[30px] leading-tight">{h.currency} {geld(Math.abs(h.total))}</span>
          {fremd && <span className="text-muted text-[12.5px]">≈ CHF {geld(Math.abs(h.total_chf))} · Kurs {h.kurs.toLocaleString("de-CH", { maximumFractionDigits: 4 })}</span>}
        </div>
      </div>

      <div className="card p-4 grid gap-3">
        <h2 className="font-bold">Wer trägt was</h2>
        <div className="grid gap-2">
          {erwachsene.map((p) => {
            const e = eff.find((x) => x.person_id === p.id);
            return (
              <div key={p.id} className="flex items-center gap-2.5">
                <Avatar name={p.display_name} color={farbe(p)} size={28} />
                <span className="flex-1 font-semibold">{p.display_name}</span>
                <span className="grid text-right text-[12.5px] text-muted leading-tight">
                  <span>trägt <b className="num text-ink">{geld(Math.abs(e?.share ?? 0))}</b></span>
                  <span>{h.kind === "refund" ? "erhalten" : "bezahlt"} <span className="num">{geld(Math.abs(e?.paid ?? 0))}</span></span>
                </span>
              </div>
            );
          })}
        </div>
        <p className="text-[14px] text-ink-2 border-t border-[var(--rule)] pt-2.5">
          {plus && minus
            ? <>Aus diesem Beleg schuldet <b>{name(minus.person_id)}</b> {name(plus.person_id)} <b className="num">CHF {geld(plus.effect)}</b>.</>
            : "Dieser Beleg verändert den Ausgleich nicht."}
        </p>
      </div>

      <div className="grid gap-2">
        <h2 className="text-[16px] font-bold px-1">{pos.length === 1 ? "Position" : `${pos.length} Positionen`}</h2>
        <div className="card list overflow-hidden">
          {pos.map((l) => {
            const t = topf(l.topf);
            return (
              <div key={l.id} className="row !cursor-default">
                <span className="grid flex-1 min-w-0 gap-0.5">
                  <span className="truncate font-semibold">{l.raw_text}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
                    {t && <span className={`chip k-tag k-${t.kind} !text-[11px] !px-2 !py-0.5`}>{t.label}</span>}
                    {l.kategorie && <span>{l.kategorie}</span>}
                    {l.rabatt > 0 && <span className="text-[var(--accent-ink)]">Rabatt {geld(l.rabatt)}</span>}
                  </span>
                </span>
                <span className="num">{geld(l.betrag)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-2">
        <h2 className="text-[16px] font-bold px-1">{h.kind === "refund" ? "Zurück auf" : "Bezahlt mit"}</h2>
        <div className="card list overflow-hidden">
          {zahlungen.map((z) => (
            <div key={z.id} className="row !cursor-default">
              <span className="k-ico small k-zweck"><Icon name={z.konto ? "karte" : "geschenk"} size={17} /></span>
              <span className="grid flex-1 min-w-0">
                <span className="font-semibold truncate">{z.konto ?? z.label ?? ZAHLART_TEXT[z.kind]}</span>
                <span className="text-muted text-[12.5px]">{z.mittel ?? ZAHLART_TEXT[z.kind] ?? z.kind}{!z.konto ? " · zählt für beide nach Anteil" : ""}</span>
              </span>
              <span className="num">{geld(Math.abs(z.betrag))}</span>
            </div>
          ))}
        </div>
      </div>

      {h.sha && <BelegFoto sha={h.sha} mime={h.mime ?? "image/jpeg"} />}

      {h.notes && <div className="card-flat p-3.5 text-[14px]"><span className="eyebrow block mb-1">Notiz</span>{h.notes}</div>}

      <p className="text-muted text-[12px] px-1">{h.quelle === "receipt_image" ? "Gescannt" : h.quelle === "receipt_pdf" ? "Aus PDF gelesen" : "Erfasst"} {new Date(h.erfasst).toLocaleString("de-CH")}{h.geaendert !== h.erfasst ? ` · geändert ${new Date(h.geaendert).toLocaleString("de-CH")}` : ""}</p>

      <LoeschKnopf text="Beleg löschen" frage="Den Beleg mit allen Positionen löschen? Der Ausgleich wird neu berechnet."
        onJa={async () => { if (await aktion(async () => belegLoeschen(await db(), h.id), "Beleg gelöscht")) go("belege"); }} />
    </Seite>
  );
}

/** Foto oder PDF des Belegs – liegt nur auf dem Handy, das ihn gescannt hat */
function BelegFoto({ sha, mime }: { sha: string; mime: string }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [gross, setGross] = useState(false);
  useEffect(() => {
    let weg: string | null = null;
    dateiLaden(sha).then((b) => { if (b) { weg = URL.createObjectURL(b); setUrl(weg); } else setUrl(null); }).catch(() => setUrl(null));
    return () => { if (weg) URL.revokeObjectURL(weg); };
  }, [sha]);
  if (url === undefined) return null;
  if (url === null) return <p className="card-flat p-3.5 text-muted text-[13.5px] flex items-center gap-2"><Icon name="kamera" size={18} />Das Belegfoto liegt auf dem Handy, das ihn gescannt hat.</p>;
  if (mime === "application/pdf") return <a href={url} target="_blank" rel="noreferrer" className="btn no-underline"><Icon name="blatt" />PDF des Belegs öffnen</a>;
  return (
    <>
      <button className="card p-2 flex items-center gap-3 text-left" onClick={() => setGross(true)} aria-label="Belegfoto anzeigen">
        <img src={url} alt="Belegfoto" className="w-14 h-18 object-cover object-top rounded-lg" />
        <span className="grid"><b>Belegfoto</b><span className="text-muted text-[12.5px]">Antippen zum Vergrössern</span></span>
      </button>
      <Sheet offen={gross} onClose={() => setGross(false)} titel="Belegfoto"><img src={url} alt="Belegfoto gross" className="w-full rounded-xl" /></Sheet>
    </>
  );
}
