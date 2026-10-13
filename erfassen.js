/* Kasse unterwegs – Erfassen: Quittung auslesen, Artikel einem Produkt zuordnen, prüfen, speichern; Gekocht */
"use strict";

/* ---------- Quittung scannen und auf dem Handy auslesen ---------- */
// Jede Seite: Originalfoto (roh) + Ecken → zugeschnittenes, entzerrtes Bild (orig, für Texterkennung und Ablage)
// + verkleinerte Kopie (blob, für «Claude liest später»). Text und Wortpositionen bleiben an der Seite.
const Q = { fotos: [], wer: "Simon", teil: "geteilt", laeuft: false, stopp: false };
const MAX_SEITEN = 8;
async function verkleinern(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const f = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * f); c.height = Math.round(bmp.height * f);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(b => r(b || file), "image/jpeg", 0.82));
  } catch (e) { return file; }
}
function zeichneQFotos() {
  const box = $("#q-fotos"); box.replaceChildren(); box.hidden = !Q.fotos.length;
  Q.fotos.forEach((f, i) => box.appendChild(h("div", { class: "foto" },
    h("button", { type: "button", class: "foto-knopf", "aria-label": `Teil ${i + 1} zuschneiden`, onclick: () => qBearbeiten(f) }, h("img", { src: f.url, alt: "Teil " + (i + 1) }), h("span", { class: "nr" }, String(i + 1)), h("span", { class: "stift" }, icon("stift"))),
    h("button", { type: "button", class: "weg", "aria-label": "Teil " + (i + 1) + " entfernen", onclick: () => qWeg(f) }, "×"))));
  $("#q-scan-txt").textContent = Q.fotos.length ? "Weiteren Teil scannen" : "Scannen";
  $("#q-speichern").disabled = !Q.fotos.length;
  $("#q-zone").classList.toggle("kompakt", !!Q.fotos.length);
}
async function seiteHinzu(s) {
  const klein = await verkleinern(s.blob);
  Q.fotos.push({ id: uid(), roh: s.roh, ecken: s.ecken, modus: s.modus, drehung: s.drehung || 0, orig: s.blob, blob: klein, url: URL.createObjectURL(klein), breite: s.breite, hoehe: s.hoehe, scan: true, text: null, fehler: false });
}
function qScannen() {
  if (Q.fotos.length >= MAX_SEITEN) { toast(`Höchstens ${MAX_SEITEN} Teile pro Quittung.`); return; }
  Scanner.oeffnen({ fertig: async seiten => { for (const s of seiten.slice(0, MAX_SEITEN - Q.fotos.length)) { await seiteHinzu(s); URL.revokeObjectURL(s.url); } zeichneQFotos(); entwurfBald(); qLesen(); } });
}
// Galerie oder Kamera-App: jedes Bild zuerst zuschneiden
async function qDateien(files) {
  for (const f of Array.from(files || [])) {
    if (Q.fotos.length >= MAX_SEITEN) { toast(`Höchstens ${MAX_SEITEN} Teile pro Quittung.`); break; }
    const s = await Scanner.zuschneiden(f);
    if (s) await seiteHinzu(s);
  }
  zeichneQFotos(); entwurfBald(); qLesen();
}
async function qBearbeiten(f) {
  if (Q.laeuft) qStopp();
  const s = await Scanner.zuschneiden(f.roh, { ecken: f.ecken, modus: f.modus, drehung: f.drehung });
  if (!s) { if (Q.fotos.some(x => x.text == null && !x.fehler)) qLesen(); return; }
  URL.revokeObjectURL(f.url);
  const klein = await verkleinern(s.blob);
  Object.assign(f, { ecken: s.ecken, modus: s.modus, drehung: s.drehung || 0, orig: s.blob, blob: klein, url: URL.createObjectURL(klein), breite: s.breite, hoehe: s.hoehe, text: null, woerter: null, fehler: false, gesichert: false });
  zeichneQFotos(); entwurfBald(); qLesen();
}
function qWeg(f) {
  URL.revokeObjectURL(f.url); Q.fotos = Q.fotos.filter(x => x !== f); zeichneQFotos(); entwurfBald();
  if (!Q.fotos.length) { if (Q.laeuft) qStopp(); qStatus(null); return; }
  if (!Q.laeuft) qAuswerten();
}
function qLeeren() {
  if (Q.laeuft) qStopp();
  for (const f of Q.fotos) URL.revokeObjectURL(f.url);
  Q.fotos = []; $("#q-notiz").value = ""; zeichneQFotos(); qStatus(null);
}
function qStopp() { Q.stopp = true; if (window.Bon) Bon.abbrechen(); }
$("#q-scan").addEventListener("click", qScannen);
$("#q-kamera").addEventListener("change", ev => { qDateien(ev.target.files); ev.target.value = ""; });
$("#q-galerie").addEventListener("change", ev => { qDateien(ev.target.files); ev.target.value = ""; });

