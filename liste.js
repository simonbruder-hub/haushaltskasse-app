/* Kasse unterwegs – Einkaufsliste, «Wo einkaufen?», Vorrat */
"use strict";
function listeAlle() {
  const basis = (L.stand ? L.stand.liste : []).map(x => ({ key: x.id, text: x.text, quelle: x.quelle, erledigt: x.id in L.listeStatus ? L.listeStatus[x.id] : !!x.erledigt }));
  const neu = L.listeNeu.map(x => ({ key: x.pwaId, text: x.text, quelle: x.quelle, erledigt: !!L.listeStatus[x.pwaId], neu: true }));
  return [...basis, ...neu];
}
function listeOps() {
  const ops = [];
  for (const x of (L.stand ? L.stand.liste : [])) if (x.id in L.listeStatus && L.listeStatus[x.id] !== !!x.erledigt) ops.push({ op: "erledigt", id: x.id, text: x.text, erledigt: L.listeStatus[x.id] });
  for (const x of L.listeNeu) ops.push({ op: "neu", pwaId: x.pwaId, text: x.text, quelle: x.quelle, erledigt: !!L.listeStatus[x.pwaId] });
  return ops;
}
const aufListe = name => listeAlle().some(l => !l.erledigt && schluessel(l.text).includes(schluessel(name)));

function zeichneListe() {
  const d = new Date();
  $("#liste-datum").textContent = WOCHENTAGE[d.getDay()] + ", " + datumLang(heute());
  const box = $("#l-items"); box.replaceChildren();
  const alle = listeAlle(), offen = alle.filter(l => !l.erledigt), erledigt = alle.filter(l => l.erledigt);
  // Fortschrittsring
  const anteil = alle.length ? erledigt.length / alle.length : 0, umfang = 2 * Math.PI * 27;
  $("#ring-fg").setAttribute("stroke-dasharray", umfang.toFixed(1)); $("#ring-fg").setAttribute("stroke-dashoffset", (umfang * (1 - anteil)).toFixed(1));
  $("#liste-sub").textContent = alle.length ? `${offen.length} offen · ${erledigt.length} erledigt` : "Noch nichts auf der Liste";
  if (!alle.length) { box.appendChild(h("div", { class: "leer" }, h("span", { class: "bild" }, icon("liste")), h("b", null, "Die Liste ist leer"), "Oben eintragen – oder in der Haushaltskasse Vorschläge übernehmen.")); zeichneTipp([]); return; }
  // Offenes nach Warengruppe, Erledigtes zuletzt
  const info = l => { const e = Produkte.erkennen(l.text); return { ...l, kat: e.kat, p: produktZuText(l.text) }; };
  const offenInfo = offen.map(info);
  for (const k of Produkte.KATEGORIEN) {
    const items = offenInfo.filter(l => l.kat === k.id);
    if (!items.length) continue;
    box.appendChild(h("div", { class: "li-gruppe" }, h("h4", null, katSymbol(k.id, true), k.name, h("span", { class: "n" }, String(items.length))), items.map(listeZeile)));
  }
  if (erledigt.length) box.appendChild(h("div", { class: "li-gruppe" }, h("h4", null, h("span", { class: "kat klein kat-anderes" }, icon("haken")), "Erledigt", h("span", { class: "n" }, String(erledigt.length))), erledigt.map(l => listeZeile({ ...l, p: null }))));
  zeichneTipp(offenInfo);
}
function listeZeile(l) {
  const cb = h("input", { type: "checkbox", "aria-label": l.text, onchange: async ev => {
    L.listeStatus[l.key] = ev.target.checked;
    const geaendert = ["listeStatus"];
    if (ev.target.checked) for (const v of (L.stand ? L.stand.vorrat : [])) { const st = L.vorratStatus[v.id] || v.status; if (st !== "genug" && schluessel(l.text).includes(schluessel(v.name))) { L.vorratStatus[v.id] = "genug"; geaendert.push("vorratStatus"); } }
    await sichern(...new Set(geaendert)); zeichneListe(); zeichneVorrat();
  } });
  cb.checked = !!l.erledigt;
  const best = l.p && l.p.laeden.length ? l.p.laeden[0] : null;
  return h("label", { class: "li" + (l.erledigt ? " done" : "") }, cb,
    h("div", { style: "min-width:0" }, h("div", { class: "t" }, l.text),
      !l.erledigt && best ? h("div", { class: "s" }, h("i", { class: "dot", style: "background:" + ladenFarbe(best.laden) }), l.p.laeden.length > 1 ? "am günstigsten bei " : "zuletzt bei ", h("b", { style: "color:var(--ink-2)" }, best.laden), h("span", { class: "mono" }, fmt(best.last.gp) + "/" + best.last.gpE)) : null),
    l.neu ? h("span", { class: "pill acc" }, "neu") : l.quelle ? h("span", { class: "tag" }, l.quelle) : h("span"));
}
// Welcher Laden ist für die offene Liste am günstigsten?
function zeichneTipp(offenInfo) {
  const card = $("#tipp-card"), box = $("#tipp"); box.replaceChildren();
  const bekannt = offenInfo.filter(l => l.p && l.p.laeden.length > 1);
  card.hidden = !bekannt.length;
  if (!bekannt.length) return;
  const zaehl = new Map();
  for (const l of bekannt) { const b = l.p.laeden[0].laden; if (!zaehl.has(b)) zaehl.set(b, []); zaehl.get(b).push(l); }
  const rang = Array.from(zaehl).sort((a, b) => b[1].length - a[1].length);
  const max = rang[0][1].length;
  $("#tipp-sub").textContent = `${bekannt.length} von ${offenInfo.length} offenen Artikeln haben Preise aus mehreren Läden`;
  box.appendChild(h("div", { class: "balken-liste" }, rang.map(([laden, items], i) => h("div", { class: "bz" + (i === 0 ? " aktiv" : "") },
    h("div", { class: "lbl" }, h("i", { class: "dot", style: "background:" + ladenFarbe(laden) }), h("span", { class: "t" }, laden)),
    h("div", { class: "wert text" }, `${items.length} ${items.length === 1 ? "Artikel" : "Artikel"} am günstigsten`),
    h("div", { class: "spur" }, h("i", { style: `width:${(items.length / max * 100).toFixed(1)}%;background:${ladenFarbe(laden)}` })),
    h("div", { class: "small muted", style: "grid-column:1/-1" }, items.map(l => l.text).join(" · "))))));
  const [ersterLaden, erste] = rang[0];
  box.appendChild(h("p", { class: "notice ok", style: "margin-top:14px" }, icon("info"), h("span", null, h("b", null, ersterLaden), ` ist für ${erste.length} von ${bekannt.length} vergleichbaren Artikeln am günstigsten – gemessen am Grundpreis (pro kg, l oder Stück) eurer letzten Einkäufe.`)));
}
async function listeHinzu(texte, quelle) {
  let n = 0;
  for (const t of texte) { if (aufListe(t)) continue; L.listeNeu.push({ pwaId: uid(), text: t, quelle: quelle || "Handy" }); n++; }
  if (n && await sichern("listeNeu")) { zeichneListe(); zeichneVorrat(); toast(n === 1 ? "Auf der Liste" : n + " auf der Liste"); }
}
$("#l-form").addEventListener("submit", ev => { ev.preventDefault(); const t = $("#l-neu").value.trim(); if (!t) return; listeHinzu([t], "Handy"); $("#l-neu").value = ""; });

