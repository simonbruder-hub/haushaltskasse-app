/* Kasse unterwegs – Budget: alle Einnahmen und Kosten im Überblick, aufgeteilt auf Simon und Eliana.
   Gliederung wie in Schweizer Budgetvorlagen: Einnahmen · feste Kosten · variable Kosten · Rückstellungen · Sparen. */
"use strict";
const HAEUFIGKEIT = { m: ["monatlich", 1], w: ["wöchentlich", 52 / 12], q: ["vierteljährlich", 1 / 3], h: ["halbjährlich", 1 / 6], j: ["jährlich", 1 / 12] };
const B_GRUPPEN = [
  { id: "einnahmen", name: "Einnahmen", icon: "einnahmen", art: "ein", text: "Nettolohn nach Abzügen, 13. Monatslohn, Nebenverdienst, Zulagen" },
  { id: "wohnen", name: "Wohnen & Energie", icon: "wohnen", art: "fix", text: "Miete mit Nebenkosten, Strom, Internet, Serafe" },
  { id: "versicherung", name: "Versicherungen", icon: "versicherung", art: "fix", text: "Krankenkasse, Zusatzversicherungen, Hausrat und Haftpflicht" },
  { id: "steuern", name: "Steuern", icon: "steuern", art: "fix", text: "Gemeinde-, Staats- und Bundessteuer – als Jahresbetrag" },
  { id: "mobilitaet", name: "Mobilität", icon: "mobilitaet", art: "fix", text: "ÖV-Abo, Halbtax, Velo, Auto" },
  { id: "essen", name: "Haushalt & Essen", icon: "essen", art: "var", text: "Lebensmittel, Auswärts essen, Drogerie" },
  { id: "freizeit", name: "Persönliches & Freizeit", icon: "freizeit", art: "var", text: "Handy, Kleider, Coiffeur, Sport, Abos, Geschenke" },
  { id: "ruecklagen", name: "Rückstellungen", icon: "ruecklagen", art: "rueck", text: "Ferien, Zahnarzt und Franchise, Anschaffungen, Unvorhergesehenes" },
  { id: "sparen", name: "Sparen & Vorsorge", icon: "sparschwein", art: "spar", text: "Sparkonto, Notgroschen, Säule 3a" }
];
const BG = id => B_GRUPPEN.find(g => g.id === id) || B_GRUPPEN[0];
// Vorlage: Beträge leer, Beispiele als Platzhalter
const B_VORLAGE = [
  ["einnahmen", "Nettolohn Simon", "m", "Simon", "z. B. 5'200"],
  ["einnahmen", "Nettolohn Eliana", "m", "Eliana", "z. B. 4'800"],
  ["einnahmen", "13. Monatslohn Simon", "j", "Simon", "", 12],
  ["einnahmen", "13. Monatslohn Eliana", "j", "Eliana", "", 12],
  ["einnahmen", "Nebenverdienst, Bonus", "j", "gemeinsam", ""],
  ["wohnen", "Miete inkl. Nebenkosten", "m", "gemeinsam", "z. B. 2'100"],
  ["wohnen", "Strom", "q", "gemeinsam", "z. B. 150 pro Quartal", 3],
  ["wohnen", "Internet & TV", "m", "gemeinsam", "z. B. 60"],
  ["wohnen", "Serafe (Radio/TV-Abgabe)", "j", "gemeinsam", "Jahresrechnung", 4],
  ["versicherung", "Krankenkasse Simon", "m", "Simon", "Grundversicherung"],
  ["versicherung", "Krankenkasse Eliana", "m", "Eliana", "Grundversicherung"],
  ["versicherung", "Zusatzversicherungen", "m", "gemeinsam", ""],
  ["versicherung", "Hausrat & Privathaftpflicht", "j", "gemeinsam", "z. B. 350", 1],
  ["steuern", "Steuern Simon", "j", "Simon", "Jahresbetrag", 3],
  ["steuern", "Steuern Eliana", "j", "Eliana", "Jahresbetrag", 3],
  ["mobilitaet", "ÖV-Abo Simon", "j", "Simon", "z. B. ZVV-Jahresabo", 1],
  ["mobilitaet", "ÖV-Abo Eliana", "j", "Eliana", "", 1],
  ["mobilitaet", "Velo, Unterhalt", "j", "gemeinsam", "", 4],
  ["essen", "Lebensmittel & Getränke", "m", "gemeinsam", "z. B. 900", null, "einkauf"],
  ["essen", "Auswärts essen", "m", "gemeinsam", "z. B. 250", null, "auswaerts"],
  ["essen", "Drogerie & Haushaltartikel", "m", "gemeinsam", "z. B. 80"],
  ["freizeit", "Handy-Abo Simon", "m", "Simon", ""],
  ["freizeit", "Handy-Abo Eliana", "m", "Eliana", ""],
  ["freizeit", "Kleider & Schuhe", "m", "gemeinsam", ""],
  ["freizeit", "Coiffeur & Körperpflege", "m", "gemeinsam", ""],
  ["freizeit", "Sport & Fitness", "m", "gemeinsam", ""],
  ["freizeit", "Streaming & Abos", "m", "gemeinsam", ""],
  ["freizeit", "Hobbys & Ausgang", "m", "gemeinsam", ""],
  ["freizeit", "Geschenke", "j", "gemeinsam", "", 12],
  ["ruecklagen", "Ferien", "j", "gemeinsam", "z. B. 3'000", 7],
  ["ruecklagen", "Gesundheit: Franchise, Zahnarzt, Brille", "j", "gemeinsam", "z. B. 1'500", 1],
  ["ruecklagen", "Anschaffungen & Ersatz", "j", "gemeinsam", "Möbel, Geräte", 11],
  ["ruecklagen", "Unvorhergesehenes", "m", "gemeinsam", "z. B. 100"],
  ["sparen", "Sparkonto, Notgroschen", "m", "gemeinsam", ""],
  ["sparen", "Säule 3a Simon", "j", "Simon", "Maximalbetrag beachten", 12],
  ["sparen", "Säule 3a Eliana", "j", "Eliana", "", 12]
];
function budgetVorlage() {
  return { version: 1, geaendert: new Date().toISOString(), aufteilung: "einkommen", posten: B_VORLAGE.map(([g, name, hf, wer, tipp, monat, link]) => ({ id: uid(), g, name, betrag: 0, h: hf, wer, monat: monat || 1, tipp: tipp || "", link: link || null })) };
}
const proMonat = p => (Number(p.betrag) || 0) * (HAEUFIGKEIT[p.h] || HAEUFIGKEIT.m)[1];

