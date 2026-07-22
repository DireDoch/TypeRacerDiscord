// =============================================================================
//  learn.test.ts — barème par tranches + générateur de séquences sur touches fixes.
// =============================================================================

import { describe, expect, it } from "vitest";
import { generateLessonExercise, generateLessonText, requiredAccuracy, LESSONS } from "./learn";
import { Rng } from "./text-gen/rng";

describe("requiredAccuracy (barème statique par tranches)", () => {
  it("leçons 1–5 indulgentes, tranches suivantes de plus en plus strictes (ADR 0006)", () => {
    expect(requiredAccuracy(0)).toBe(70);
    expect(requiredAccuracy(4)).toBe(70);
    expect(requiredAccuracy(5)).toBe(75);
    expect(requiredAccuracy(9)).toBe(75);
    expect(requiredAccuracy(10)).toBe(80);
    expect(requiredAccuracy(20)).toBe(82);
    expect(requiredAccuracy(35)).toBe(85);
    expect(requiredAccuracy(50)).toBe(87);
    expect(requiredAccuracy(70)).toBe(90);
    expect(requiredAccuracy(90)).toBe(92);
    expect(requiredAccuracy(99)).toBe(92);
  });

  it("aucune tranche ne couvre plus de 20 leçons (granularité, ADR 0006)", () => {
    const froms = [0, 5, 10, 20, 35, 50, 70, 90];
    for (let i = 1; i < froms.length; i++) {
      expect(froms[i] - froms[i - 1]).toBeLessThanOrEqual(20);
    }
    expect(100 - froms[froms.length - 1]).toBeLessThanOrEqual(20);
  });
});

describe("generateLessonText", () => {
  it("n'utilise QUE le jeu de touches fixe", () => {
    const tokens = generateLessonText(["f", "j"], 20, new Rng(42));
    expect(tokens).toHaveLength(20);
    for (const t of tokens) {
      expect(t).toHaveLength(3);
      for (const ch of t) expect(["f", "j"]).toContain(ch);
    }
  });

  it("déterministe : même graine ⇒ même exercice", () => {
    const keys = ["a", "s", "d", "f"];
    expect(generateLessonText(keys, 15, new Rng(7))).toEqual(generateLessonText(keys, 15, new Rng(7)));
  });
});

describe("LESSONS (cursus complet)", () => {
  it("100 leçons après le lot 76-100 (#33) — cursus complet, sans trou", () => {
    expect(LESSONS.length).toBe(100);
  });

  it("chaque leçon : titre, contenu, jeu de touches ou mots, exercice", () => {
    expect(LESSONS.length).toBeGreaterThanOrEqual(2);
    for (const l of LESSONS) {
      expect(l.title.length).toBeGreaterThan(0);
      expect(l.content.length).toBeGreaterThan(0);
      expect(l.tokens).toBeGreaterThan(0);
      // Une leçon `words` tire de la word-list (keys vide, volontaire) ; sinon touches fixes.
      expect(l.words ? l.keys.length === 0 : l.keys.length > 0).toBe(true);
    }
  });

  it("generateLessonExercise produit `tokens` jetons pour chaque leçon, y compris `words`", () => {
    for (const l of LESSONS) {
      const ex = generateLessonExercise(l, new Rng(1));
      expect(ex).toHaveLength(l.tokens);
    }
  });
});
