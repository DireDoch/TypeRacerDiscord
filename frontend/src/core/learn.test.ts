// =============================================================================
//  learn.test.ts — barème par tranches, générateur de séquences, et les invariants
//  du cursus lu depuis `src/content/lessons.json` (#201).
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

  // Depuis #201 le cursus est une DONNÉE (`src/content/lessons.json`) et le `as Lesson[]`
  // de `learn.ts` est le seul endroit où on lui fait confiance : ces vérifications-là sont
  // ce qui remplace le typage d'un littéral TypeScript.

  it("aucun titre en double — la liste se navigue au titre", () => {
    const titles = LESSONS.map((l) => l.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("aucun paragraphe de contenu vide", () => {
    for (const l of LESSONS) {
      for (const p of l.content) expect(p.trim().length).toBeGreaterThan(0);
    }
  });

  it("les touches d'un exercice sont des caractères simples", () => {
    for (const l of LESSONS) {
      for (const k of l.keys) expect([...k]).toHaveLength(1);
    }
  });

  it("une référence d'illustration, si elle existe, n'est pas vide (ADR 0006)", () => {
    for (const l of LESSONS) {
      if (l.diagram !== undefined) expect(l.diagram.trim().length).toBeGreaterThan(0);
    }
  });
});
