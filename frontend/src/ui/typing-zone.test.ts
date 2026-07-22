// =============================================================================
//  typing-zone.test.ts — rendu partagé de la zone de frappe (issue #21).
// =============================================================================

import { describe, expect, it } from "vitest";
import { escapeText, wordsHtml, windowScrollTop } from "./typing-zone";
import type { InputView } from "../core/input/controller";

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
    expect(windowScrollTop(1 * LH, LH)).toBe(0);
  });
});

describe("escapeText (sûr en contenu ET en contexte attribut)", () => {
  it("échappe < > & — contenu HTML", () => {
    expect(escapeText("<a & b>")).toBe("&lt;a &amp; b&gt;");
  });

  it("échappe aussi le guillemet double — sûr dans un href=\"…\"", () => {
    expect(escapeText('a"b')).toBe("a&quot;b");
  });
});

describe("wordsHtml (boucle mot-à-mot partagée par Practice/Race/Apprendre/Replay)", () => {
  it("mots verrouillés corrects, mot courant avec curseur si `active`, mots à venir vides", () => {
    const view: InputView = { lockedWords: ["ab"], typed: "c", wordIndex: 1 };
    const html = wordsHtml(["ab", "cd", "ef"], view, true);
    expect(html).toContain('class="correct">a'); // "ab" verrouillé, exact
    expect(html).toContain("at-cursor"); // curseur sur le mot courant, active=true
  });

  it("active=false : le mot courant n'affiche pas de curseur", () => {
    const view: InputView = { lockedWords: [], typed: "", wordIndex: 0 };
    const html = wordsHtml(["ab"], view, false);
    expect(html).not.toContain("at-cursor");
    expect(html).not.toContain("caret");
  });
});
