// =============================================================================
//  numbers.ts — Setting Numbers : jetons-nombres autonomes.
//
//  Règle (défaut documenté, paramétrable) : ~17 % des slots deviennent un
//  jeton-nombre AUTONOME de 1 à 4 chiffres (ex. "42", "7", "1980"). Pas de
//  nombre collé à un mot. Le 1er chiffre n'est jamais 0 (sauf le nombre "0").
// =============================================================================

import type { Rng } from "./rng";

/** Proportion de slots transformés en jeton-nombre. */
export const NUMBER_TOKEN_RATIO = 0.17;

/** Génère un jeton-nombre de 1 à 4 chiffres. */
export function numberToken(rng: Rng): string {
  const len = 1 + rng.int(4); // 1..4 chiffres
  if (len === 1) return String(rng.int(10)); // "0".."9"
  let s = String(1 + rng.int(9)); // 1er chiffre 1..9
  for (let i = 1; i < len; i++) s += String(rng.int(10));
  return s;
}