// Alles ausrechnen, was die Ansicht und die Excel-Datei brauchen
function budgetRechnen(b) {
  const r = { gruppen: {}, ein: 0, aus: 0, spar: 0, rueck: 0, fix: 0, var: 0, person: {}, gemeinsam: 0, jahr: Array.from({ length: 12 }, () => ({ summe: 0, posten: [] })), jahresposten: 0 };
  for (const g of B_GRUPPEN) r.gruppen[g.id] = 0;
  for (const p of PERSONEN) r.person[p] = { ein: 0, eigen: 0, anteil: 0, einzahlung: 0, frei: 0 };
  for (const p of b.posten) {
    const m = proMonat(p), g = BG(p.g);
    r.gruppen[g.id] += m;
    if (g.art === "ein") { if (p.wer === "gemeinsam") for (const x of PERSONEN) r.person[x].ein += m / PERSONEN.length; else if (r.person[p.wer]) r.person[p.wer].ein += m; r.ein += m; continue; }
    if (g.art === "spar") r.spar += m; else r.aus += m;
    if (g.art === "rueck") r.rueck += m; if (g.art === "fix") r.fix += m; if (g.art === "var") r.var += m;
    if (p.wer === "gemeinsam") r.gemeinsam += m; else if (r.person[p.wer]) r.person[p.wer].eigen += m;
    // Wann grosse Rechnungen fällig sind
    if (["j", "h", "q"].includes(p.h) && Number(p.betrag) > 0) {
      const schritt = { j: 12, h: 6, q: 3 }[p.h], start = Math.min(12, Math.max(1, Number(p.monat) || 1));
      for (let k = start - 1; k < start - 1 + 12; k += schritt) { const i = k % 12; r.jahr[i].summe += Number(p.betrag); r.jahr[i].posten.push(p); }
      r.jahresposten += m;
    }
  }
  const [a, e] = PERSONEN, ea = r.person[a].ein, ee = r.person[e].ein;
  r.anteil = { [a]: b.aufteilung === "haelfte" || !(ea + ee) ? 0.5 : ea / (ea + ee) }; r.anteil[e] = 1 - r.anteil[a];
  for (const p of PERSONEN) { const x = r.person[p]; x.anteil = r.gemeinsam * r.anteil[p]; x.einzahlung = x.anteil; x.frei = x.ein - x.eigen - x.anteil; }
  r.uebrig = r.ein - r.aus - r.spar;
  r.sparquote = r.ein > 0 ? r.spar / r.ein : 0;
  r.miete = b.posten.filter(p => p.g === "wohnen" && /miete/i.test(p.name)).reduce((s, p) => s + proMonat(p), 0);
  return r;
}

