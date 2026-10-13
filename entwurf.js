/* Kasse unterwegs – Entwürfe: Android beendet Apps im Hintergrund (z. B. beim Wechsel zur Kamera oder in eine andere App).
   Damit nichts verloren geht, sichert die App alle ungespeicherten Eingaben, Fotos und gelesenen Quittungen laufend
   und stellt sie beim nächsten Start wieder her. */
"use strict";
const ENTWURF_FELDER = ["l-neu", "f-datum", "f-betrag", "f-notiz", "f-resto", "f-laden-andere", "g-titel", "q-notiz", "pr-name", "pr-preis", "pr-menge", "pr-einheit", "pr-laden"];
let entwurfT = null, entwurfBereit = false, entwurfLaeuft = false, entwurfNochmal = false;
function entwurfBald() { if (!entwurfBereit) return; clearTimeout(entwurfT); entwurfT = setTimeout(entwurfSichern, 400); }
async function entwurfSichern() {
  if (!entwurfBereit) return;
  if (entwurfLaeuft) { entwurfNochmal = true; return; }
  entwurfLaeuft = true;
  try {
    const felder = {}; for (const id of ENTWURF_FELDER) { const el = $("#" + id); if (el) felder[id] = el.value; }
    const fotos = [];
    for (const f of Q.fotos) {
      if (!f.gesichert) { await DB.set("fotos", `entwurf:${f.id}:roh`, f.roh); await DB.set("fotos", `entwurf:${f.id}:orig`, f.orig); await DB.set("fotos", `entwurf:${f.id}:klein`, f.blob); f.gesichert = true; }
      fotos.push({ id: f.id, ecken: f.ecken, modus: f.modus, drehung: f.drehung, breite: f.breite, hoehe: f.hoehe, scan: f.scan, text: f.text, woerter: f.woerter || null, wB: f.wB, wH: f.wH, fehler: f.fehler });
    }
    const leer = !fotos.length && !F.artikel.length && !Object.entries(felder).some(([k, v]) => v && !(k === "f-datum" && v === heute()) && !(k === "pr-laden" || k === "pr-einheit"));
    await DB.set("kv", "entwurf", leer ? null : { zeit: Date.now(), felder, F: { typ: F.typ, laden: F.laden, wer: F.wer, teil: F.teil, teilBeruehrt: F.teilBeruehrt, ausBon: F.ausBon, bon: F.bon, artikel: F.artikel }, G: { wer: G.wer, sterne: G.sterne }, Q: { wer: Q.wer, teil: Q.teil }, fotos });
    // Fotos alter Entwürfe aufräumen
    const ids = new Set(Q.fotos.map(f => f.id));
    for (const k of await DB.schluessel("fotos")) { const m = String(k).match(/^entwurf:([^:]+):/); if (m && !ids.has(m[1])) await DB.del("fotos", k); }
  } catch (e) { /* Speicher voll o. ä.: beim nächsten Mal wieder versuchen */ }
  entwurfLaeuft = false;
  if (entwurfNochmal) { entwurfNochmal = false; entwurfSichern(); }
}
async function entwurfLaden() {
  let e = null; try { e = await DB.get("kv", "entwurf"); } catch (x) { e = null; }
  try {
    if (!e) return;
    for (const [id, v] of Object.entries(e.felder || {})) { const el = $("#" + id); if (el && v != null) el.value = v; }
    if (e.G) { G.wer = e.G.wer || G.wer; G.sterne = e.G.sterne || 0; segBauen("g-wer", [...PERSONEN.map(p => [p, p]), ["Zusammen", "Zusammen"]], G.wer, v => G.wer = v); gSterne(); }
    if (e.Q) { Q.wer = e.Q.wer || Q.wer; Q.teil = e.Q.teil || Q.teil; segBauen("q-wer", PERSONEN.map(p => [p, p]), Q.wer, v => Q.wer = v); segBauen("q-teil", [["geteilt", "50/50"], ["allein", "Allein"]], Q.teil, v => Q.teil = v); }
    if (e.F) {
      Object.assign(F, e.F, { artikel: Array.isArray(e.F.artikel) ? e.F.artikel : [] });
      segBauen("f-typ", [["einkauf", "Einkauf"], ["auswaerts", "Auswärts essen"]], F.typ, fTyp);
      segBauen("f-wer", PERSONEN.map(p => [p, p]), F.wer, v => F.wer = v);
      segBauen("f-teil", [["geteilt", "50/50"], ["allein", "Allein"]], F.teil, v => { F.teil = v; F.teilBeruehrt = true; });
      ladenChips(); fTyp(F.typ);
      if (F.ausBon) zeichneBonHinweis(true);
      zeichneArtikel();
    }
    for (const m of e.fotos || []) {
      const [roh, orig, klein] = await Promise.all(["roh", "orig", "klein"].map(t => DB.get("fotos", `entwurf:${m.id}:${t}`)));
      if (!orig) continue;
      Q.fotos.push({ ...m, roh: roh || orig, orig, blob: klein || orig, url: URL.createObjectURL(klein || orig), gesichert: true });
    }
    zeichneQFotos();
    if (Q.fotos.length) {
      if (Q.fotos.some(f => f.text == null && !f.fehler)) qLesen();
      else if (!F.ausBon) qAuswerten();
      else qStatus("ok", h("span", null, h("b", null, "Wiederhergestellt. "), "Deine Quittung ist noch nicht gespeichert – unten prüfen und speichern."));
    }
    if (e.F && (F.ausBon || F.artikel.length || zahl($("#f-betrag").value) > 0)) toast("Nicht gespeicherte Eingaben wiederhergestellt");
  } finally {
    entwurfBereit = true;
  }
}
// Jede Eingabe sichert, beim Verlassen der App sofort
document.addEventListener("input", entwurfBald, true);
document.addEventListener("change", entwurfBald, true);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { clearTimeout(entwurfT); entwurfSichern(); } });
addEventListener("pagehide", () => { clearTimeout(entwurfT); entwurfSichern(); });
