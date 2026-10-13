/* Quittungen auf dem Handy auslesen – Texterkennung (Tesseract) und Auswertung für Schweizer Kassenzettel.
   Läuft komplett auf dem Gerät, auch ohne Netz. */
(function () {
  "use strict";
  let basis = new URL("ocr/", document.baseURI).href;
  let workerP = null, fortschritt = null;

  function worker() {
    if (!workerP) {
      workerP = Tesseract.createWorker("deu", 1, {
        workerPath: basis + "worker.min.js",
        corePath: basis.replace(/\/$/, ""),
        langPath: basis.replace(/\/$/, ""),
        gzip: true,
        workerBlobURL: false,
        logger: m => { if (fortschritt) fortschritt(m); }
      }).then(async w => {
        await w.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1", user_defined_dpi: "300" });
        return w;
      }).catch(e => { workerP = null; throw e; });
    }
    return workerP;
  }

  // Bild aufbereiten: richtig drehen, hellsten Farbkanal nehmen (farbiger Hintergrund verschwindet),
  // Kontrast strecken und mit lokaler Schwelle (Bradley) in Schwarz/Weiss umwandeln
  async function vorbereiten(blob, opt = {}) {
    const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const f = Math.min(1, (opt.max || 4000) / Math.max(bmp.width, bmp.height));
    const W0 = Math.round(bmp.width * f), H0 = Math.round(bmp.height * f);
    const c0 = document.createElement("canvas"); c0.width = W0; c0.height = H0;
    const ctx0 = c0.getContext("2d", { willReadFrequently: true });
    ctx0.drawImage(bmp, 0, 0, W0, H0);
    if (bmp.close) bmp.close();
    const img0 = ctx0.getImageData(0, 0, W0, H0), d0 = img0.data;
    let g = new Uint8ClampedArray(W0 * H0);
    const weiss = new Uint8ClampedArray(W0 * H0);
    for (let i = 0, j = 0; i < d0.length; i += 4, j++) weiss[j] = Math.min(d0[i], d0[i + 1], d0[i + 2]);
    const hist = new Uint32Array(256);
    for (let i = 0, j = 0; i < d0.length; i += 4, j++) {
      const v = opt.kanal === "lum" ? (d0[i] * 299 + d0[i + 1] * 587 + d0[i + 2] * 114) / 1000 | 0 : Math.max(d0[i], d0[i + 1], d0[i + 2]);
      g[j] = v; hist[v]++;
    }
    const n = W0 * H0; let lo = 0, hi = 255, s = 0;
    for (; lo < 255; lo++) { s += hist[lo]; if (s > n * 0.01) break; }
    s = 0; for (; hi > 0; hi--) { s += hist[hi]; if (s > n * 0.05) break; }
    const span = Math.max(1, hi - lo);
    for (let j = 0; j < g.length; j++) g[j] = (g[j] - lo) * 255 / span;
    let W = W0, H = H0;
    if (opt.zuschneiden !== false) {
      const box = quittungFinden(weiss, W, H);
      if (box) {
        const z = new Uint8ClampedArray(box.w * box.h);
        for (let y = 0; y < box.h; y++) z.set(g.subarray((box.y + y) * W + box.x, (box.y + y) * W + box.x + box.w), y * box.w);
        g = z; W = box.w; H = box.h;
      }
    }
    if (opt.schwelle !== false) {
      // Integralbild für schnelle Fenstermittelwerte
      const integ = new Float64Array((W + 1) * (H + 1));
      for (let y = 1; y <= H; y++) { let zeile = 0; for (let x = 1; x <= W; x++) { zeile += g[(y - 1) * W + x - 1]; integ[y * (W + 1) + x] = integ[(y - 1) * (W + 1) + x] + zeile; } }
      const r = Math.max(8, Math.round(Math.max(W, H) / (opt.fenster || 40))), t = opt.t || 0.18;
      for (let y = 0; y < H; y++) {
        const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
        for (let x = 0; x < W; x++) {
          const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
          const summe = integ[y1 * (W + 1) + x1] - integ[y0 * (W + 1) + x1] - integ[y1 * (W + 1) + x0] + integ[y0 * (W + 1) + x0];
          const mittel = summe / ((x1 - x0) * (y1 - y0));
          g[y * W + x] = g[y * W + x] < mittel * (1 - t) ? 0 : 255;
        }
      }
    }
    if (opt.schwelle !== false && opt.entrauschen !== false) entrauschen(g, W, H);
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const img = ctx.createImageData(W, H), d = img.data;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) { d[i] = d[i + 1] = d[i + 2] = g[j]; d[i + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    if (opt.schwelle === false || opt.gerade === false) return c;
    const winkel = schraege(g, W, H);
    c.winkel = winkel;
    if (Math.abs(winkel) < 0.15) return c;
    // Begradigen: um den gefundenen Winkel zurückdrehen, danach wieder hart schwarz/weiss
    const r = document.createElement("canvas"); r.width = W; r.height = H;
    const rc = r.getContext("2d", { willReadFrequently: true });
    rc.fillStyle = "#fff"; rc.fillRect(0, 0, W, H);
    rc.translate(W / 2, H / 2); rc.rotate(-winkel * Math.PI / 180); rc.drawImage(c, -W / 2, -H / 2);
    const ri = rc.getImageData(0, 0, W, H), rd = ri.data;
    for (let i = 0; i < rd.length; i += 4) rd[i] = rd[i + 1] = rd[i + 2] = rd[i] < 160 ? 0 : 255;
    rc.setTransform(1, 0, 0, 1, 0, 0); rc.putImageData(ri, 0, 0);
    r.winkel = winkel;
    return r;
  }

  // Die helle, ungefärbte Papierfläche finden und den Hintergrund (Tisch) wegschneiden
  function otsu(werte) {
    const hist = new Uint32Array(256); for (const v of werte) hist[Math.max(0, Math.min(255, Math.round(v)))]++;
    let total = 0, sumAll = 0; for (let v = 0; v < 256; v++) { total += hist[v]; sumAll += v * hist[v]; }
    let wB = 0, sumB = 0, best = 0, t = 128;
    for (let v = 0; v < 256; v++) { wB += hist[v]; if (!wB) continue; const wF = total - wB; if (!wF) break; sumB += v * hist[v]; const zw = wB * wF * (sumB / wB - (sumAll - sumB) / wF) ** 2; if (zw > best) { best = zw; t = v; } }
    return t;
  }
  function median(arr) { const a = Array.from(arr).sort((x, y) => x - y); return a[a.length >> 1]; }
  function laengsterLauf(an, luecke) {
    let bestS = -1, bestL = 0, s0 = -1, letzt = -1e9;
    for (let i = 0; i < an.length; i++) if (an[i]) { if (i - letzt > luecke) s0 = i; letzt = i; if (i - s0 + 1 > bestL) { bestL = i - s0 + 1; bestS = s0; } }
    return bestL ? [bestS, bestS + bestL - 1] : null;
  }
  function quittungFinden(w, W, H) {
    const sp = new Float32Array(W), tmp = new Uint8Array(Math.ceil(H / 4));
    for (let x = 0; x < W; x++) { let k = 0; for (let y = 0; y < H; y += 4) tmp[k++] = w[y * W + x]; sp[x] = median(tmp.subarray(0, k)); }
    const t = otsu(sp);
    const xs = laengsterLauf(Array.from(sp, v => v > t), Math.round(W * 0.02));
    if (!xs) return null;
    const bw = xs[1] - xs[0] + 1;
    if (bw < W * 0.15 || bw > W * 0.95) return null;
    const ze = new Float32Array(H), tmp2 = new Uint8Array(Math.ceil(bw / 4));
    for (let y = 0; y < H; y++) { let k = 0; for (let x = xs[0]; x <= xs[1]; x += 4) tmp2[k++] = w[y * W + x]; ze[y] = median(tmp2.subarray(0, k)); }
    const ys = laengsterLauf(Array.from(ze, v => v > t), Math.round(H * 0.03)) || [0, H - 1];
    const pad = Math.round(Math.max(W, H) * 0.008);
    const x = Math.max(0, xs[0] - pad), y = Math.max(0, ys[0] - pad);
    return { x, y, w: Math.min(W, xs[1] + pad + 1) - x, h: Math.min(H, ys[1] + pad + 1) - y };
  }

  // Einzelne schwarze Pixel ohne Nachbarn (Tischstruktur, Papierkörnung) entfernen
  function entrauschen(g, W, H) {
    const weg = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x; if (g[i]) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && !g[i + dy * W + dx]) n++;
      if (n < 2) weg.push(i);
    }
    for (const i of weg) g[i] = 255;
  }

  // Schräglage schätzen: Winkel, bei dem die Textzeilen am schärfsten waagrecht stehen
  function schraege(g, W, H) {
    const schritt = Math.max(1, Math.round(W / 700)), pts = [];
    for (let y = 0; y < H; y += schritt) for (let x = 0; x < W; x += schritt) if (!g[y * W + x]) pts.push(x, y);
    if (pts.length < 200) return 0;
    let best = 0, bestV = -1;
    const zeilen = new Float64Array(Math.ceil(H / schritt) + Math.ceil(W / schritt) + 10);
    const off = Math.ceil(W / schritt) + 5;
    for (let a = -6; a <= 6.0001; a += 0.2) {
      const sin = Math.sin(a * Math.PI / 180), cos = Math.cos(a * Math.PI / 180);
      zeilen.fill(0);
      for (let k = 0; k < pts.length; k += 2) { const yy = Math.round((pts[k + 1] * cos - pts[k] * sin) / schritt) + off; if (yy >= 0 && yy < zeilen.length) zeilen[yy]++; }
      let summe = 0, quad = 0; for (const z of zeilen) { summe += z; quad += z * z; }
      const v = quad / zeilen.length - (summe / zeilen.length) ** 2;
      if (v > bestV) { bestV = v; best = a; }
    }
    return Math.round(best * 10) / 10;
  }

  const zahl = s => Number(String(s).replace(/\s/g, "").replace(",", "."));
  const r2 = x => Math.round(x * 100) / 100;
  // Preis: Ziffern, Komma/Punkt, zwei Ziffern; eine dritte Ziffer direkt dahinter ist meist das Steuerkürzel «A»
  const PREIS = /(-?\s?\d{1,4})[.,](\d{2})\d?(?![\d.,])/g;
  const STOPP = /\b(total|summe|zu bezahlen|zu zahlen|dein lidl preis|zwischensumme|bar\b|karte|twint|rückgeld|ruckgeld|kreditkarte|maestro|visa|mastercard|postfinance|mwst|mehrwertsteuer|kundenbeleg|buchung)/i;
  // Kopf, Adresse, Kasse, Zeit, Grussformeln – solche Zeilen sind nie Artikel
  const KOPF = /(kundenhotline|hotline|www\.|https?:|@|\.ch\b|\.com\b|bonkopie|kundeninformation|kundenkarte|name:|stra(ss|ß)e|str\.\s*\d|\bweg\s+\d|gasse\s+\d|platz\s+\d|\bplz\b|ort:|filiale|\btel\b|tel\.|telefon|\bfax\b|\buid\b|mwst-?nr|mwst\.?\s?nr|che-?\s?\d|\b\d{4}\s+[a-zäöü]{3,}|öffnungszeit|offnungszeit|montag|mo\.?\s*-\s*(fr|sa)|vielen dank|danke für|danke fur|merci|bis bald|auf wiedersehen|kasse\s*\d|kassier|bedient|bon[- ]?nr|beleg[- ]?nr|transaktion|terminal|trm-id|\baid\b|datum|uhrzeit|\b\d{1,2}:\d{2}(:\d{2})?\b|anzahl artikel|\d+\s+artikel\b|genossenschaft|\bag\b\s*$|\bgmbh\b)/i;
  const RABATT = /(rabatt|aktion|reduziert|ermässigung|ermassigung|gutschein|cumulus|supercard|plus|-\s?\d+\s?%)/i;
  const MENGE = /(?:^|\s)(\d{1,2})\s*[x×*]\s*(\d{1,4}[.,]\d{2})/i;
  const GEWICHT = /(\d{1,3}[.,]?\d{3})\s*k[gaq9]\s*[x×*-]*\s*(\d{1,4}[.,]\d{2})/i;

  function laden(text) {
    if (/lidl|l[il1]dl plus/i.test(text)) return "Lidl";
    if (/migros|migrolino|cumulus/i.test(text)) return "Migros";
    if (/\bcoop\b|coop pronto|naturaplan|supercard/i.test(text)) return "Coop";
    if (/denner/i.test(text)) return "Denner";
    if (/aldi/i.test(text)) return "Aldi";
    return "";
  }
  function datum(text) {
    const re = /\b(\d{1,2})[.\/](\d{1,2})[.\/](\d{4}|\d{2})\b/g; let m;
    while ((m = re.exec(text))) {
      let t = +m[1], mo = +m[2], j = +m[3]; if (j < 100) j += 2000;
      if (t >= 1 && t <= 31 && mo >= 1 && mo <= 12 && j >= 2020 && j <= 2100) return `${j}-${String(mo).padStart(2, "0")}-${String(t).padStart(2, "0")}`;
    }
    return null;
  }
  // Störzeichen vor und nach dem Namen entfernen: nur zusammenhängende «Wort»-Teile behalten
  function sauberName(s) {
    const teile = s.replace(/[|_~^`´"“”‚‘’»«©®°\\{}\[\]<>]+/g, " ").split(/\s+/).filter(Boolean);
    const wortig = t => { const b = (t.match(/[A-Za-zÄÖÜäöüÀ-ÿ]/g) || []).length; return b >= 2 && b / t.length >= 0.5 || /^\d+(%|g|kg|l|cl|ml|er)?$/i.test(t) && false; };
    let a = 0, e = teile.length;
    while (a < e && (!wortig(teile[a]) || teile[a].length <= 2 && a + 1 < e && wortig(teile[a + 1]))) a++;
    while (e > a && !wortig(teile[e - 1]) && !/^(\d+%|xxl|xl|ch|bio|\d{2,3}g\+?)$/i.test(teile[e - 1])) e--;
    return teile.slice(a, e).join(" ").replace(/^[^A-Za-zÄÖÜäöü]+/, "").replace(/[\s.:;,\-]+$/, "").trim();
  }
  function letzterPreis(z) {
    let m, letzt = null; PREIS.lastIndex = 0;
    while ((m = PREIS.exec(z))) letzt = { wert: zahl(m[1] + "." + m[2]), index: m.index, ende: m.index + m[0].length };
    return letzt;
  }

  // Text einer Quittung in Laden, Datum, Total und Artikel zerlegen
  function parsen(text) {
    const zeilen = text.split(/\r?\n/).map(z => z.replace(/\s+/g, " ").trim()).filter(Boolean);
    const artikel = [], totals = []; let fertig = false, offen = null;
    // Artikelname, zu dem kein Preis lesbar war: trotzdem aufnehmen, damit man ihn nachtragen kann
    const offenAblegen = () => { if (offen && artikel.length) artikel.push({ b: offen, n: offen, p: 0, r: 0, q: null, e: null, unsicher: true, fehlt: true }); offen = null; };
    for (const z of zeilen) {
      const mw = z.match(/mwst\.? von\s*(\d{1,4}[.,]\d{2})/i); if (mw) totals.push(zahl(mw[1]));
      if (fertig) {
        if (/total|summe|karte|twint|preis/i.test(z) && !/preisvorteil|gespart/i.test(z)) { const p = letzterPreis(z); if (p && p.wert > 0) totals.push(p.wert); }
        continue;
      }
      if (KOPF.test(z)) continue;
      if (STOPP.test(z)) {
        offenAblegen();
        if (/total|summe|zu bezahlen|zu zahlen|dein lidl preis|karte/i.test(z)) { const p = letzterPreis(z); if (p && p.wert > 0) totals.push(p.wert); }
        if (artikel.length >= 2) fertig = true;
        continue;
      }
      // Zusatzzeile nach einem Artikelnamen ohne Preis: daraus wird dieser Artikel
      if (offen) {
        const gwo = z.match(GEWICHT), mzo = z.match(MENGE);
        if (gwo && !/[A-Za-zÄÖÜäöü]{4}/.test(z.replace(gwo[0], "").replace(/chf|kg/gi, ""))) {
          let kg = zahl(gwo[1]); if (kg >= 100) kg = kg / 1000;
          artikel.push({ b: offen, n: offen, p: Math.round(kg * zahl(gwo[2]) * 20) / 20, r: 0, q: kg, e: "kg", korr: true }); offen = null; continue;
        }
        if (mzo && !/[A-Za-zÄÖÜäöü]{3}/.test(z.replace(mzo[0], ""))) {
          artikel.push({ b: offen, n: offen, p: r2(+mzo[1] * zahl(mzo[2])), r: 0, q: +mzo[1], e: "Stk", korr: true }); offen = null; continue;
        }
      }
      const letzter = artikel[artikel.length - 1];
      // Gewichtszeile «0.849 kg x 14.90 CHF/kg» gehört zum Artikel davor (oder steht in derselben Zeile)
      const gw = z.match(GEWICHT);
      if (gw) {
        let kg = zahl(gw[1]); if (kg >= 100) kg = kg / 1000;
        const preisKg = zahl(gw[2]);
        const rest = z.replace(gw[0], " ");
        const eigenerPreis = letzterPreis(rest);
        const ziel = eigenerPreis && /[A-Za-zÄÖÜäöü]{3}/.test(rest.slice(0, eigenerPreis.index)) ? null : letzter;
        if (ziel) { ziel.q = kg; ziel.e = "kg"; const soll = Math.round(kg * preisKg * 20) / 20; if (Math.abs(soll - (ziel.p + (ziel.r || 0))) > 0.011) { ziel.p = r2(soll - (ziel.r || 0)); ziel.korr = true; ziel.unsicher = false; } continue; }
      }
      // Mengenzeile «2 x 3.59»
      const mz = z.match(MENGE);
      if (mz && letzter && !/[A-Za-zÄÖÜäöü]{3}/.test(z.replace(mz[0], ""))) {
        letzter.q = +mz[1]; letzter.e = "Stk"; const soll = r2(+mz[1] * zahl(mz[2]));
        if (soll > 0 && Math.abs(soll - (letzter.p + (letzter.r || 0))) > 0.011) { letzter.p = r2(soll - (letzter.r || 0)); letzter.korr = true; letzter.unsicher = false; }
        else if (soll > 0) letzter.unsicher = false;
        continue;
      }
      const unsicher = z.includes("⚑");
      const pm = letzterPreis(z);
      if (!pm) { offenAblegen(); const nm = sauberName(z); offen = /[A-Za-zÄÖÜäöü]{3}/.test(nm) && !MENGE.test(z) && !GEWICHT.test(z) ? nm : null; continue; }
      offenAblegen();
      let name = z.slice(0, pm.index);
      const betrag = pm.wert;
      // Rabattzeile: negativer Betrag oder Rabatt-Stichwort ohne eigenen Artikel
      if (letzter && (betrag < 0 || RABATT.test(name) && Math.abs(betrag) < letzter.p)) {
        const r = Math.abs(betrag);
        if (r < letzter.p) { letzter.p = r2(letzter.p - r); letzter.r = r2((letzter.r || 0) + r); }
        continue;
      }
      if (betrag <= 0 || betrag > 500) continue;
      let q = null, e = null;
      const mm = name.match(/\s(\d{1,2})\s*[x×*]?\s*(\d{1,4}[.,]\d{2})\s*$/);
      if (mm && Math.abs(+mm[1] * zahl(mm[2]) - betrag) < 0.06) { q = +mm[1]; e = "Stk"; name = name.slice(0, mm.index); }
      name = sauberName(name.replace(/\bCHF\b/gi, " "));
      if (!/[A-Za-zÄÖÜäöü]{3}/.test(name)) continue;
      artikel.push({ b: name, n: name, p: betrag, r: 0, q, e, unsicher });
    }
    const summeArtikel = r2(artikel.reduce((s, a) => s + a.p, 0));
    // Total: der am häufigsten genannte Betrag; bei Gleichstand der, der am nächsten an der Artikelsumme liegt
    let total = null;
    if (totals.length) {
      const zaehl = new Map(); for (const t of totals) zaehl.set(t, (zaehl.get(t) || 0) + 1);
      total = Array.from(zaehl).sort((a, b) => b[1] - a[1] || Math.abs(a[0] - summeArtikel) - Math.abs(b[0] - summeArtikel))[0][0];
    }
    return { laden: laden(text), datum: datum(text), total: total != null ? total : summeArtikel, summeArtikel, artikel, text };
  }

  // Mehrere Teile einer langen Quittung: doppelte Zeilen an den Übergängen entfernen
  function zusammenfuegen(texte) {
    const out = [];
    for (const t of texte) {
      const zs = t.split(/\r?\n/);
      const schonDa = new Set(out.slice(-12).map(z => z.replace(/\s+/g, " ").trim()));
      let start = 0;
      while (start < Math.min(12, zs.length) && schonDa.has(zs[start].replace(/\s+/g, " ").trim()) && zs[start].trim()) start++;
      out.push(...zs.slice(start));
    }
    return out.join("\n");
  }

  // Wörter mit Position aus der TSV-Ausgabe von Tesseract
  function woerter(tsv, dx = 0, dy = 0) {
    return String(tsv || "").split("\n").map(z => z.split("\t")).filter(c => c.length >= 12 && c[0] === "5" && c[11].trim())
      .map(c => ({ key: c[2] + "-" + c[3] + "-" + c[4], x0: +c[6] + dx, y0: +c[7] + dy, x1: +c[6] + +c[8] + dx, y1: +c[7] + +c[9] + dy, text: c[11].trim() }));
  }
  function zeilenAus(ws) {
    const m = new Map();
    for (const w of ws) { if (!m.has(w.key)) m.set(w.key, []); m.get(w.key).push(w); }
    return Array.from(m.values()).map(arr => { arr.sort((a, b) => a.x0 - b.x0); const y0 = Math.min(...arr.map(w => w.y0)), y1 = Math.max(...arr.map(w => w.y1)); return { woerter: arr, y: (y0 + y1) / 2, h: y1 - y0 }; }).sort((a, b) => a.y - b.y);
  }
  // Text aus der Preisspalte in einen Preis verwandeln: «345A» → 3.45, «1198» → 1.19 (letzte Ziffer = «A»)
  function preisNormal(t) {
    t = t.replace(/\s/g, "").replace(",", ".");
    let m = t.match(/(-?)(\d{1,4})\.(\d{2})/);
    if (m) return m[1] + Number(m[2]) + "." + m[3];
    m = t.match(/^(-?)(\d{3,5})(A?)/);
    if (!m) return "";
    let ziffern = m[2];
    if (!m[3] && ziffern.length >= 4) ziffern = ziffern.slice(0, -1);
    if (ziffern.length < 3) return "";
    return m[1] + Number(ziffern.slice(0, -2)) + "." + ziffern.slice(-2);
  }
  const istPreisWort = t => /^-?\d{1,4}[.,]\d{2}[A-Z0-9]?$/.test(t);

  // Eine Quittung auslesen: Durchgang 1 für Namen und Lage der Preisspalte, Durchgang 2 nur für die Preise
  let letzte = null; // Wörter mit Position der letzten Seite (für die Textebene im PDF)
  async function bildAuslesen(w, bild, melden) {
    await w.setParameters({ tessedit_pageseg_mode: "6", tessedit_char_whitelist: "" });
    fortschrittTeil = [0, 0.7]; 
    const a = await w.recognize(bild, {}, { text: true, tsv: true });
    const alle = woerter(a.data.tsv);
    const W = bild.width;
    letzte = { breite: bild.width, hoehe: bild.height, woerter: alle.map(x => ({ t: x.text, x0: x.x0, y0: x.y0, x1: x.x1, y1: x.y1 })), text: a.data.text || "" };
    const preisWoerter = alle.filter(x => istPreisWort(x.text) && x.x0 > W * 0.45);
    if (preisWoerter.length < 3) return a.data.text || "";
    const xs = preisWoerter.map(x => x.x0).sort((p, q) => p - q);
    const zeichen = Math.max(8, (preisWoerter[0].x1 - preisWoerter[0].x0) / Math.max(4, preisWoerter[0].text.length));
    const px0 = Math.max(0, Math.round(xs[Math.floor(xs.length * 0.1)] - zeichen * 2.5));
    const px1 = Math.min(W, Math.round(Math.max(...preisWoerter.map(x => x.x1)) + zeichen * 2));
    // Durchgang 2: nur die Preisspalte, nur Ziffern
    const streifen = document.createElement("canvas"); streifen.width = px1 - px0; streifen.height = bild.height;
    streifen.getContext("2d").drawImage(bild, px0, 0, px1 - px0, bild.height, 0, 0, px1 - px0, bild.height);
    await w.setParameters({ tessedit_pageseg_mode: "6", tessedit_char_whitelist: "0123456789.,-A" });
    fortschrittTeil = [0.7, 1];
    const b = await w.recognize(streifen, {}, { text: false, tsv: true });
    await w.setParameters({ tessedit_char_whitelist: "" });
    const preisZeilen = zeilenAus(woerter(b.data.tsv, px0, 0)).map(z => ({ y: z.y, h: z.h, text: preisNormal(z.woerter.map(x => x.text).join("")) })).filter(z => z.text);
    // Linker Rand der Quittung: dort beginnen die Artikelnamen; alles weiter links ist Hintergrund
    const zeilenA = zeilenAus(alle);
    const starts = zeilenA.map(z => z.woerter.find(x => (x.text.match(/[A-Za-zÄÖÜäöü]/g) || []).length >= 3)).filter(Boolean).map(x => x.x0).sort((p, q) => p - q);
    const nameX0 = starts.length ? starts[Math.floor(starts.length * 0.3)] - zeichen * 1.5 : 0;
    const namenZeilen = zeilenA.map(z => ({ y: z.y, h: z.h,
      text: z.woerter.filter(x => x.x1 <= px0 + zeichen && x.x1 > nameX0).map(x => x.text).join(" "),
      rest: z.woerter.filter(x => x.x1 > px0 + zeichen).map(x => x.text).join(" ") })).filter(z => z.text.trim());
    const hoehe = median(namenZeilen.map(z => z.h)) || 20;
    // Zuordnung nach kleinstem Abstand; Artikelzeilen haben Vorrang vor Mengen- und Gewichtszeilen
    const istZusatz = t => (MENGE.test(t) || GEWICHT.test(t)) && !/[A-Za-zÄÖÜäöü]{4}/.test(t.replace(/chf|kg/gi, ""));
    const paare = [];
    namenZeilen.forEach((z, i) => preisZeilen.forEach((p, j) => { const d = Math.abs(p.y - z.y); if (d <= hoehe * 0.75) paare.push([d + (istZusatz(z.text) ? hoehe : 0), i, j]); }));
    paare.sort((x, y) => x[0] - y[0]);
    const preisVon = new Map(), vergeben = new Set();
    for (const [, i, j] of paare) if (!preisVon.has(i) && !vergeben.has(j)) { preisVon.set(i, preisZeilen[j].text); vergeben.add(j); }
    // Sauber gelesener Preis aus Durchgang 1 («3.95 A») hat Vorrang, sonst der Ziffern-Durchgang
    // erster Betrag im Text; was direkt danach folgt (meist das «A»), wird ignoriert
    const sauberA = t => { const m = String(t).match(/(?:^|[\s(])(-?\d{1,3})[.,](\d{2})/); return m ? Number(m[1]) + "." + m[2] : ""; };
    const zeilen = [];
    // Der Ziffern-Durchgang allein zählt nur im Artikelblock (zwischen erster und letzter sauber gelesener Preiszeile) –
    // sonst werden Hausnummern, Postleitzahlen oder Telefonnummern im Kopf zu «Preisen»
    const mitA = namenZeilen.map(z => !!sauberA(z.rest)), ersteA = mitA.indexOf(true), letzteA = mitA.lastIndexOf(true);
    namenZeilen.forEach((z, i) => {
      const a = sauberA(z.rest);
      let b = preisVon.get(i) || "";
      if (!a && b && (ersteA < 0 || i < ersteA - 1 || i > letzteA + 2)) b = "";
      if (/total|summe|dein lidl preis|karte|mwst/i.test(z.text)) { if (a) zeilen.push(z.text + "   " + a); if (b) zeilen.push(z.text + "   " + b); if (!a && !b) zeilen.push(z.text + "   " + z.rest); return; }
      let wahl = a || b;
      if (wahl && Number(wahl) < 0 && !RABATT.test(z.text)) wahl = String(Math.abs(Number(wahl)));
      if (wahl && Number(wahl) > 200 && a === "") wahl = "";
      // Hinweis «bitte prüfen» nur, wenn sich die beiden Durchgänge widersprechen oder nur der Ziffern-Durchgang etwas fand
      const unsicher = (a && b) ? Math.abs(Math.abs(Number(a)) - Math.abs(Number(b))) > 0.011 : !a;
      zeilen.push(wahl ? z.text + "   " + wahl + (unsicher ? " ⚑" : "") : z.text);
    });
    return zeilen.join("\n");
  }

  let fortschrittTeil = [0, 1];
  async function auslesen(blobs, onFortschritt) {
    const w = await worker();
    const texte = [];
    for (let i = 0; i < blobs.length; i++) {
      fortschritt = m => { if (onFortschritt && m.status === "recognizing text") onFortschritt((i + fortschrittTeil[0] + (fortschrittTeil[1] - fortschrittTeil[0]) * m.progress) / blobs.length, i + 1, blobs.length); };
      const bild = await vorbereiten(blobs[i]);
      texte.push(await bildAuslesen(w, bild));
    }
    fortschritt = null;
    return parsen(zusammenfuegen(texte));
  }

  // Ein einzelnes Foto lesen (für die App: jedes Foto einzeln, Ergebnis danach mit ausTexten zusammenführen)
  // melden(phase, anteil): phase = "laden" | "vorbereiten" | "lesen"
  let abbruch = null;
  async function bildText(blob, melden, opt) {
    const melde = (ph, p) => { try { if (melden) melden(ph, p); } catch (e) { } };
    const stop = new Promise((_, rej) => { abbruch = () => rej(Object.assign(new Error("abgebrochen"), { abgebrochen: true })); });
    const arbeit = (async () => {
      fortschritt = m => {
        if (m.status === "recognizing text") melde("lesen", fortschrittTeil[0] + (fortschrittTeil[1] - fortschrittTeil[0]) * (m.progress || 0));
        else if (/load|initiali/i.test(m.status || "")) melde("laden", m.progress || 0);
      };
      melde("laden", 0);
      const w = await worker();
      melde("vorbereiten", 0);
      await new Promise(r => setTimeout(r, 30));
      const bild = await vorbereiten(blob, opt || {});
      melde("lesen", 0);
      return await bildAuslesen(w, bild);
    })();
    arbeit.catch(() => { });
    try { return await Promise.race([arbeit, stop]); }
    finally { fortschritt = null; abbruch = null; }
  }
  const ausTexten = texte => parsen(zusammenfuegen(texte));

  async function laden_vorab(onLog) { fortschritt = onLog || null; await worker(); fortschritt = null; }
  async function abbrechen() {
    if (abbruch) abbruch();
    const p = workerP; workerP = null; fortschritt = null;
    if (p) { try { (await p).terminate(); } catch (e) { } }
  }

  window.Bon = { letzte: () => letzte, auslesen, bildText, ausTexten, parsen, vorbereiten, bildAuslesen, abbrechen, vorab: laden_vorab, setzeBasis: b => { basis = b; } };
})();
