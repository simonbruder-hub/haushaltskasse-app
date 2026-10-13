/* Kasse unterwegs – Scanner: Kamera in der App mit automatischer Kantenerkennung und Auslöser,
   Zuschneiden mit verschiebbaren Ecken und Lupe, Perspektive entzerren, Kontrast verbessern. */
"use strict";
const Scanner = (() => {
  const MODI = [["kontrast", "Kontrast"], ["farbe", "Farbe"], ["sw", "S/W"]];
  let modus = "kontrast";
  try { modus = localStorage.getItem("kasse-scanmodus") || "kontrast"; } catch (e) { }

  // Foto + Ecken → fertige Seite (hohe JPEG-Qualität)
  async function verarbeiten(quelle, ecken, m, drehung) {
    let bild = quelle instanceof Blob ? await Bild.laden(quelle) : quelle;
    if (drehung) bild = Bild.drehen(bild, drehung);
    const W = Bild.breite(bild), H = Bild.hoehe(bild);
    const px = ecken.map(p => ({ x: p.x * W, y: p.y * H }));
    const c = Bild.verbessern(Bild.entzerren(bild, px, 4000), m || modus);
    const blob = await Bild.zuBlob(c, "image/jpeg", 0.92);
    return { blob, breite: c.width, hoehe: c.height };
  }
  const ganz = () => [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

  /* ---------- Kamera ---------- */
  let ui = null, stream = null, track = null, worker = null, loopT = null, beschaeftigt = false, ziel = null, geglaettet = null, verlauf = [], stabilSeit = 0, sperreBis = 0, auto = true, seiten = [], fertigCb = null, aufnahmeLaeuft = false, bildCap = null;
  function wk() {
    if (!worker) { try { worker = new Worker("scan-worker.js"); worker.onmessage = e => { beschaeftigt = false; ergebnis(e.data.r); }; worker.onerror = () => { worker = null; beschaeftigt = false; }; } catch (e) { worker = null; } }
    return worker;
  }
  async function oeffnen({ fertig } = {}) {
    fertigCb = fertig; seiten = [];
    ui = h("div", { class: "scanner", role: "dialog", "aria-modal": "true", "aria-label": "Quittung scannen" },
      h("video", { playsinline: true, muted: true, autoplay: true }),
      h("canvas", { class: "ueber" }),
      h("div", { class: "blitz" }),
      h("div", { class: "sc-oben" },
        h("button", { type: "button", class: "sc-rund", "aria-label": "Schliessen", onclick: () => schliessen(false) }, icon("x")),
        h("span", { class: "sc-hinweis", id: "sc-hinweis" }, "Kamera startet …"),
        h("button", { type: "button", class: "sc-rund", id: "sc-licht", "aria-label": "Licht", hidden: true, onclick: licht }, icon("licht"))),
      h("div", { class: "sc-unten" },
        h("div", { class: "sc-leiste" },
          h("button", { type: "button", class: "sc-pill", id: "sc-auto", "aria-pressed": String(auto), onclick: ev => { auto = !auto; ev.currentTarget.setAttribute("aria-pressed", String(auto)); ev.currentTarget.lastChild.textContent = auto ? "Auto" : "Manuell"; } }, icon("blitzauto"), auto ? "Auto" : "Manuell"),
          segBauen(h("div", { class: "seg klein sc-seg", role: "group", "aria-label": "Bildart" }), MODI, modus, v => { modus = v; try { localStorage.setItem("kasse-scanmodus", v); } catch (e) { } })),
        h("div", { class: "sc-knoepfe" },
          h("label", { class: "sc-rund gross", "aria-label": "Aus der Galerie" }, icon("bild"), h("input", { type: "file", accept: "image/*", multiple: true, class: "sr", tabindex: "-1", onchange: ev => { galerie(ev.target.files); ev.target.value = ""; } })),
          h("button", { type: "button", class: "sc-ausloeser", id: "sc-ausloeser", "aria-label": "Aufnehmen", onclick: () => aufnehmen() }, h("svg", { class: "ring" })),
          h("button", { type: "button", class: "sc-fertig", id: "sc-fertig", disabled: true, onclick: () => schliessen(true) }, h("span", { class: "sc-thumbs", id: "sc-thumbs" }), h("span", null, "Fertig"))),
        h("p", { class: "sc-tipp" }, "Lange Quittung? Teil für Teil von oben nach unten aufnehmen.")));
    ui.querySelector(".sc-ausloeser svg").outerHTML = '<svg class="ring" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="36" class="bg"/><circle cx="40" cy="40" r="36" class="fg" stroke-dasharray="226.2" stroke-dashoffset="226.2"/></svg>';
    document.body.appendChild(ui); document.body.style.overflow = "hidden";
    const video = ui.querySelector("video");
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } } });
    } catch (e) {
      hinweis(e && e.name === "NotAllowedError" ? "Kein Zugriff auf die Kamera – in den Einstellungen erlauben oder die Galerie nutzen." : "Kamera nicht verfügbar – Galerie nutzen.", "fehler");
      return;
    }
    if (!ui) { stream.getTracks().forEach(t => t.stop()); return; }
    video.srcObject = stream; track = stream.getVideoTracks()[0];
    try { await video.play(); } catch (e) { }
    try { const cap = track.getCapabilities ? track.getCapabilities() : {}; if (cap.torch) ui.querySelector("#sc-licht").hidden = false; if (cap.focusMode && cap.focusMode.includes("continuous")) track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => { }); } catch (e) { }
    try { if ("ImageCapture" in window) bildCap = new ImageCapture(track); } catch (e) { bildCap = null; }
    hinweis("Quittung ins Bild halten");
    schleife();
  }
  let lichtAn = false;
  function licht() { if (!track) return; lichtAn = !lichtAn; track.applyConstraints({ advanced: [{ torch: lichtAn }] }).catch(() => { }); ui.querySelector("#sc-licht").classList.toggle("an", lichtAn); }
  function hinweis(t, art) { const el = ui && ui.querySelector("#sc-hinweis"); if (el) { el.textContent = t; el.className = "sc-hinweis" + (art ? " " + art : ""); } }
  const probe = document.createElement("canvas");
  function schleife() {
    clearTimeout(loopT);
    if (!ui) return;
    const video = ui.querySelector("video");
    if (video.videoWidth && !beschaeftigt && !aufnahmeLaeuft) {
      const f = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight));
      probe.width = Math.round(video.videoWidth * f); probe.height = Math.round(video.videoHeight * f);
      const ctx = probe.getContext("2d", { willReadFrequently: true }); ctx.drawImage(video, 0, 0, probe.width, probe.height);
      const d = ctx.getImageData(0, 0, probe.width, probe.height);
      const w = wk();
      if (w) { beschaeftigt = true; w.postMessage({ id: Date.now(), d: d.data.buffer, W: probe.width, H: probe.height }, [d.data.buffer]); }
      else ergebnis(Bild.findenDaten(d.data, probe.width, probe.height));
    }
    zeichnen();
    loopT = setTimeout(schleife, 120);
  }
  function ergebnis(r) {
    const jetzt = performance.now();
    if (r && r.guete >= 0.5) {
      ziel = r.ecken;
      verlauf.push({ t: jetzt, e: r.ecken }); verlauf = verlauf.filter(v => jetzt - v.t < 1200);
      const ruhig = verlauf.length >= 3 && verlauf.every(v => v.e.every((p, i) => Math.hypot(p.x - r.ecken[i].x, p.y - r.ecken[i].y) < 0.025));
      if (ruhig) { if (!stabilSeit) stabilSeit = jetzt; } else stabilSeit = 0;
      const dauer = stabilSeit ? jetzt - stabilSeit : 0;
      if (!aufnahmeLaeuft) hinweis(auto ? (dauer > 0 ? "Ruhig halten …" : "Quittung erkannt") : "Erkannt – auslösen", "ok");
      ring(auto ? Math.min(1, dauer / 900) : 0);
      if (auto && dauer > 900 && jetzt > sperreBis && !aufnahmeLaeuft) aufnehmen(r.ecken);
    } else {
      verlauf = []; stabilSeit = 0; ring(0);
      if (!aufnahmeLaeuft && ui) hinweis(ziel ? "Quittung ins Bild halten" : "Quittung ins Bild halten – heller Untergrund geht, Kontrast hilft");
      ziel = null;
    }
  }
  function ring(a) { const fg = ui && ui.querySelector(".sc-ausloeser .fg"); if (fg) fg.setAttribute("stroke-dashoffset", String(226.2 * (1 - a))); }
  // Viereck über das Video zeichnen (Video füllt den Bildschirm: «cover»)
  function zeichnen() {
    if (!ui) return;
    const video = ui.querySelector("video"), cv = ui.querySelector(".ueber");
    const cw = cv.clientWidth, ch = cv.clientHeight, dpr = devicePixelRatio || 1;
    if (cv.width !== Math.round(cw * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
    const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cw, ch);
    if (!ziel || !video.videoWidth) { geglaettet = null; return; }
    geglaettet = geglaettet ? geglaettet.map((p, i) => ({ x: p.x + (ziel[i].x - p.x) * 0.45, y: p.y + (ziel[i].y - p.y) * 0.45 })) : ziel;
    const s = Math.max(cw / video.videoWidth, ch / video.videoHeight), ox = (cw - video.videoWidth * s) / 2, oy = (ch - video.videoHeight * s) / 2;
    const pts = geglaettet.map(p => ({ x: ox + p.x * video.videoWidth * s, y: oy + p.y * video.videoHeight * s }));
    ctx.fillStyle = "rgba(10, 20, 14, .35)"; ctx.beginPath(); ctx.rect(0, 0, cw, ch); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.fill("evenodd");
    ctx.strokeStyle = stabilSeit ? "#5cf0a8" : "#ffffff"; ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = "#ffffff"; for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill(); }
  }
  async function aufnehmen(liveEcken) {
    if (!ui || aufnahmeLaeuft) return;
    const video = ui.querySelector("video"); if (!video.videoWidth) return;
    aufnahmeLaeuft = true; ring(0);
    const bl = ui.querySelector(".blitz"); bl.classList.remove("an"); void bl.offsetWidth; bl.classList.add("an");
    if (navigator.vibrate) try { navigator.vibrate(30); } catch (e) { }
    hinweis("Wird verarbeitet …", "ok");
    try {
      let roh = null;
      if (bildCap && bildCap.takePhoto) { try { roh = await bildCap.takePhoto(); } catch (e) { roh = null; } }
      if (!roh) { const c = document.createElement("canvas"); c.width = video.videoWidth; c.height = video.videoHeight; c.getContext("2d").drawImage(video, 0, 0); roh = await Bild.zuBlob(c, "image/jpeg", 0.95); }
      const bmp = await Bild.laden(roh);
      const f = Bild.finden(bmp);
      const ecken = f && f.guete >= 0.45 ? f.ecken : (liveEcken || ziel || ganz());
      const s = await verarbeiten(bmp, ecken, modus);
      seiten.push({ roh, ecken, modus, drehung: 0, ...s, url: URL.createObjectURL(s.blob) });
      thumbs();
      hinweis(`Teil ${seiten.length} aufgenommen – weiterer Teil oder «Fertig»`, "ok");
    } catch (e) { hinweis("Aufnahme ging nicht – nochmals versuchen", "fehler"); }
    sperreBis = performance.now() + 2500; verlauf = []; stabilSeit = 0;
    aufnahmeLaeuft = false;
  }
  function thumbs() {
    const box = ui.querySelector("#sc-thumbs"); box.replaceChildren(...seiten.slice(-3).map(s => h("img", { src: s.url, alt: "" })));
    ui.querySelector("#sc-fertig").disabled = !seiten.length;
    ui.querySelector("#sc-fertig").lastChild.textContent = seiten.length ? `Fertig (${seiten.length})` : "Fertig";
  }
  async function galerie(files) {
    for (const f of Array.from(files || [])) {
      const s = await zuschneiden(f);
      if (s) { seiten.push({ ...s, url: URL.createObjectURL(s.blob) }); if (ui) thumbs(); }
    }
  }
  function schliessen(uebernehmen) {
    clearTimeout(loopT);
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; track = null; bildCap = null; ziel = null; geglaettet = null; verlauf = []; lichtAn = false;
    if (ui) ui.remove(); ui = null; document.body.style.overflow = "";
    const s = seiten; seiten = [];
    if (uebernehmen && s.length && fertigCb) fertigCb(s);
    else for (const x of s) URL.revokeObjectURL(x.url);
  }

  /* ---------- Zuschneiden ---------- */
  // Liefert { blob, roh, ecken, modus, drehung, breite, hoehe } oder null (abgebrochen)
  function zuschneiden(roh, start) {
    return new Promise(async aufloesen => {
      let bmp = null;
      try { bmp = await Bild.laden(roh); } catch (e) { toast("Dieses Bild lässt sich nicht öffnen."); aufloesen(null); return; }
      let drehung = (start && start.drehung) || 0, bild = drehung ? Bild.drehen(bmp, drehung) : bmp;
      let ecken = start && start.ecken ? start.ecken.map(p => ({ ...p })) : null, m = (start && start.modus) || modus;
      if (!ecken) { const f = Bild.finden(bild); ecken = f && f.guete >= 0.35 ? f.ecken : [{ x: 0.06, y: 0.04 }, { x: 0.94, y: 0.04 }, { x: 0.94, y: 0.96 }, { x: 0.06, y: 0.96 }]; }
      const cv = h("canvas", { class: "zs-bild" }), lupe = h("canvas", { class: "lupe", width: "220", height: "220", hidden: true });
      const griffe = [0, 1, 2, 3].map(i => h("span", { class: "zs-ecke", "data-i": String(i), role: "slider", "aria-label": ["Ecke oben links", "Ecke oben rechts", "Ecke unten rechts", "Ecke unten links"][i] }));
      const kanten = [0, 1, 2, 3].map(i => h("span", { class: "zs-kante", "data-k": String(i), "aria-label": ["Oberkante", "rechte Kante", "Unterkante", "linke Kante"][i] }));
      const buehne = h("div", { class: "zs-buehne" }, cv, ...kanten, ...griffe, lupe);
      const fertig = r => { el.remove(); document.body.style.overflow = ""; aufloesen(r); };
      const uebernehmen = h("button", { type: "button", class: "btn primary gross", onclick: async () => {
        uebernehmen.disabled = true; uebernehmen.lastChild.textContent = "Wird verarbeitet …";
        try { const s = await verarbeiten(bmp, ecken, m, drehung); try { localStorage.setItem("kasse-scanmodus", m); } catch (e) { } modus = m; fertig({ roh, ecken, modus: m, drehung, ...s }); }
        catch (e) { uebernehmen.disabled = false; uebernehmen.lastChild.textContent = "Übernehmen"; toast("Das Bild liess sich nicht verarbeiten."); }
      } }, icon("haken"), "Übernehmen");
      const el = h("div", { class: "zuschnitt", role: "dialog", "aria-modal": "true", "aria-label": "Zuschneiden" },
        h("div", { class: "zs-oben" }, h("button", { type: "button", class: "sc-rund", "aria-label": "Abbrechen", onclick: () => fertig(null) }, icon("x")), h("b", null, "Zuschneiden"), h("span", { style: "width:44px" })),
        buehne,
        h("div", { class: "zs-unten" },
          h("p", { class: "zs-tipp" }, "Ecken oder Kanten ziehen. Tipp: Kopf mit Adresse und Fussteil weglassen – dann liest die App nur die Artikel."),
          h("div", { class: "row", style: "justify-content:center;gap:6px" },
            h("button", { type: "button", class: "btn small", onclick: () => { drehung = (drehung + 90) % 360; bild = drehung ? Bild.drehen(bmp, drehung) : bmp; ecken = ecken.map(p => ({ x: 1 - p.y, y: p.x })); ecken = [ecken[3], ecken[0], ecken[1], ecken[2]]; malen(); } }, icon("drehen"), "Drehen"),
            h("button", { type: "button", class: "btn small", onclick: () => { const f = Bild.finden(bild); if (f && f.guete >= 0.35) { ecken = f.ecken; malen(); } else toast("Keine Kanten gefunden – Ecken bitte von Hand setzen."); } }, icon("zauber"), "Automatisch"),
            h("button", { type: "button", class: "btn small", onclick: () => { ecken = ganz(); malen(); } }, icon("rahmen"), "Ganzes Bild")),
          h("div", { class: "row", style: "justify-content:center" }, segBauen(h("div", { class: "seg", role: "group", "aria-label": "Bildart" }), MODI, m, v => { m = v; })),
          uebernehmen));
      document.body.appendChild(el); document.body.style.overflow = "hidden";
      // Darstellung: Bild einpassen
      let lage = { s: 1, ox: 0, oy: 0, w: 1, h: 1 };
      function malen() {
        const bw = buehne.clientWidth, bh = buehne.clientHeight, dpr = devicePixelRatio || 1, W = Bild.breite(bild), H = Bild.hoehe(bild);
        const s = Math.min(bw / W, bh / H) * 0.94, w = W * s, hh = H * s, ox = (bw - w) / 2, oy = (bh - hh) / 2;
        lage = { s, ox, oy, w, h: hh };
        cv.style.cssText = `left:${ox}px;top:${oy}px;width:${w}px;height:${hh}px`;
        cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr);
        const ctx = cv.getContext("2d"); ctx.drawImage(bild, 0, 0, cv.width, cv.height);
        // ausserhalb abdunkeln
        const P = ecken.map(p => ({ x: p.x * cv.width, y: p.y * cv.height }));
        ctx.fillStyle = "rgba(10, 16, 12, .55)"; ctx.beginPath(); ctx.rect(0, 0, cv.width, cv.height); P.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.fill("evenodd");
        ctx.strokeStyle = "#5cf0a8"; ctx.lineWidth = 2.5 * dpr; ctx.beginPath(); P.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();
        griffe.forEach((g, i) => { g.style.left = (ox + ecken[i].x * w) + "px"; g.style.top = (oy + ecken[i].y * hh) + "px"; g.setAttribute("aria-valuetext", `${Math.round(ecken[i].x * 100)} %, ${Math.round(ecken[i].y * 100)} %`); });
        kanten.forEach((k, i) => { const a = ecken[i], b = ecken[(i + 1) % 4]; k.style.left = (ox + (a.x + b.x) / 2 * w) + "px"; k.style.top = (oy + (a.y + b.y) / 2 * hh) + "px"; });
      }
      function lupeZeigen(p) {
        const W = Bild.breite(bild), H = Bild.hoehe(bild), ctx = lupe.getContext("2d"), z = 3, r = 110;
        lupe.hidden = false;
        const px = p.x * W, py = p.y * H, quell = r / (lage.s * z);
        ctx.save(); ctx.clearRect(0, 0, 220, 220); ctx.beginPath(); ctx.arc(r, r, r - 2, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(bild, px - quell, py - quell, quell * 2, quell * 2, 0, 0, 220, 220);
        ctx.strokeStyle = "#5cf0a8"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(r - 14, r); ctx.lineTo(r + 14, r); ctx.moveTo(r, r - 14); ctx.lineTo(r, r + 14); ctx.stroke(); ctx.restore();
        const sx = lage.ox + p.x * lage.w, sy = lage.oy + p.y * lage.h;
        lupe.style.left = Math.min(buehne.clientWidth - 120, Math.max(0, sx - 55)) + "px"; lupe.style.top = Math.max(0, sy - 150) + "px";
      }
      // Ziehen: Ecke oder ganze Kante (zwei Ecken)
      let ziehen = null;
      const pos = ev => { const r = buehne.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (ev.clientX - r.left - lage.ox) / lage.w)), y: Math.min(1, Math.max(0, (ev.clientY - r.top - lage.oy) / lage.h)) }; };
      buehne.addEventListener("pointerdown", ev => {
        const t = ev.target.closest(".zs-ecke, .zs-kante"); if (!t) return;
        ev.preventDefault(); t.setPointerCapture(ev.pointerId);
        const p0 = pos(ev);
        ziehen = t.classList.contains("zs-ecke") ? { ecke: +t.dataset.i } : { kante: +t.dataset.k, start: p0, alt: ecken.map(p => ({ ...p })) };
      });
      buehne.addEventListener("pointermove", ev => {
        if (!ziehen) return; const p = pos(ev);
        if (ziehen.ecke != null) { ecken[ziehen.ecke] = p; lupeZeigen(p); }
        else { const i = ziehen.kante, j = (i + 1) % 4, dx = p.x - ziehen.start.x, dy = p.y - ziehen.start.y; for (const k of [i, j]) ecken[k] = { x: Math.min(1, Math.max(0, ziehen.alt[k].x + dx)), y: Math.min(1, Math.max(0, ziehen.alt[k].y + dy)) }; lupeZeigen(ecken[i]); }
        malen();
      });
      const loslassen = () => { ziehen = null; lupe.hidden = true; };
      buehne.addEventListener("pointerup", loslassen); buehne.addEventListener("pointercancel", loslassen);
      addEventListener("resize", malen, { once: true });
      requestAnimationFrame(malen);
    });
  }
  return { oeffnen, zuschneiden, verarbeiten, schliessen };
})();
