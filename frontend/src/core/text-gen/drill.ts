// =============================================================================
//  text-gen/drill.ts — texte du Mode Drill (FONCTION PURE et SEEDÉE).
//
//  Texte personnalisé (CONTEXT.md, terme Drill) : un court échauffement en
//  séquences ciblées sur les Weak spots du profil (« fjf jfj »), puis de vrais
//  mots de la word-list standard choisis parce qu'ils CONTIENNENT ces Weak
//  spots. Personnalisé ⇒ jamais de PB (même règle que Zen / Time infini).
// =============================================================================

import type { WeakSpot } from "../types";
import { Rng } from "./rng";
import { ENGLISH_WORDS } from "./word-list";

/** Nombre de Weak spots ciblés (les plus sévères — déjà triés par le serveur). */
export const DRILL_TOP_SPOTS = 3;
/** Nombre de vrais mots après l'échauffement. */
export const DRILL_WORD_COUNT = 20;

/**
 * Échauffement d'un Weak spot : bigramme « ab » → « aba bab » (alternance),
 * touche « a » → « aaa aaa » (répétition).
 */
function warmupTokens(spot: WeakSpot): string[] {
  const c = spot.chars;
  if (spot.kind === "bigram" && c.length === 2) {
    return [`${c[0]}${c[1]}${c[0]}`, `${c[1]}${c[0]}${c[1]}`];
  }
  return [c.repeat(3), c.repeat(3)];
}

/**
 * Génère les jetons-mots d'un Drill : échauffement des `DRILL_TOP_SPOTS` premiers
 * Weak spots, puis `DRILL_WORD_COUNT` mots de la word-list contenant au moins un
 * de ces Weak spots (toute la liste si aucun mot ne matche — ex. Weak spot « , »).
 * Renvoie [] si `spots` est vide (pas de profil → le caller explique au joueur).
 */
export function generateDrillText(spots: WeakSpot[], rng: Rng): string[] {
  const top = spots.slice(0, DRILL_TOP_SPOTS);
  if (top.length === 0) return [];

  const tokens = top.flatMap(warmupTokens);
  const targets = top.map((s) => s.chars);
  const pool = ENGLISH_WORDS.filter((w) => targets.some((t) => w.includes(t)));
  const source = pool.length > 0 ? pool : ENGLISH_WORDS;
  for (let i = 0; i < DRILL_WORD_COUNT; i++) tokens.push(rng.pick(source));
  return tokens;
}
