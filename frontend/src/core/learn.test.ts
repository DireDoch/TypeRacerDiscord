// =============================================================================
//  learn.test.ts — barème par tranches + générateur de séquences sur touches fixes.
// =============================================================================

import { describe, expect, it } from "vitest";
import { generateLessonExercise, generateLessonText, requiredAccuracy, LESSONS } from "./learn";
import { Rng } from "./text-gen/rng";

describe("requiredAccuracy (barème statique par tranches)", () => {
  it("leçons 1–5 indulgentes, tranches suivantes plus strictes", () => {
    expect(requiredAccuracy(0)).toBe(70);
    expect(requiredAccuracy(4)).toBe(70);
    expect(requiredAccuracy(5)).toBe(80);
    expect(requiredAccuracy(9)).toBe(80);
    expect(requiredAccuracy(10)).toBe(90);
    expect(requiredAccuracy(99)).toBe(90);
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
