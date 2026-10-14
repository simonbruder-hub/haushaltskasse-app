import { useQuery } from "../db/client";
import { KONTO_ART, type Konto } from "../lib/data";
import { ichBin } from "../lib/sync";
import { gruppieren } from "../lib/gruppen";
import { useHaushalt } from "../lib/haushalt";
import { Avatar, farbe, KontoIcon } from "../ui/kit";
import { Icon } from "../ui/Icon";

export function Uebersicht() {
  const { household, ich, personen, konten } = useHaushalt();
  const me = personen.find((p) => p.id === ich);
  const g = gruppieren(konten, personen);
  const echte = konten.filter((k) => k.status === "active").length;
  const vorbereitet = konten.filter((k) => k.status === "virtual").length;
  const kat = useQuery<{ gemeinsam: number; persoenlich: number }>(
    `select count(*) filter (where default_cost_account_id is not null)::int as gemeinsam,
            count(*) filter (where default_cost_account_id is null)::int as persoenlich
       from category where household_id = $1 and archived_at is null`, [household])?.[0];
  return (
    <section className="grid gap-5">
      <div className="grid gap-1 pt-2">
        <span className="eyebrow">{new Date().toLocaleDateString("de-CH", { weekday: "long", day: "numeric", month: "long" })}</span>
        <h1 className="text-[30px] font-extrabold tracking-tight">{me ? `Hallo ${me.display_name}` : "Willkommen"}</h1>
      </div>

      {!me && <WerBinIch />}

      <div className="hero p-5 grid gap-4">
        <div className="flex items-center justify-between gap-3">
          <p className="eyebrow !text-current opacity-80">Euer Kontenplan</p>
          <span className="chip bg-white/15">immer 50/50</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Kennzahl zahl={echte} text={echte === 1 ? "echtes Konto" : "echte Konten"} />
          <Kennzahl zahl={vorbereitet} text={vorbereitet === 1 ? "Topf vorbereitet" : "Töpfe vorbereitet"} />
        </div>
        <p className="text-[14px] opacity-90">
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

      {kat && (
        <a href="#/kategorien" className="card p-4 flex items-center gap-4 no-underline text-ink">
          <span className="k-ico k-zweck"><Icon name="kategorien" /></span>
          <span className="grid flex-1">
            <b>Kategorien</b>
            <span className="text-muted text-[13.5px]">{kat.gemeinsam} gehen standardmässig in «Gemeinsam», {kat.persoenlich} in den persönlichen Topf</span>
          </span>
          <Icon name="rechts" className="text-muted" />
        </a>
      )}

      <Fahrplan />
    </section>
  );
}

function Kennzahl({ zahl, text }: { zahl: number; text: string }) {
  return <div className="rounded-2xl bg-white/12 p-3"><p className="num text-[30px] leading-none">{zahl}</p><p className="text-[13px] opacity-85 mt-1">{text}</p></div>;
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
  ["M2", "Belege und Ausgleich", "Einkäufe erfassen, Topf pro Position, wer schuldet wem", false],
  ["M3", "Beleg-Scanner", "Foto oder PDF → Positionen, lernt eure Kürzel", false],
  ["M4", "Produkte und Preise", "EAN-Scan im Laden, Preisvergleich, Shrinkflation", false],
  ["M5", "Budget und Konten", "Safe-to-Spend, Fixkosten, Verträge, Sparziele, Daueraufträge", false],
  ["M6", "Rechnungen und Planung", "QR-Rechnungen, Garantien, Smart Basket", false],
  ["M7", "Übernahme", "Daten aus Haushaltskasse und Kasse unterwegs", false],
];
function Fahrplan() {
  return (
    <div className="card p-5 grid gap-3">
      <div className="flex items-center justify-between"><h2 className="text-[17px] font-bold">Was als Nächstes kommt</h2><span className="chip chip-ok">1 von 7</span></div>
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
