/* Kasse unterwegs – Bildverarbeitung für den Scanner, ohne Bibliothek und offline:
   Dokument finden (Papierfläche + konvexe Hülle + grösstes Viereck), Perspektive entzerren,
   Schatten ausgleichen und Kontrast verbessern, Schwarz-Weiss, drehen. */
(function () {
  "use strict";
  const G = typeof window !== "undefined" ? window : self;

  async function laden(blob) {
    try { return await createImageBitmap(blob, { imageOrientation: "from-image" }); }
    catch (e) {
      // ältere Browser: über ein <img>
      const url = URL.createObjectURL(blob);
      try { const img = new Image(); img.src = url; await img.decode(); return img; } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
    }
  }
  const breite = b => b.videoWidth || b.naturalWidth || b.width, hoehe = b => b.videoHeight || b.naturalHeight || b.height;
  function leinwand(w, h) { if (typeof document === "undefined") return new OffscreenCanvas(w, h); const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function klein(quelle, max) {
    const W = breite(quelle), H = hoehe(quelle), f = Math.min(1, max / Math.max(W, H));
    const c = leinwand(Math.max(1, Math.round(W * f)), Math.max(1, Math.round(H * f)));
    c.getContext("2d", { willReadFrequently: true }).drawImage(quelle, 0, 0, c.width, c.height);
    return c;
  }

  /* ---------- Dokument finden ---------- */
  function otsu(hist, n) {
    let sumAll = 0; for (let v = 0; v < 256; v++) sumAll += v * hist[v];
    let wB = 0, sumB = 0, best = 0, t = 128;
    for (let v = 0; v < 256; v++) { wB += hist[v]; if (!wB) continue; const wF = n - wB; if (!wF) break; sumB += v * hist[v]; const zw = wB * wF * (sumB / wB - (sumAll - sumB) / wF) ** 2; if (zw > best) { best = zw; t = v; } }
    return t;
  }
  function morph(m, W, H, r, dilate) {
    const out = new Uint8Array(W * H), tmp = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = dilate ? 0 : 1;
      for (let k = -r; k <= r; k++) { const xx = x + k; if (xx < 0 || xx >= W) { if (!dilate) { v = 0; break; } continue; } const a = m[y * W + xx]; if (dilate ? a : !a) { v = dilate ? 1 : 0; break; } }
      tmp[y * W + x] = v;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = dilate ? 0 : 1;
      for (let k = -r; k <= r; k++) { const yy = y + k; if (yy < 0 || yy >= H) { if (!dilate) { v = 0; break; } continue; } const a = tmp[yy * W + x]; if (dilate ? a : !a) { v = dilate ? 1 : 0; break; } }
      out[y * W + x] = v;
    }
    return out;
  }
  function huelle(pts) {
    pts = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    if (pts.length < 3) return pts;
    const kreuz = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const unten = [], oben = [];
    for (const p of pts) { while (unten.length >= 2 && kreuz(unten[unten.length - 2], unten[unten.length - 1], p) <= 0) unten.pop(); unten.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (oben.length >= 2 && kreuz(oben[oben.length - 2], oben[oben.length - 1], p) <= 0) oben.pop(); oben.push(p); }
    oben.pop(); unten.pop();
    return unten.concat(oben);
  }
  const flaeche3 = (a, b, c) => Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  function flaeche(q) { let s = 0; for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; s += a.x * b.y - b.x * a.y; } return Math.abs(s) / 2; }
  // Grösstes Viereck mit Ecken auf der Hülle
  function groesstesViereck(h) {
    const n = h.length; if (n < 4) return null;
    let best = null, bestA = -1;
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      let ka = -1, k = -1; for (let t = i + 1; t < j; t++) { const a = flaeche3(h[i], h[t], h[j]); if (a > ka) { ka = a; k = t; } }
      let la = -1, l = -1; for (let t = j + 1; t < n + i; t++) { const tt = t % n; const a = flaeche3(h[j], h[tt], h[i]); if (a > la) { la = a; l = tt; } }
      if (k < 0 || l < 0) continue;
      if (ka + la > bestA) { bestA = ka + la; best = [h[i], h[k], h[j], h[l]]; }
    }
    return best;
  }
  // Ecken in die Reihenfolge oben links, oben rechts, unten rechts, unten links bringen
  function ordnen(q) {
    const c = { x: q.reduce((s, p) => s + p.x, 0) / 4, y: q.reduce((s, p) => s + p.y, 0) / 4 };
    const s = q.slice().sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
    // mit Bildschirm-Koordinaten (y nach unten) beginnt der Winkel bei links; oben links = kleinste Summe x+y
    let start = 0, min = Infinity; s.forEach((p, i) => { if (p.x + p.y < min) { min = p.x + p.y; start = i; } });
    // atan2 mit y nach unten zählt im Uhrzeigersinn: oben links → oben rechts → unten rechts → unten links
    return [0, 1, 2, 3].map(i => s[(start + i) % 4]);
  }
  function winkel(q) { return q.map((p, i) => { const a = q[(i + 3) % 4], b = q[(i + 1) % 4]; const v1 = { x: a.x - p.x, y: a.y - p.y }, v2 = { x: b.x - p.x, y: b.y - p.y }; return Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1)))) * 180 / Math.PI; }); }

  /* Kanten-Verfahren (wie Canny + Hough): Helligkeit glätten (Maserung des Tischs verschwindet), Sobel-Gradient,
     Hough-Transformation getrennt nach Richtung des Helligkeitssprungs – linker Papierrand wird nach rechts heller,
     rechter Rand nach rechts dunkler. Jede Kandidatenlinie muss auf der Papierseite heller sein als daneben,
     sonst ist es nur eine Textspalte. Oben/unten genauso; fehlt eine Kante (Bon länger als das Bild), gilt der Bildrand. */
  function glaetten(src, W, H, r) {
    const tmp = new Float32Array(W * H), out = new Float32Array(W * H), n = 2 * r + 1;
    for (let y = 0; y < H; y++) { let s = 0; for (let x = -r; x <= r; x++) s += src[y * W + Math.min(W - 1, Math.max(0, x))]; for (let x = 0; x < W; x++) { tmp[y * W + x] = s / n; s += src[y * W + Math.min(W - 1, x + r + 1)] - src[y * W + Math.max(0, x - r)]; } }
    for (let x = 0; x < W; x++) { let s = 0; for (let y = -r; y <= r; y++) s += tmp[Math.min(H - 1, Math.max(0, y)) * W + x]; for (let y = 0; y < H; y++) { out[y * W + x] = s / n; s += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x]; } }
    return out;
  }
  function kantenFinden(lum, W, H) {
    let g = glaetten(lum, W, H, 2); g = glaetten(g, W, H, 2);
    const gx = new Float32Array(W * H), gy = new Float32Array(W * H), mag = new Float32Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const a = g[i - W - 1], b = g[i - W], c = g[i - W + 1], d = g[i - 1], f = g[i + 1], h = g[i + W - 1], k = g[i + W], l = g[i + W + 1];
      gx[i] = (c + 2 * f + l) - (a + 2 * d + h); gy[i] = (h + 2 * k + l) - (a + 2 * b + c); mag[i] = Math.hypot(gx[i], gy[i]);
    }
    const sortiert = Array.from(mag).filter(v => v > 0).sort((p, q) => p - q);
    const schwelle = Math.max(10, sortiert[Math.floor(sortiert.length * 0.8)] || 10);
    const hell = (x, y) => g[Math.min(H - 1, Math.max(0, Math.round(y))) * W + Math.min(W - 1, Math.max(0, Math.round(x)))];
    // Linien x = x0 + t·(y − H/2) bzw. y = y0 + t·(x − W/2)
    function linien(senkrecht, vorzeichen, xmin, xmax) {
      const L = senkrecht ? W : H, M = senkrecht ? H : W, WINK = 30, acc = new Float32Array((2 * WINK + 1) * L);
      const tans = Array.from({ length: 2 * WINK + 1 }, (_, i) => Math.tan((i - WINK) * Math.PI / 180));
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x, m = mag[i]; if (m < schwelle) continue;
        const gq = senkrecht ? gx[i] : gy[i], gs = senkrecht ? gy[i] : gx[i];
        if (Math.abs(gq) < Math.abs(gs) * 1.2 || Math.sign(gq) !== vorzeichen) continue;
        if (xmin && (senkrecht ? false : (x < xmin(y) || x > xmax(y)))) continue;
        const u = senkrecht ? x : y, v = (senkrecht ? y : x) - M / 2;
        for (let t = 0; t <= 2 * WINK; t++) { const bin = Math.round(u - tans[t] * v); if (bin >= 0 && bin < L) acc[t * L + bin] += m; }
      }
      // Kandidaten: lokale Maxima
      const kand = [];
      for (let t = 0; t <= 2 * WINK; t++) for (let bin = 1; bin < L - 1; bin++) {
        const v = acc[t * L + bin]; if (v <= 0) continue;
        let max = true; for (let dt = -2; dt <= 2 && max; dt++) for (let db = -3; db <= 3; db++) { const tt = t + dt, bb = bin + db; if ((dt || db) && tt >= 0 && tt <= 2 * WINK && bb >= 0 && bb < L && acc[tt * L + bb] > v) { max = false; break; } }
        if (max) kand.push({ t: tans[t], u0: bin, wert: v });
      }
      kand.sort((p, q) => q.wert - p.wert);
      // Prüfen: Papierseite heller, Kante durchgehend
      const d = Math.max(4, Math.round(Math.max(W, H) / 80)), aus = [];
      for (const k of kand.slice(0, 14)) {
        let kontrast = 0, halt = 0, n = 0;
        for (let s = 0.08; s <= 0.92; s += 0.04) {
          const v = s * M - M / 2, u = k.u0 + k.t * v; // Punkt auf der Linie
          const px = senkrecht ? u : s * M, py = senkrecht ? s * M : u;
          if (!senkrecht && xmin && (px < xmin(py) || px > xmax(py))) continue;
          const nx = senkrecht ? d : 0, ny = senkrecht ? 0 : d;
          const innen = hell(px + nx * vorzeichen, py + ny * vorzeichen), aussen = hell(px - nx * vorzeichen, py - ny * vorzeichen);
          kontrast += innen - aussen; n++;
          const i = Math.round(py) * W + Math.round(px);
          if (i >= 0 && i < W * H && mag[i] >= schwelle * 0.5) halt++;
        }
        if (!n) continue;
        kontrast /= n;
        if (kontrast < 6) continue;
        aus.push({ ...k, kontrast, halt: halt / n, score: k.wert * (0.4 + halt / n) * Math.min(2, kontrast / 12) });
      }
      return aus.sort((p, q) => q.score - p.score);
    }
    const links = linien(true, 1), rechts = linien(true, -1);
    let paar = null, best = 0;
    for (const l of links.slice(0, 6)) for (const r of rechts.slice(0, 6)) {
      const xl = l.u0, xr = r.u0; if (xr - xl < W * 0.1) continue;
      if (Math.abs(Math.atan(l.t) - Math.atan(r.t)) > 15 * Math.PI / 180) continue;
      const s = l.score + r.score; if (s > best) { best = s; paar = [l, r]; }
    }
    if (!paar) return null;
    const [L, R] = paar, xL = y => L.u0 + L.t * (y - H / 2), xR = y => R.u0 + R.t * (y - H / 2);
    // oben/unten nur nehmen, wenn die Kante deutlich ist und dahinter Hintergrund liegt (wie neben dem Papier)
    const bg = [], pap = [], d2 = Math.max(6, Math.round(W / 40));
    for (let y = H * 0.1; y < H * 0.9; y += H / 30) { bg.push(hell(xL(y) - d2, y), hell(xR(y) + d2, y)); pap.push(hell(xL(y) + d2, y), hell(xR(y) - d2, y)); }
    const med = a => a.slice().sort((p, q) => p - q)[a.length >> 1], bgW = med(bg), papW = med(pap), spanne = Math.max(1, papW - bgW);
    const dahinter = (k, oberhalb) => { const vals = []; for (let s2 = 0.2; s2 <= 0.8; s2 += 0.1) { const x = xL(k.u0) + (xR(k.u0) - xL(k.u0)) * s2, y = k.u0 + k.t * (x - W / 2) + (oberhalb ? -2 * d2 : 2 * d2); if (y >= 0 && y < H) vals.push(hell(x, y)); } return vals.length ? med(vals) : bgW; };
    // Laufen die Seitenränder über die Kandidatenlinie hinaus weiter, geht auch das Papier weiter → keine Oberkante
    const randWeiter = (ya, yb) => {
      if (yb - ya < H * 0.03) return 0;
      let ja = 0, n = 0;
      for (let y = ya; y <= yb; y += Math.max(2, (yb - ya) / 12)) for (const [fx, vz] of [[xL, 1], [xR, -1]]) {
        let gut = false;
        for (let o = -2; o <= 2 && !gut; o++) { const x = Math.round(fx(y)) + o, i = Math.round(y) * W + x; if (x > 0 && x < W - 1 && i >= 0 && i < W * H && mag[i] >= schwelle * 0.5 && Math.sign(gx[i]) === vz) gut = true; }
        ja += gut ? 1 : 0; n++;
      }
      return n ? ja / n : 0;
    };
    const oben = linien(false, 1, xL, xR).filter(k => k.u0 < H * 0.3 && k.halt > 0.6 && Math.abs(dahinter(k, true) - bgW) < spanne * 0.45 && randWeiter(0, k.u0 - 4) < 0.35)[0];
    const unten = linien(false, -1, xL, xR).filter(k => k.u0 > H * 0.7 && k.halt > 0.6 && Math.abs(dahinter(k, false) - bgW) < spanne * 0.45 && randWeiter(k.u0 + 4, H - 1) < 0.35)[0];
    const yO = x => oben ? oben.u0 + oben.t * (x - W / 2) : 0, yU = x => unten ? unten.u0 + unten.t * (x - W / 2) : H;
    // Schnittpunkte iterativ (Linien sind fast senkrecht/waagrecht)
    const schnitt = (fx, fy) => { let y = H / 2, x = fx(y); for (let i = 0; i < 6; i++) { y = fy(x); x = fx(y); } return { x, y }; };
    const ecken = [schnitt(xL, yO), schnitt(xR, yO), schnitt(xR, yU), schnitt(xL, yU)];
    const guete = Math.min(1, (L.halt + R.halt) / 2 * 1.25) * Math.min(1, (L.kontrast + R.kontrast) / 40 + 0.3);
    return { ecken, guete, oben: !!oben, unten: !!unten, flaeche: flaeche(ecken) };
  }

  function transponieren(a, W, H) { const t = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) t[x * H + y] = a[y * W + x]; return t; }
  function versuchen(merkmal, W, H) {
    let k = kantenFinden(merkmal, W, H);
    // quer liegende Quittung: Bild gedreht prüfen
    if (!k || k.guete < 0.5) {
      const kq = kantenFinden(transponieren(merkmal, W, H), H, W);
      if (kq && (!k || kq.guete > k.guete)) k = { ...kq, ecken: kq.ecken.map(p => ({ x: p.y, y: p.x })) };
    }
    return k;
  }

  // Quittung im Bild suchen. Ergebnis: Ecken relativ (0..1) und Güte 0..1. 320 px reichen und glätten die Maserung am besten.
  function finden(quelle, max = 320) {
    const c = klein(quelle, max), W = c.width, H = c.height;
    return findenDaten(c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data, W, H);
  }
  // reine Rechnung auf RGBA-Daten – läuft auch im Hintergrund-Worker (Live-Kamera)
  function findenDaten(d, W, H) {
    const lum = new Float32Array(W * H); for (let i = 0, j = 0; i < d.length; i += 4, j++) lum[j] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    // zwei Merkmale: Helligkeit (dunkler Tisch) und «Papierfarbe» = hell und neutral (Holz, Stein, Stoff sind meist wärmer)
    const papier = new Float32Array(W * H);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) papier[j] = Math.max(0, lum[j] - 2.5 * Math.max(0, d[i] - d[i + 2]) - 1.2 * Math.max(0, Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) - 12));
    const kh = versuchen(lum, W, H), kp = versuchen(papier, W, H);
    let k = kh;
    if (kp && (!kh || kp.guete > kh.guete)) k = kp;
    if (k && k.guete >= 0.35) {
      const q = ordnen(k.ecken.map(p => ({ x: Math.min(W, Math.max(0, p.x)), y: Math.min(H, Math.max(0, p.y)) })));
      if (winkel(q).every(a => a > 40 && a < 140) && flaeche(q) > W * H * 0.03)
        return { ecken: q.map(p => ({ x: p.x / W, y: p.y / H })), guete: k.guete, anteil: flaeche(q) / (W * H), verfahren: "kanten" };
    }
    const m = maskeFinden(d, W, H);
    return m ? { ...m, verfahren: "maske" } : null;
  }
  function maskeFinden(d, W, H) {
    // «Papier»: hell und ungefärbt
    const p = new Uint8Array(W * H), hist = new Uint32Array(256);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) { const mn = Math.min(d[i], d[i + 1], d[i + 2]), mx = Math.max(d[i], d[i + 1], d[i + 2]); const v = Math.max(0, mn - (mx - mn)); p[j] = v; hist[v]++; }
    const t = otsu(hist, W * H);
    let m = new Uint8Array(W * H), an = 0; for (let j = 0; j < p.length; j++) { m[j] = p[j] > t ? 1 : 0; an += m[j]; }
    if (an < W * H * 0.04 || an > W * H * 0.97) return null;
    // Schrift schliessen, Staub entfernen
    const r = Math.max(1, Math.round(Math.max(W, H) / 120));
    m = morph(morph(m, W, H, r, true), W, H, r, false);
    m = morph(morph(m, W, H, 1, false), W, H, 1, true);
    // grösste zusammenhängende Fläche (Nähe zur Mitte zählt mit)
    const lab = new Int32Array(W * H).fill(-1), stapel = new Int32Array(W * H);
    let bestId = -1, bestW = 0, id = 0; const groesse = [];
    for (let s0 = 0; s0 < W * H; s0++) {
      if (!m[s0] || lab[s0] >= 0) continue;
      let sp = 0, cnt = 0, sx = 0, sy = 0; stapel[sp++] = s0; lab[s0] = id;
      while (sp) { const q = stapel[--sp]; cnt++; const x = q % W, y = (q / W) | 0; sx += x; sy += y;
        if (x > 0 && m[q - 1] && lab[q - 1] < 0) { lab[q - 1] = id; stapel[sp++] = q - 1; }
        if (x < W - 1 && m[q + 1] && lab[q + 1] < 0) { lab[q + 1] = id; stapel[sp++] = q + 1; }
        if (y > 0 && m[q - W] && lab[q - W] < 0) { lab[q - W] = id; stapel[sp++] = q - W; }
        if (y < H - 1 && m[q + W] && lab[q + W] < 0) { lab[q + W] = id; stapel[sp++] = q + W; } }
      const dm = Math.hypot(sx / cnt / W - 0.5, sy / cnt / H - 0.5);
      const w = cnt * (1.2 - dm);
      groesse.push(cnt);
      if (w > bestW) { bestW = w; bestId = id; }
      id++;
    }
    if (bestId < 0) return null;
    // Randpunkte je Zeile → konvexe Hülle → grösstes Viereck
    const pts = [];
    for (let y = 0; y < H; y++) { let l = -1, rr = -1; for (let x = 0; x < W; x++) if (lab[y * W + x] === bestId) { if (l < 0) l = x; rr = x; } if (l >= 0) { pts.push({ x: l, y }, { x: rr + 1, y }); } }
    const hl = huelle(pts);
    let q = groesstesViereck(hl.length > 140 ? hl.filter((_, i) => i % Math.ceil(hl.length / 140) === 0) : hl);
    if (!q) return null;
    q = ordnen(q);
    const qa = flaeche(q), anteil = qa / (W * H), fuell = groesse[bestId] / Math.max(1, qa);
    const w = winkel(q), wOk = w.every(a => a > 45 && a < 135);
    const guete = Math.max(0, Math.min(1, (anteil > 0.06 ? 1 : anteil / 0.06) * Math.min(1, fuell / 0.85) * (wOk ? 1 : 0.4)));
    return { ecken: q.map(pt => ({ x: Math.min(1, Math.max(0, pt.x / W)), y: Math.min(1, Math.max(0, pt.y / H)) })), guete, anteil };
  }

  /* ---------- Entzerren ---------- */
  // Einheitsquadrat → Viereck (Heckbert)
  function homographie(q) {
    const [p0, p1, p2, p3] = q;
    const sx = p0.x - p1.x + p2.x - p3.x, sy = p0.y - p1.y + p2.y - p3.y;
    let a, b, c, d, e, f, g, h;
    if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) { a = p1.x - p0.x; b = p2.x - p1.x; c = p0.x; d = p1.y - p0.y; e = p2.y - p1.y; f = p0.y; g = 0; h = 0; }
    else {
      const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, den = dx1 * dy2 - dx2 * dy1;
      g = (sx * dy2 - dx2 * sy) / den; h = (dx1 * sy - sx * dy1) / den;
      a = p1.x - p0.x + g * p1.x; b = p3.x - p0.x + h * p3.x; c = p0.x; d = p1.y - p0.y + g * p1.y; e = p3.y - p0.y + h * p3.y; f = p0.y;
    }
    return { a, b, c, d, e, f, g, h };
  }
  const abst = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  // quelle: Bild; ecken in Pixeln (oben links, oben rechts, unten rechts, unten links)
  function entzerren(quelle, ecken, max = 4000) {
    const W = breite(quelle), H = hoehe(quelle);
    const src = leinwand(W, H), sctx = src.getContext("2d", { willReadFrequently: true }); sctx.drawImage(quelle, 0, 0);
    const sd = sctx.getImageData(0, 0, W, H).data;
    let ow = Math.max(abst(ecken[0], ecken[1]), abst(ecken[3], ecken[2])), oh = Math.max(abst(ecken[0], ecken[3]), abst(ecken[1], ecken[2]));
    const f = Math.min(1, max / Math.max(ow, oh)); ow = Math.max(8, Math.round(ow * f)); oh = Math.max(8, Math.round(oh * f));
    const out = leinwand(ow, oh), octx = out.getContext("2d"), img = octx.createImageData(ow, oh), od = img.data;
    const { a, b, c, d, e, f: ff, g, h } = homographie(ecken);
    for (let oy = 0; oy < oh; oy++) {
      const v = (oy + 0.5) / oh;
      let nx = b * v + c, ny = e * v + ff, nz = h * v + 1;
      const sxu = a / ow, syu = d / ow, szu = g / ow;
      nx += sxu * 0.5; ny += syu * 0.5; nz += szu * 0.5;
      let o = oy * ow * 4;
      for (let ox = 0; ox < ow; ox++, o += 4, nx += sxu, ny += syu, nz += szu) {
        const x = nx / nz - 0.5, y = ny / nz - 0.5;
        const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
        const xa = x0 < 0 ? 0 : x0 >= W ? W - 1 : x0, xb = x0 + 1 < 0 ? 0 : x0 + 1 >= W ? W - 1 : x0 + 1;
        const ya = y0 < 0 ? 0 : y0 >= H ? H - 1 : y0, yb = y0 + 1 < 0 ? 0 : y0 + 1 >= H ? H - 1 : y0 + 1;
        const i00 = (ya * W + xa) * 4, i10 = (ya * W + xb) * 4, i01 = (yb * W + xa) * 4, i11 = (yb * W + xb) * 4;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        od[o] = sd[i00] * w00 + sd[i10] * w10 + sd[i01] * w01 + sd[i11] * w11;
        od[o + 1] = sd[i00 + 1] * w00 + sd[i10 + 1] * w10 + sd[i01 + 1] * w01 + sd[i11 + 1] * w11;
        od[o + 2] = sd[i00 + 2] * w00 + sd[i10 + 2] * w10 + sd[i01 + 2] * w01 + sd[i11 + 2] * w11;
        od[o + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  /* ---------- Verbessern ---------- */
  // «kontrast»: Schatten und ungleichmässiges Licht ausgleichen (Hintergrund schätzen und herausrechnen), Schrift kräftiger
  // «sw»: reines Schwarz-Weiss · «farbe»: unverändert
  function verbessern(canvas, modus) {
    if (modus === "farbe") return canvas;
    const W = canvas.width, H = canvas.height, ctx = canvas.getContext("2d", { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    // Hintergrund: hellster Wert je Kachel, geglättet
    const K = Math.max(8, Math.round(Math.max(W, H) / 48)), gw = Math.ceil(W / K), gh = Math.ceil(H / K);
    const grid = new Float32Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const vals = [];
      for (let y = gy * K; y < Math.min(H, gy * K + K); y += 2) for (let x = gx * K; x < Math.min(W, gx * K + K); x += 2) { const i = (y * W + x) * 4; vals.push(Math.max(d[i], d[i + 1], d[i + 2])); }
      vals.sort((p, q) => p - q); grid[gy * gw + gx] = vals.length ? vals[Math.floor(vals.length * 0.9)] : 255;
    }
    const glatt = new Float32Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) { let s = 0, n = 0; for (let k = -1; k <= 1; k++) for (let l = -1; l <= 1; l++) { const yy = gy + k, xx = gx + l; if (yy >= 0 && yy < gh && xx >= 0 && xx < gw) { s += grid[yy * gw + xx]; n++; } } glatt[gy * gw + gx] = s / n; }
    for (let y = 0; y < H; y++) {
      const fy = Math.min(gh - 1.001, Math.max(0, y / K - 0.5)), y0 = Math.floor(fy), y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < W; x++) {
        const fx = Math.min(gw - 1.001, Math.max(0, x / K - 0.5)), x0 = Math.floor(fx), x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
        const bg = Math.max(60, (glatt[y0 * gw + x0] * (1 - tx) + glatt[y0 * gw + x1] * tx) * (1 - ty) + (glatt[y1 * gw + x0] * (1 - tx) + glatt[y1 * gw + x1] * tx) * ty);
        const i = (y * W + x) * 4;
        if (modus === "sw") { const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / bg; const v = l < 0.72 ? 0 : 255; d[i] = d[i + 1] = d[i + 2] = v; }
        else for (let c = 0; c < 3; c++) { let v = d[i + c] / bg * 255; v = 255 - (255 - Math.min(255, v)) * 1.35; d[i + c] = v < 0 ? 0 : v; }
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }
  function drehen(quelle, grad) {
    const W = breite(quelle), H = hoehe(quelle), quer = grad % 180 !== 0;
    const c = leinwand(quer ? H : W, quer ? W : H), ctx = c.getContext("2d");
    ctx.translate(c.width / 2, c.height / 2); ctx.rotate(grad * Math.PI / 180); ctx.drawImage(quelle, -W / 2, -H / 2);
    return c;
  }
  function zuBlob(canvas, typ = "image/jpeg", q = 0.92) { return new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error("toBlob")), typ, q)); }
  function vorschau(quelle, max = 360) { return klein(quelle, max); }

  G.Bild = { laden, finden, findenDaten, entzerren, verbessern, drehen, zuBlob, vorschau, klein, breite, hoehe, homographie };
})();
