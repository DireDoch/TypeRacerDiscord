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

describe("wordsHtml — highlight mode (issue #68)", () => {
  const words = ["a", "b", "c", "d", "e"];
  const view: InputView = { lockedWords: [], typed: "", wordIndex: 0 };

  it("off/letter : rien n'est jamais assombri, même loin devant", () => {
    for (const mode of ["off", "letter"] as const) {
      const html = wordsHtml(words, view, true, mode);
      expect(html).not.toContain("dim");
    }
  });

  it("word : seul le mot courant reste net, tout le reste s'assombrit", () => {
    const html = wordsHtml(words, view, true, "word");
    const wordSpans = html.match(/<span class="word[^"]*">/g) ?? [];
    expect(wordSpans[0]).not.toContain("dim"); // mot courant (index 0)
    expect(wordSpans[1]).toContain("dim"); // index 1, hors fenêtre (word = 0 mot après)
  });

  it("next-two-words : fenêtre de 2 mots après le courant reste nette", () => {
    const html = wordsHtml(words, view, true, "next-two-words");
    const wordSpans = html.match(/<span class="word[^"]*">/g) ?? [];
    expect(wordSpans[0]).not.toContain("dim"); // courant
    expect(wordSpans[1]).not.toContain("dim"); // +1
    expect(wordSpans[2]).not.toContain("dim"); // +2
    expect(wordSpans[3]).toContain("dim"); // +3, hors fenêtre
  });

  it("un mot déjà verrouillé n'est jamais assombri, quel que soit le mode", () => {
    const past: InputView = { lockedWords: ["a", "b", "c"], typed: "", wordIndex: 3 };
    const html = wordsHtml(words, past, true, "word");
    const wordSpans = html.match(/<span class="word[^"]*">/g) ?? [];
    expect(wordSpans[0]).not.toContain("dim");
    expect(wordSpans[1]).not.toContain("dim");
    expect(wordSpans[2]).not.toContain("dim");
  });
});

describe("wordsHtml — red-on-error (issue #68) : le mot courant fautif se rend ENTIER en rouge", () => {
  it("aucune erreur : le préfixe correct reste vert (classe correct)", () => {
    const view: InputView = { lockedWords: [], typed: "th", wordIndex: 0 };
    const html = wordsHtml(["the"], view, true);
    expect(html).toContain('class="correct"');
    expect(html).not.toContain('class="incorrect"');
  });

  it("une erreur dans le mot : TOUT le préfixe tapé passe en rouge, pas que la lettre fautive", () => {
    const view: InputView = { lockedWords: [], typed: "tx", wordIndex: 0 }; // 'x' au lieu de 'h'
    const html = wordsHtml(["the"], view, true);
    // Les deux caractères tapés ('t' pourtant correct, et 'x' fautif) sont en rouge.
    expect(html).toMatch(/<span class="incorrect[^"]*">t<\/span>/);
    expect(html).toMatch(/<span class="incorrect[^"]*">x<\/span>/);
    expect(html).not.toContain('class="correct"');
  });

  it("le mot fautif garde son highlight (pas de perte de netteté) — seule sa couleur change", () => {
    const words = ["the", "cat", "sat"];
    const view: InputView = { lockedWords: [], typed: "tx", wordIndex: 0 };
    const html = wordsHtml(words, view, true, "word");
    const wordSpans = html.match(/<span class="word[^"]*">/g) ?? [];
    expect(wordSpans[0]).not.toContain("dim"); // mot courant, fautif, mais pas "dim"
  });

  it("un mot verrouillé (déjà soumis) n'est jamais forcé en rouge, quelle que soit son exactitude", () => {
    // "xh" a été verrouillé avec une faute sur son 1er caractère seulement : le rendu du
    // mot verrouillé reste le rendu caractère-par-caractère habituel — le 'h' correct
    // reste vert, il ne serait rouge que si forceError s'appliquait (réservé au mot courant).
    const view: InputView = { lockedWords: ["xh"], typed: "", wordIndex: 1 };
    const html = wordsHtml(["the", "cat"], view, true);
    expect(html).toMatch(/<span class="incorrect[^"]*">x<\/span>/);
    expect(html).toMatch(/<span class="correct[^"]*">h<\/span>/);
  });
});
