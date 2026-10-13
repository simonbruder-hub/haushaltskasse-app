/* Kasse unterwegs – Preise nachschlagen, Preis notieren, Vergleichstabelle */
"use strict";
let prKat = "alle";
function zeichnePreise() {
  const box = $("#pr-liste"); box.replaceChildren();
  const alle = produkte(), q = schluessel($("#pr-suche").value);
  const laeden = new Set(alle.flatMap(p => p.laeden.map(l => l.laden)));
  $("#pr-eyebrow").textContent = alle.length ? `${alle.length} Produkte · ${laeden.size} ${laeden.size === 1 ? "Laden" : "Läden"}` : "Preise je Laden";
  // Filter nach Warengruppe
  const kats = Produkte.KATEGORIEN.filter(k => alle.some(p => p.kat === k.id));
  const chips = $("#pr-kats"); chips.replaceChildren();
  chips.hidden = kats.length < 2;
  chips.appendChild(h("button", { type: "button", class: "chip", "aria-pressed": String(prKat === "alle"), onclick: () => { prKat = "alle"; zeichnePreise(); } }, "Alle"));
  for (const k of kats) chips.appendChild(h("button", { type: "button", class: "chip", "aria-pressed": String(prKat === k.id), onclick: () => { prKat = k.id; zeichnePreise(); } }, icon(k.icon), k.name));
  if (!alle.length) { box.appendChild(h("div", { class: "leer" }, h("span", { class: "bild" }, icon("tag")), h("b", null, "Noch keine Preise"), "Unter «Abgleich» den Stand aus der Haushaltskasse laden, eine Quittung fotografieren – oder unten einen Preis notieren.")); return; }
  const liste = alle.filter(p => (prKat === "alle" || p.kat === prKat) && (!q || p.key.includes(q) || schluessel(KAT(p.kat).name).includes(q))).slice(0, 150);
  if (!liste.length) { box.appendChild(h("p", { class: "hint", style: "padding:10px 0" }, "Kein Produkt gefunden.")); return; }
  for (const p of liste) box.appendChild(produktKarte(p));
}
function produktKarte(p) {
  const best = p.laeden[0], max = Math.max(...p.laeden.map(l => l.last.gp));
  const bio = Produkte.istBio(p.name);
  return h("div", { class: "produkt" },
    h("div", { class: "kopf" }, katSymbol(p.kat),
      h("div", { style: "min-width:0" }, h("div", { class: "nm" }, Produkte.ohneBio(p.name), bio ? h("span", { class: "pill gut", style: "margin-left:7px" }, "Bio") : null),
        h("div", { class: "sub" }, `${KAT(p.kat).name} · ${p.laeden.length} ${p.laeden.length === 1 ? "Laden" : "Läden"} · zuletzt ${datumKurz(p.last.datum)}`)),
      h("div", { class: "rechts" }, h("div", { class: "mono", style: "font-size:17px" }, fmt(best.last.gp)), h("div", { class: "tiny muted" }, "pro " + best.last.gpE))),
    p.laeden.map((l, i) => {
      const d = l.prev ? (l.last.gp - l.prev.gp) / l.prev.gp : 0;
      return h("div", { class: "pl" + (i === 0 && p.laeden.length > 1 ? " best" : ""), title: `${l.laden}: ${fmt(l.last.gp)} pro ${l.last.gpE} am ${datumKurz(l.last.datum)}` },
        h("span", { class: "ld" }, h("i", { class: "dot", style: "background:" + ladenFarbe(l.laden) }), l.laden),
        h("span", { class: "spur" }, h("i", { style: `width:${Math.max(4, l.last.gp / max * 100).toFixed(1)}%;background:${ladenFarbe(l.laden)}` })),
        h("span", { class: "p" }, fmt(l.last.gp)),
        h("span", { class: "dat" }, i === 0 && p.laeden.length > 1 ? h("span", { class: "pill gut" }, icon("haken"), "günstigster") : null, datumKurz(l.last.datum), Math.abs(d) >= 0.005 ? aenderung(d) : null));
    }));
}
$("#pr-suche").addEventListener("input", zeichnePreise);
$("#pr-laden").replaceChildren(...[...LAEDEN, "Andere"].map(l => h("option", { value: l }, l)));
$("#pr-einheit").replaceChildren(...EINHEITEN.map(e => h("option", { value: e }, e || "–")));
function prVergleich() {
  const name = $("#pr-name").value.trim(), preis = zahl($("#pr-preis").value), box = $("#pr-vergleich"); box.replaceChildren();
  if (!name || !(preis > 0)) return;
  const menge = zahl($("#pr-menge").value);
  const p = vergleichPanel([{ n: name, p: preis, q: menge > 0 ? menge : null, e: $("#pr-einheit").value || null }], $("#pr-laden").value, heute(), null);
  if (p) box.appendChild(p);
}
for (const id of ["#pr-name", "#pr-preis", "#pr-menge", "#pr-einheit", "#pr-laden"]) $(id).addEventListener(id.includes("einheit") || id.includes("laden") ? "change" : "input", prVergleich);
$("#pr-form").addEventListener("submit", async ev => {
  ev.preventDefault();
  const name = $("#pr-name").value.trim(), preis = zahl($("#pr-preis").value), menge = zahl($("#pr-menge").value);
  if (!name || !(preis > 0)) { toast("Bitte Produkt und Preis eintragen."); return; }
  L.preise.push({ pwaId: uid(), name, laden: $("#pr-laden").value, preis: rund(preis), menge: menge > 0 ? menge : null, einheit: $("#pr-einheit").value || null, datum: heute() });
  if (await sichern("preise")) { toast("Preis notiert"); $("#pr-form").reset(); $("#pr-vergleich").replaceChildren(); $("#pr-mehr").open = false; zeichnePreise(); zeichneStand(); }
});

