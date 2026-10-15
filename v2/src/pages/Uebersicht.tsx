import { useQuery } from "../db/client";
import { KONTO_ART, type Konto } from "../lib/data";
import { ichBin } from "../lib/sync";
import { gruppieren } from "../lib/gruppen";
import { useHaushalt } from "../lib/haushalt";
import { geld, heute, monatName, monatsGrenzen } from "../lib/format";
import { topfOptionen } from "../lib/auswahl";
import { useBelege } from "../lib/belegliste";
import { Avatar, farbe, KontoIcon } from "../ui/kit";
import { Icon } from "../ui/Icon";
import { BelegEintrag } from "./Belege";
import { SALDO_SQL, schuld } from "./Ausgleich";

export function Uebersicht() {
  const { ich, personen, konten } = useHaushalt();
  const me = personen.find((p) => p.id === ich);
  const g = gruppieren(konten, personen);
  const echte = konten.filter((k) => k.status === "active").length;
  const vorbereitet = konten.filter((k) => k.status === "virtual").length;
  return (
    <section className="grid gap-5">
      <div className="grid gap-1 pt-2">
        <span className="eyebrow">{new Date().toLocaleDateString("de-CH", { weekday: "long", day: "numeric", month: "long" })}</span>
        <h1 className="text-[30px] font-extrabold tracking-tight">{me ? `Hallo ${me.display_name}` : "Willkommen"}</h1>
      </div>

      {!me && <WerBinIch />}

      <AusgleichKarte />
      <DieserMonat />
      <LetzteBelege />

      <h2 className="text-[17px] font-bold px-1 -mb-2 mt-1">Eure Töpfe</h2>
      <div className="card p-5 grid gap-4">
        <div className="flex items-center justify-between gap-3">
          <p className="eyebrow">Euer Kontenplan</p>
          <span className="chip chip-ok">immer 50/50</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Kennzahl zahl={echte} text={echte === 1 ? "echtes Konto" : "echte Konten"} />
          <Kennzahl zahl={vorbereitet} text={vorbereitet === 1 ? "Topf vorbereitet" : "Töpfe vorbereitet"} />
        </div>
        <p className="text-[14px] text-ink-2">
          {g.gemeinsam.some((k) => k.status === "virtual")
            ? "Heute bezahlt ihr über eure Privatkonten. «Gemeinsam Leben» ist ein Topf ohne eigenes Konto – die App rechnet aus, wer wem etwas schuldet."
            : "Gemeinsame Ausgaben laufen über euer gemeinsames Konto. Ein Ausgleich entsteht nur, wenn jemand privat für Gemeinsames bezahlt."}
        </p>
      </div>

      <div className="grid gap-3">
        <h2 className="text-[17px] font-bold px-1">Gemeinsam</h2>
        {g.gemeinsam.map((k) => <TopfKarte key={k.id} k={k} />)}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {g.proPerson.map(({ person, konten: ks }) => (
          <div key={person.id} className="card p-4 grid gap-3 content-start">
            <div className="flex items-center gap-2.5">
              <Avatar name={person.display_name} color={farbe(person)} size={34} />
              <div className="grid"><b>{person.display_name}</b><span className="text-muted text-[12.5px]">{ks.length} {ks.length === 1 ? "Topf" : "Töpfe"}</span></div>
            </div>
            <div className="grid gap-2">
              {ks.map((k) => (
                <a key={k.id} href={`#/konten/${k.id}`} className={`topf k-${k.kind} ${k.status === "virtual" ? "virtuell" : ""} card-flat no-underline text-ink flex items-center gap-2.5 py-2.5 pl-3.5 pr-2`}>
                  <KontoIcon kind={k.kind} small />
                  <span className="grid min-w-0 flex-1">
                    <span className="font-semibold truncate">{k.name}</span>
                    <span className="text-muted text-[12px]">{k.status === "active" ? "Konto" : "vorbereitet"}{k.is_personal_default ? " · persönlicher Topf" : ""}</span>
                  </span>
                  <Icon name="rechts" size={18} className="text-muted" />
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>

      {g.kinder.length > 0 && (
        <div className="grid gap-3">
          <h2 className="text-[17px] font-bold px-1">Kinder</h2>
          {g.kinder.map((k) => <TopfKarte key={k.id} k={k} />)}
        </div>
      )}


      <Fahrplan />
    </section>
  );
}

function Kennzahl({ zahl, text }: { zahl: number; text: string }) {
  return <div className="rounded-2xl bg-[var(--paper-2)] p-3"><p className="num text-[30px] leading-none">{zahl}</p><p className="text-[13px] text-ink-2 mt-1">{text}</p></div>;
}

/** Wer schuldet wem – das Wichtigste zuerst */
function AusgleichKarte() {
  const { household, personen } = useHaushalt();
  const stand = useQuery<{ person_id: string; display_name: string; paid_total: number; my_share: number; transfers_net: number; balance: number }>(SALDO_SQL, [household]);
  const n = useQuery<{ n: number }>(`select count(*)::int as n from transaction_header where household_id = $1 and deleted_at is null`, [household])?.[0]?.n;
  if (!stand || n === undefined) return null;
  if (!n) {
    return (
      <a href="#/erfassen" className="hero p-5 grid gap-3 no-underline">
        <span className="grid place-items-center size-11 rounded-2xl bg-white/15"><Icon name="beleg" size={24} /></span>
        <p className="text-[21px] font-extrabold leading-tight">Erfasse euren ersten Einkauf</p>
        <p className="text-[14px] opacity-90">Betrag, Laden, wer bezahlt hat und für wen – die App rechnet aus, wer wem etwas schuldet.</p>
        <span className="btn bg-white/95 text-[#12291f] border-transparent justify-self-start"><Icon name="plus" />Beleg erfassen</span>
      </a>
    );
  }
  const s = schuld(stand);
  const p = (id: string) => personen.find((x) => x.id === id) ?? {};
  return (
    <a href="#/ausgleich" className="hero p-5 grid gap-2 no-underline">
      <div className="flex items-center justify-between"><p className="eyebrow !text-current opacity-80">Ausgleich</p><Icon name="rechts" /></div>
      {s ? (
        <>
          <div className="flex items-center gap-2.5">
            <span className="avatars"><Avatar name={s.von.display_name} color={farbe(p(s.von.person_id))} size={30} /><Avatar name={s.an.display_name} color={farbe(p(s.an.person_id))} size={30} /></span>
            <p className="text-[16px] font-semibold">{s.von.display_name} schuldet {s.an.display_name}</p>
          </div>
          <p className="num text-[36px] leading-none">CHF {geld(s.betrag)}</p>
        </>
      ) : (
        <p className="text-[22px] font-extrabold flex items-center gap-2"><Icon name="haken" size={24} strokeWidth={2.4} />Ihr seid quitt</p>
      )}
    </a>
  );
}

function DieserMonat() {
  const { household, konten, personen } = useHaushalt();
  const t = heute();
  const { von, bis } = monatsGrenzen(t);
  const toepfe = useQuery<{ topf: string; betrag: number }>(`
    select coalesce(l.cost_account_id, h.default_cost_account_id) as topf, sum(a.amount_base)::float8 as betrag
      from line_item_allocation a join line_item l on l.id = a.line_item_id join transaction_header h on h.id = l.transaction_id
     where h.household_id = $1 and h.status = 'confirmed' and h.deleted_at is null and h.booking_date >= $2 and h.booking_date < $3
     group by 1 order by 2 desc`, [household, von, bis]);
  const anzahl = useQuery<{ n: number }>(`select count(*)::int as n from transaction_header where household_id = $1 and status = 'confirmed'
     and deleted_at is null and booking_date >= $2 and booking_date < $3`, [household, von, bis])?.[0]?.n ?? 0;
  if (!toepfe || !anzahl) return null;
  const opts = topfOptionen(konten, personen);
  const summe = toepfe.reduce((s, x) => s + x.betrag, 0);
  const max = Math.max(...toepfe.map((x) => x.betrag), 1);
  return (
    <a href="#/belege" className="card p-4 grid gap-3 no-underline text-ink">
      <div className="flex items-start justify-between gap-3">
        <div className="grid">
          <span className="eyebrow capitalize">{monatName(t.slice(0, 7))}</span>
          <span className="num text-[28px] leading-tight">CHF {geld(summe)}</span>
          <span className="text-muted text-[13px]">{anzahl} {anzahl === 1 ? "Beleg" : "Belege"}</span>
        </div>
        <Icon name="rechts" className="text-muted mt-1" />
      </div>
      <div className="grid gap-2">
        {toepfe.map((x) => {
          const o = opts.find((y) => y.id === x.topf) ?? konten.filter((k) => k.id === x.topf).map((k) => ({ label: k.name, kind: k.kind }))[0];
          return (
            <div key={x.topf} className={`grid gap-1 k-${o?.kind ?? "zweck"}`}>
              <div className="flex justify-between text-[13.5px]"><span className="font-semibold">{o?.label ?? "Topf"}</span><span className="num">{geld(x.betrag)}</span></div>
              <div className="h-2 rounded-full bg-[var(--paper-2)] overflow-hidden"><div className="h-full rounded-full bg-[var(--k)]" style={{ width: `${Math.max(3, (x.betrag / max) * 100)}%` }} /></div>
            </div>
          );
        })}
      </div>
    </a>
  );
}

function LetzteBelege() {
  const { household } = useHaushalt();
  const belege = useBelege(household, "order by h.booking_date desc, h.created_at desc limit 3");
  if (!belege?.length) return null;
  return (
    <div className="grid gap-2">
      <div className="flex items-end justify-between px-1">
        <h2 className="text-[17px] font-bold">Zuletzt erfasst</h2>
        <a href="#/belege" className="text-[13.5px] font-semibold text-accent-ink no-underline">Alle Belege</a>
      </div>
      <div className="card list overflow-hidden">{belege.map((b) => <BelegEintrag key={b.id} b={b} />)}</div>
    </div>
  );
}

function TopfKarte({ k }: { k: Konto }) {
  return (
    <a href={`#/konten/${k.id}`} className={`topf k-${k.kind} ${k.status === "virtual" ? "virtuell" : ""} card no-underline text-ink p-4 pl-5 flex items-center gap-3.5`}>
      <KontoIcon kind={k.kind} />
      <span className="grid flex-1 min-w-0 gap-1">
        <span className="flex items-center gap-2 flex-wrap"><b className="text-[16.5px]">{k.name}</b>
          <span className={`chip ${k.status === "active" ? "chip-ok" : "chip-virtuell"}`}>{k.status === "active" ? "Konto" : "ohne eigenes Konto"}</span></span>
        <span className="text-muted text-[13px]">{KONTO_ART[k.kind].text}</span>
        <span className="split mt-1" aria-label="Anteile">{k.owners.map((o) => <span key={o.person_id} style={{ width: `${o.share * 100}%`, background: farbe(o) }} />)}</span>
      </span>
      <span className="avatars">{k.owners.map((o) => <Avatar key={o.person_id} name={o.name} color={farbe(o)} />)}</span>
    </a>
  );
}

function WerBinIch() {
  const { personen } = useHaushalt();
  return (
    <div className="card p-5 grid gap-3">
      <div className="flex gap-3 items-start"><span className="k-ico k-privat"><Icon name="person" /></span>
        <div className="grid"><b>Wer benutzt dieses Handy?</b><span className="text-muted text-[13.5px]">Damit Vorschläge (z. B. der persönliche Topf) zu dir passen.</span></div></div>
      <div className="flex gap-2 flex-wrap">
        {personen.filter((p) => p.role === "adult").map((p) => (
          <button key={p.id} className="btn" onClick={() => ichBin(p.id)}><Avatar name={p.display_name} color={farbe(p)} size={24} />{p.display_name}</button>
        ))}
      </div>
    </div>
  );
}

const MODULE: [string, string, string, boolean][] = [
  ["M1", "Fundament", "Konten, Töpfe, Personen, Kategorien, Abgleich", true],
  ["M2", "Belege und Ausgleich", "Einkäufe erfassen, Topf pro Position, wer schuldet wem", true],
  ["M3", "Beleg-Scanner", "Foto oder PDF → Positionen, lernt eure Kürzel", true],
  ["M4", "Produkte und Preise", "EAN-Scan im Laden, Preisvergleich, Shrinkflation", false],
  ["M5", "Budget und Konten", "Safe-to-Spend, Fixkosten, Verträge, Sparziele, Daueraufträge", false],
  ["M6", "Rechnungen und Planung", "QR-Rechnungen, Garantien, Smart Basket", false],
  ["M7", "Übernahme", "Daten aus Haushaltskasse und Kasse unterwegs", false],
];
function Fahrplan() {
  return (
    <div className="card p-5 grid gap-3">
      <div className="flex items-center justify-between"><h2 className="text-[17px] font-bold">Was als Nächstes kommt</h2><span className="chip chip-ok">{MODULE.filter((m) => m[3]).length} von {MODULE.length}</span></div>
      <ol className="grid gap-2.5">
        {MODULE.map(([nr, titel, text, fertig]) => (
          <li key={nr} className="flex gap-3 items-start">
            <span className="step" style={{ background: fertig ? "var(--accent)" : "var(--paper-2)", color: fertig ? "var(--on-accent)" : "var(--muted)" }}>
              {fertig ? <Icon name="haken" size={15} strokeWidth={2.5} /> : nr.slice(1)}
            </span>
            <span className="grid"><b className={fertig ? "" : "text-ink-2"}>{titel}</b><span className="text-muted text-[13px]">{text}</span></span>
          </li>
        ))}
      </ol>
    </div>
  );
}
