// =============================================================================
//  learn.test.ts — barème par tranches + générateur de séquences sur touches fixes.
// =============================================================================

import { describe, expect, it } from "vitest";
import { generateLessonText, requiredAccuracy, LESSONS } from "./learn";
import { Rng } from "./text-gen/rng";

describe("requiredAccuracy (barème statique par tranches)", () => {
  it("leçons 1–10 indulgentes, tranches suivantes plus strictes", () => {
    expect(requiredAccuracy(0)).toBe(70);
    expect(requiredAccuracy(9)).toBe(70);
    expect(requiredAccuracy(10)).toBe(80);
    expect(requiredAccuracy(19)).toBe(80);
    expect(requiredAccuracy(20)).toBe(90);
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

describe("LESSONS (socle)", () => {
  it("2–3 leçons complètes : titre, contenu, touches, exercice", () => {
    expect(LESSONS.length).toBeGreaterThanOrEqual(2);
    for (const l of LESSONS) {
      expect(l.title.length).toBeGreaterThan(0);
      expect(l.content.length).toBeGreaterThan(0);
      expect(l.keys.length).toBeGreaterThan(0);
      expect(l.tokens).toBeGreaterThan(0);
    }
  });
});
