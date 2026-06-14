// =============================================================================
//  text-gen/index.ts — génération de texte cible (FONCTION PURE et SEEDÉE).
//
//  Unique point de génération. Déterministe : même (config, count, seed) ⇒ même
//  sortie, côté TS (MVP) et côté Rust (Phase 2, port à l'identique). Le Mode
//  Quotes NE passe PAS par ici (texte fourni par GET /api/quote). Zen n'a pas de
//  texte cible. Pour Time/Words, le caller demande `count` jetons (et en redemande
//  pour Time infini, en réutilisant le MÊME Rng pour rester déterministe).
// =============================================================================

import type { RunConfig } from "../types";
import { Rng } from "./rng";
import { ENGLISH_WORDS } from "./word-list";
import { numberToken, NUMBER_TOKEN_RATIO } from "./numbers";
import { applyPunctuation } from "./punctuation";

/** Sous-ensemble de config qui influe sur la génération. */
export interface GenSettings {
  punctuation: boolean;
  numbers: boolean;
}

/**
 * Génère `count` jetons-mots cibles. Joints par des espaces, ils forment le
 * `targetText`. (Quotes/Zen n'appellent pas cette fonction.)
 */
export function generateText(settings: GenSettings, count: number, seed: number): string[] {
  const rng = new Rng(seed);
  return generateWithRng(settings, count, rng);
}

/**
 * Variante exposant le Rng, pour que Time infini puisse re-générer des lots
 * supplémentaires en CONTINUANT la même suite (déterminisme préservé).
 */
export function generateWithRng(settings: GenSettings, count: number, rng: Rng): string[] {
  const base: string[] = [];
  for (let i = 0; i < count; i++) {
    if (settings.numbers && rng.chance(NUMBER_TOKEN_RATIO)) {
      base.push(numberToken(rng));
    } else {
      base.push(rng.pick(ENGLISH_WORDS));
    }
  }
  return settings.punctuation ? applyPunctuation(base, rng) : base;
}

/** Aide : nombre de jetons à pré-générer selon le Mode (heuristique pour Time). */
export function initialWordCount(config: RunConfig): number {
  switch (config.mode) {
    case "words":
      return config.modeValue;
    case "time":
      // ~3 mots/seconde à 100+ WPM ; 0 (infini) ⇒ premier lot généreux, retoppé ensuite.
      return config.modeValue === 0 ? 60 : Math.max(20, config.modeValue * 3);
    default:
      return 0; // quotes / zen
  }
}
