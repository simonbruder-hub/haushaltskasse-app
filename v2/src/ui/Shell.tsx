import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { useHaushalt } from "../lib/haushalt";
import { useSync } from "../lib/sync";

const TABS: [string, string, string][] = [["", "Übersicht", "uebersicht"], ["belege", "Belege", "beleg"], ["erfassen", "Erfassen", "plus"], ["ausgleich", "Ausgleich", "ausgleich"], ["mehr", "Mehr", "mehr"]];
const UNTER_MEHR = ["mehr", "konten", "kategorien", "personen", "einstellungen", "preise", "preis-pruefen"];
const tabVon = (seite: string) => (UNTER_MEHR.includes(seite) ? "mehr" : seite);

export function Shell({ seite, children }: { seite: string; children: ReactNode }) {
  const { name } = useHaushalt();
  return (
    <div className="mx-auto max-w-[42rem] px-4 pb-[calc(118px+env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)]">
      <header className="flex items-center justify-between gap-3 pt-4 pb-1">
        <a href="#/" className="flex items-center gap-2.5 min-w-0 no-underline text-ink">
          <img src="./icon-192.png" alt="" width={38} height={38} className="rounded-xl shadow-sm" />
          <div className="min-w-0">
            <p className="font-extrabold text-[18px] leading-tight">Haushalt</p>
            <p className="text-muted text-[12.5px] truncate">{name}</p>
          </div>
        </a>
        <SyncChip />
      </header>
      <main className="grid gap-5">{children}</main>
      <nav className="tabs" aria-label="Hauptnavigation">
        {TABS.map(([pfad, text, icon]) => pfad === "erfassen" ? (
          <a key={pfad} href="#/erfassen" className="fab" aria-label={text} aria-current={seite === pfad || seite === "scan" ? "page" : undefined}>
            <Icon name={icon} size={28} strokeWidth={2.4} />
          </a>
        ) : (
          <a key={pfad} href={`#/${pfad}`} aria-current={tabVon(seite) === pfad ? "page" : undefined}>
            <Icon name={icon} size={23} /><span>{text}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}

function SyncChip() {
  const s = useSync();
  const [text, cls, icon] =
    s.modus === "lokal" ? ["Nur auf diesem Handy", "chip-virtuell", "wolke_aus"] :
    s.modus === "abgemeldet" ? ["Nicht angemeldet", "chip-warn", "wolke_aus"] :
    s.modus === "laeuft" ? ["Gleicht ab …", "chip-ok", "aktualisieren"] :
    s.modus === "fehler" ? ["Abgleich gestört", "chip-crit", "wolke_aus"] :
    s.ausstehend ? [`${s.ausstehend} ausstehend`, "chip-warn", "wolke"] : ["Abgeglichen", "chip-ok", "wolke"];
  return <a href="#/einstellungen" className={`chip ${cls} no-underline`} title="Abgleich"><Icon name={icon} size={14} strokeWidth={2} /><span className="hidden min-[380px]:inline">{text}</span></a>;
}
