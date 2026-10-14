import { useQuery } from "../db/client";
import { useHaushalt } from "../lib/haushalt";
import { useSync } from "../lib/sync";
import { Seite } from "../ui/kit";
import { Icon } from "../ui/Icon";

export function Mehr() {
  const { household, konten, personen } = useHaushalt();
  const s = useSync();
  const kat = useQuery<{ n: number; b: number }>(`select count(*)::int as n, count(distinct life_area_id)::int as b from category where household_id = $1 and archived_at is null`, [household])?.[0];
  const echte = konten.filter((k) => k.status === "active").length;
  const toepfe = konten.filter((k) => k.status === "virtual").length;
  const abgleich = s.modus === "lokal" ? "Nur auf diesem Handy" : s.modus === "abgemeldet" ? "Nicht angemeldet" : s.modus === "fehler" ? "Abgleich gestört" : "Mit dem Server verbunden";
  const eintraege: [string, string, string, string][] = [
    ["konten", "konten", "Konten und Töpfe", `${echte} ${echte === 1 ? "echtes Konto" : "echte Konten"} · ${toepfe} ${toepfe === 1 ? "Topf" : "Töpfe"} vorbereitet`],
    ["kategorien", "kategorien", "Kategorien", kat ? `${kat.n} Kategorien in ${kat.b} Lebensbereichen` : ""],
    ["personen", "personen", "Personen", personen.filter((p) => !p.archived_at).map((p) => p.display_name).join(", ")],
    ["einstellungen", "einstellungen", "Einstellungen", `Gerät, Abgleich, Sicherung · ${abgleich}`],
  ];
  return (
    <Seite eyebrow="Mehr" titel="Haushalt einrichten">
      <nav className="card list overflow-hidden" aria-label="Weitere Seiten">
        {eintraege.map(([pfad, icon, titel, text]) => (
          <a key={pfad} href={`#/${pfad}`} className="row no-underline text-ink">
            <span className="k-ico k-zweck"><Icon name={icon} /></span>
            <span className="grid flex-1 min-w-0"><b>{titel}</b><span className="text-muted text-[13px] truncate">{text}</span></span>
            <Icon name="rechts" className="text-muted" />
          </a>
        ))}
      </nav>
      <a href="../" className="card-flat row no-underline text-ink">
        <span className="k-ico k-privat"><Icon name="link" /></span>
        <span className="grid flex-1 min-w-0"><b>Kasse unterwegs</b><span className="text-muted text-[13px]">Die bisherige App bleibt erreichbar, bis alles übernommen ist.</span></span>
        <Icon name="rechts" className="text-muted" />
      </a>
    </Seite>
  );
}
