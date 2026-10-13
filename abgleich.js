/* Kasse unterwegs – Abgleich mit der Haushaltskasse, Einstellungen, Start */
"use strict";
function zeichneBadge() {
  const n = L.eintraege.length + L.quittungen.length + L.gekocht.length + L.preise.length + listeOps().length + vorratOps().length;
  $("#badge").hidden = !n; $("#badge").textContent = String(n);
}
function blobZuDataUrl(b) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); }); }
function zaehlen() {
  return { eintraege: L.eintraege.length, quittungen: L.quittungen.length, liste: listeOps().length, vorrat: vorratOps().length, gekocht: L.gekocht.length, preise: L.preise.length, budget: budgetNeu() ? 1 : 0 };
}
// Budget nur senden, wenn es auf dem Handy geändert wurde (neuer als im Stand)
const budgetNeu = () => !!(L.budget && L.budget.posten.some(p => Number(p.betrag) > 0) && (!L.stand || !L.stand.budget || String(L.budget.geaendert) > String(L.stand.budget.geaendert || "")));
function zeichneSenden() {
  const z = zaehlen(), teile = [];
  if (z.eintraege) teile.push(["bon", `${z.eintraege} ${z.eintraege === 1 ? "Einkauf" : "Einkäufe"}`]);
  if (z.quittungen) teile.push(["kamera", `${z.quittungen} ${z.quittungen === 1 ? "Foto" : "Fotos"} für Claude`]);
  if (z.liste) teile.push(["liste", `${z.liste} Listen-Änderungen`]);
  if (z.vorrat) teile.push(["vorrat", `${z.vorrat} Vorrats-Änderungen`]);
  if (z.gekocht) teile.push(["topf", `${z.gekocht} gekochte Gerichte`]);
  if (z.preise) teile.push(["tag", `${z.preise} notierte Preise`]);
  if (z.budget) teile.push(["budget", "geändertes Budget"]);
  const box = $("#senden-info"); box.replaceChildren();
  box.appendChild(teile.length ? h("div", { class: "chips" }, teile.map(([i, t]) => h("span", { class: "pill acc" }, icon(i), t))) : h("p", { class: "small muted" }, "Nichts Neues zum Senden."));
  $("#senden-datei").disabled = !teile.length;
  $("#aufraeumen").disabled = !L.exportiert;
  $("#schritt2").querySelector(".schritt").classList.toggle("fertig", !teile.length && !!L.stand);
  zeichneBadge();
}
async function paket() {
  const quittungen = [];
  for (const q of L.quittungen) { const fotos = []; for (const fid of q.fotoIds) { const b = await DB.get("fotos", fid); if (b) fotos.push(await blobZuDataUrl(b)); } quittungen.push({ pwaId: q.pwaId, datum: q.datum, bezahlt: q.bezahlt, teilung: q.teilung, notiz: q.notiz, fotos }); }
  const p = { format: "haushaltskasse-handy", version: 1, erstellt: new Date().toISOString(), von: L.ich, eintraege: L.eintraege, quittungen, liste: listeOps(), vorrat: vorratOps(), gekocht: L.gekocht, preise: L.preise };
  if (budgetNeu()) p.budget = L.budget;
  return p;
}
async function exportMerken() {
  L.exportiert = { zeit: new Date().toISOString(), eintraege: L.eintraege.map(x => x.pwaId), quittungen: L.quittungen.map(x => x.pwaId), gekocht: L.gekocht.map(x => x.pwaId), preise: L.preise.map(x => x.pwaId), listeNeu: L.listeNeu.map(x => x.pwaId), listeStatus: { ...L.listeStatus }, vorratStatus: { ...L.vorratStatus } };
  await sichern("exportiert"); zeichneSenden();
}
async function dateiBauen() { const p = await paket(); return new File([JSON.stringify(p)], `haushaltskasse-handy-${heute()}.json`, { type: "application/json" }); }
$("#senden-datei").onclick = async () => {
  const f = await dateiBauen(); const url = URL.createObjectURL(f);
  const a = h("a", { href: url, download: f.name }); document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  await exportMerken(); toast("Datei erstellt – liegt in «Downloads»");
};
$("#senden-teilen").onclick = async () => {
  const f = await dateiBauen();
  try { await navigator.share({ files: [f], title: "Haushaltskasse unterwegs" }); await exportMerken(); }
  catch (e) { if (e && e.name !== "AbortError") toast("Teilen ging nicht. Bitte «Datei erstellen» verwenden."); }
};
try { $("#senden-teilen").hidden = !(navigator.canShare && navigator.canShare({ files: [new File(["{}"], "t.json", { type: "application/json" })] })); } catch (e) { }
$("#aufraeumen").onclick = () => {
  const b = $("#aufraeumen");
  if (!b.dataset.sicher) { b.dataset.sicher = "1"; b.lastChild.textContent = "Ja, wirklich entfernen"; return; }
  delete b.dataset.sicher; b.lastChild.textContent = "Gesendetes entfernen"; aufraeumen();
};
async function aufraeumen() {
  const x = L.exportiert; if (!x) return;
  const weg = q => x.quittungen.includes(q.pwaId);
  for (const q of L.quittungen.filter(weg)) for (const fid of q.fotoIds) await DB.del("fotos", fid).catch(() => { });
  L.quittungen = L.quittungen.filter(q => !weg(q));
  L.eintraege = L.eintraege.filter(e => !x.eintraege.includes(e.pwaId));
  L.gekocht = L.gekocht.filter(g => !x.gekocht.includes(g.pwaId));
  L.preise = L.preise.filter(p => !x.preise.includes(p.pwaId));
  L.exportiert = null;
  if (await sichern("quittungen", "eintraege", "gekocht", "preise", "exportiert")) toast("Aufgeräumt. Jetzt einen neuen Stand aus der Haushaltskasse laden.");
  alles();
}

