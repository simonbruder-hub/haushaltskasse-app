/* Kasse unterwegs – Ablage: gescannte Quittungen bleiben auf dem Handy (Bild in hoher Qualität + erkannter Text),
   durchsuchbar, als PDF mit Textebene teilen oder speichern. */
"use strict";
const Ablage = (() => {
  let liste = [], suche = "";
  async function laden() { try { liste = (await DB.alle("ablage")) || []; } catch (e) { liste = []; } liste.sort((a, b) => String(b.datum + b.erstellt).localeCompare(String(a.datum + a.erstellt))); return liste; }
  // seiten: [{ blob, breite, hoehe, woerter, wBreite, wHoehe, text }]
  async function speichern({ seiten, laden: ld, datum, total, eintragId, notiz }) {
    const id = uid(), rec = { id, erstellt: new Date().toISOString(), datum: datum || heute(), laden: ld || "", total: Number(total) || 0, eintragId: eintragId || null, notiz: notiz || "", text: seiten.map(s => s.text || "").join("\n"), seiten: [] };
    for (let i = 0; i < seiten.length; i++) {
      const s = seiten[i], fotoId = `ablage:${id}:${i}`;
      await DB.set("fotos", fotoId, s.blob);
      rec.seiten.push({ fotoId, breite: s.breite, hoehe: s.hoehe, woerter: s.woerter || [], wBreite: s.wBreite || s.breite, wHoehe: s.wHoehe || s.hoehe });
    }
    await DB.set("ablage", id, rec);
    await laden(); zeichnen();
    return rec;
  }
  async function loeschen(rec) {
    for (const s of rec.seiten) await DB.del("fotos", s.fotoId).catch(() => { });
    await DB.del("ablage", rec.id).catch(() => { });
    await laden(); zeichnen();
  }
  async function pdfBlob(rec) {
    const seiten = [];
    for (const s of rec.seiten) {
      const b = await DB.get("fotos", s.fotoId); if (!b) continue;
      seiten.push({ jpeg: new Uint8Array(await b.arrayBuffer()), breite: s.breite, hoehe: s.hoehe, woerter: s.woerter, woerterBreite: s.wBreite, woerterHoehe: s.wHoehe });
    }
    return new Blob([PDF.erstellen(seiten, `Quittung ${rec.laden} ${datumLang(rec.datum)}`)], { type: "application/pdf" });
  }
  const dateiname = rec => `Quittung-${(rec.laden || "Laden").replace(/[^A-Za-z0-9ÄÖÜäöü]+/g, "")}-${rec.datum}`;
  function herunterladen(blob, name) { const url = URL.createObjectURL(blob), a = h("a", { href: url, download: name }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
  async function teilen(rec) {
    const blob = await pdfBlob(rec), f = new File([blob], dateiname(rec) + ".pdf", { type: "application/pdf" });
    try { if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: f.name }); return; } } catch (e) { if (e && e.name === "AbortError") return; }
    herunterladen(blob, f.name);
  }
  function zeichnen() {
    const box = $("#ablage-liste"); if (!box) return;
    box.replaceChildren();
    const q = Produkte.norm(suche);
    const treffer = liste.filter(r => !q || Produkte.norm(`${r.laden} ${r.text} ${r.notiz} ${datumKurz(r.datum)} ${fmt(r.total)}`).includes(q));
    $("#ablage-sub").textContent = liste.length ? `${liste.length} ${liste.length === 1 ? "Quittung" : "Quittungen"} auf diesem Handy · durchsuchbar, als PDF teilbar` : "Gescannte Quittungen landen hier – auch offline";
    $("#ablage-suche").hidden = liste.length < 2;
    if (!liste.length) { box.appendChild(h("div", { class: "leer" }, h("span", { class: "bild" }, icon("ordner")), h("b", null, "Noch leer"), "Beim Speichern einer gescannten Quittung kommt sie automatisch in die Ablage.")); return; }
    if (!treffer.length) { box.appendChild(h("p", { class: "hint", style: "padding:8px 0" }, "Nichts gefunden.")); return; }
    for (const r of treffer.slice(0, 100)) {
      const thumb = h("div", { class: "foto", style: "width:46px;height:62px" });
      if (r.seiten[0]) DB.get("fotos", r.seiten[0].fotoId).then(b => { if (b) thumb.appendChild(h("img", { src: URL.createObjectURL(b), alt: "" })); }).catch(() => { });
      const treffzeile = q && r.text ? (() => { const z = r.text.split("\n").find(x => Produkte.norm(x).includes(q)); return z ? h("div", { class: "sub mono", style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, "… " + z.trim()) : null; })() : null;
      box.appendChild(h("button", { type: "button", class: "wartet ablage-zeile", onclick: () => zeigen(r) }, thumb,
        h("div", { style: "min-width:0;text-align:left" }, h("div", { style: "font-weight:650;display:flex;gap:7px;align-items:center" }, h("i", { class: "dot", style: "background:" + ladenFarbe(r.laden) }), r.laden || "Quittung"),
          h("div", { class: "sub" }, `${datumLang(r.datum)} · ${r.seiten.length} ${r.seiten.length === 1 ? "Seite" : "Seiten"}`), treffzeile),
        h("span", { class: "num" }, r.total ? fmt(r.total) : "")));
    }
    if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(e => { const el = $("#ablage-platz"); if (el && e.usage) el.textContent = `Belegt auf dem Handy: ${(e.usage / 1048576).toFixed(0)} MB`; }).catch(() => { });
  }
  async function zeigen(r) {
    const bilder = h("div", { class: "ablage-bilder" });
    for (const s of r.seiten) { const b = await DB.get("fotos", s.fotoId).catch(() => null); if (b) bilder.appendChild(h("img", { src: URL.createObjectURL(b), alt: "Quittung", loading: "lazy" })); }
    const loesch = h("button", { type: "button", class: "btn danger small", onclick: async () => { if (!loesch.dataset.sicher) { loesch.dataset.sicher = "1"; loesch.lastChild.textContent = "Wirklich löschen?"; return; } await loeschen(r); sheetZu(); toast("Aus der Ablage gelöscht"); } }, icon("muell"), "Löschen");
    sheetOeffnen(h("div", { class: "stack" },
      h("div", { class: "row zwischen" }, h("div", null, h("h3", null, r.laden || "Quittung"), h("p", { class: "small muted" }, datumLang(r.datum) + (r.total ? " · CHF " + fmt(r.total) : ""))), h("button", { type: "button", class: "icon-btn", "aria-label": "Schliessen", onclick: sheetZu }, icon("x"))),
      h("div", { class: "row" },
        h("button", { type: "button", class: "btn primary", onclick: () => teilen(r) }, icon("teilen"), "PDF teilen"),
        h("button", { type: "button", class: "btn", onclick: async () => herunterladen(await pdfBlob(r), dateiname(r) + ".pdf") }, icon("pdf"), "PDF speichern"),
        h("button", { type: "button", class: "btn", onclick: async () => { const b = await DB.get("fotos", r.seiten[0].fotoId); if (b) herunterladen(b, dateiname(r) + ".jpg"); } }, icon("bild"), "Bild")),
      bilder,
      r.text ? h("details", { class: "mehr" }, h("summary", null, icon("bon"), "Erkannter Text", h("span", { class: "dreh-wrap" }, icon("runter"))), h("pre", { class: "ablage-text" }, r.text)) : null,
      h("div", null, loesch)));
  }
  $("#ablage-suche").addEventListener("input", ev => { suche = ev.target.value; zeichnen(); });
  return { laden, speichern, zeichnen, pdfBlob, loeschen, alle: () => liste };
})();
