/* Kasse unterwegs – durchsuchbares PDF ohne Bibliothek: je Seite das Scan-Bild (JPEG, unverändert eingebettet)
   und darüber unsichtbarer Text an den Wortpositionen der Texterkennung (Suchen und Kopieren im PDF-Leser). */
(function () {
  "use strict";
  const enc = new TextEncoder();
  // Helvetica mit WinAnsi: Umlaute direkt, € und typografische Zeichen umsetzen
  const WIN = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "–": 0x96, "—": 0x97 };
  function pdfText(s) {
    const out = [0x28];
    for (const ch of String(s)) {
      let c = ch.codePointAt(0);
      if (WIN[ch]) c = WIN[ch]; else if (c > 255) c = 0x3f;
      if (c === 0x28 || c === 0x29 || c === 0x5c) out.push(0x5c);
      out.push(c);
    }
    out.push(0x29);
    return new Uint8Array(out);
  }
  const zahl = n => (Math.round(n * 100) / 100).toString();
  function erstellen(seiten, titel) {
    const teile = [], offsets = []; let laenge = 0;
    const add = x => { const b = typeof x === "string" ? enc.encode(x) : x; teile.push(b); laenge += b.length; };
    const obj = (nr, kopf, strom) => { offsets[nr] = laenge; add(`${nr} 0 obj\n${kopf}\n`); if (strom) { add("stream\n"); add(strom); add("\nendstream\n"); } add("endobj\n"); };
    add("%PDF-1.4\n"); add(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    const n = seiten.length, kids = [];
    // 1 Katalog, 2 Seiten, 3 Schrift, 4 Info, dann je Seite: Bild, Inhalt, Seite
    for (let i = 0; i < n; i++) kids.push(`${5 + i * 3 + 2} 0 R`);
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${n} >>`);
    obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const d = new Date(), p2 = x => String(x).padStart(2, "0");
    offsets[4] = laenge; add("4 0 obj\n<< /Producer (Kasse unterwegs) /Title "); add(pdfText(titel || "Quittung")); add(` /CreationDate (D:${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}) >>\nendobj\n`);
    seiten.forEach((s, i) => {
      const nrBild = 5 + i * 3, nrInhalt = nrBild + 1, nrSeite = nrBild + 2;
      const pw = 595.28, sc = pw / s.breite, ph = s.hoehe * sc;
      obj(nrBild, `<< /Type /XObject /Subtype /Image /Width ${s.breite} /Height ${s.hoehe} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${s.jpeg.length} >>`, s.jpeg);
      // Inhalt: Bild füllt die Seite, darüber unsichtbarer Text (Darstellungsmodus 3)
      const inhalt = [enc.encode(`q ${zahl(pw)} 0 0 ${zahl(ph)} 0 0 cm /Im1 Do Q\nBT 3 Tr\n`)];
      const wsx = s.woerterBreite ? pw / s.woerterBreite : sc, wsy = s.woerterHoehe ? ph / s.woerterHoehe : sc;
      for (const w of s.woerter || []) {
        const t = String(w.t || "").trim(); if (!t) continue;
        const hgt = Math.max(2, (w.y1 - w.y0) * wsy), size = hgt * 0.92, ziel = Math.max(1, (w.x1 - w.x0) * wsx);
        const tz = Math.min(400, Math.max(20, 100 * ziel / (t.length * 0.52 * size)));
        inhalt.push(enc.encode(`/F1 ${zahl(size)} Tf ${zahl(tz)} Tz 1 0 0 1 ${zahl(w.x0 * wsx)} ${zahl(ph - w.y1 * wsy + hgt * 0.18)} Tm `), pdfText(t), enc.encode(" Tj\n"));
      }
      inhalt.push(enc.encode("ET\n"));
      const lang = inhalt.reduce((a, b) => a + b.length, 0), strom = new Uint8Array(lang); let o = 0; for (const b of inhalt) { strom.set(b, o); o += b.length; }
      obj(nrInhalt, `<< /Length ${lang} >>`, strom);
      obj(nrSeite, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${zahl(pw)} ${zahl(ph)}] /Resources << /XObject << /Im1 ${nrBild} 0 R >> /Font << /F1 3 0 R >> >> /Contents ${nrInhalt} 0 R >>`);
    });
    const anzahl = 5 + n * 3, xref = laenge;
    let x = `xref\n0 ${anzahl}\n0000000000 65535 f \n`;
    for (let i = 1; i < anzahl; i++) x += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
    add(x); add(`trailer\n<< /Size ${anzahl} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(laenge); let o = 0; for (const b of teile) { out.set(b, o); o += b.length; }
    return out;
  }
  window.PDF = { erstellen };
})();