// Ist-Werte aus der Haushaltskasse (Stand) plus noch nicht gesendete Einträge auf dem Handy
function istDiesenMonat() {
  const m = monatVon(heute()), u = L.stand && L.stand.uebersicht;
  const ist = { einkauf: 0, auswaerts: 0, quelle: [] };
  if (u && u.monat === m) { ist.einkauf += Number(u.einkauf) || 0; ist.auswaerts += Number(u.auswaerts) || 0; ist.quelle.push("Haushaltskasse"); }
  const schon = new Set((u && u.pwaIds) || []);
  for (const e of L.eintraege) if (monatVon(e.datum) === m && !schon.has(e.pwaId)) { ist[e.typ === "auswaerts" ? "auswaerts" : "einkauf"] += Number(e.betrag) || 0; if (!ist.quelle.includes("Handy")) ist.quelle.push("Handy"); }
  ist.verlauf = u && Array.isArray(u.monate) ? u.monate : [];
  return ist;
}

/* ---------- Ansicht ---------- */
let bSpeichernT = null, bMonatGewaehlt = null;
function budgetGeaendert() {
  L.budget.geaendert = new Date().toISOString();
  clearTimeout(bSpeichernT); bSpeichernT = setTimeout(() => sichern("budget"), 400);
  zeichneBudgetUebersicht();
}
function zeichneBudget() {
  const box = $("#b-inhalt"); box.replaceChildren();
  if (!L.budget) L.budget = budgetVorlage();
  box.append(h("div", { id: "b-uebersicht", class: "stack", style: "gap:14px" }), budgetEditor());
  zeichneBudgetUebersicht();
}
function zeichneBudgetUebersicht() {
  const box = $("#b-uebersicht"); if (!box) return;
  box.replaceChildren();
  const b = L.budget, r = budgetRechnen(b);
  $("#b-eyebrow").textContent = "Monatsbudget · " + monatName(monatVon(heute()));
  if (!(r.ein > 0)) {
    box.appendChild(h("div", { class: "card" }, h("div", { class: "leer" }, h("span", { class: "bild" }, icon("budget")), h("b", null, "Euer Budget in 3 Schritten"),
      h("span", null, "1. Einnahmen eintragen · 2. feste und variable Kosten · 3. Rückstellungen und Sparen. Jährliche Rechnungen einfach als Jahresbetrag – die App rechnet auf den Monat um."),
      h("button", { type: "button", class: "btn primary", style: "margin-top:8px", onclick: () => { const d = $('details[data-gruppe="einnahmen"]'); d.open = true; d.scrollIntoView({ behavior: "smooth", block: "start" }); setTimeout(() => d.querySelector(".betrag").focus(), 350); } }, icon("stift"), "Mit den Einnahmen beginnen"))));
    return;
  }
  // 1. Was bleibt übrig?
  const plus = r.uebrig >= 0;
  box.appendChild(h("div", { class: "card stack" },
    h("div", { class: "hero" }, h("span", { class: "eyebrow" }, plus ? "Pro Monat übrig" : "Pro Monat fehlen"),
      h("div", { class: "zahl " + (plus ? "down" : "up") }, h("small", null, "CHF"), fmt0(Math.abs(r.uebrig))),
      h("p", { class: "small muted" }, !plus ? "Die geplanten Ausgaben sind höher als die Einnahmen. Unten siehst du, wo das meiste Geld hingeht." : r.spar > 0 ? `Nach allen Kosten, Rückstellungen und ${fmt0(r.spar)} fürs Sparen. Reserve für Unerwartetes – oder zusätzlich sparen.` : "Nach allen Kosten und Rückstellungen. Noch nichts fürs Sparen eingeplant – unten unter «Sparen & Vorsorge» eintragen.")),
    h("div", { class: "kacheln" },
      h("div", { class: "kachel" }, h("span", { class: "l" }, "Einnahmen"), h("span", { class: "v" }, fmt0(r.ein)), h("span", { class: "d" }, "pro Monat, netto")),
      h("div", { class: "kachel" }, h("span", { class: "l" }, "Ausgaben"), h("span", { class: "v" }, fmt0(r.aus)), h("span", { class: "d" }, `${Math.round(r.aus / r.ein * 100)} % der Einnahmen`)),
      h("div", { class: "kachel" }, h("span", { class: "l" }, "Sparen"), h("span", { class: "v" }, fmt0(r.spar)), h("span", { class: "d" }, `Sparquote ${Math.round(r.sparquote * 100)} %`))),
    einnahmenBalken(r)));
  // 2. Wohin das Geld geht
  const aus = B_GRUPPEN.filter(g => g.art !== "ein").map(g => [g, r.gruppen[g.id]]).filter(([, v]) => v > 0).sort((a, b2) => b2[1] - a[1]);
  if (aus.length) {
    const max = aus[0][1];
    box.appendChild(h("div", { class: "card" },
      h("div", { class: "card-kopf" }, h("div", { class: "titel-mit-ico" }, h("span", { class: "ico" }, icon("budget")), h("div", null, h("h3", null, "Wohin das Geld geht"), h("p", null, "Pro Monat und Anteil an den Einnahmen")))),
      h("div", { class: "balken-liste" }, aus.map(([g, v]) => h("div", { class: "bz" },
        h("div", { class: "lbl" }, h("span", { class: "kat klein kat-anderes" }, icon(g.icon)), h("span", { class: "t" }, g.name)),
        h("div", { class: "wert" }, `${fmt0(v)} · ${Math.round(v / r.ein * 100)} %`),
        h("div", { class: "spur" }, h("i", { style: `width:${(v / max * 100).toFixed(1)}%` })))))));
  }
  // 3. Wer zahlt was
  box.appendChild(personenKarte(r));
  // 4. Ist gegen Budget (aus der Haushaltskasse)
  box.appendChild(istKarte());
  // 5. Jahresplan
  box.appendChild(jahresKarte(r));
  // 6. Faustregeln
  box.appendChild(regelKarte(r));
}
// Ein Balken: Einnahmen = 100 %, aufgeteilt in Ausgaben, Sparen, übrig (eine Reihe, beschriftet)
function einnahmenBalken(r) {
  // Farben geprüft (Dataviz-Validator, hell und dunkel): Violett und Gelb; der Rest ist die neutrale Spur
  const teile = [["Ausgaben", r.aus, "var(--viz-aus)"], ["Sparen", r.spar, "var(--viz-spar)"], ["Übrig", Math.max(0, r.uebrig), "var(--track)"]].filter(t => t[1] > 0);
  const summe = teile.reduce((s, t) => s + t[1], 0) || 1;
  return h("div", { class: "stack", style: "gap:8px" },
    h("div", { style: "display:flex;gap:2px;height:14px;border-radius:5px;overflow:hidden", role: "img", "aria-label": teile.map(t => `${t[0]} ${fmt0(t[1])}`).join(", ") },
      teile.map(t => h("i", { style: `flex:${t[1] / summe};background:${t[2]}`, title: `${t[0]}: CHF ${fmt0(t[1])}` }))),
    h("div", { class: "row", style: "gap:14px" }, teile.map(t => h("span", { class: "row small", style: "gap:6px" }, h("i", { class: "dot", style: "background:" + t[2] + (t[0] === "Übrig" ? ";box-shadow:inset 0 0 0 1px var(--rule-strong)" : "") }), `${t[0]} ${Math.round(t[1] / r.ein * 100)} %`))));
}
function personenKarte(r) {
  const seg = segBauen(h("div", { class: "seg klein", role: "group", "aria-label": "Gemeinsame Kosten teilen" }), [["einkommen", "nach Einkommen"], ["haelfte", "50 / 50"]], L.budget.aufteilung, v => { L.budget.aufteilung = v; budgetGeaendert(); });
  return h("div", { class: "card stack" },
    h("div", { class: "card-kopf", style: "margin-bottom:0" }, h("div", { class: "titel-mit-ico" }, h("span", { class: "ico" }, icon("person")), h("div", null, h("h3", null, "Wer zahlt was"), h("p", null, `Gemeinsame Kosten ${fmt0(r.gemeinsam)} pro Monat`)))),
    h("div", { class: "row" }, h("span", { class: "small muted", style: "font-weight:600" }, "Gemeinsames teilen"), seg),
    h("div", { class: "zeile2" }, PERSONEN.map((p, i) => { const x = r.person[p]; return h("div", { class: "person" },
      h("div", { class: "kopf" }, h("span", { class: "avatar" + (i ? " e" : "") }, p[0]), h("b", null, p), h("span", { class: "pill", style: "margin-left:auto" }, `${Math.round(r.anteil[p] * 100)} %`)),
      h("div", { class: "kv" }, h("span", null, "Einnahmen"), h("b", null, fmt0(x.ein))),
      h("div", { class: "kv" }, h("span", null, "Gemeinsames"), h("b", null, "− " + fmt0(x.anteil))),
      h("div", { class: "kv" }, h("span", null, "Eigenes"), h("b", null, "− " + fmt0(x.eigen))),
      h("hr", { class: "perfo" }),
      h("div", { class: "kv gross" }, h("span", null, "Frei"), h("b", { class: x.frei >= 0 ? "down" : "up" }, fmt0(x.frei))),
      h("div", { class: "notice", style: "padding:8px 10px;font-size:12.5px" }, h("span", null, "Aufs gemeinsame Konto ", h("b", { class: "mono", style: "white-space:nowrap" }, "CHF " + fmt0(r05(x.einzahlung))), " pro Monat"))); })));
}
function istKarte() {
  const ist = istDiesenMonat(), b = L.budget;
  const plan = link => b.posten.filter(p => p.link === link).reduce((s, p) => s + proMonat(p), 0);
  const d = new Date(), tage = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(), tag = d.getDate();
  const zeile = (titel, ico, wert, soll) => {
    const anteil = soll > 0 ? wert / soll : 0, erwartet = tag / tage;
    const st = soll > 0 ? (anteil > 1 ? "over" : anteil > erwartet + 0.1 ? "warn" : "") : "";
    return h("div", { class: "stack", style: "gap:6px" },
      h("div", { class: "row zwischen" }, h("span", { class: "row", style: "gap:8px;font-weight:650" }, h("span", { class: "kat klein kat-" + ico }, icon(ico === "fruechte" ? "topf" : "essen")), titel),
        h("span", { class: "mono small" }, `${fmt0(wert)} / ${soll > 0 ? fmt0(soll) : "–"}`)),
      soll > 0 ? h("div", { class: "meter " + st, role: "meter", "aria-valuemin": "0", "aria-valuemax": String(Math.round(soll)), "aria-valuenow": String(Math.round(wert)), "aria-label": titel }, h("i", { style: `width:${Math.min(100, anteil * 100).toFixed(1)}%` }), h("span", { class: "marke", style: `left:${(erwartet * 100).toFixed(1)}%`, title: "Heute" })) : h("p", { class: "tiny muted" }, "Im Budget unten einen Betrag eintragen, dann erscheint hier der Vergleich."),
      soll > 0 ? h("p", { class: "tiny muted" }, wert <= soll ? `Noch ${fmt0(soll - wert)} für ${tage - tag + 1} Tage – etwa ${fmt0((soll - wert) / (tage - tag + 1))} pro Tag.` : `${fmt0(wert - soll)} über dem Budget.`) : null);
  };
  const verlauf = ist.verlauf.filter(m => m.m !== monatVon(heute())).slice(-6);
  const schnitt = verlauf.length ? verlauf.reduce((s, m) => s + (Number(m.einkauf) || 0), 0) / verlauf.length : 0;
  return h("div", { class: "card stack" },
    h("div", { class: "card-kopf", style: "margin-bottom:0" }, h("div", { class: "titel-mit-ico" }, h("span", { class: "ico" }, icon("trend")), h("div", null, h("h3", null, "Diesen Monat: Ist und Budget"), h("p", null, ist.quelle.length ? "Aus " + ist.quelle.join(" und ") + " · Strich = heute" : "Stand aus der Haushaltskasse laden für die Ist-Werte")))),
    zeile("Lebensmittel", "gemuese", ist.einkauf, plan("einkauf")),
    zeile("Auswärts essen", "fruechte", ist.auswaerts, plan("auswaerts")),
    schnitt > 0 ? h("p", { class: "small muted" }, `Lebensmittel im Schnitt der letzten ${verlauf.length} Monate: `, h("b", { class: "mono", style: "color:var(--ink)" }, "CHF " + fmt0(schnitt)), plan("einkauf") > 0 ? ` – Budget ${schnitt > plan("einkauf") ? "eher knapp" : "passt"}.` : " – ein guter Startwert fürs Budget.") : null);
}
function jahresKarte(r) {
  const max = Math.max(...r.jahr.map(m => m.summe), r.jahresposten, 1);
  const detail = h("div", { class: "stack", style: "gap:6px" });
  const aktuell = new Date().getMonth();
  if (bMonatGewaehlt == null) bMonatGewaehlt = r.jahr.findIndex((m, i) => i >= aktuell && m.summe > 0);
  if (bMonatGewaehlt < 0) bMonatGewaehlt = aktuell;
  const zeigen = i => {
    bMonatGewaehlt = i;
    for (const [k, btn] of knoepfe.entries()) btn.classList.toggle("an", k === i);
    const m = r.jahr[i];
    detail.replaceChildren(h("div", { class: "row zwischen" }, h("b", null, MONATE[i]), h("span", { class: "mono" }, m.summe ? "CHF " + fmt0(m.summe) : "keine grossen Rechnungen")),
      ...m.posten.map(p => h("div", { class: "kv" }, h("span", null, p.name, h("span", { class: "muted small" }, ` · ${HAEUFIGKEIT[p.h][0]}`)), h("b", null, fmt0(p.betrag)))));
  };
  const knoepfe = r.jahr.map((m, i) => h("button", { type: "button", "aria-label": `${MONATE[i]}: CHF ${fmt0(m.summe)}`, onclick: () => zeigen(i) },
    h("i", { class: m.summe ? null : "nix", style: `height:${Math.max(2, m.summe / max * 118).toFixed(0)}px` }), h("span", null, MONATE_KURZ[i].slice(0, 1))));
  const linie = r.jahresposten > 0 ? h("div", { class: "linie", style: `bottom:${(r.jahresposten / max * 118 + 20).toFixed(0)}px` }, h("span", null, `${fmt0(r.jahresposten)}/Monat zurücklegen`)) : null;
  const card = h("div", { class: "card stack" },
    h("div", { class: "card-kopf", style: "margin-bottom:0" }, h("div", { class: "titel-mit-ico" }, h("span", { class: "ico" }, icon("kalender")), h("div", null, h("h3", null, "Jahresplan"), h("p", null, "Wann jährliche, halbjährliche und Quartalsrechnungen kommen. Monat antippen.")))),
    r.jahresposten > 0 ? h("div", { class: "jahr" }, knoepfe, linie) : h("p", { class: "hint" }, "Jährliche Posten (Steuern, Versicherungen, Serafe …) mit Fälligkeitsmonat eintragen – dann zeigt der Plan, wann das Geld weggeht."),
    r.jahresposten > 0 ? detail : null);
  if (r.jahresposten > 0) zeigen(bMonatGewaehlt);
  return card;
}
function regelKarte(r) {
  const regeln = [];
  const pz = x => Math.round(x * 100) + " %";
  if (r.miete > 0) { const q = r.miete / r.ein; regeln.push([q <= 0.33 ? "gut" : q <= 0.4 ? "warn" : "crit", `Miete: ${pz(q)} der Einnahmen`, "Faustregel: höchstens ein Drittel des Nettoeinkommens."]); }
  regeln.push([r.sparquote >= 0.1 ? "gut" : r.sparquote > 0 ? "warn" : "crit", `Sparquote: ${pz(r.sparquote)}`, "Faustregel: mindestens 10 % der Einnahmen auf die Seite legen."]);
  regeln.push([r.uebrig >= 0 ? "gut" : "crit", r.uebrig >= 0 ? `Budget geht auf (+${fmt0(r.uebrig)})` : `Budget geht nicht auf (−${fmt0(-r.uebrig)})`, r.uebrig >= 0 ? "Einnahmen decken alle geplanten Ausgaben und das Sparen." : "Ausgaben senken oder Sparbetrag anpassen."]);
  if (r.jahresposten > 0) regeln.push(["gut", `Für Jahresrechnungen ${fmt0(r.jahresposten)} pro Monat zurücklegen`, "Am besten per Dauerauftrag auf ein eigenes Konto – dann sind Steuern und Versicherungen kein Schock."]);
  const notgroschen = r.aus * 3;
  regeln.push(["gut", `Notgroschen: etwa ${fmt0(notgroschen)}`, "Faustregel: drei Monatsausgaben als Reserve auf dem Sparkonto."]);
  return h("div", { class: "card" },
    h("div", { class: "card-kopf" }, h("div", { class: "titel-mit-ico" }, h("span", { class: "ico" }, icon("haken")), h("div", null, h("h3", null, "Faustregeln"), h("p", null, "Grobe Richtwerte, keine Vorschriften")))),
    regeln.map(([st, titel, text]) => h("div", { class: "check" }, h("span", { class: "sym " + st }, icon(st === "gut" ? "haken" : "warn")), h("div", null, h("b", null, titel), h("p", null, text)))));
}