function qStatus(art, text, nochmals) {
  const box = $("#q-status"); box.replaceChildren(); delete box.dataset.lauf;
  box.hidden = !art;
  if (!art) return;
  box.appendChild(h("div", { class: "notice " + art }, icon(art === "ok" ? "haken" : art === "fehler" ? "warn" : "info"),
    h("div", { style: "min-width:0;display:grid;gap:8px" }, h("div", null, text),
      nochmals ? h("div", null, h("button", { type: "button", class: "btn small", onclick: () => { for (const f of Q.fotos) f.fehler = false; qLesen(); } }, icon("sync"), "Nochmals auslesen")) : null)));
}
const PHASEN = { laden: "Texterkennung wird geladen", vorbereiten: "Foto wird aufbereitet", lesen: "Artikel und Preise werden gelesen" };
function qFortschritt(phase, p, nr, von, url) {
  const box = $("#q-status");
  if (!box.dataset.lauf) {
    box.replaceChildren(); box.hidden = false; box.dataset.lauf = "1";
    box.appendChild(h("div", { class: "lese" },
      h("div", { class: "vorschau" }, h("img", { id: "q-vorschau", alt: "" })),
      h("div", { style: "min-width:0" },
        h("div", { class: "titel", id: "q-phase" }),
        h("div", { class: "fortschritt", role: "progressbar", "aria-label": "Fortschritt", "aria-valuemin": "0", "aria-valuemax": "100", id: "q-balken" }, h("i")),
        h("div", { class: "row zwischen" }, h("span", { class: "pz", id: "q-prozent" }), h("button", { type: "button", class: "btn small ghost", onclick: qStopp }, "Abbrechen")),
        h("p", { class: "tiny muted", id: "q-tipp", style: "margin-top:4px" }))));
  }
  if (url && $("#q-vorschau").getAttribute("src") !== url) $("#q-vorschau").src = url;
  const anteil = phase === "laden" ? 0.04 * p : phase === "vorbereiten" ? 0.07 : 0.1 + 0.9 * p;
  const gesamt = Math.max(0, Math.min(1, ((nr - 1) + anteil) / von));
  $("#q-phase").textContent = PHASEN[phase] + (von > 1 ? ` · Foto ${nr}/${von}` : "") + " …";
  $("#q-prozent").textContent = Math.round(gesamt * 100) + " %";
  $("#q-balken").setAttribute("aria-valuenow", String(Math.round(gesamt * 100)));
  $("#q-balken").firstChild.style.width = (gesamt * 100).toFixed(1) + "%";
  $("#q-tipp").textContent = phase === "laden" ? "Beim ersten Mal einmalig rund 5 MB, danach auch offline." : "Etwa eine halbe Minute pro Foto. Die App kann offen bleiben.";
}
async function qLesen() {
  if (Q.laeuft || !Q.fotos.length) return;
  if (!window.Bon || !window.Tesseract) { qStatus("fehler", "Die Texterkennung ist noch nicht auf dem Handy. Die App einmal mit Internet öffnen – oder unten von Hand erfassen."); return; }
  Q.laeuft = true; Q.stopp = false;
  let abgebrochen = false;
  try {
    let f;
    while (!Q.stopp && (f = Q.fotos.find(x => x.text == null && !x.fehler))) {
      const foto = f, nr = () => Math.max(1, Q.fotos.indexOf(foto) + 1);
      qFortschritt("laden", 0, nr(), Q.fotos.length, foto.url);
      const melden = (ph, p) => { if (!Q.stopp) qFortschritt(ph, p, nr(), Q.fotos.length, foto.url); };
      const merken = () => { const l = Bon.letzte(); foto.woerter = l ? l.woerter : []; foto.wB = l && l.breite; foto.wH = l && l.hoehe; entwurfBald(); };
      try { foto.text = await Bon.bildText(foto.orig, melden, { zuschneiden: !foto.scan }); merken(); }
      catch (e) {
        if (e && e.abgebrochen) { abgebrochen = true; break; }
        try { foto.text = await Bon.bildText(foto.blob, melden, { zuschneiden: !foto.scan }); merken(); }
        catch (e2) { if (e2 && e2.abgebrochen) { abgebrochen = true; break; } foto.fehler = true; }
      }
    }
  } finally { Q.laeuft = false; }
  if (abgebrochen || Q.stopp) { Q.stopp = false; if (Q.fotos.length) qStatus("info", "Auslesen abgebrochen.", true); return; }
  qAuswerten();
}
function qAuswerten() {
  const texte = Q.fotos.filter(f => f.text != null).map(f => f.text), fehler = Q.fotos.filter(f => f.fehler).length;
  if (!texte.length) { qStatus("fehler", "Das Foto liess sich nicht lesen. Bitte nochmals gerade, nah und hell fotografieren – oder unten von Hand erfassen.", true); return; }
  let r = null; try { r = Bon.ausTexten(texte); } catch (e) { r = null; }
  if (!r || !r.artikel.length) { qStatus("fehler", "Auf dem Foto wurden keine Artikel gefunden. Die ganze Quittung gerade und scharf fotografieren – oder unten von Hand erfassen.", true); return; }
  formAusBon(r);
  const pruefen = F.artikel.filter(a => a.pruefen).length;
  qStatus("ok", h("span", null, h("b", null, `${r.artikel.length} Artikel gelesen. `), pruefen ? `${pruefen} gelb markierte ${pruefen === 1 ? "Zeile" : "Zeilen"} mit dem Bon vergleichen, dann speichern.` : "Kurz kontrollieren, dann speichern.", fehler ? ` ${fehler === 1 ? "Ein Foto" : fehler + " Fotos"} liess sich nicht lesen.` : ""));
  setTimeout(() => $("#bon-ansicht").scrollIntoView({ behavior: "smooth", block: "start" }), 150);
}

