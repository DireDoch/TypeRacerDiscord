// =============================================================================
//  practice.test.ts — fenêtre glissante de 3 lignes (windowScrollTop, pure).
//  Le mot actif doit rester sur la ligne du MILIEU : lignes 0-1 sans défilement,
//  ligne n ≥ 2 → (n-1) lignes masquées en haut.
// =============================================================================

import { describe, expect, it } from "vitest";
import { windowScrollTop } from "./practice";

const LH = 38.4; // line-height 2.4rem à 16px — volontairement fractionnaire.

describe("windowScrollTop (fenêtre glissante de 3 lignes)", () => {
  it("lignes 0 et 1 : pas de défilement (le curseur monte jusqu'au milieu)", () => {
    expect(windowScrollTop(0, LH)).toBe(0);
    expect(windowScrollTop(38, LH)).toBe(0); // offsetTop arrondi par le DOM (38 ≈ 38.4)
  });

  it("ligne 2 : une ligne masquée — le curseur reste au milieu, jamais en bas", () => {
    expect(windowScrollTop(2 * LH, LH)).toBeCloseTo(LH);
    expect(windowScrollTop(76, LH)).toBeCloseTo(LH); // 76 ≈ 76.8, arrondi DOM
  });

  it("ligne n : (n-1) lignes masquées (suit la progression, y compris Time infini)", () => {
    expect(windowScrollTop(5 * LH, LH)).toBeCloseTo(4 * LH);
    expect(windowScrollTop(40 * LH, LH)).toBeCloseTo(39 * LH);
  });

  it("retour en arrière : re-remonter le curseur fait redescendre la fenêtre", () => {
    // Le calcul ne dépend que du mot actif : revenir à la ligne 1 → défilement 0.
    expect(windowScrollTop(1 * LH, LH)).toBe(0);
  });
});