/* ---------- Vorrat ---------- */
function vorratOps() {
  const ops = [];
  for (const v of (L.stand ? L.stand.vorrat : [])) if (v.id in L.vorratStatus && L.vorratStatus[v.id] !== v.status) ops.push({ op: "status", id: v.id, name: v.name, status: L.vorratStatus[v.id] });
  return ops;
}
const ORT_KAT = { "Vorratsschrank": "vorrat", "Kühlschrank": "milch", "Tiefkühler": "tk", "Früchte & Gemüse": "gemuese" };
function zeichneVorrat() {
  const box = $("#vr-liste"); box.replaceChildren();
  const vr = L.stand ? L.stand.vorrat : [];
  if (!vr.length) { box.appendChild(h("div", { class: "leer" }, h("span", { class: "bild" }, icon("vorrat")), L.stand ? "Im Stand ist kein Vorrat erfasst." : "Kommt mit dem Stand aus der Haushaltskasse.")); return; }
  for (const ort of ORTE) {
    const items = vr.filter(v => (ORTE.includes(v.ort) ? v.ort : "Vorratsschrank") === ort);
    if (!items.length) continue;
    const knapp = items.filter(v => (L.vorratStatus[v.id] || v.status) !== "genug").length;
    box.appendChild(h("div", { class: "li-gruppe" }, h("h4", null, katSymbol(ORT_KAT[ort], true), ort, h("span", { class: "n" }, knapp ? `${knapp} knapp/leer · ${items.length}` : String(items.length))), items.map(v => {
      const st = L.vorratStatus[v.id] || v.status || "genug";
      const seg = h("div", { class: "seg klein", role: "group", "aria-label": "Bestand " + v.name }, [["genug", "Genug"], ["knapp", "Knapp"], ["leer", "Leer"]].map(([k, t]) => h("button", { type: "button", "data-v": k, "aria-pressed": String(st === k), onclick: async () => { L.vorratStatus[v.id] = k; await sichern("vorratStatus"); zeichneVorrat(); zeichneListe(); } }, t)));
      const istAufListe = aufListe(v.name);
      return h("div", { class: "vr" },
        h("div", { style: "min-width:0" }, h("span", { class: "nm" }, v.name), h("div", { class: "sub" }, v.menge ? h("span", null, v.menge) : null, v.mhd ? h("span", null, "haltbar bis " + datumKurz(v.mhd)) : null)),
        st !== "genug" && istAufListe ? h("span", { class: "pill acc" }, icon("haken"), "auf der Liste") : h("span"),
        h("div", { class: "akt" }, seg, st !== "genug" && !istAufListe ? h("button", { type: "button", class: "btn small soft", onclick: () => listeHinzu([v.name], "Vorrat") }, icon("plus"), "Auf die Liste") : null));
    })));
  }
}
ZEICHNER.liste = () => { zeichneListe(); zeichneVorrat(); };
