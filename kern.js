/* Kasse unterwegs – Kern: Hilfen, Symbole, Speicher, Register, Stand */
"use strict";
const PERSONEN = ["Simon", "Eliana"];
const LAEDEN = ["Migros", "Coop", "Lidl", "Denner"];
const EINHEITEN = ["", "Stk", "kg", "g", "l", "dl", "ml"];
const ORTE = ["Vorratsschrank", "Kühlschrank", "Tiefkühler", "Früchte & Gemüse"];
const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const MONATE_KURZ = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const WOCHENTAGE = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

/* ---------- Hilfen ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.setAttribute("style", v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value" && (tag === "input" || tag === "select")) el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(3)) { if (kid == null || kid === false) continue; el.appendChild(typeof kid === "object" ? kid : document.createTextNode(String(kid))); }
  return el;
}
const nf = new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 });
const fmt = n => nf.format(Number(n) || 0);
const fmt0 = n => nf0.format(Math.round(Number(n) || 0));
const chf = n => "CHF " + fmt(n);
const rund = n => Math.round(n * 100) / 100;
const r05 = n => Math.round(n * 20) / 20;
const zahl = s => { const t = String(s ?? "").trim().replace(/[’'\s]/g, "").replace(",", ".").replace(/^CHF/i, ""); return t === "" ? NaN : Number(t); };
const heute = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const monatVon = d => String(d || "").slice(0, 7);
const datumKurz = d => { const [y, m, t] = String(d).split("-"); return t + "." + m + "."; };
const datumLang = d => { const [y, m, t] = String(d).split("-"); return Number(t) + ". " + MONATE[Number(m) - 1] + " " + y; };
const monatName = k => { const [y, m] = String(k).split("-").map(Number); return MONATE[m - 1] + " " + y; };
const schluessel = n => String(n || "").trim().toLowerCase().replace(/\s+/g, " ");
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const ladenFarbe = l => ({ Coop: "var(--st-coop)", Migros: "var(--st-migros)", Lidl: "var(--st-lidl)", Denner: "var(--st-denner)" }[l] || "var(--st-andere)");
let toastT; function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3200); }
function segBauen(id, werte, aktiv, onWahl) {
  const box = typeof id === "string" ? $("#" + id) : id; box.replaceChildren();
  for (const [v, t] of werte) box.appendChild(h("button", { type: "button", "data-v": v, "aria-pressed": String(v === aktiv), onclick: () => { for (const b of box.children) b.setAttribute("aria-pressed", String(b.dataset.v === v)); onWahl(v); } }, t));
  return box;
}
function grundpreis(p, q, e) {
  const preis = Number(p), menge = Number(q);
  if (!(preis > 0)) return null;
  const f = { kg: [1, "kg"], g: [1000, "kg"], l: [1, "l"], dl: [10, "l"], ml: [1000, "l"], Stk: [1, "Stk."] }[e];
  if (!(menge > 0) || !f) return { wert: preis, einheit: "Pack." };
  return { wert: preis / (menge / f[0]), einheit: f[1] };
}
function aenderung(d) { return h("span", { class: "chg " + (d > 0 ? "up" : "down") }, (d > 0 ? "▲ +" : "▼ ") + (Math.round(d * 1000) / 10).toLocaleString("de-CH") + " %"); }
function loeschKnopf(fn, label) {
  const b = h("button", { type: "button", class: "icon-btn", "aria-label": label || "Löschen", onclick: () => {
    if (b.dataset.sicher) fn();
    else { b.dataset.sicher = "1"; b.replaceChildren(h("span", { class: "pill crit" }, "Löschen?")); b.style.width = "auto"; setTimeout(() => { if (b.isConnected && b.dataset.sicher) { delete b.dataset.sicher; b.style.width = ""; b.replaceChildren(icon("muell")); } }, 3500); }
  } }, icon("muell"));
  return b;
}

/* ---------- Symbole (eigene Strichzeichnungen, 24×24) ---------- */
const ICONS = {
  bon: '<path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2z"/><path d="M9 7.5h6M9 11h6M9 14.5h3.5"/>',
  liste: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="m3.5 6 1.5 1.5L8 4.5M3.5 12 5 13.5 8 10.5M3.5 18 5 19.5 8 16.5"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.6"/>',
  kamera: '<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.6l1.6-2.5h6.6L16.9 7h2.6A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/><circle cx="12" cy="13.2" r="3.6"/>',
  bild: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-10 9"/>',
  budget: '<path d="M12 3v9l7.8 4.5A9 9 0 1 1 12 3z"/><path d="M15 3.5a9 9 0 0 1 5.6 9.4L15 13z"/>',
  sync: '<path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.6M20 4v4.6h-4.6"/><path d="M20 12a8 8 0 0 1-13.7 5.7L4 15.4M4 20v-4.6h4.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  haken: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  muell: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  suche: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  runter: '<path d="m6 9 6 6 6-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.01"/>',
  warn: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.3v.01"/>',
  stift: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  topf: '<path d="M4 10h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M2 10h20M9 6.5c0-1 .8-1.5.8-2.5M12.5 6.5c0-1 .8-1.5.8-2.5"/>',
  archiv: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
  laden: '<path d="M4 9.5 5.2 4h13.6L20 9.5"/><path d="M4 9.5v10.5h16V9.5M4 9.5c0 1.4 1.1 2.5 2.7 2.5S9.3 10.9 9.3 9.5c0 1.4 1.2 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1.1 2.5 2.6 2.5S20 10.9 20 9.5"/><path d="M10 20v-4.5h4V20"/>',
  vorrat: '<rect x="6.5" y="3" width="11" height="3.5" rx="1"/><path d="M6 6.5h12v12.5a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M9 12.5h6"/>',
  hoch: '<path d="M12 19V7M7 12l5-5 5 5M5 4h14"/>',
  runterladen: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  teilen: '<circle cx="6" cy="12" r="2.5"/><circle cx="17.5" cy="6" r="2.5"/><circle cx="17.5" cy="18" r="2.5"/><path d="m8.2 10.8 7-3.6M8.2 13.2l7 3.6"/>',
  besen: '<path d="M14 4 10.5 10.5"/><path d="M6.5 10.5h8l1.5 9.5H5z"/><path d="M8.5 15.5 8 20M12.5 15.5l.5 4.5"/>',
  einstellungen: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.6M12 18.9v2.6M4.6 4.6l1.9 1.9M17.5 17.5l1.9 1.9M2.5 12h2.6M18.9 12h2.6M4.6 19.4l1.9-1.9M17.5 6.5l1.9-1.9"/>',
  laptop: '<rect x="4.5" y="5" width="15" height="10.5" rx="1.5"/><path d="M2.5 19h19"/>',
  handy: '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/>',
  tabelle: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M3.5 9.5h17M3.5 15h17M9.5 9.5V20"/>',
  kalender: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  sparschwein: '<path d="M4.5 11.5a6.5 5.5 0 0 1 11.6-3.4h2.3l1.6 2v3.4l-2 .9-1 3.1h-2.6V16h-4.4v1.5H7.4l-1.1-3.1a5.3 5.3 0 0 1-1.8-2.9z"/><path d="M15.5 11.3v.01M9.5 5.5h3.5"/>',
  person: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  // Warengruppen
  gemuese: '<path d="M14.6 9.4 4.4 19.6c-.5.5-1.3 0-1-.7l5.1-11a4 4 0 0 1 6.1 1.5z"/><path d="M14.6 9.4c1.3-1.8 3.4-2.4 5.4-1.9M14.6 9.4c.4-2.2-.3-4.3-1.9-5.6M14.6 9.4l3.5-5M7.5 12.5l1.5 1.5M6 16l1.4 1.4"/>',
  fruechte: '<path d="M12 7.2c-2.2-2-6.6-1.4-7 3.4-.4 4 2.3 9.4 5 9.4 1.1 0 1.3-.6 2-.6s.9.6 2 .6c2.7 0 5.4-5.4 5-9.4-.4-4.8-4.8-5.4-7-3.4z"/><path d="M12 7.2c0-2 .9-3.6 3-4.4"/>',
  fleisch: '<path d="M15.2 3.2a5.3 5.3 0 0 1 4.3 8.3c-1.4 1.9-3.9 2.6-6 1.9l-3.4 3.4a2.2 2.2 0 1 1-3.1 3 2.2 2.2 0 1 1-3-3.1l3.4-3.4c-.7-2.1 0-4.6 1.9-6a5.3 5.3 0 0 1 5.9-4.1z"/>',
  milch: '<path d="M8 2.5h8v3l2.2 3.2V21H5.8V8.7L8 5.5z"/><path d="M5.8 8.7h12.4M8 5.5h8M9.5 13h5"/>',
  kaese: '<path d="M3 16.5v-5.2L15.5 5 21 10.5v6z"/><path d="M3 11.3h18"/><circle cx="8" cy="14.2" r=".9"/><circle cx="14.5" cy="13.8" r="1.2"/><circle cx="11.5" cy="8.3" r=".8"/>',
  brot: '<path d="M5.3 11.2a3.9 3.9 0 0 1 .7-7.6c1.9-.3 3.9.6 6 .6s4.1-.9 6-.6a3.9 3.9 0 0 1 .7 7.6V20H5.3z"/><path d="M9 8l1.5 2M12 7.5 13.5 10M15 8l1.5 2"/>',
  tk: '<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="M9.5 4 12 6.4 14.5 4M9.5 20l2.5-2.4 2.5 2.4M4.2 11 6.9 12l-1 3M19.8 13l-2.7-1 1-3"/>',
  getraenke: '<path d="M10 2.5h4v3.7l2 3v11.3a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9.2l2-3z"/><path d="M8 13h8M10 2.5h4"/>',
  suesses: '<circle cx="12" cy="12" r="4.2"/><path d="M8.6 9.4 4 6.2l-.6 4.4 5.2.8M15.4 14.6l4.6 3.2.6-4.4-5.2-.8"/>',
  haushalt: '<path d="M8.5 9h6l1 3v9.5h-8V12z"/><path d="M10 9V5.5h4V9M14 5.5h3l2.2 1.5"/><path d="M19.5 3.5v.01M21.3 6v.01M21 1.8v.01"/>',
  anderes: '<path d="M5 8h14l-1.2 12.5H6.2z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  // Budget-Gruppen
  einnahmen: '<path d="M12 3v10M8 9l4 4 4-4"/><path d="M4 14.5V19a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-4.5"/>',
  wohnen: '<path d="M3 11.2 12 4l9 7.2"/><path d="M5.5 9.5v11h13v-11"/><path d="M10 20.5v-6h4v6"/>',
  versicherung: '<path d="M12 3 5 6v5.5c0 4.6 3 8 7 9.5 4-1.5 7-4.9 7-9.5V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  steuern: '<path d="M3 9.2 12 4l9 5.2"/><path d="M5.5 10.5v7.5M10 10.5v7.5M14 10.5v7.5M18.5 10.5v7.5M3 20.5h18"/>',
  mobilitaet: '<rect x="5" y="3.5" width="14" height="13.5" rx="2.5"/><path d="M5 10.5h14M8.5 20.5l1.8-3.5M15.5 20.5 13.7 17M9 13.8v.01M15 13.8v.01M10 6.5h4"/>',
  essen: '<path d="M3.5 10h17l-2 10.5h-13z"/><path d="m7.5 10 4-6M16.5 10l-4-6M9 13.5v3.5M12 13.5v3.5M15 13.5v3.5"/>',
  freizeit: '<path d="M12 20s-7.5-4.6-7.5-10.4A4.1 4.1 0 0 1 12 7.3a4.1 4.1 0 0 1 7.5 2.3C19.5 15.4 12 20 12 20z"/>',
  ruecklagen: '<path d="M3 12.5a9 9 0 0 1 18 0z"/><path d="M12 12.5v6.5a2 2 0 0 1-4 0M12 3.5v-1"/>'
};
function icon(name, cls) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "i" + (cls ? " " + cls : "")); s.setAttribute("aria-hidden", "true");
  s.innerHTML = ICONS[name] || ICONS.anderes;
  return s;
}
function iconsFuellen(root = document) { for (const el of $$("[data-icon]", root)) if (!el.querySelector("svg")) el.appendChild(icon(el.dataset.icon)); }
const KAT = id => Produkte.KAT[id] || Produkte.KAT.anderes;
function katSymbol(katId, klein) { const k = KAT(katId); return h("span", { class: "kat kat-" + k.id + (klein ? " klein" : ""), title: k.name }, icon(k.icon)); }

