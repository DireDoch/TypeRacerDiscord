import { describe, it, expect } from "vitest";
import { generateText } from "./index";
import { numberToken } from "./numbers";
import { Rng } from "./rng";

describe("generateText", () => {
  const plain = { punctuation: false, numbers: false };

  it("est déterministe pour une même graine", () => {
    expect(generateText(plain, 30, 12345)).toEqual(generateText(plain, 30, 12345));
  });

  it("diffère pour des graines différentes", () => {
    expect(generateText(plain, 30, 1)).not.toEqual(generateText(plain, 30, 2));
  });

  it("produit exactement le nombre de jetons demandé (Words)", () => {
    expect(generateText(plain, 50, 7)).toHaveLength(50);
    expect(generateText({ punctuation: true, numbers: true }, 50, 7)).toHaveLength(50);
  });

  it("sans Settings : que des mots minuscules a-z", () => {
    for (const w of generateText(plain, 100, 99)) expect(w).toMatch(/^[a-z]+$/);
  });

  it("Numbers : injecte des jetons-nombres autonomes", () => {
    const toks = generateText({ punctuation: false, numbers: true }, 400, 3);
    const nums = toks.filter((t) => /^\d+$/.test(t));
    expect(nums.length).toBeGreaterThan(0);
    for (const n of nums) expect(n.length).toBeLessThanOrEqual(4);
  });

  it("Punctuation : 1re lettre majuscule et fin de phrase ponctuée", () => {
    const toks = generateText({ punctuation: true, numbers: false }, 60, 42);
    // La 1re lettre est majuscule (un guillemet/parenthèse d'ouverture peut précéder).
    expect(toks[0]).toMatch(/^["(]?[A-Z]/);
    expect(toks.some((t) => /[.?!]$/.test(t))).toBe(true);
  });
});

describe("numberToken", () => {
  it("génère 1 à 4 chiffres, sans zéro en tête (sauf '0')", () => {
    const rng = new Rng(1);
    for (let i = 0; i < 500; i++) {
      const n = numberToken(rng);
      expect(n).toMatch(/^\d{1,4}$/);
      if (n.length > 1) expect(n[0]).not.toBe("0");
    }
  });
});
