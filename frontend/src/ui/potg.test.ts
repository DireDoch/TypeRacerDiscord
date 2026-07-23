import { describe, it, expect } from "vitest";
import { duelWindow, rampedAdvance } from "./potg";
import type { KeystrokeLog } from "../core/types";

/** Un log dont seule la DERNIÈRE frappe compte pour l'arrivée (le reste positionne). */
const log = (...ts: number[]): KeystrokeLog => ts.map((t) => ({ t, k: "a" }));

describe("duelWindow — la fenêtre du duel sur l'horloge commune (ADR 0011)", () => {
  it("de 3 s avant la 1re arrivée jusqu'à la 2e", () => {
    // Arrivées à 10,0 s et 10,5 s → start 7,0 s, end 10,5 s.
    expect(duelWindow(log(2000, 10_000), log(3000, 10_500))).toEqual({
      start: 7000,
      end: 10_500,
    });
  });

  it("l'ordre des deux logs est indifférent (min/max)", () => {
    expect(duelWindow(log(10_500), log(10_000))).toEqual({ start: 7000, end: 10_500 });
  });

  it("un duel dans les 3 premières secondes borne le début à 0, jamais négatif", () => {
    expect(duelWindow(log(1000), log(2500))).toEqual({ start: 0, end: 2500 });
  });

  it("deux logs vides : rien à animer (end === start === 0)", () => {
    expect(duelWindow([], [])).toEqual({ start: 0, end: 0 });
  });
});

describe("rampedAdvance — rampe d'accélération vers le ralenti (#55)", () => {
  it("part de 0", () => {
    expect(rampedAdvance(0)).toBe(0);
    expect(rampedAdvance(-5)).toBe(0);
  });

  it("démarre proche du temps réel (rampe pas encore ralentie)", () => {
    // À 100 ms d'écran, ~97 ms de log avancés : quasi 1:1, pas de ralenti sec.
    expect(rampedAdvance(100)).toBeGreaterThan(90);
    expect(rampedAdvance(100)).toBeLessThan(100);
  });

  it("est strictement monotone", () => {
    expect(rampedAdvance(200)).toBeGreaterThan(rampedAdvance(100));
    expect(rampedAdvance(5000)).toBeGreaterThan(rampedAdvance(4000));
  });

  it("après la rampe, la pente vaut le ralenti final (0.25×)", () => {
    // Bien au-delà de la rampe : 200 ms d'écran → ~50 ms de log (0.25×).
    const slope = rampedAdvance(5200) - rampedAdvance(5000);
    expect(slope).toBeCloseTo(50, 5);
  });
});