/* ---------- Speicher auf dem Handy (IndexedDB) ---------- */
const DB = (() => {
  let offen;
  const oeffnen = () => offen || (offen = new Promise((res, rej) => {
    const r = indexedDB.open("kasse-unterwegs", 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("kv"); r.result.createObjectStore("fotos"); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (store, modus, fn) => { const db = await oeffnen(); return new Promise((res, rej) => { const t = db.transaction(store, modus); const anf = fn(t.objectStore(store)); t.oncomplete = () => res(anf ? anf.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
  return { get: (s, k) => tx(s, "readonly", st => st.get(k)), set: (s, k, v) => tx(s, "readwrite", st => st.put(v, k)), del: (s, k) => tx(s, "readwrite", st => st.delete(k)) };
})();
// zuordnung: Bon-Text → { n: Produktname, g: Packungsgrösse } – lernt aus jeder Korrektur, bleibt auf dem Handy
// budget: Monatsbudget (wird mit der Haushaltskasse abgeglichen)
const L = { stand: null, eintraege: [], quittungen: [], listeNeu: [], listeStatus: {}, vorratStatus: {}, gekocht: [], preise: [], ich: "Simon", exportiert: null, zuordnung: {}, budget: null };
const KEYS = Object.keys(L);
let persistGefragt = false;
async function sichern(...keys) {
  try { for (const k of keys) await DB.set("kv", k, L[k]); }
  catch (e) { toast("Speichern auf dem Handy hat nicht geklappt. Ist der Speicher voll?"); return false; }
  if (!persistGefragt && navigator.storage && navigator.storage.persist) { persistGefragt = true; navigator.storage.persist().then(() => typeof zeichneSpeicher === "function" && zeichneSpeicher()).catch(() => { }); }
  if (typeof zeichneSenden === "function") zeichneSenden();
  return true;
}

/* ---------- Netz ---------- */
function zeichneNetz() { const on = navigator.onLine; $("#netz").classList.toggle("off", !on); $("#netz").lastElementChild.textContent = on ? "Online" : "Offline"; }
addEventListener("online", zeichneNetz); addEventListener("offline", zeichneNetz);

/* ---------- Register ---------- */
const ZEICHNER = {};
function tab(name) {
  for (const b of $$(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
  for (const s of $$("main > section")) s.hidden = s.id !== "p-" + name;
  try { localStorage.setItem("kasse-tab", name); } catch (e) { }
  if (ZEICHNER[name]) ZEICHNER[name]();
  scrollTo({ top: 0 });
}
for (const b of $$(".tabs button")) b.onclick = () => tab(b.dataset.tab);

/* ---------- Bottom Sheet ---------- */
function sheetOeffnen(inhalt) {
  const s = $("#sheet"); s.replaceChildren(h("div", { class: "panel", role: "dialog", "aria-modal": "true" }, h("span", { class: "griff" }), inhalt));
  s.hidden = false; s.onclick = ev => { if (ev.target === s) sheetZu(); };
  document.body.style.overflow = "hidden";
}
function sheetZu() { $("#sheet").hidden = true; $("#sheet").replaceChildren(); document.body.style.overflow = ""; }
addEventListener("keydown", ev => { if (ev.key === "Escape" && !$("#sheet").hidden) sheetZu(); });

/* ---------- Stand ---------- */
function zeichneStand() {
  const s = L.stand;
  $("#kein-stand").hidden = !!s;
  $("#stand-info").textContent = s ? "Stand vom " + datumLang(String(s.erstellt).slice(0, 10)) : "Noch kein Stand aus der Haushaltskasse";
  $("#stand-detail").textContent = s ? `Geladen: ${s.preise.length} Preise, ${s.liste.length} Listen-Artikel, ${s.vorrat.length} Vorrats-Artikel${s.budget ? ", Budget" : ""} – Stand vom ${datumLang(String(s.erstellt).slice(0, 10))}.` : "Noch nichts geladen.";
  $("#schritt1").querySelector(".schritt").classList.toggle("fertig", !!s);
  const namen = new Set([...(s ? s.preise.map(p => p.n) : []), ...L.preise.map(p => p.name), ...Produkte.KATALOG.map(p => p.name)]);
  $("#dl-produkte").replaceChildren(...Array.from(namen).sort((a, b) => a.localeCompare(b, "de")).map(n => h("option", { value: n })));
  $("#dl-gerichte").replaceChildren(...(s ? s.gerichte || [] : []).map(n => h("option", { value: n })));
  $("#dl-restos").replaceChildren(...(s ? s.restos || [] : []).map(n => h("option", { value: n })));
}
$("#stand-datei").addEventListener("change", async ev => {
  const f = ev.target.files && ev.target.files[0]; ev.target.value = ""; if (!f) return;
  let s; try { s = JSON.parse(await f.text()); } catch (e) { toast("Diese Datei lässt sich nicht lesen."); return; }
  if (!s || s.format !== "haushaltskasse-stand" || !Array.isArray(s.preise)) { toast("Das ist keine Stand-Datei der Haushaltskasse."); return; }
  s.liste = Array.isArray(s.liste) ? s.liste : []; s.vorrat = Array.isArray(s.vorrat) ? s.vorrat : [];
  L.stand = s;
  for (const x of s.liste) if (x.id in L.listeStatus && L.listeStatus[x.id] === !!x.erledigt) delete L.listeStatus[x.id];
  for (const v of s.vorrat) if (v.id in L.vorratStatus && L.vorratStatus[v.id] === v.status) delete L.vorratStatus[v.id];
  const imStand = new Set(s.liste.map(x => x.pwaId).filter(Boolean));
  for (const x of L.listeNeu) if (imStand.has(x.pwaId)) delete L.listeStatus[x.pwaId];
  L.listeNeu = L.listeNeu.filter(x => !imStand.has(x.pwaId));
  const keys = ["stand", "listeStatus", "vorratStatus", "listeNeu"];
  // Budget aus der Haushaltskasse übernehmen, wenn es neuer ist als das auf dem Handy
  if (s.budget && s.budget.posten && (!L.budget || String(s.budget.geaendert || "") > String(L.budget.geaendert || ""))) { L.budget = s.budget; keys.push("budget"); }
  if (await sichern(...keys)) { toast("Stand geladen"); alles(); }
});

/* ---------- Beobachtete Preise (für Vergleiche) ---------- */
function beobachtungen() {
  const obs = [];
  for (const o of (L.stand ? L.stand.preise : [])) if (Number(o.gp) > 0) obs.push({ key: schluessel(o.n), name: o.n, laden: o.l, datum: o.d, gp: Number(o.gp), gpE: o.e, quelle: "stand" });
  for (const p of L.preise) { const g = grundpreis(p.preis, p.menge, p.einheit); if (g) obs.push({ key: schluessel(p.name), name: p.name, laden: p.laden, datum: p.datum, gp: g.wert, gpE: g.einheit, quelle: "notiz", pwaId: p.pwaId }); }
  for (const e of L.eintraege) if (e.typ === "einkauf") for (const a of e.artikel || []) { const g = grundpreis((Number(a.p) || 0) + (Number(a.r) || 0), a.q, a.e); if (g) obs.push({ key: schluessel(a.n), name: a.n, laden: e.ort, datum: e.datum, gp: g.wert, gpE: g.einheit, quelle: "eintrag", pwaId: e.pwaId }); }
  return obs.sort((a, b) => a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0);
}
function vergleiche(artikel, laden, datum, ohnePwaId) {
  const obs = beobachtungen().filter(o => !(ohnePwaId && o.pwaId === ohnePwaId));
  return artikel.filter(a => a && a.n && Number(a.p) > 0).map(a => {
    const normal = (Number(a.p) || 0) + (Number(a.r) || 0), g = grundpreis(normal, a.q, a.e), key = schluessel(a.n), menge = normal / g.wert;
    const bekannt = obs.filter(o => o.key === key), gleich = bekannt.filter(o => o.gpE === g.einheit && o.datum <= datum);
    const hier = gleich.filter(o => o.laden === laden), vorher = hier.length ? hier[hier.length - 1] : null;
    const proLaden = new Map(); for (const o of gleich) if (o.laden !== laden) proLaden.set(o.laden, o);
    let besser = null; for (const o of proLaden.values()) if (o.gp < g.wert * 0.98 && (!besser || o.gp < besser.gp)) besser = o;
    const d = vorher ? (g.wert - vorher.gp) / vorher.gp : null;
    return { a, gp: g.wert, gpE: g.einheit, vorher, d, besser, status: !bekannt.length ? "neu" : d == null ? "anders" : d > 0.005 ? "teurer" : d < -0.005 ? "guenstiger" : "gleich", diffChf: vorher ? (g.wert - vorher.gp) * menge : 0, sparChf: besser ? (g.wert - besser.gp) * menge : 0 };
  });
}
// Produkte mit letztem Preis je Laden
function produkte() {
  const map = new Map();
  for (const o of beobachtungen()) { if (!map.has(o.key)) map.set(o.key, { key: o.key, name: o.name, obs: [] }); const p = map.get(o.key); p.obs.push(o); p.name = o.name; }
  for (const p of map.values()) {
    p.last = p.obs[p.obs.length - 1];
    p.kat = Produkte.kategorieVon(p.name);
    const proLaden = new Map(); for (const o of p.obs) if (o.gpE === p.last.gpE) { const arr = proLaden.get(o.laden) || []; arr.push(o); proLaden.set(o.laden, arr); }
    p.laeden = Array.from(proLaden, ([laden, arr]) => ({ laden, last: arr[arr.length - 1], prev: arr.length > 1 ? arr[arr.length - 2] : null, verlauf: arr })).sort((a, b) => a.last.gp - b.last.gp);
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "de"));
}
// Bestes bekanntes Angebot zu einem freien Text (Listeneintrag)
function produktZuText(text) {
  const alle = produkte(); if (!alle.length) return null;
  const k = schluessel(text);
  let p = alle.find(x => x.key === k) || alle.find(x => k.includes(x.key) && x.key.length >= 3);
  if (!p) { const e = Produkte.erkennen(text); if (e.name) p = alle.find(x => schluessel(Produkte.ohneBio(x.name)) === schluessel(e.name)); }
  return p || null;
}