// Vergleich gegen frühere Preise: zuerst nur Auffälliges, der Rest auf Wunsch
function vergleichPanel(artikel, laden, datum, ohnePwaId) {
  const v = vergleiche(artikel, laden, datum, ohnePwaId);
  if (!v.length) return null;
  const vz = x => (x >= 0 ? "+" : "−") + fmt(Math.abs(x));
  const t = v.filter(x => x.status === "teurer"), g = v.filter(x => x.status === "guenstiger"), n = v.filter(x => x.status === "neu"), b = v.filter(x => x.besser);
  const rang = x => ({ teurer: 0, guenstiger: 2, anders: 3, neu: 4, gleich: 5 }[x.status] - (x.besser ? 0.5 : 0));
  const sortiert = v.slice().sort((a, b2) => rang(a) - rang(b2)), tabelle = vergleichTabelle(sortiert);
  const panel = h("div", { class: "stack", style: "gap:10px" },
    h("div", { class: "row", style: "gap:8px" }, h("span", { class: "kat klein kat-anderes" }, icon("trend")), h("b", null, "Preisvergleich" + (laden ? " · " + laden : ""))),
    h("div", { class: "chips" },
      t.length ? h("span", { class: "pill crit" }, `▲ ${t.length} teurer · ${vz(t.reduce((s, x) => s + x.diffChf, 0))}`) : null,
      g.length ? h("span", { class: "pill gut" }, `▼ ${g.length} günstiger · ${vz(g.reduce((s, x) => s + x.diffChf, 0))}`) : null,
      b.length ? h("span", { class: "pill warn" }, `${b.length} anderswo günstiger · ${vz(b.reduce((s, x) => s + x.sparChf, 0))}`) : null,
      n.length ? h("span", { class: "pill acc" }, `${n.length} neu`) : null,
      !t.length && !g.length && !b.length ? h("span", { class: "pill" }, L.stand ? "keine Preisänderungen" : "Stand laden für den Vergleich") : null),
    tabelle);
  const unwichtig = x => (x.status === "neu" || x.status === "gleich") && !x.besser;
  const zeilen = $$("tbody tr", tabelle), versteckt = v.length > 8 ? zeilen.filter((tr, i) => unwichtig(sortiert[i])) : [];
  if (!versteckt.length) return panel;
  for (const tr of versteckt) tr.hidden = true;
  if (versteckt.length === zeilen.length) tabelle.hidden = true;
  const knopf = h("button", { type: "button", class: "btn small", onclick: () => { for (const tr of versteckt) tr.hidden = false; tabelle.hidden = false; knopf.remove(); } }, `Alle ${v.length} Artikel zeigen`);
  panel.appendChild(h("div", null, knopf));
  return panel;
}
function vergleichTabelle(sortiert) {
  return h("div", { class: "tbl-wrap" }, h("table", null,
    h("thead", null, h("tr", null, h("th", null, "Artikel"), h("th", { class: "r" }, "Jetzt"), h("th", { class: "r" }, "Letztes Mal"), h("th", { class: "r" }, "Änderung"), h("th", null, "Anderswo"))),
    h("tbody", null, sortiert.map(x => h("tr", { class: "vg-" + x.status },
      h("td", null, x.a.n), h("td", { class: "r" }, fmt(x.gp) + "/" + x.gpE),
      h("td", { class: "r" }, x.vorher ? `${fmt(x.vorher.gp)} · ${datumKurz(x.vorher.datum)}` : "–"),
      h("td", { class: "r" }, x.status === "neu" ? h("span", { class: "pill acc" }, "neu") : x.d == null ? h("span", { class: "muted small" }, "erstmals hier") : Math.abs(x.d) < 0.005 ? h("span", { class: "muted" }, "gleich") : aenderung(x.d)),
      h("td", null, x.besser ? h("span", { class: "row", style: "gap:5px;flex-wrap:nowrap" }, h("i", { class: "dot", style: "background:" + ladenFarbe(x.besser.laden) }), `${x.besser.laden} ${fmt(x.besser.gp)}`) : ""))))));
}
ZEICHNER.preise = zeichnePreise;