/* ---------- Bon-Text → Produkt (gelernt, aus der Haushaltskasse, Katalog) ---------- */
const bonKey = t => Produkte.norm(t);
function zeichenpaare(t) { const s = " " + t + " ", m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; }
function aehnlich(a, b) {
  const A = zeichenpaare(a), B = zeichenpaare(b); let gleich = 0, na = 0, nb = 0;
  for (const v of A.values()) na += v; for (const v of B.values()) nb += v;
  for (const [g, v] of A) gleich += Math.min(v, B.get(g) || 0);
  return 2 * gleich / ((na + nb) || 1);
}
function namenFinder() {
  const bon = new Map();
  const bn = L.stand && L.stand.bonNamen;
  if (bn && typeof bn === "object") for (const [b, n] of Object.entries(bn)) if (b && n) bon.set(bonKey(b), typeof n === "string" ? { n } : n);
  for (const e of L.eintraege) for (const a of e.artikel || []) if (a.b && a.n) bon.set(bonKey(a.b), { n: a.n });
  for (const [k, z] of Object.entries(L.zuordnung || {})) bon.set(k, z);
  return b => {
    const k = bonKey(b); if (!k) return null;
    if (bon.has(k)) return { ...bon.get(k), quelle: "gelernt" };
    let best = null, w = 0;
    for (const [kk, z] of bon) { const x = aehnlich(k, kk); if (x > w) { w = x; best = z; } }
    return w >= 0.78 ? { ...best, quelle: "gelernt" } : null;
  };
}
const gText = g => g ? `${String(g.q).replace(".", ".")} ${g.e}` : "";
function zuArtikel(a, finder) {
  const gel = finder(a.b), erk = Produkte.erkennen(a.b);
  let n = gel ? gel.n : erk.name ? Produkte.mitBio(erk.name, erk.bio) : "";
  const kat = Produkte.kategorieVon(n || a.b);
  let anzahl = 1, packung = "", gewogen = false;
  if (a.e === "kg" && a.q) { packung = gText({ q: a.q, e: "kg" }); gewogen = true; }
  else {
    if (a.e === "Stk" && a.q > 1) anzahl = a.q;
    const g = (gel && gel.g) || erk.groesse;
    if (g) packung = gText(g);
  }
  return { id: uid(), n, b: a.b, kat, p: a.fehlt ? null : a.p, r: a.r || 0, anzahl, packung, gewogen, pruefen: !!(a.unsicher || a.fehlt), fehlt: !!a.fehlt, zugeordnet: !!n, quelle: gel ? "gelernt" : erk.name ? "katalog" : "" };
}

/* ---------- Formular «Prüfen & speichern» ---------- */
const F = { typ: "einkauf", laden: "Migros", wer: "Simon", teil: "allein", teilBeruehrt: false, ausBon: false, artikel: [], bon: null };
function ladenChips() {
  const box = $("#f-laden"); box.replaceChildren();
  for (const l of [...LAEDEN, "Andere"]) {
    const aktiv = l === "Andere" ? !LAEDEN.includes(F.laden) : F.laden === l;
    box.appendChild(h("button", { type: "button", class: "chip", "aria-pressed": String(aktiv), onclick: () => { F.laden = l === "Andere" ? $("#f-laden-andere").value.trim() : l; ladenChips(); fAktualisieren(); } }, l !== "Andere" ? h("i", { class: "dot", style: "background:" + ladenFarbe(l) }) : null, l));
  }
  $("#f-laden-andere").hidden = LAEDEN.includes(F.laden);
}
$("#f-laden-andere").addEventListener("input", e => { F.laden = e.target.value.trim(); fAktualisieren(); });
function fTyp(v) { F.typ = v; $("#f-laden-wrap").hidden = v !== "einkauf"; $("#f-resto-wrap").hidden = v !== "auswaerts"; $("#f-art-wrap").hidden = v !== "einkauf"; fAktualisieren(); }

// Artikel → gespeichertes Format { n, b, p, r, q, e }
function artikelDaten(a) {
  const g = Produkte.groesse(a.packung), anzahl = Number(a.anzahl) > 0 ? Number(a.anzahl) : 1;
  let q = null, e = null;
  if (g) { q = Math.round(anzahl * g.q * 1000) / 1000; e = g.e; }
  else if (anzahl > 1) { q = anzahl; e = "Stk"; }
  const d = { n: (a.n || a.b || "").trim(), q, e, p: Number(a.p) > 0 ? rund(Number(a.p)) : null, r: Number(a.r) > 0 ? rund(Number(a.r)) : 0 };
  if (a.b) d.b = a.b;
  return d;
}
function artLesen() { return F.artikel.map(artikelDaten).filter(a => a.n && a.p != null); }

