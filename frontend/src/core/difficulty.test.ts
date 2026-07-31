import { describe, it, expect } from "vitest";
import { detectDifficultyFailure, type Difficulty } from "./difficulty";
import type { Keystroke } from "./types";
import vectorsFile from "../../../test-vectors/difficulty.json";

/** Construit un log à partir de tokens [t, k(, ctrl)]. */
function log(...events: Array<[number, string, ("backspace" | "backspace-word")?]>): Keystroke[] {
  return events.map(([t, k, ctrl]) => (ctrl ? { t, k: "", ctrl } : { t, k }));
}

describe("detectDifficultyFailure — Normal ne seche jamais", () => {
  it("aucune erreur ne fait échouer Normal", () => {
    expect(
      detectDifficultyFailure("normal", ["the"], log([100, "t"], [200, "x"], [300, "e"])),
    ).toBeNull();
  });
});

describe("detectDifficultyFailure — Expert : mot soumis avec erreur non corrigée", () => {
  it("un mot exact soumis ne seche pas", () => {
    expect(
      detectDifficultyFailure("expert", ["cat"], log([100, "c"], [200, "a"], [300, "t"], [400, " "])),
    ).toBeNull();
  });

  it("un mot faux soumis (espace) fait échouer, au point du mot précédent", () => {
    const r = detectDifficultyFailure("expert", ["the", "cat"], log(
      [100, "t"], [200, "h"], [300, "e"], [400, " "],
      [500, "c"], [600, "x"], [700, " "],
    ));
    expect(r).toEqual({ charsDone: 4, percent: 57 });
  });

  it("une correction (backspace) avant l'espace évite l'échec", () => {
    expect(
      detectDifficultyFailure("expert", ["the"], log(
        [100, "t"], [200, "x"], [300, "", "backspace"], [400, "h"], [500, "e"], [600, " "],
      )),
    ).toBeNull();
  });
});

describe("detectDifficultyFailure — Master : 1re frappe incorrecte, avant correction possible", () => {
  it("aucune erreur ne fait échouer", () => {
    expect(
      detectDifficultyFailure("master", ["cat"], log([100, "c"], [200, "a"], [300, "t"])),
    ).toBeNull();
  });

  it("la toute première frappe fausse fait échouer immédiatement", () => {
    expect(detectDifficultyFailure("master", ["the"], log([100, "x"]))).toEqual({
      charsDone: 0,
      percent: 0,
    });
  });

  it("un espace précoce (mot incomplet) n'est jamais une frappe incorrecte", () => {
    expect(
      detectDifficultyFailure("master", ["the", "cat"], log(
        [100, "t"], [200, "h"], [300, " "], [400, "c"], [500, "a"], [600, "t"],
      )),
    ).toBeNull();
  });

  it("les frappes après l'échec n'ont plus d'importance (1re seule compte)", () => {
    expect(
      detectDifficultyFailure("master", ["the"], log([100, "x"], [200, "h"], [300, "e"])),
    ).toEqual({ charsDone: 0, percent: 0 });
  });
});

// --- Vecteurs de parité TS/Rust (issue #64, ADR 0013) --------------------------

interface VectorCase {
  name: string;
  difficulty: Difficulty;
  targetWords: string[];
  keystrokes: Keystroke[];
  expected: { charsDone: number; percent: number } | null;
}

describe("detectDifficultyFailure — vecteurs de parité TS/Rust", () => {
  const { cases } = vectorsFile as unknown as { cases: VectorCase[] };
  it("le fichier de vecteurs n'est pas vide", () => {
    expect(cases.length).toBeGreaterThan(0);
  });
  for (const c of cases) {
    it(c.name, () => {
      expect(detectDifficultyFailure(c.difficulty, c.targetWords, c.keystrokes)).toEqual(c.expected);
    });
  }
});
