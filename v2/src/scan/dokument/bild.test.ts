import { describe, expect, it } from "vitest";
import { findenDaten, homographie } from "./bild.js";
import type { Punkt } from "./bild.js";

/** Heller Beleg (Viereck q, in Pixeln) mit etwas «Schrift» auf dunklem, warmem Holz */
function szene(W: number, H: number, q: Punkt[]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4);
  const innen = (x: number, y: number) => q.every((a, i) => { const b = q[(i + 1) % 4]; return (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) >= 0; });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, rausch = ((x * 7919 + y * 104729) % 13) - 6;
    if (innen(x + 0.5, y + 0.5)) {
      const schrift = y % 14 < 3 && x % 9 < 6 && (x * 31 + y) % 5 !== 0;
      const v = schrift ? 40 : 240 + rausch / 2;
      d[i] = v; d[i + 1] = v; d[i + 2] = v - 3;
    } else { d[i] = 70 + rausch; d[i + 1] = 52 + rausch; d[i + 2] = 38 + rausch; }
    d[i + 3] = 255;
  }
  return d;
}

describe("Dokumentscanner: Beleg im Bild finden", () => {
  it("findet einen schräg liegenden Beleg auf dunklem Grund", () => {
    const W = 240, H = 320;
    const q = [{ x: 52, y: 40 }, { x: 196, y: 52 }, { x: 186, y: 290 }, { x: 40, y: 280 }];
    const r = findenDaten(szene(W, H, q), W, H);
    expect(r).not.toBeNull();
    expect(r!.guete).toBeGreaterThanOrEqual(0.5);
    r!.ecken.forEach((p, i) => {
      expect(Math.abs(p.x * W - q[i].x)).toBeLessThan(8);
      expect(Math.abs(p.y * H - q[i].y)).toBeLessThan(8);
    });
  });

  it("Homographie bildet das Einheitsquadrat auf die Ecken ab", () => {
    const q = [{ x: 10, y: 20 }, { x: 300, y: 35 }, { x: 280, y: 400 }, { x: 5, y: 390 }];
    const { a, b, c, d, e, f, g, h } = homographie(q);
    const abb = (u: number, v: number) => { const z = g * u + h * v + 1; return { x: (a * u + b * v + c) / z, y: (d * u + e * v + f) / z }; };
    [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], i) => {
      const p = abb(u, v);
      expect(p.x).toBeCloseTo(q[i].x, 6);
      expect(p.y).toBeCloseTo(q[i].y, 6);
    });
  });
});