function zeichneArtikel() {
  const box = $("#f-artikel"); box.replaceChildren();
  if (!F.artikel.length) { box.appendChild(h("p", { class: "hint", style: "padding:6px 0" }, "Optional: Artikel erfassen für den Preisvergleich.")); return; }
  const gruppen = F.ausBon ? Produkte.KATEGORIEN.map(k => [k, F.artikel.filter(a => a.kat === k.id)]).filter(([, a]) => a.length) : [[null, F.artikel]];
  for (const [k, arts] of gruppen) {
    const g = h("div", { class: "art-gruppe" });
    if (k) g.appendChild(h("h4", null, katSymbol(k.id, true), k.name, h("span", { class: "n", "data-kat-summe": k.id })));
    for (const a of arts) g.appendChild(artZeile(a));
    box.appendChild(g);
  }
  fAktualisieren();
}
function artZeile(a) {
  const preis = h("input", { type: "text", inputmode: "decimal", placeholder: a.fehlt ? "Preis?" : "0.00", "aria-label": "Preis CHF", value: Number(a.p) > 0 ? Number(a.p).toFixed(2) : "" });
  const anzahl = h("input", { type: "text", inputmode: "numeric", "aria-label": "Anzahl", value: String(a.anzahl || 1) });
  const packung = h("input", { type: "text", "aria-label": "Packungsgrösse", placeholder: a.gewogen ? "Gewicht" : "Packung, z. B. 500 g", value: a.packung || "" });
  const gp = h("span", { class: "gp" }), badge = h("span", { class: "vg-zeile" });
  const row = h("div", { class: "art" + (a.pruefen ? " pruefen" : ""), "data-id": a.id });
  const ok = () => { a.pruefen = false; row.classList.remove("pruefen"); knopf && knopf.remove(); };
  const knopf = a.pruefen ? h("button", { type: "button", class: "pill warn ok-knopf", "aria-label": "Als geprüft markieren", onclick: ok }, a.fehlt ? "Preis fehlt" : "bitte prüfen", icon("haken")) : null;
  const prodKnopf = h("button", { type: "button", class: "prod", onclick: () => produktWaehlen(a), "aria-label": "Produkt wählen" }, katSymbol(a.kat, true),
    h("span", { class: "t" + (a.zugeordnet ? "" : " offen") }, a.n || "Produkt wählen"), icon("stift", "stift"));
  row.append(prodKnopf, h("div", { class: "preis" }, preis),
    h("div", { class: "mengen" }, anzahl, packung, gp),
    h("div", { class: "det" }, knopf,
      a.b && schluessel(a.b) !== schluessel(a.n) ? h("span", { class: "bonname" }, a.b) : null,
      a.quelle === "gelernt" ? h("span", { class: "pill acc" }, "gelernt") : null,
      Number(a.r) > 0 ? h("span", null, `Rabatt ${fmt(a.r)}`) : null,
      badge,
      h("button", { type: "button", class: "icon-btn", style: "margin-left:auto;width:32px;height:32px", "aria-label": "Artikel entfernen", onclick: () => { F.artikel = F.artikel.filter(x => x !== a); zeichneArtikel(); } }, icon("x"))));
  const neuRechnen = () => {
    const d = artikelDaten(a), g = d.p ? grundpreis(d.p + (d.r || 0), d.q, d.e) : null;
    gp.textContent = g ? `${fmt(g.wert)}/${g.einheit}` : "";
    badge.replaceChildren();
    if (F.typ === "einkauf" && d.p && d.n) {
      const v = vergleiche([d], F.laden, $("#f-datum").value || heute(), null)[0];
      if (v) {
        if (v.status === "teurer") badge.appendChild(h("span", { class: "pill crit" }, `▲ ${Math.round(v.d * 100)} % teurer`));
        else if (v.status === "guenstiger") badge.appendChild(h("span", { class: "pill gut" }, `▼ ${Math.abs(Math.round(v.d * 100))} % günstiger`));
        if (v.besser) badge.appendChild(h("span", { class: "pill warn" }, h("i", { class: "dot", style: "background:" + ladenFarbe(v.besser.laden) }), `${v.besser.laden} ${fmt(v.besser.gp)}`));
      }
    }
  };
  preis.addEventListener("input", () => { a.p = zahl(preis.value); if (a.p > 0 && a.fehlt) { a.fehlt = false; ok(); } neuRechnen(); fAktualisieren(); });
  anzahl.addEventListener("input", () => { a.anzahl = zahl(anzahl.value) || 1; neuRechnen(); });
  packung.addEventListener("input", () => { a.packung = packung.value.trim(); a.packungGeaendert = true; neuRechnen(); });
  row._neu = neuRechnen; neuRechnen();
  return row;
}

