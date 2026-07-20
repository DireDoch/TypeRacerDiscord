// =============================================================================
//  drill.test.ts — générateur de texte du Mode Drill (échauffement + mots ciblés).
// =============================================================================

import { describe, expect, it } from "vitest";
import { generateDrillText, DRILL_TOP_SPOTS, DRILL_WORD_COUNT } from "./drill";
import { Rng } from "./rng";
import type { WeakSpot } from "../types";

function spot(chars: string, kind: "key" | "bigram", severity: number): WeakSpot {
  return {
    chars,
    kind,
    occurrences: 20,
    meanDelayMs: 300,
    errorRate: 0.1,
    slow: true,
    faulty: false,
    severity,
  };
}

describe("generateDrillText", () => {
  it("échauffement : bigramme en alternance, touche en répétition", () => {
    const tokens = generateDrillText([spot("fj", "bigram", 2), spot("e", "key", 1)], new Rng(42));
    expect(tokens.slice(0, 4)).toEqual(["fjf", "jfj", "eee", "eee"]);
  });

  it("les vrais mots contiennent au moins un Weak spot ciblé", () => {
    const tokens = generateDrillText([spot("th", "bigram", 2)], new Rng(42));
    const words = tokens.slice(2); // après l'échauffement
    expect(words).toHaveLength(DRILL_WORD_COUNT);
    for (const w of words) expect(w).toContain("th");
  });

  it("ne cible que les DRILL_TOP_SPOTS plus sévères (déjà triés par le serveur)", () => {
    const spots = ["a", "b", "c", "d", "e"].map((c, i) => spot(c, "key", 5 - i));
    const tokens = generateDrillText(spots, new Rng(42));
    // 2 jetons d'échauffement par spot ciblé, pas plus.
    expect(tokens.slice(0, DRILL_TOP_SPOTS * 2)).toEqual(["aaa", "aaa", "bbb", "bbb", "ccc", "ccc"]);
    expect(tokens[DRILL_TOP_SPOTS * 2]).not.toBe("ddd");
  });

  it("déterministe : même graine ⇒ même texte", () => {
    const spots = [spot("e", "key", 1)];
    expect(generateDrillText(spots, new Rng(7))).toEqual(generateDrillText(spots, new Rng(7)));
  });

  it("aucun mot ne matche (Weak spot « , ») → repli sur toute la word-list", () => {
    const tokens = generateDrillText([spot(",", "key", 1)], new Rng(42));
    expect(tokens).toHaveLength(2 + DRILL_WORD_COUNT);
  });

  it("sans Weak spots → [] (le caller explique au joueur)", () => {
    expect(generateDrillText([], new Rng(42))).toEqual([]);
  });
});