/* ---------- Einstellungen ---------- */
let installEreignis = null;
addEventListener("beforeinstallprompt", ev => { ev.preventDefault(); installEreignis = ev; $("#install-btn").hidden = false; $("#install-info").textContent = ""; });
$("#install-btn").onclick = async () => { if (!installEreignis) return; installEreignis.prompt(); await installEreignis.userChoice.catch(() => null); installEreignis = null; $("#install-btn").hidden = true; };
function zeichneSpeicher() {
  const standalone = matchMedia("(display-mode: standalone)").matches;
  $("#install-info").textContent = standalone ? "Als App installiert." : installEreignis ? "" : "Zum Installieren im Chrome-Menü (⋮) «App installieren» tippen.";
  if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(p => { $("#speicher-info").textContent = p ? "Die Daten sind dauerhaft auf diesem Handy gespeichert." : "Die Daten liegen nur auf diesem Handy. Nicht die Website-Daten von Chrome löschen, solange etwas nicht gesendet ist."; }).catch(() => { });
}
ZEICHNER.abgleich = zeichneSenden;

/* ---------- Start ---------- */
function alles() { zeichneStand(); zeichneListe(); zeichneVorrat(); zeichnePreise(); zeichneQListe(); zeichneEListe(); zeichneGListe(); zeichneSenden(); if (!$("#p-budget").hidden) zeichneBudget(); }
(async function start() {
  iconsFuellen();
  zeichneNetz();
  try { for (const k of KEYS) { const v = await DB.get("kv", k); if (v !== undefined) L[k] = v; } }
  catch (e) { toast("Der Speicher auf dem Handy ist nicht verfügbar. Ist ein privates Fenster offen?"); }
  if (!L.zuordnung || typeof L.zuordnung !== "object") L.zuordnung = {};
  F.wer = Q.wer = L.ich;
  segBauen("q-wer", PERSONEN.map(p => [p, p]), Q.wer, v => Q.wer = v);
  segBauen("q-teil", [["geteilt", "50/50"], ["allein", "Allein"]], Q.teil, v => Q.teil = v);
  segBauen("g-wer", [...PERSONEN.map(p => [p, p]), ["Zusammen", "Zusammen"]], G.wer, v => G.wer = v);
  segBauen("ich", PERSONEN.map(p => [p, p]), L.ich, async v => { L.ich = v; await sichern("ich"); F.wer = Q.wer = v; segBauen("q-wer", PERSONEN.map(p => [p, p]), v, w => Q.wer = w); fLeeren(); });
  gSterne(); fLeeren(); zeichneQFotos(); zeichneSpeicher(); alles();
  let start = "liste"; try { start = localStorage.getItem("kasse-tab") || "liste"; } catch (e) { }
  tab(["liste", "erfassen", "preise", "budget", "abgleich"].includes(start) ? start : "liste");
})();
if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => { }));