// Produktwahl im Blatt von unten: Vorschläge, Suche im Katalog, eure bekannten Produkte, eigener Name
function produktWaehlen(a) {
  let bio = a.n ? Produkte.istBio(a.n) : Produkte.erkennen(a.b || "").bio;
  const such = h("input", { type: "search", placeholder: "Produkt suchen, z. B. Rahm", "aria-label": "Produkt suchen" });
  const liste = h("div", { class: "wahl" });
  const bioSeg = h("div", { class: "seg klein", role: "group", "aria-label": "Bio" });
  const setBio = v => { bio = v; segBauen(bioSeg, [["0", "Normal"], ["1", "Bio"]], bio ? "1" : "0", x => { bio = x === "1"; }); };
  setBio(bio);
  const bekannte = Array.from(new Set(beobachtungen().map(o => Produkte.ohneBio(o.name))));
  const waehle = (name, kat) => {
    a.n = Produkte.mitBio(name, bio); a.kat = kat || Produkte.kategorieVon(name); a.zugeordnet = true; a.quelle = "";
    sheetZu(); zeichneArtikel();
  };
  const eintrag = (name, kat, sub) => h("button", { type: "button", class: Produkte.ohneBio(a.n) === name ? "an" : null, onclick: () => waehle(name, kat) }, katSymbol(kat, true), h("span", { style: "display:grid;min-width:0" }, h("span", null, name), sub ? h("span", { class: "s" }, sub) : null));
  const fuellen = () => {
    liste.replaceChildren();
    const q = such.value.trim();
    const gesehen = new Set();
    const add = (name, kat, sub) => { if (gesehen.has(name)) return; gesehen.add(name); liste.appendChild(eintrag(name, kat, sub)); };
    if (!q) {
      const erk = Produkte.erkennen(a.b || a.n || "");
      if (erk.name) add(erk.name, erk.kat, "Vorschlag aus dem Bon-Text");
      const k = bonKey(a.b || a.n || "");
      bekannte.map(n => [aehnlich(k, bonKey(n)), n]).filter(x => x[0] > 0.35).sort((x, y) => y[0] - x[0]).slice(0, 4).forEach(([, n]) => add(n, Produkte.kategorieVon(n), "schon gekauft"));
      Produkte.KATALOG.filter(p => p.kat === (erk.name ? erk.kat : a.kat)).slice(0, 10).forEach(p => add(p.name, p.kat, KAT(p.kat).name));
    } else {
      bekannte.filter(n => schluessel(n).includes(schluessel(q))).slice(0, 5).forEach(n => add(n, Produkte.kategorieVon(n), "schon gekauft"));
      Produkte.suchen(q, 10).forEach(p => add(p.name, p.kat, KAT(p.kat).name));
      liste.appendChild(h("button", { type: "button", onclick: () => waehle(q.replace(/\s*\(Bio\)$/i, ""), Produkte.erkennen(q).kat) }, h("span", { class: "kat klein kat-anderes" }, icon("plus")), h("span", { style: "display:grid" }, h("span", null, `«${q}» als eigenes Produkt`), h("span", { class: "s" }, "für Dinge, die nicht in der Liste sind"))));
    }
  };
  such.addEventListener("input", fuellen);
  sheetOeffnen(h("div", { class: "stack" },
    h("div", { class: "row zwischen" }, h("h3", null, "Produkt wählen"), h("button", { type: "button", class: "icon-btn", "aria-label": "Schliessen", onclick: sheetZu }, icon("x"))),
    a.b ? h("p", { class: "small muted" }, "Auf dem Bon: ", h("span", { class: "mono", style: "color:var(--ink)" }, a.b)) : null,
    h("p", { class: "small muted" }, "Gleiche Produkte aus verschiedenen Läden bekommen denselben Namen – so werden die Preise vergleichbar. Die App merkt sich deine Wahl für diesen Bon-Text."),
    h("div", { class: "row" }, h("span", { class: "small muted", style: "font-weight:600" }, "Qualität"), bioSeg),
    h("div", { class: "feld-icon" }, icon("suche"), such), liste));
  fuellen();
  setTimeout(() => such.focus(), 50);
}

// Summen, Kategorien-Übersicht, Vergleich – ohne die Zeilen neu zu bauen (Fokus bleibt)
function fAktualisieren() {
  const box = $("#f-vergleich"); box.replaceChildren();
  const arts = F.typ === "einkauf" ? artLesen() : [];
  const s = rund(arts.reduce((x, a) => x + a.p, 0)), b = zahl($("#f-betrag").value), diff = b > 0 ? rund(b - s) : 0;
  $("#f-art-sum").replaceChildren(...[arts.length ? `${arts.length} Artikel · ${fmt(s)}` : "",
    arts.length && Math.abs(diff) >= 0.01 ? h("span", { class: F.ausBon ? "up" : null }, ` · Differenz ${diff > 0 ? "+" : "−"}${fmt(Math.abs(diff))}` + (F.ausBon ? " – ein Preis stimmt noch nicht" : "")) : null,
    arts.length && F.ausBon && Math.abs(diff) < 0.01 && b > 0 ? h("span", { class: "down" }, " · stimmt mit dem Total ✓") : null].filter(Boolean));
  for (const el of $$("[data-kat-summe]")) { const k = el.dataset.katSumme; el.textContent = fmt(F.artikel.filter(a => a.kat === k).reduce((x, a) => x + (Number(a.p) > 0 ? Number(a.p) : 0), 0)); }
  for (const r of $$("#f-artikel .art")) if (r._neu) r._neu();
  zeichneBonAnsicht();
  $("#f-ablage-wrap").hidden = !(F.ausBon && Q.fotos.length && F.typ === "einkauf");
  entwurfBald();
  if (!arts.length || F.ausBon) return;
  const p = vergleichPanel(arts, F.laden, $("#f-datum").value || heute(), null);
  if (p) box.appendChild(p);
}

