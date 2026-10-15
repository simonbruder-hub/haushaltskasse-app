import { describe, expect, test } from "vitest";
import { gtinGueltig, istLadenCode, normalisieren } from "./ean";
import { packungAusOff, packungAusText, packungText } from "./menge";

describe("Packungsgrösse lesen (Blueprint §3.2)", () => {
  test.each([
    ["6 x 1.5 l", { groesse: 1.5, einheit: "l", anzahl: 6 }],
    ["4x125g", { groesse: 125, einheit: "g", anzahl: 4 }],
    ["75 cl", { groesse: 750, einheit: "ml", anzahl: 1 }],
    ["1,5 L", { groesse: 1.5, einheit: "l", anzahl: 1 }],
    ["10 Stück", { groesse: 10, einheit: "piece", anzahl: 1 }],
    ["1.5l x 6", { groesse: 1.5, einheit: "l", anzahl: 6 }],
    ["2 dl", { groesse: 200, einheit: "ml", anzahl: 1 }],
    // Belegtexte
    ["M-CL VOLLMI UHT 1L", { groesse: 1, einheit: "l", anzahl: 1 }],
    ["ZWEIFEL CHIPS NATURE 280G", { groesse: 280, einheit: "g", anzahl: 1 }],
    ["AQUA PANNA 6X1.5L", { groesse: 1.5, einheit: "l", anzahl: 6 }],
    ["EIER FREILAND 6ER", { groesse: 6, einheit: "piece", anzahl: 1 }],
  ])("«%s»", (text, erwartet) => {
    expect(packungAusText(text)).toEqual(erwartet);
  });

  test.each([["environ 1 kg"], ["ca. 500 g"], ["BANANEN"], ["M-CL VOLLMI UHT"], ["Preis 3.20"], [""]])("«%s» → nichts", (text) => {
    expect(packungAusText(text)).toBeNull();
  });

  test("OpenFoodFacts ohne lesbare Angabe: Gesamtmenge", () => {
    expect(packungAusOff("1 Packung", 500, "g")).toEqual({ groesse: 500, einheit: "g", anzahl: 1 });
    expect(packungAusOff(null, "33", "cl")).toEqual({ groesse: 330, einheit: "ml", anzahl: 1 });
    expect(packungAusOff(null, null, null)).toBeNull();
  });

  test("Anzeige", () => {
    expect(packungText({ groesse: 1.5, einheit: "l", anzahl: 6 })).toBe("6 × 1.5 l");
    expect(packungText({ groesse: 10, einheit: "piece", anzahl: 1 })).toBe("10 Stk.");
  });
});

describe("EAN prüfen", () => {
  test.each([["7610200337030", true], ["7610200337037", false], ["4006381333931", true], ["96385074", true], ["036000291452", true], ["123", false]])(
    "%s → %s", (code, ok) => { expect(gtinGueltig(code)).toBe(ok); });
  test("Ladencode und UPC-A", () => {
    expect(istLadenCode("2412345012345")).toBe(true);
    expect(istLadenCode("7610200337030")).toBe(false);
    expect(normalisieren("036000291452")).toBe("0036000291452");
  });
});