/* ---------- Bearbeiten ---------- */
function budgetEditor() {
  const card = h("div", { class: "card", id: "b-editor" },
    h("div", { class: "card-kopf" }, h("div", { class: "titel-mit-ico" }, h("span", { class: "ico" }, icon("stift")), h("div", null, h("h3", null, "Budget bearbeiten"), h("p", null, "Betrag und wie oft – die App rechnet auf den Monat um")))));
  for (const g of B_GRUPPEN) card.appendChild(gruppenEditor(g));
  card.appendChild(h("div", { class: "stack", style: "margin-top:16px" },
    h("button", { type: "button", class: "btn primary voll", onclick: budgetExcel }, icon("tabelle"), "Als Excel-Tabelle speichern"),
    h("p", { class: "hint" }, "Die Excel-Datei rechnet mit Formeln weiter – Beträge dort ändern, Summen passen sich an. Das Budget geht beim Abgleich auch an die Haushaltskasse und von dort auf Elianas Handy."),
    h("button", { type: "button", class: "btn ghost small", onclick: ev => { const btn = ev.currentTarget; if (!btn.dataset.sicher) { btn.dataset.sicher = "1"; btn.textContent = "Wirklich alle Beträge löschen?"; return; } L.budget = budgetVorlage(); sichern("budget"); zeichneBudget(); toast("Budget zurückgesetzt"); } }, "Budget zurücksetzen")));
  return card;
}
function gruppenEditor(g) {
  const summe = h("span", { class: "sum" });
  const posten = () => L.budget.posten.filter(p => p.g === g.id);
  const sumNeu = () => { summe.textContent = fmt0(posten().reduce((s, p) => s + proMonat(p), 0)); };
  const inhalt = h("div");
  const zeichne = () => { inhalt.replaceChildren(...posten().map(p => postenZeile(p, sumNeu, zeichne)), h("div", { style: "padding:8px 0 4px" }, h("button", { type: "button", class: "btn small soft", onclick: () => { const p = { id: uid(), g: g.id, name: "", betrag: 0, h: "m", wer: g.id === "einnahmen" ? L.ich : "gemeinsam", monat: 1, tipp: "", link: null }; L.budget.posten.push(p); zeichne(); budgetGeaendert(); setTimeout(() => { const el = $(`[data-posten="${p.id}"] .name`); if (el) el.focus(); }, 30); } }, icon("plus"), "Posten"))); sumNeu(); };
  zeichne();
  return h("details", { class: "b-gruppe", "data-gruppe": g.id },
    h("summary", null, h("span", { class: "kat kat-anderes" }, icon(g.icon)), h("span", { style: "min-width:0" }, h("span", { class: "t" }, g.name), h("br"), h("span", { class: "s" }, g.text)), summe, icon("runter", "dreh")),
    inhalt);
}
function postenZeile(p, sumNeu, neuZeichnen) {
  const mtl = h("span", { class: "mtl" });
  const zeigeMtl = () => { mtl.textContent = p.h === "m" || !(Number(p.betrag) > 0) ? "" : `= ${fmt0(proMonat(p))}/Monat`; row.classList.toggle("null", !(Number(p.betrag) > 0)); };
  const name = h("input", { type: "text", class: "name", value: p.name, placeholder: "Bezeichnung", "aria-label": "Bezeichnung", oninput: e => { p.name = e.target.value; budgetGeaendert(); } });
  const betrag = h("input", { type: "text", inputmode: "decimal", class: "betrag", value: Number(p.betrag) > 0 ? String(p.betrag) : "", placeholder: p.tipp && /\d/.test(p.tipp) ? p.tipp.replace(/^z\. B\. /, "") : "0", "aria-label": "Betrag " + p.name, oninput: e => { const v = zahl(e.target.value); p.betrag = v > 0 ? v : 0; zeigeMtl(); sumNeu(); budgetGeaendert(); } });
  const hf = h("select", { "aria-label": "Wie oft", onchange: e => { p.h = e.target.value; monat.hidden = !["j", "h", "q"].includes(p.h); zeigeMtl(); sumNeu(); budgetGeaendert(); } }, Object.entries(HAEUFIGKEIT).map(([k, [t]]) => h("option", { value: k }, t)));
  hf.value = p.h;
  const wer = h("select", { "aria-label": "Wer", onchange: e => { p.wer = e.target.value; budgetGeaendert(); } }, [["gemeinsam", "gemeinsam"], ...PERSONEN.map(x => [x, x])].map(([v, t]) => h("option", { value: v }, t)));
  wer.value = p.wer;
  const monat = h("select", { "aria-label": "Fällig im Monat", onchange: e => { p.monat = Number(e.target.value); budgetGeaendert(); } }, MONATE.map((m, i) => h("option", { value: String(i + 1) }, "fällig " + MONATE_KURZ[i])));
  monat.value = String(p.monat || 1); monat.hidden = !["j", "h", "q"].includes(p.h);
  const row = h("div", { class: "b-posten", "data-posten": p.id }, name, betrag,
    h("button", { type: "button", class: "icon-btn", "aria-label": "Posten entfernen", onclick: () => { L.budget.posten = L.budget.posten.filter(x => x !== p); neuZeichnen(); budgetGeaendert(); } }, icon("x")),
    h("div", { class: "opt" }, hf, wer, monat, p.link ? h("span", { class: "pill acc" }, "Ist aus Haushaltskasse") : null, mtl));
  zeigeMtl();
  return row;
}
async function budgetExcel() {
  try {
    const r = budgetRechnen(L.budget);
    const blob = Excel.budgetMappe(L.budget, r, { personen: PERSONEN, gruppen: B_GRUPPEN, haeufigkeit: HAEUFIGKEIT, ist: istDiesenMonat(), monate: MONATE });
    const name = `Haushaltsbudget-${heute()}.xlsx`, url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: name }); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast("Excel-Datei gespeichert – liegt in «Downloads»");
  } catch (e) { console.error(e); toast("Die Excel-Datei liess sich nicht erstellen."); }
}
ZEICHNER.budget = zeichneBudget;
