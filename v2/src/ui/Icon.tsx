const kreis = (x: number, y: number, r: number) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

const PFADE: Record<string, string> = {
  uebersicht: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  leben: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  privat: "M3 7a2 2 0 0 1 2-2h12v4M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z" + kreis(16, 14, 1.2),
  sparen: "M5 11.5C5 8 8.1 5.5 12 5.5c2.4 0 4.4.9 5.6 2.4H20v4.3l-2 .9V17h-3v-2H9v2H6v-3.3a5 5 0 0 1-1-2.2zM15.5 9.5h.01M10 5.7V4",
  freizeit: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  kind: kreis(12, 12, 8) + "M9.2 11h.01M14.8 11h.01M9.5 14.5a3.5 3.5 0 0 0 5 0M12 4c-1.5 0-2 1-1.2 1.8",
  zweck: kreis(12, 12, 8.5) + kreis(12, 12, 4.5) + kreis(12, 12, .8),
  konten: "M3 10l9-6 9 6M5 10v8M9.7 10v8M14.3 10v8M19 10v8M3 20.5h18",
  kategorien: "M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3-8.7 8.7zM8 8h.01",
  personen: kreis(9, 7.5, 3.5) + "M2.5 20a6.5 6.5 0 0 1 13 0M16 4a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-3.5-5.8",
  einstellungen: "M4 7h9M17 7h3M4 17h3M11 17h9" + kreis(15, 7, 2) + kreis(9, 17, 2),
  wolke: "M7 18.5a4.5 4.5 0 1 1 .8-8.9A6 6 0 0 1 19.2 11a3.8 3.8 0 0 1-.7 7.5z",
  wolke_aus: "M7 18.5a4.5 4.5 0 1 1 .8-8.9A6 6 0 0 1 19.2 11a3.8 3.8 0 0 1-.7 7.5zM3 3l18 18",
  plus: "M12 5v14M5 12h14",
  rechts: "M9 6l6 6-6 6",
  links: "M15 6l-6 6 6 6",
  haken: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6 6 18",
  karte: "M3 6.5h18v11H3zM3 10.5h18M7 14.5h3",
  muell: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  aktualisieren: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  info: kreis(12, 12, 9) + "M12 11v5M12 8h.01",
  pfeil: "M5 12h14M13 6l6 6-6 6",
  person: kreis(12, 8, 4) + "M4 21a8 8 0 0 1 16 0",
  schluessel: kreis(8, 15, 4) + "M11 12l9-9M17 6l3 3M15 8l2 2",
  stift: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  blatt: "M5 19c0-8 5-13 15-14-1 10-6 15-14 15M5 19l7-7",
  waage: "M12 4v16M5 20h14M5 8l-3 6a3 3 0 0 0 6 0zM19 8l-3 6a3 3 0 0 0 6 0zM5 8h14",
  beleg: "M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21zM9.5 8h5M9.5 12h5M9.5 16h3",
  ausgleich: "M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4",
  mehr: kreis(5, 12, 1.3) + kreis(12, 12, 1.3) + kreis(19, 12, 1.3),
  suche: kreis(11, 11, 6.5) + "M20 20l-4.3-4.3",
  laden: "M4 9l1.6-5h12.8L20 9M4 9v11h16V9M4 9h16M9.5 20v-5.5h5V20",
  kalender: "M4 6h16v14H4zM4 10.5h16M8.5 3.5v4M15.5 3.5v4",
  kamera: "M4 8h3l1.6-2.5h6.8L17 8h3v11H4z" + kreis(12, 13.2, 3.6),
  geschenk: "M4 11h16v9H4zM3 7.5h18V11H3zM12 7.5V20M12 7.5c-1.5-3-5-3.6-5-1.5 0 1.2 2 1.5 5 1.5zM12 7.5c1.5-3 5-3.6 5-1.5 0 1.2-2 1.5-5 1.5z",
  bild: "M5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11A2.5 2.5 0 0 1 5.5 4zM21 16l-5-5-10 9" + kreis(9, 10, 2),
  licht: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1v.5h5V16c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
  blitzauto: "M13 3 6 13.5h5L10 21l7-10.5h-5z",
  drehen: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  zauber: "m4 20 11-11M14 4l1 2.5L17.5 7 15 8l-1 2.5L13 8l-2.5-1L13 6zM19 13l.6 1.4L21 15l-1.4.6L19 17l-.6-1.4L17 15l1.4-.6z",
  rahmen: "M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM4 9h16M9 4v16",
  zuschneiden: "M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14",
  strichcode: "M4 5v14M7 5v14M10.5 5v14M13 5v14M16.5 5v14M20 5v14",
  preis: "M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3-8.7 8.7zM8 8h.01M10.5 14.5l4-4",
  alarm: "M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9zM10 20a2.2 2.2 0 0 0 4 0",
  trend_hoch: "M3 17l6-6 4 4 8-8M15 7h6v6",
  trend_runter: "M3 7l6 6 4-4 8 8M15 17h6v-6",
};

export type IconName = keyof typeof PFADE;
export function Icon({ name, size = 20, className = "", strokeWidth = 1.8 }: { name: IconName | string; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}>
      <path d={PFADE[name] ?? PFADE.info} />
    </svg>
  );
}

export const KONTO_ICON: Record<string, IconName> = { leben: "leben", privat: "privat", sparen: "sparen", freizeit: "freizeit", kind: "kind", zweck: "zweck" };
