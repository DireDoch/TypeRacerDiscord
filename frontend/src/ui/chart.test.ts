import { describe, it, expect } from "vitest";
import { chartGeometry, nearestIndex, niceMax, readoutText } from "./chart";
import type { PerSecondPoint } from "../core/types";

const pt = (t: number, wpm: number, raw: number, errors = 0): PerSecondPoint => ({ t, wpm, raw, errors, burst: wpm });

describe("niceMax", () => {
  it("arrondit au multiple de 10 au-dessus", () => {
    expect(niceMax(83)).toBe(90);
    expect(niceMax(90)).toBe(90);
  });

  it("ne descend jamais sous 10 — un Run à 0 wpm garde un axe lisible", () => {
    expect(niceMax(0)).toBe(10);
  });
});

describe("chartGeometry", () => {
  const points = [pt(1, 40, 44), pt(2, 60, 62, 2), pt(3, 55, 58), pt(4.2, 70, 71)];
  const g = chartGeometry(points, 400, 200);

  it("étale les points sur le temps, pas sur leur index — le dernier porte la durée exacte", () => {
    expect(g.xs).toHaveLength(4);
    expect(g.xs[0]).toBe(g.left);
    expect(g.xs[3]).toBeCloseTo(g.right);
    // t=3 sur une étendue de 1 à 4,2 : (3-1)/3,2 = 62,5 % du tracé.
    expect((g.xs[2] - g.left) / (g.right - g.left)).toBeCloseTo(0.625);
  });

  it("pose une faute par seconde fautive, sur la courbe wpm", () => {
    expect(g.dots).toHaveLength(1);
    expect(g.dots[0].x).toBeCloseTo(g.xs[1]);
  });

  it("referme l'aire sur la ligne de base", () => {
    expect(g.areaPath.endsWith(`L${g.xs[0].toFixed(1)},${g.baseline} Z`)).toBe(true);
  });

  it("plafonne l'axe Y au-dessus du maximum lu, raw compris", () => {
    expect(g.ticks.map((t) => t.value)).toEqual([0, 40, 80]);
    expect(g.ticks[0].y).toBe(g.baseline);
  });

  it("survit à un Run d'une seule seconde — aucune division par zéro", () => {
    const solo = chartGeometry([pt(1, 30, 32)], 400, 200);
    expect(solo.xs[0]).toBe(solo.left);
    expect(solo.areaPath).toBe("");
  });
});

describe("chartGeometry — unité du joueur (#69)", () => {
  const points = [pt(1, 40, 40), pt(2, 80, 80)];

  it("met l'axe à l'échelle de l'unité affichée, pas du WPM brut", () => {
    // 80 wpm = 400 cpm : un axe plafonné à 80 sous un héros à « 400 cpm » ne veut rien dire.
    expect(chartGeometry(points, 400, 200, "wpm").ticks.at(-1)!.value).toBe(80);
    expect(chartGeometry(points, 400, 200, "cpm").ticks.at(-1)!.value).toBe(400);
  });
});

describe("nearestIndex", () => {
  it("se cale sur la seconde la plus proche, jamais entre deux", () => {
    expect(nearestIndex([0, 10, 20, 30], 16)).toBe(2);
    expect(nearestIndex([0, 10, 20, 30], 4)).toBe(0);
    expect(nearestIndex([0, 10, 20, 30], 999)).toBe(3);
  });
});

describe("readoutText", () => {
  it("accorde le pluriel des fautes et garde la seconde entière entière", () => {
    expect(readoutText(pt(12, 80, 84, 1))).toBe("12 s · 80 wpm · 84 raw · 1 faute");
    expect(readoutText(pt(12, 80, 84, 0))).toBe("12 s · 80 wpm · 84 raw · 0 fautes");
  });

  it("garde la décimale du dernier point, qui porte la durée exacte", () => {
    expect(readoutText(pt(31.4, 87, 92, 3))).toBe("31.4 s · 87 wpm · 92 raw · 3 fautes");
  });

  it("suit l'unité choisie, libellé compris", () => {
    expect(readoutText(pt(12, 80, 84, 0), "cpm")).toBe("12 s · 400 cpm · 420 raw · 0 fautes");
  });
});
