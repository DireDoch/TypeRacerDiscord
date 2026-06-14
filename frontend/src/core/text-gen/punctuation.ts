// =============================================================================
//  punctuation.ts — Setting Punctuation : ponctuation "structurée type phrases".
//
//  Plutôt que des symboles saupoudrés au hasard, on impose une structure de
//  phrases (défaut documenté, paramétrable) :
//   - phrases de 4 à 10 jetons ;
//   - 1re lettre de chaque phrase en MAJUSCULE ;
//   - fin de phrase : '.' 70 %, '?' 15 %, '!' 15 % ;
//   - virgule après un jeton intérieur : 12 % ;
//   - jeton entouré de guillemets "…" : 5 %, ou de parenthèses (…) : 4 %.
//  Les jetons-nombres participent comme des jetons normaux.
// =============================================================================

import type { Rng } from "./rng";

export const PUNCT = {
  sentenceMin: 4,
  sentenceMax: 10,
  comma: 0.12,
  quote: 0.05,
  paren: 0.04,
  endWeights: [
    { mark: ".", w: 0.7 },
    { mark: "?", w: 0.15 },
    { mark: "!", w: 0.15 },
  ],
} as const;

function capitalize(token: string): string {
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c >= "a" && c <= "z") {
      return token.slice(0, i) + c.toUpperCase() + token.slice(i + 1);
    }
    if (c >= "A" && c <= "Z") return token; // déjà capitalisé (ou nombre devant)
  }
  return token; // jeton sans lettre (nombre) : inchangé
}

function endMark(rng: Rng): string {
  const r = rng.next();
  let acc = 0;
  for (const e of PUNCT.endWeights) {
    acc += e.w;
    if (r < acc) return e.mark;
  }
  return ".";
}

/**
 * Décore une liste de jetons bruts en phrases ponctuées. Renvoie de nouveaux
 * jetons (les espaces restent les séparateurs ; la ponctuation est collée aux jetons).
 */
export function applyPunctuation(tokens: readonly string[], rng: Rng): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const remaining = tokens.length - i;
    let len = PUNCT.sentenceMin + rng.int(PUNCT.sentenceMax - PUNCT.sentenceMin + 1);
    if (len > remaining) len = remaining;
    const end = i + len;

    for (let j = i; j < end; j++) {
      let tok = tokens[j];
      const isFirst = j === i;
      const isLast = j === end - 1;

      // Enrobage guillemets / parenthèses (sur un jeton intérieur unique).
      if (!isLast) {
        if (rng.chance(PUNCT.quote)) tok = `"${tok}"`;
        else if (rng.chance(PUNCT.paren)) tok = `(${tok})`;
      }

      if (isFirst) tok = capitalize(tok);

      if (isLast) {
        tok += endMark(rng);
      } else if (rng.chance(PUNCT.comma)) {
        tok += ",";
      }
      out.push(tok);
    }
    i = end;
  }
  return out;
}