// Digitale Quittung: Laden, Total, wofür das Geld ausgegeben wurde, was sich verändert hat
function zeichneBonAnsicht() {
  const box = $("#bon-ansicht");
  if (!F.ausBon || F.typ !== "einkauf") { box.hidden = true; box.replaceChildren(); return; }
  const arts = artLesen(), total = zahl($("#f-betrag").value), summe = rund(arts.reduce((x, a) => x + a.p, 0));
  const proKat = Produkte.KATEGORIEN.map(k => [k, rund(F.artikel.filter(a => a.kat === k.id).reduce((x, a) => x + (Number(a.p) > 0 ? Number(a.p) : 0), 0))]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const max = proKat.length ? proKat[0][1] : 1;
  const v = vergleiche(arts, F.laden, $("#f-datum").value || heute(), null);
  const t = v.filter(x => x.status === "teurer"), g = v.filter(x => x.status === "guenstiger"), bs = v.filter(x => x.besser);
  const pruefen = F.artikel.filter(a => a.pruefen).length, offen = F.artikel.filter(a => !a.zugeordnet).length;
  box.hidden = false;
  box.replaceChildren(h("div", { class: "bon-wrap" }, h("div", { class: "bon", style: "--ladenfarbe:" + ladenFarbe(F.laden) },
    h("div", { class: "streifen" }),
    h("div", { class: "bk" },
      h("div", { class: "laden" }, h("i", { class: "dot", style: "width:14px;height:14px;background:" + ladenFarbe(F.laden) }), F.laden || "Laden?"),
      h("div", { class: "meta" }, icon("kalender"), h("span", null, datumLang($("#f-datum").value || heute())), h("span", null, "·"), h("span", null, `${F.artikel.length} Artikel`), F.bon && F.bon.datumFehlt ? h("span", { class: "pill warn" }, "Datum prüfen") : null)),
    h("div", { class: "total" }, h("span", null, "Total"), h("b", null, fmt(total > 0 ? total : summe))),
    h("div", { class: "teil" }, h("div", { class: "chips" },
      pruefen ? h("span", { class: "pill warn" }, icon("warn"), `${pruefen} prüfen`) : h("span", { class: "pill gut" }, icon("haken"), "alles geprüft"),
      offen ? h("span", { class: "pill" }, `${offen} ohne Produkt`) : null,
      total > 0 && Math.abs(total - summe) >= 0.01 ? h("span", { class: "pill crit" }, `Summe ${fmt(summe)} ≠ Total`) : total > 0 ? h("span", { class: "pill gut" }, "Summe = Total") : null)),
    proKat.length ? h("div", { class: "teil" }, h("hr", { class: "perfo" }), h("h4", { style: "margin-top:12px" }, "Wofür ausgegeben"),
      h("div", { class: "balken-liste" }, proKat.slice(0, 7).map(([k, wert]) => h("div", { class: "bz" },
        h("div", { class: "lbl" }, katSymbol(k.id, true), h("span", { class: "t" }, k.name)),
        h("div", { class: "wert" }, `${fmt(wert)} · ${Math.round(wert / (summe || 1) * 100)} %`),
        h("div", { class: "spur" }, h("i", { style: `width:${(wert / max * 100).toFixed(1)}%` })))))) : null,
    v.length ? h("div", { class: "teil" }, h("hr", { class: "perfo" }), h("h4", { style: "margin-top:12px" }, "Preise im Vergleich"),
      h("div", { class: "kacheln" },
        h("div", { class: "kachel" }, h("span", { class: "l" }, "Teurer geworden"), h("span", { class: "v up" }, String(t.length)), h("span", { class: "d" }, t.length ? `zusammen +${fmt(t.reduce((s2, x) => s2 + x.diffChf, 0))}` : "nichts")),
        h("div", { class: "kachel" }, h("span", { class: "l" }, "Günstiger"), h("span", { class: "v down" }, String(g.length)), h("span", { class: "d" }, g.length ? `zusammen −${fmt(Math.abs(g.reduce((s2, x) => s2 + x.diffChf, 0)))}` : "nichts")),
        h("div", { class: "kachel" }, h("span", { class: "l" }, "Anderswo billiger"), h("span", { class: "v" }, String(bs.length)), h("span", { class: "d" }, bs.length ? `bis ${fmt(bs.reduce((s2, x) => s2 + x.sparChf, 0))} sparen` : "nichts"))),
      t.length || bs.length ? h("div", { class: "stack", style: "gap:6px;margin-top:10px" }, [...t, ...bs.filter(x => !t.includes(x))].slice(0, 6).map(x => h("div", { class: "kv" }, h("span", null, x.a.n),
        h("span", { class: "row", style: "gap:6px" }, x.status === "teurer" ? aenderung(x.d) : null, x.besser ? h("span", { class: "small muted" }, `${x.besser.laden} ${fmt(x.besser.gp)}/${x.gpE}`) : null)))) : null) : null)));
}

$("#f-art-plus").onclick = () => { const a = { id: uid(), n: "", b: "", kat: "anderes", p: null, r: 0, anzahl: 1, packung: "", pruefen: false, zugeordnet: false }; F.artikel.push(a); zeichneArtikel(); produktWaehlen(a); };
$("#f-datum").addEventListener("change", fAktualisieren);
$("#f-betrag").addEventListener("input", () => {
  const b = zahl($("#f-betrag").value), schwelle = (L.stand && L.stand.einstellungen && Number(L.stand.einstellungen.schwelle)) || 50;
  if (!F.teilBeruehrt && F.typ === "einkauf") { F.teil = b >= schwelle ? "geteilt" : "allein"; segBauen("f-teil", [["geteilt", "50/50"], ["allein", "Allein"]], F.teil, v => { F.teil = v; F.teilBeruehrt = true; }); }
  fAktualisieren();
});
function fLeeren() {
  F.ausBon = false; F.bon = null; F.artikel = []; $("#f-bon").hidden = true; $("#f-bon").replaceChildren();
  $("#f-titel").textContent = "Von Hand erfassen"; $("#f-sub").textContent = "Einkauf oder Restaurant – mit Preisvergleich";
  $("#f-form").reset(); $("#f-datum").value = heute(); F.teilBeruehrt = false; F.teil = "allein";
  segBauen("f-typ", [["einkauf", "Einkauf"], ["auswaerts", "Auswärts essen"]], "einkauf", fTyp); F.typ = "einkauf";
  segBauen("f-wer", PERSONEN.map(p => [p, p]), F.wer, v => F.wer = v);
  segBauen("f-teil", [["geteilt", "50/50"], ["allein", "Allein"]], F.teil, v => { F.teil = v; F.teilBeruehrt = true; });
  ladenChips(); fTyp("einkauf"); zeichneArtikel();
}
// Gelesene Quittung übernehmen
function formAusBon(r) {
  fLeeren();
  F.ausBon = true; F.bon = { datumFehlt: !r.datum };
  F.laden = r.laden || "";
  $("#f-laden-andere").value = LAEDEN.includes(F.laden) ? "" : F.laden;
  ladenChips();
  $("#f-datum").value = r.datum || heute();
  $("#f-betrag").value = r.total > 0 ? r.total.toFixed(2) : "";
  $("#f-betrag").dispatchEvent(new Event("input"));
  const finder = namenFinder();
  F.artikel = r.artikel.map(a => zuArtikel(a, finder));
  F.bon.ladenFehlt = !r.laden;
  zeichneBonHinweis();
  zeichneArtikel();
}
function zeichneBonHinweis(wieder) {
  $("#f-titel").textContent = "Quittung prüfen"; $("#f-sub").textContent = "Gelesen von deinem Foto – kontrollieren und speichern";
  const pruefen = F.artikel.filter(a => a.pruefen).length, offen = F.artikel.filter(a => !a.zugeordnet).length, b = F.bon || {};
  const box = $("#f-bon"); box.hidden = false;
  box.replaceChildren(h("div", { class: "notice warn" }, icon("info"), h("div", null,
    wieder ? h("b", null, "Wiederhergestellt – noch nicht gespeichert. ") : null,
    pruefen ? `${pruefen} ${pruefen === 1 ? "Zeile ist" : "Zeilen sind"} gelb – dort war die Erkennung unsicher. Mit dem Bon vergleichen und mit ✓ bestätigen. ` : "Bitte kurz mit dem Bon vergleichen. ",
    offen ? `${offen} Artikel ${offen === 1 ? "hat" : "haben"} noch kein Produkt – antippen und wählen, dann werden die Preise vergleichbar. ` : "",
    b.ladenFehlt ? "Laden nicht erkannt – bitte wählen. " : "", b.datumFehlt ? "Datum nicht erkannt – heute eingesetzt." : "")));
}
$("#f-form").addEventListener("submit", async ev => {
  ev.preventDefault();
  const betrag = zahl($("#f-betrag").value);
  if (!(betrag > 0)) { toast("Bitte einen Betrag eingeben."); $("#f-betrag").focus(); return; }
  const ort = F.typ === "einkauf" ? (F.laden || $("#f-laden-andere").value.trim()) : $("#f-resto").value.trim();
  if (!ort) { toast(F.typ === "einkauf" ? "Bitte den Laden wählen." : "Bitte das Restaurant eintragen."); return; }
  if (F.typ === "einkauf") {
    const ohne = F.artikel.find(a => (a.n || a.b) && !(Number(a.p) > 0));
    if (ohne) { toast("Bei einem Artikel fehlt der Preis – bitte ergänzen oder die Zeile entfernen."); const r = $(`#f-artikel .art[data-id="${ohne.id}"]`); if (r) { r.scrollIntoView({ block: "center" }); r.querySelector(".preis input").focus(); } return; }
  }
  const ausBon = F.ausBon, pwaId = uid(), datum = $("#f-datum").value || heute();
  // Zuordnungen lernen: dieser Bon-Text heisst ab jetzt so (und hat diese Packung)
  if (F.typ === "einkauf") for (const a of F.artikel) if (a.b && a.n && a.zugeordnet) { const g = !a.gewogen ? Produkte.groesse(a.packung) : null; L.zuordnung[bonKey(a.b)] = g ? { n: a.n, g } : { n: a.n }; }
  L.eintraege.push({ pwaId, typ: F.typ, datum, ort, betrag: rund(betrag), bezahlt: F.wer, teilung: F.teil, notiz: $("#f-notiz").value.trim(), artikel: F.typ === "einkauf" ? artLesen() : [] });
  if (await sichern("eintraege", "zuordnung")) {
    if (ausBon && Q.fotos.length && $("#f-ablage").checked) {
      try { await Ablage.speichern({ seiten: Q.fotos.map(f => ({ blob: f.orig, breite: f.breite, hoehe: f.hoehe, woerter: f.woerter, wBreite: f.wB, wHoehe: f.wH, text: f.text })), laden: ort, datum, total: rund(betrag), eintragId: pwaId }); toast("Gespeichert und in der Ablage"); }
      catch (e) { toast("Gespeichert – die Ablage ist voll, das Bild wurde nicht aufbewahrt"); }
    } else toast("Gespeichert – wird beim nächsten Abgleich gesendet");
    if (ausBon) qLeeren();
    fLeeren(); zeichneEListe(); zeichnePreise(); if (typeof zeichneBudget === "function") zeichneBudget();
  }
});
function zeichneEListe() {
  const box = $("#e-liste"); box.replaceChildren();
  if (!L.eintraege.length) return;
  box.appendChild(h("h4", { class: "eyebrow", style: "margin-bottom:4px" }, "Auf dem Handy erfasst · noch nicht gesendet"));
  for (const e of L.eintraege.slice().reverse()) box.appendChild(h("div", { class: "wartet" },
    e.typ === "einkauf" ? h("span", { class: "kat klein", style: "background:var(--paper-2)" }, h("i", { class: "dot", style: "background:" + ladenFarbe(e.ort) })) : h("span", { class: "kat klein kat-fruechte" }, icon("topf")),
    h("div", { style: "min-width:0" }, h("div", { style: "font-weight:650" }, `${e.ort}`), h("div", { class: "sub" }, `${datumKurz(e.datum)} · ${e.bezahlt} · ${e.teilung === "geteilt" ? "50/50" : "allein"}${e.artikel.length ? " · " + e.artikel.length + " Artikel" : ""}`)),
    h("div", { class: "row", style: "flex-wrap:nowrap" }, h("span", { class: "num" }, fmt(e.betrag)), loeschKnopf(async () => { L.eintraege = L.eintraege.filter(x => x.pwaId !== e.pwaId); await sichern("eintraege"); zeichneEListe(); zeichnePreise(); }))));
}
$("#q-speichern").onclick = async () => {
  if (!Q.fotos.length) return;
  if (Q.laeuft) qStopp();
  const pwaId = uid(), fotoIds = [];
  try { for (const f of Q.fotos) { const fid = uid(); await DB.set("fotos", fid, f.blob); fotoIds.push(fid); } }
  catch (e) { toast("Die Fotos liessen sich nicht speichern. Ist der Speicher voll?"); return; }
  L.quittungen.push({ pwaId, datum: heute(), bezahlt: Q.wer, teilung: Q.teil, notiz: $("#q-notiz").value.trim(), fotoIds });
  if (await sichern("quittungen")) {
    qLeeren(); $("#q-mehr").open = false; zeichneQListe();
    if (F.ausBon) fLeeren();
    toast("Foto aufgehoben – beim nächsten Abgleich liest Claude es aus");
  }
};
async function zeichneQListe() {
  const box = $("#q-liste"); box.replaceChildren();
  if (!L.quittungen.length) return;
  box.appendChild(h("h4", { class: "eyebrow" }, "Fotos für Claude"));
  for (const q of L.quittungen.slice().reverse()) {
    const thumb = h("div", { class: "foto", style: "width:42px;height:56px" });
    DB.get("fotos", q.fotoIds[0]).then(b => { if (b) thumb.appendChild(h("img", { src: URL.createObjectURL(b), alt: "" })); }).catch(() => { });
    box.appendChild(h("div", { class: "wartet" }, thumb,
      h("div", { style: "min-width:0" }, h("div", null, "Quittung vom " + datumKurz(q.datum)), h("div", { class: "sub" }, `${q.fotoIds.length} ${q.fotoIds.length === 1 ? "Foto" : "Fotos"} · ${q.bezahlt} · ${q.teilung === "geteilt" ? "50/50" : "allein"}${q.notiz ? " · " + q.notiz : ""}`)),
      loeschKnopf(async () => { L.quittungen = L.quittungen.filter(x => x.pwaId !== q.pwaId); for (const fid of q.fotoIds) await DB.del("fotos", fid).catch(() => { }); await sichern("quittungen"); zeichneQListe(); })));
  }
}

/* ---------- Gekocht ---------- */
const G = { wer: "Zusammen", sterne: 0 };
function gSterne() {
  const box = $("#g-sterne"); box.replaceChildren();
  for (let i = 1; i <= 5; i++) box.appendChild(h("button", { type: "button", class: i <= G.sterne ? "an" : null, "aria-label": i + " von 5 Sternen", "aria-pressed": String(i === G.sterne), onclick: () => { G.sterne = i === G.sterne ? 0 : i; gSterne(); } }, "★"));
}
$("#g-form").addEventListener("submit", async ev => {
  ev.preventDefault();
  const titel = $("#g-titel").value.trim(); if (!titel) { toast("Bitte das Gericht eintragen."); return; }
  L.gekocht.push({ pwaId: uid(), titel, datum: heute(), wer: G.wer, bewertung: G.sterne || null, notiz: "" });
  if (await sichern("gekocht")) { $("#g-titel").value = ""; G.sterne = 0; gSterne(); zeichneGListe(); toast("Eingetragen"); }
});
function zeichneGListe() {
  const box = $("#g-liste"); box.replaceChildren();
  for (const g of L.gekocht.slice().reverse()) box.appendChild(h("div", { class: "wartet" }, h("span", { class: "kat klein kat-fruechte" }, icon("topf")),
    h("div", { style: "min-width:0" }, h("div", { style: "font-weight:650" }, g.titel), h("div", { class: "sub" }, `${datumKurz(g.datum)} · ${g.wer}${g.bewertung ? " · " + "★".repeat(g.bewertung) : ""}`)),
    loeschKnopf(async () => { L.gekocht = L.gekocht.filter(x => x.pwaId !== g.pwaId); await sichern("gekocht"); zeichneGListe(); })));
}
ZEICHNER.erfassen = () => { zeichneEListe(); zeichneQListe(); Ablage.zeichnen(); };
