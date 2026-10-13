/* Kasse unterwegs – Excel-Datei (.xlsx) direkt auf dem Handy erzeugen, ohne Internet.
   Kleiner XLSX-Schreiber (ZIP ohne Kompression, Formeln, Stile, Auswahllisten, Datenbalken)
   und die Budget-Mappe: Übersicht · Budget · Jahresplan · Ist-Vergleich · Anleitung · Listen. */
(function () {
  "use strict";
  const enc = new TextEncoder();

  /* ---------- ZIP (Methode «stored») ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = d => { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(dateien) {
    const teile = [], zentral = []; let off = 0;
    const d = new Date(), zeit = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), datum = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const f of dateien) {
      const name = enc.encode(f.name), daten = typeof f.data === "string" ? enc.encode(f.data) : f.data, crc = crc32(daten);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, zeit, true); lh.setUint16(12, datum, true); lh.setUint32(14, crc, true); lh.setUint32(18, daten.length, true); lh.setUint32(22, daten.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      teile.push(new Uint8Array(lh.buffer), name, daten);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, zeit, true); ch.setUint16(14, datum, true); ch.setUint32(16, crc, true); ch.setUint32(20, daten.length, true); ch.setUint32(24, daten.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
      zentral.push(new Uint8Array(ch.buffer), name);
      off += 30 + name.length + daten.length;
    }
    const zGroesse = zentral.reduce((s, x) => s + x.length, 0);
    const ende = new DataView(new ArrayBuffer(22));
    ende.setUint32(0, 0x06054b50, true); ende.setUint16(8, dateien.length, true); ende.setUint16(10, dateien.length, true); ende.setUint32(12, zGroesse, true); ende.setUint32(16, off, true);
    const alle = [...teile, ...zentral, new Uint8Array(ende.buffer)], out = new Uint8Array(alle.reduce((s, x) => s + x.length, 0));
    let p = 0; for (const x of alle) { out.set(x, p); p += x.length; }
    return out;
  }

  /* ---------- Stile ---------- */
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  function Stile() {
    const fonts = ['<font><sz val="10"/><name val="Arial"/><family val="2"/></font>'], fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'], numFmts = [], xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'], dxfs = [];
    const idx = (arr, x) => { let i = arr.indexOf(x); if (i < 0) { arr.push(x); i = arr.length - 1; } return i; };
    const fmtIds = {};
    return {
      // { b, i, sz, farbe, fuellung, rahmen: "unten"|"oben"|"box", fmt, h: "left|center|right", umbruch, v: "top|center" }
      xf(o = {}) {
        const font = `<font>${o.b ? "<b/>" : ""}${o.i ? "<i/>" : ""}<sz val="${o.sz || 10}"/>${o.farbe ? `<color rgb="FF${o.farbe}"/>` : ""}<name val="Arial"/><family val="2"/></font>`;
        const fontId = idx(fonts, font);
        const fillId = o.fuellung ? idx(fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${o.fuellung}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
        const linie = f => `<${f} style="thin"><color rgb="FFC9C2B2"/></${f}>`, dick = f => `<${f} style="medium"><color rgb="FF1C6A4F"/></${f}>`;
        const border = o.rahmen === "unten" ? `<border><left/><right/><top/>${linie("bottom")}<diagonal/></border>` : o.rahmen === "oben" ? `<border><left/><right/>${dick("top")}<bottom/><diagonal/></border>` : o.rahmen === "box" ? `<border>${linie("left")}${linie("right")}${linie("top")}${linie("bottom")}<diagonal/></border>` : borders[0];
        const borderId = idx(borders, border);
        let numFmtId = 0;
        if (o.fmt) { if (!(o.fmt in fmtIds)) { fmtIds[o.fmt] = 164 + numFmts.length; numFmts.push(`<numFmt numFmtId="${fmtIds[o.fmt]}" formatCode="${esc(o.fmt)}"/>`); } numFmtId = fmtIds[o.fmt]; }
        const align = o.h || o.umbruch || o.v ? `<alignment${o.h ? ` horizontal="${o.h}"` : ""}${o.v ? ` vertical="${o.v}"` : ""}${o.umbruch ? ' wrapText="1"' : ""}/>` : "";
        const xf = `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"${numFmtId ? ' applyNumberFormat="1"' : ""} applyFont="1"${fillId ? ' applyFill="1"' : ""}${borderId ? ' applyBorder="1"' : ""}${align ? ' applyAlignment="1">' + align + "</xf>" : "/>"}`;
        return idx(xfs, xf);
      },
      dxf(farbe, fett) { return idx(dxfs, `<dxf><font>${fett ? "<b/>" : ""}<color rgb="FF${farbe}"/></font></dxf>`); },
      xml() {
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
          (numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.join("")}</numFmts>` : "") +
          `<fonts count="${fonts.length}">${fonts.join("")}</fonts><fills count="${fills.length}">${fills.join("")}</fills><borders count="${borders.length}">${borders.join("")}</borders>` +
          `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>` +
          `<cellStyles count="1"><cellStyle name="Standard" xfId="0" builtinId="0"/></cellStyles><dxfs count="${dxfs.length}">${dxfs.join("")}</dxfs></styleSheet>`;
      }
    };
  }

  /* ---------- Tabellenblatt ---------- */
  const spalte = n => { let s = ""; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; };
  const ref = (c, r) => spalte(c) + r;
  function Blatt(name) {
    const zellen = new Map(), hoehen = {};
    const b = { name, breiten: [], merges: [], listen: [], cf: [], frieren: null, farbe: null, quer: false, versteckt: false,
      // c: Spalte ab 0, r: Zeile ab 1; v: Zahl, Text oder { f: "Formel" }
      set(c, r, v, s) { if (!zellen.has(r)) zellen.set(r, new Map()); zellen.get(r).set(c, { v, s }); return b; },
      hoehe(r, h) { hoehen[r] = h; return b; },
      xml() {
        const rows = Array.from(zellen.keys()).sort((a, b2) => a - b2);
        const maxC = Math.max(0, ...Array.from(zellen.values()).flatMap(m => Array.from(m.keys())));
        let x = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`;
        x += `<sheetPr>${b.farbe ? `<tabColor rgb="FF${b.farbe}"/>` : ""}<pageSetUpPr fitToPage="1"/></sheetPr>`;
        x += `<dimension ref="A1:${ref(maxC, rows.length ? rows[rows.length - 1] : 1)}"/>`;
        x += `<sheetViews><sheetView workbookViewId="0" showGridLines="0"${b.aktiv ? ' tabSelected="1"' : ""}>`;
        if (b.frieren) x += `<pane ySplit="${b.frieren - 1}" topLeftCell="A${b.frieren}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${b.frieren}" sqref="A${b.frieren}"/>`;
        x += `</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>`;
        if (b.breiten.length) x += "<cols>" + b.breiten.map((w, i) => w ? `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>` : "").join("") + "</cols>";
        x += "<sheetData>";
        for (const r of rows) {
          const m = zellen.get(r);
          x += `<row r="${r}"${hoehen[r] ? ` ht="${hoehen[r]}" customHeight="1"` : ""}>`;
          for (const c of Array.from(m.keys()).sort((a, b2) => a - b2)) {
            const { v, s } = m.get(c), st = s ? ` s="${s}"` : "";
            if (v == null || v === "") x += `<c r="${ref(c, r)}"${st}/>`;
            else if (typeof v === "object" && v.f) x += `<c r="${ref(c, r)}"${st}${v.text ? ' t="str"' : ""}><f>${esc(v.f)}</f></c>`;
            else if (typeof v === "number") x += `<c r="${ref(c, r)}"${st}><v>${Number.isFinite(v) ? v : 0}</v></c>`;
            else x += `<c r="${ref(c, r)}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
          }
          x += "</row>";
        }
        x += "</sheetData>";
        if (b.merges.length) x += `<mergeCells count="${b.merges.length}">${b.merges.map(m => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`;
        let prio = 1;
        for (const c of b.cf) {
          if (c.typ === "balken") x += `<conditionalFormatting sqref="${c.sqref}"><cfRule type="dataBar" priority="${prio++}"><dataBar><cfvo type="num" val="0"/><cfvo type="max"/><color rgb="FF${c.farbe}"/></dataBar></cfRule></conditionalFormatting>`;
          else x += `<conditionalFormatting sqref="${c.sqref}"><cfRule type="expression" dxfId="${c.dxf}" priority="${prio++}"><formula>${esc(c.formel)}</formula></cfRule></conditionalFormatting>`;
        }
        if (b.listen.length) x += `<dataValidations count="${b.listen.length}">${b.listen.map(l => l.ganz
          ? `<dataValidation type="whole" allowBlank="1" showErrorMessage="1" errorTitle="Monat" error="Bitte eine Zahl von 1 bis 12 eingeben." sqref="${l.sqref}"><formula1>1</formula1><formula2>12</formula2></dataValidation>`
          : `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Auswahl" error="Bitte einen Wert aus der Liste wählen." sqref="${l.sqref}"><formula1>${esc('"' + l.werte.join(",") + '"')}</formula1></dataValidation>`).join("")}</dataValidations>`;
        x += `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>`;
        x += `<pageSetup paperSize="9" orientation="${b.quer ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0"/>`;
        x += `<headerFooter><oddFooter>&amp;L${esc(name)}&amp;RSeite &amp;P von &amp;N</oddFooter></headerFooter>`;
        return x + "</worksheet>";
      }
    };
    return b;
  }

  /* ---------- Arbeitsmappe ---------- */
  function mappeBytes(blaetter, stile, titel) {
    const dateien = [];
    dateien.push({ name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${blaetter.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` });
    dateien.push({ name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` });
    const jetzt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    dateien.push({ name: "docProps/core.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(titel)}</dc:title><dc:creator>Kasse unterwegs</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${jetzt}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${jetzt}</dcterms:modified></cp:coreProperties>` });
    dateien.push({ name: "docProps/app.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Kasse unterwegs</Application></Properties>` });
    dateien.push({ name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${blaetter.map((b, i) => `<sheet name="${esc(b.name)}" sheetId="${i + 1}"${b.versteckt ? ' state="hidden"' : ""} r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` });
    dateien.push({ name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${blaetter.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${blaetter.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` });
    blaetter.forEach((b, i) => dateien.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: b.xml() }));
    dateien.push({ name: "xl/styles.xml", data: stile.xml() });
    return zip(dateien);
  }

  /* ---------- Die Budget-Mappe ---------- */
  const GRUEN = "1C6A4F", HELLGRUEN = "DCEBE2", PAPIER = "F5F0E6", GELB = "FFF2CC", BLAU = "0000FF", GRAU = "6F7D75", ROT = "C00000", DUNKELGRUEN = "006100";
  const CHF = '#,##0.00;(#,##0.00);"-"', CHF0 = '#,##0;(#,##0);"-"', PROZ = '0.0%;(0.0%);"-"';
  const N = 300; // Zeilen im Budget, die die Formeln abdecken
  function budgetBytes(budget, r, o) {
    const S = Stile(), P = o.personen, [P1, P2] = P;
    const st = {
      titel: S.xf({ b: true, sz: 16, farbe: GRUEN }), unter: S.xf({ i: true, farbe: GRAU }), hinweis: S.xf({ farbe: GRAU, umbruch: true, v: "top" }),
      kopf: S.xf({ b: true, farbe: "FFFFFF", fuellung: GRUEN, v: "center", umbruch: true }), kopfR: S.xf({ b: true, farbe: "FFFFFF", fuellung: GRUEN, h: "right", v: "center", umbruch: true }),
      gruppe: S.xf({ b: true, sz: 11, fuellung: HELLGRUEN, farbe: "1D2620" }), gruppeLeer: S.xf({ fuellung: HELLGRUEN }),
      grp: S.xf({ farbe: "9AA39C", sz: 8 }), text: S.xf({}), fett: S.xf({ b: true }),
      einText: S.xf({ farbe: BLAU, fuellung: GELB, rahmen: "box" }), einChf: S.xf({ farbe: BLAU, fuellung: GELB, rahmen: "box", fmt: CHF }), einZahl: S.xf({ farbe: BLAU, fuellung: GELB, rahmen: "box", h: "center" }),
      chf: S.xf({ fmt: CHF }), chf0: S.xf({ fmt: CHF0 }), chfFett: S.xf({ b: true, fmt: CHF }), chfSumme: S.xf({ b: true, fmt: CHF, rahmen: "oben" }), textSumme: S.xf({ b: true, rahmen: "oben" }),
      proz: S.xf({ fmt: PROZ }), prozFett: S.xf({ b: true, fmt: PROZ }), grossChf: S.xf({ b: true, sz: 14, fmt: CHF0, farbe: GRUEN }), grossText: S.xf({ b: true, sz: 11 }),
      monat: S.xf({ b: true, farbe: "FFFFFF", fuellung: GRUEN, h: "center" }), klein: S.xf({ farbe: "9AA39C", sz: 8, h: "center" }), zahl: S.xf({}),
      legende: S.xf({ farbe: BLAU, fuellung: GELB, rahmen: "box" }), formelBeispiel: S.xf({ rahmen: "box", fmt: CHF })
    };
    const gut = S.dxf(DUNKELGRUEN, true), schlecht = S.dxf(ROT, true);
    const datum = new Date().toLocaleDateString("de-CH");

    /* Listen (versteckt): Häufigkeiten mit Faktor, Personen, Aufteilung */
    const li = Blatt("Listen"); li.versteckt = true; li.breiten = [18, 16, 4, 14, 4, 16];
    li.set(0, 1, "Wie oft", st.kopf).set(1, 1, "Faktor pro Monat", st.kopf);
    const hf = Object.entries(o.haeufigkeit);
    hf.forEach(([k, [t]], i) => { li.set(0, i + 2, t, st.text); li.set(1, i + 2, { f: { m: "1", w: "52/12", q: "1/3", h: "1/6", j: "1/12" }[k] }, st.zahl); });
    const HF = `Listen!$A$2:$A$${hf.length + 1}`, FK = `Listen!$B$2:$B$${hf.length + 1}`;
    const werListe = ["gemeinsam", ...P], aufteilung = ["nach Einkommen", "50 / 50"];

    /* Budget */
    const bu = Blatt("Budget"); bu.frieren = 5; bu.farbe = GRUEN; bu.quer = true;
    bu.breiten = [21, 36, 13, 15, 12, 10, 13, 13, 13, 13, 13];
    bu.set(0, 1, "Haushaltsbudget " + P.join(" & "), st.titel).hoehe(1, 24);
    bu.set(0, 2, `Blau auf Gelb = eingeben · schwarz = rechnet selbst · Stand ${datum}`, st.unter);
    bu.set(0, 3, "Zeilen einfügen innerhalb einer Gruppe ist erlaubt – Spalte A muss den Gruppennamen enthalten.", st.unter);
    const kopf = ["Gruppe", "Posten", "Betrag CHF", "Wie oft", "Wer", "Fällig Monat", "Pro Monat", "Pro Jahr", "Anteil " + P1, "Anteil " + P2, "Ist-Kategorie"];
    kopf.forEach((t, c) => bu.set(c, 4, t, c >= 2 && c !== 3 && c !== 4 && c !== 5 && c !== 10 ? st.kopfR : st.kopf)); bu.hoehe(4, 30);
    let z = 5;
    const postenZeilen = [];
    for (const g of o.gruppen) {
      bu.set(0, z, g.name, st.gruppe); for (let c = 1; c <= 10; c++) bu.set(c, z, c === 1 ? g.text : "", c === 1 ? S.xf({ i: true, farbe: GRAU, fuellung: HELLGRUEN }) : st.gruppeLeer);
      z++;
      const posten = budget.posten.filter(p => p.g === g.id);
      const leer = Math.max(2, 3 - Math.max(0, posten.length - 6));
      const zeilen = [...posten.map(p => ({ p })), ...Array.from({ length: leer }, () => ({ p: null }))];
      for (const { p } of zeilen) {
        const hfT = p ? o.haeufigkeit[p.h][0] : "monatlich";
        bu.set(0, z, g.name, st.grp);
        bu.set(1, z, p ? p.name : "", st.einText);
        bu.set(2, z, p && Number(p.betrag) > 0 ? Number(p.betrag) : "", st.einChf);
        bu.set(3, z, hfT, st.einText);
        bu.set(4, z, p ? p.wer : "gemeinsam", st.einText);
        bu.set(5, z, p && ["j", "h", "q"].includes(p.h) ? Number(p.monat) || 1 : "", st.einZahl);
        bu.set(6, z, { f: `IFERROR(C${z}*INDEX(${FK},MATCH(D${z},${HF},0)),0)` }, st.chf);
        bu.set(7, z, { f: `G${z}*12` }, st.chf);
        bu.set(8, z, { f: g.art === "ein" ? `IF(E${z}="${P1}",G${z},IF(E${z}="${P2}",0,G${z}/2))` : `IF(E${z}="${P1}",G${z},IF(E${z}="${P2}",0,G${z}*'Übersicht'!$C$24))` }, st.chf);
        bu.set(9, z, { f: `G${z}-I${z}` }, st.chf);
        bu.set(10, z, p && p.link ? (p.link === "einkauf" ? "Lebensmittel" : "Auswärts") : "", st.einText);
        postenZeilen.push(z); z++;
      }
    }
    const R = c => `Budget!$${c}$5:$${c}$${N}`;
    bu.set(1, z + 1, "Kontrolle: Summe aller Posten pro Monat", st.textSumme).set(6, z + 1, { f: `SUM(G5:G${z - 1})` }, st.chfSumme).set(8, z + 1, { f: `SUM(I5:I${z - 1})` }, st.chfSumme).set(9, z + 1, { f: `SUM(J5:J${z - 1})` }, st.chfSumme);
    bu.listen.push({ sqref: `D5:D${N}`, werte: hf.map(([, [t]]) => t) }, { sqref: `E5:E${N}`, werte: werListe }, { sqref: `F5:F${N}`, ganz: true }, { sqref: `K5:K${N}`, werte: ["Lebensmittel", "Auswärts"] });

    /* Übersicht */
    const ue = Blatt("Übersicht"); ue.farbe = "C98A1A"; ue.aktiv = true;
    ue.breiten = [3, 46, 15, 15, 17, 3, 46];
    ue.set(1, 1, "Budget-Übersicht " + P.join(" & "), st.titel).hoehe(1, 24);
    ue.set(1, 2, `Alles pro Monat in CHF · rechnet aus dem Blatt «Budget» · Stand ${datum}`, st.unter);
    ue.set(1, 4, "Gemeinsame Kosten teilen", st.fett).set(2, 4, budget.aufteilung === "haelfte" ? aufteilung[1] : aufteilung[0], st.einText);
    ue.set(6, 4, "«nach Einkommen»: wer mehr verdient, trägt mehr. «50 / 50»: hälftig.", st.hinweis);
    ue.listen.push({ sqref: "C4", werte: aufteilung });
    ue.set(1, 6, "Bereich", st.kopf).set(2, 6, "Pro Monat", st.kopfR).set(3, 6, "Pro Jahr", st.kopfR).set(4, 6, "% Einnahmen", st.kopfR);
    ue.set(1, 7, "Einnahmen", st.grossText).set(2, 7, { f: `SUMIFS(${R("G")},${R("A")},"Einnahmen")` }, st.chfFett).set(3, 7, { f: "C7*12" }, st.chfFett).set(4, 7, { f: "IF($C$7=0,0,C7/$C$7)" }, st.prozFett);
    const ausG = o.gruppen.filter(g => g.art !== "ein" && g.art !== "spar");
    let zr = 8;
    for (const g of ausG) { ue.set(1, zr, g.name, st.text).set(2, zr, { f: `SUMIFS(${R("G")},${R("A")},B${zr})` }, st.chf).set(3, zr, { f: `C${zr}*12` }, st.chf).set(4, zr, { f: `IF($C$7=0,0,C${zr}/$C$7)` }, st.proz); zr++; }
    const zAus = zr; ue.set(1, zr, "Ausgaben total", st.textSumme).set(2, zr, { f: `SUM(C8:C${zr - 1})` }, st.chfSumme).set(3, zr, { f: `C${zr}*12` }, st.chfSumme).set(4, zr, { f: `IF($C$7=0,0,C${zr}/$C$7)` }, st.prozFett); zr++;
    const sparG = o.gruppen.find(g => g.art === "spar");
    const zSpar = zr; ue.set(1, zr, sparG.name, st.text).set(2, zr, { f: `SUMIFS(${R("G")},${R("A")},B${zr})` }, st.chf).set(3, zr, { f: `C${zr}*12` }, st.chf).set(4, zr, { f: `IF($C$7=0,0,C${zr}/$C$7)` }, st.proz); zr++;
    const zUeb = zr; ue.set(1, zr, "Übrig pro Monat", st.textSumme).set(2, zr, { f: `C7-C${zAus}-C${zSpar}` }, S.xf({ b: true, sz: 12, fmt: CHF, rahmen: "oben" })).set(3, zr, { f: `C${zr}*12` }, st.chfSumme).set(4, zr, { f: `IF($C$7=0,0,C${zr}/$C$7)` }, st.prozFett);
    ue.cf.push({ sqref: `C${zUeb}:E${zUeb}`, dxf: schlecht, formel: `$C$${zUeb}<0` }, { sqref: `C${zUeb}:E${zUeb}`, dxf: gut, formel: `$C$${zUeb}>=0` });
    ue.cf.push({ sqref: `C8:C${zAus - 1}`, typ: "balken", farbe: "8CC4A8" });
    ue.set(6, 7, "Rechnet automatisch: jährliche Beträge ÷ 12, vierteljährliche ÷ 3, wöchentliche × 52 ÷ 12.", st.hinweis);
    ue.set(6, zUeb, "Positiv = Reserve oder zusätzlich sparen. Negativ (rot) = Budget geht nicht auf.", st.hinweis);
    // Wer zahlt was – feste Zeilen 21–29
    ue.set(1, 21, "Wer zahlt was", st.kopf).set(2, 21, P1, st.kopfR).set(3, 21, P2, st.kopfR).set(4, 21, "Zusammen", st.kopfR);
    const einP = p => `SUMIFS(${R("G")},${R("A")},"Einnahmen",${R("E")},"${p}")+SUMIFS(${R("G")},${R("A")},"Einnahmen",${R("E")},"gemeinsam")/2`;
    ue.set(1, 22, "Einnahmen", st.text).set(2, 22, { f: einP(P1) }, st.chf).set(3, 22, { f: einP(P2) }, st.chf).set(4, 22, { f: "C22+D22" }, st.chf);
    ue.set(1, 23, "Gemeinsame Kosten (inkl. Rückstellungen und Sparen)", st.text).set(4, 23, { f: `SUMIFS(${R("G")},${R("A")},"<>Einnahmen",${R("E")},"gemeinsam")` }, st.chf);
    ue.set(1, 24, "Anteil an den gemeinsamen Kosten", st.text).set(2, 24, { f: `IF($C$4="50 / 50",0.5,IF(E22=0,0.5,C22/E22))` }, st.proz).set(3, 24, { f: "1-C24" }, st.proz).set(4, 24, { f: "C24+D24" }, st.proz);
    ue.set(1, 25, "Anteil gemeinsame Kosten in CHF", st.text).set(2, 25, { f: "$E$23*C24" }, st.chf).set(3, 25, { f: "$E$23*D24" }, st.chf).set(4, 25, { f: "C25+D25" }, st.chf);
    ue.set(1, 26, "Eigene Kosten", st.text).set(2, 26, { f: `SUMIFS(${R("G")},${R("A")},"<>Einnahmen",${R("E")},"${P1}")` }, st.chf).set(3, 26, { f: `SUMIFS(${R("G")},${R("A")},"<>Einnahmen",${R("E")},"${P2}")` }, st.chf).set(4, 26, { f: "C26+D26" }, st.chf);
    ue.set(1, 27, "Frei verfügbar", st.textSumme).set(2, 27, { f: "C22-C25-C26" }, st.chfSumme).set(3, 27, { f: "D22-D25-D26" }, st.chfSumme).set(4, 27, { f: "C27+D27" }, st.chfSumme);
    ue.set(1, 28, "Aufs gemeinsame Konto, pro Monat (auf 5 Rp.)", st.fett).set(2, 28, { f: "MROUND(C25,0.05)" }, st.chfFett).set(3, 28, { f: "MROUND(D25,0.05)" }, st.chfFett).set(4, 28, { f: "C28+D28" }, st.chfFett);
    ue.cf.push({ sqref: "C27:E27", dxf: schlecht, formel: "C27<0" });
    ue.set(6, 23, "Alle Posten mit «Wer = gemeinsam» ausser Einnahmen.", st.hinweis);
    ue.set(6, 24, "Gemeinsame Einnahmen (z. B. Bonus) zählen je zur Hälfte.", st.hinweis);
    // Faustregeln – Zeilen 31–36
    ue.set(1, 31, "Faustregeln (grobe Richtwerte)", st.kopf).set(2, 31, "Wert", st.kopfR).set(3, 31, "Ziel", st.kopfR).set(4, 31, "Status", st.kopf);
    ue.set(1, 32, "Miete im Verhältnis zu den Einnahmen", st.text).set(2, 32, { f: `IF($C$7=0,0,SUMIFS(${R("G")},${R("B")},"*Miete*")/$C$7)` }, st.proz).set(3, 32, { f: "1/3" }, st.proz).set(4, 32, { f: `IF(C32<=D32,"✓ erfüllt","✗ zu hoch")`, text: true }, st.fett);
    ue.set(1, 33, "Sparquote", st.text).set(2, 33, { f: `IF($C$7=0,0,C${zSpar}/$C$7)` }, st.proz).set(3, 33, 0.1, st.proz).set(4, 33, { f: `IF(C33>=D33,"✓ erfüllt","✗ zu tief")`, text: true }, st.fett);
    ue.set(1, 34, "Budget geht auf (übrig ≥ 0)", st.text).set(2, 34, { f: `C${zUeb}` }, st.chf).set(3, 34, 0, st.chf).set(4, 34, { f: `IF(C34>=D34,"✓ erfüllt","✗ Defizit")`, text: true }, st.fett);
    const periodisch = `SUMPRODUCT((${R("A")}<>"Einnahmen")*(${R("A")}<>"")*((${R("D")}="jährlich")+(${R("D")}="halbjährlich")+(${R("D")}="vierteljährlich"))*${R("G")})`;
    ue.set(1, 35, "Für Jahresrechnungen monatlich zurücklegen", st.text).set(2, 35, { f: periodisch }, st.chf);
    ue.set(1, 36, "Notgroschen (drei Monatsausgaben)", st.text).set(2, 36, { f: `C${zAus}*3` }, st.chf);
    ue.cf.push({ sqref: "E32:E34", dxf: gut, formel: 'LEFT(E32,1)="✓"' }, { sqref: "E32:E34", dxf: schlecht, formel: 'LEFT(E32,1)="✗"' });
    ue.set(6, 32, "Faustregel: Miete höchstens ein Drittel des Nettoeinkommens.", st.hinweis);
    ue.set(6, 33, "Faustregel: mindestens 10 % der Einnahmen sparen.", st.hinweis);
    ue.set(6, 35, "Am besten per Dauerauftrag auf ein eigenes Konto.", st.hinweis);
    ue.set(6, 36, "Faustregel: drei Monatsausgaben als Reserve auf dem Sparkonto.", st.hinweis);
    ue.set(1, 38, "Diese Richtwerte sind übliche Faustregeln, keine Vorgaben einer Beratungsstelle. Für eine persönliche Beratung: Budgetberatung Schweiz (budgetberatung.ch).", st.hinweis);

    /* Jahresplan: wann fliesst wie viel? */
    const ja = Blatt("Jahresplan"); ja.farbe = "2A78D6"; ja.quer = true; ja.frieren = 6;
    ja.breiten = [40, ...Array(12).fill(10.5), 12];
    ja.set(0, 1, "Jahresplan – Geldflüsse pro Monat", st.titel).hoehe(1, 24);
    ja.set(0, 2, "Monatliche Posten jeden Monat, jährliche im Fälligkeitsmonat, halbjährliche alle 6, vierteljährliche alle 3 Monate ab dem Fälligkeitsmonat.", st.unter);
    ja.set(0, 4, "", st.kopf); o.monate.forEach((m, i) => ja.set(i + 1, 4, m.slice(0, 3), st.monat)); ja.set(13, 4, "Jahr", st.monat);
    ja.set(0, 5, "Monat Nr.", st.klein); for (let i = 0; i < 12; i++) ja.set(i + 1, 5, i + 1, st.klein);
    const regel = `((${R("D")}="monatlich")+(${R("D")}="wöchentlich")*52/12)*${R("C")}`;
    const faellig = c => `((${R("D")}="jährlich")*(${R("F")}=${c}$5)+(${R("D")}="halbjährlich")*(MOD(${c}$5-${R("F")},6)=0)+(${R("D")}="vierteljährlich")*(MOD(${c}$5-${R("F")},3)=0))*${R("C")}`;
    const ein = `(${R("A")}="Einnahmen")`, aus = `(${R("A")}<>"Einnahmen")*(${R("A")}<>"")`;
    const zeilenJ = [
      ["Einnahmen", c => `SUMPRODUCT(${ein}*(${regel}+${faellig(c)}))`, st.chf],
      ["Ausgaben (inkl. Rückstellungen und Sparen)", c => `SUMPRODUCT(${aus}*(${regel}+${faellig(c)}))`, st.chf],
      ["davon periodische Rechnungen", c => `SUMPRODUCT(${aus}*${faellig(c)})`, S.xf({ i: true, farbe: GRAU, fmt: CHF })],
      ["Saldo des Monats", c => `${c}6-${c}7`, st.chfSumme],
      ["Kumuliert seit Januar", c => c === "B" ? "B9" : `${String.fromCharCode(c.charCodeAt(0) - 1)}10+${c}9`, st.chfFett]
    ];
    zeilenJ.forEach(([t, f, s], k) => {
      const zz = 6 + k; ja.set(0, zz, t, k === 3 ? st.textSumme : k === 4 ? st.fett : st.text);
      for (let i = 0; i < 12; i++) { const c = spalte(i + 1); ja.set(i + 1, zz, { f: f(c) }, s); }
      ja.set(13, zz, k === 4 ? { f: "M10" } : { f: `SUM(B${zz}:M${zz})` }, k >= 3 ? st.chfSumme : st.chfFett);
    });
    ja.cf.push({ sqref: "B9:N10", dxf: schlecht, formel: "B9<0" });
    ja.set(0, 12, "Rot = in diesem Monat geht mehr weg als reinkommt. Mit den monatlichen Rückstellungen (Blatt «Übersicht») wird das ausgeglichen.", st.hinweis);

    /* Ist-Vergleich */
    const iv = Blatt("Ist-Vergleich"); iv.farbe = "EB6834"; iv.frieren = 5;
    iv.breiten = [16, 14, 14, 13, 14, 14, 13, 3, 44];
    iv.set(0, 1, "Ist-Vergleich Essen", st.titel).hoehe(1, 24);
    iv.set(0, 2, "Budget kommt aus dem Blatt «Budget» (Spalte «Ist-Kategorie»). Ist-Werte eintragen oder aus der Haushaltskasse übernehmen.", st.unter);
    ["Monat", "Budget Lebensmittel", "Ist Lebensmittel", "Differenz", "Budget Auswärts", "Ist Auswärts", "Differenz"].forEach((t, c) => iv.set(c, 4, t, c ? st.kopfR : st.kopf)); iv.hoehe(4, 30);
    const jahr = new Date().getFullYear(), istMap = {};
    for (const m of (o.ist && o.ist.verlauf) || []) istMap[m.m] = m;
    const jetztM = new Date().toISOString().slice(0, 7);
    if (o.ist && (o.ist.einkauf || o.ist.auswaerts)) istMap[jetztM] = { m: jetztM, einkauf: o.ist.einkauf, auswaerts: o.ist.auswaerts };
    for (let i = 0; i < 12; i++) {
      const zz = 5 + i, key = `${jahr}-${String(i + 1).padStart(2, "0")}`, m = istMap[key];
      iv.set(0, zz, `${o.monate[i]} ${jahr}`, st.text);
      iv.set(1, zz, { f: `SUMIFS(${R("G")},${R("K")},"Lebensmittel")` }, st.chf);
      iv.set(2, zz, m && Number(m.einkauf) > 0 ? Math.round(Number(m.einkauf) * 100) / 100 : "", st.einChf);
      iv.set(3, zz, { f: `IF(C${zz}="","",B${zz}-C${zz})` }, st.chf);
      iv.set(4, zz, { f: `SUMIFS(${R("G")},${R("K")},"Auswärts")` }, st.chf);
      iv.set(5, zz, m && Number(m.auswaerts) > 0 ? Math.round(Number(m.auswaerts) * 100) / 100 : "", st.einChf);
      iv.set(6, zz, { f: `IF(F${zz}="","",E${zz}-F${zz})` }, st.chf);
    }
    iv.set(0, 17, "Total", st.textSumme);
    iv.set(1, 17, { f: 'SUMPRODUCT((C5:C16<>"")*B5:B16)' }, st.chfSumme).set(2, 17, { f: "SUM(C5:C16)" }, st.chfSumme).set(3, 17, { f: "SUM(D5:D16)" }, st.chfSumme);
    iv.set(4, 17, { f: 'SUMPRODUCT((F5:F16<>"")*E5:E16)' }, st.chfSumme).set(5, 17, { f: "SUM(F5:F16)" }, st.chfSumme).set(6, 17, { f: "SUM(G5:G16)" }, st.chfSumme);
    iv.set(8, 17, "Budget-Total zählt nur Monate mit Ist-Wert. Differenz positiv = unter Budget.", st.hinweis);
    iv.cf.push({ sqref: "D5:D17 G5:G17", dxf: schlecht, formel: 'AND(ISNUMBER(D5),D5<0)' }, { sqref: "D5:D17 G5:G17", dxf: gut, formel: 'AND(ISNUMBER(D5),D5>=0)' });

    /* Anleitung */
    const an = Blatt("Anleitung"); an.farbe = "6F7D75";
    an.breiten = [3, 30, 14, 15, 12, 10, 50];
    an.set(1, 1, "So funktioniert die Budget-Tabelle", st.titel).hoehe(1, 24);
    an.set(1, 2, `Erstellt mit «Kasse unterwegs» am ${datum}`, st.unter);
    const absatz = [
      ["1. Blatt «Budget»", "Pro Posten Betrag, «Wie oft», «Wer» und bei jährlichen Rechnungen den Fälligkeitsmonat eintragen. Jahresbeträge (Steuern, Versicherungen) einfach als Jahresbetrag – umgerechnet wird automatisch."],
      ["2. Blatt «Übersicht»", "Zeigt Einnahmen, Ausgaben je Bereich, Sparen, was übrig bleibt, wer wie viel trägt und wie viel jede Person aufs gemeinsame Konto überweist."],
      ["3. Blatt «Jahresplan»", "Zeigt Monat für Monat, wann grosse Rechnungen fällig sind und ob das Geld reicht."],
      ["4. Blatt «Ist-Vergleich»", "Ist-Ausgaben für Lebensmittel und Auswärts essen pro Monat – aus der Haushaltskasse oder von Hand."],
      ["Fälligkeit", "Bei jährlichen, halbjährlichen und vierteljährlichen Posten den Monat (1–12) der ersten Rechnung eintragen – sonst fehlt die Rechnung im Jahresplan."],
      ["Neue Posten", "Innerhalb einer Gruppe eine Zeile einfügen und in Spalte A den Gruppennamen stehen lassen. Die Formeln decken die Zeilen 5 bis " + N + " ab."]
    ];
    absatz.forEach(([t, x], i) => { an.set(1, 4 + i, t, st.fett).set(2, 4 + i, x, st.hinweis); an.merges.push(`C${4 + i}:G${4 + i}`); an.hoehe(4 + i, 30); });
    an.set(1, 11, "Legende", st.kopf); for (let c = 2; c <= 6; c++) an.set(c, 11, "", st.kopf);
    an.set(1, 12, "Eingabe", st.legende).set(2, 12, "Blaue Schrift auf Gelb: hier eintragen oder ändern.", st.text); an.merges.push("C12:G12");
    an.set(1, 13, { f: "1234.5" }, st.formelBeispiel).set(2, 13, "Schwarze Schrift: Formel, rechnet selbst – nicht überschreiben.", st.text); an.merges.push("C13:G13");
    an.set(1, 15, "Beispielzeile (so wird ein Posten ausgefüllt)", st.kopf); for (let c = 2; c <= 6; c++) an.set(c, 15, "", st.kopf);
    ["Posten", "Betrag CHF", "Wie oft", "Wer", "Fällig", "Ergibt pro Monat"].forEach((t, c) => an.set(c + 1, 16, t, st.fett));
    an.set(1, 17, "Steuern (Beispiel)", st.einText).set(2, 17, 6000, st.einChf).set(3, 17, "jährlich", st.einText).set(4, 17, "gemeinsam", st.einText).set(5, 17, 3, st.einZahl).set(6, 17, { f: "C17/12" }, st.chf);
    an.set(1, 19, "Wie oft", st.kopf).set(2, 19, "Faktor pro Monat", st.kopfR); for (let c = 3; c <= 6; c++) an.set(c, 19, "", st.kopf);
    hf.forEach(([, [t]], i) => { an.set(1, 20 + i, t, st.text).set(2, 20 + i, { f: `Listen!B${i + 2}` }, S.xf({ fmt: "0.0000" })); });
    an.set(1, 26, "Hinweis", st.fett).set(2, 26, "Die Faustregeln in der Übersicht sind allgemeine Richtwerte. Für eine persönliche Budgetberatung: Budgetberatung Schweiz (budgetberatung.ch).", st.hinweis); an.merges.push("C26:G26"); an.hoehe(26, 30);

    return mappeBytes([ue, bu, ja, iv, an, li], S, "Haushaltsbudget " + P.join(" & "));
  }
  function budgetMappe(budget, r, o) {
    return new Blob([budgetBytes(budget, r, o)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  window.Excel = { budgetMappe, budgetBytes, zip, crc32 };
})();
