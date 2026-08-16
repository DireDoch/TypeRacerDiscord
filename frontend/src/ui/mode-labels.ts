// =============================================================================
//  ui/mode-labels.ts — libellés français des Modes (issue #21).
//
//  Source unique, hors de practice.ts : barre de config, filtres et colonne
//  « mode » de l'Historique le consommaient tous via practice.ts, créant un
//  couplage inutile (aucun des deux n'a besoin du reste de Practice).
// =============================================================================

import type { RunConfig } from "../core/types";
import type { Difficulty } from "../core/difficulty";

export const MODE_LABELS: Record<RunConfig["mode"], string> = {
  time: "temps",
  words: "mots",
  quotes: "citations",
  zen: "zen",
  drill: "entraînement",
  "trigram-drill": "triplets",
};

/** Le même tableau vivait à l'identique dans practice.ts et race.ts — c'est ce module
 *  qui porte les libellés, les deux écrans le lisent. */
export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  normal: "Normal",
  expert: "Expert",
  master: "Master",
};

/**
 * La config courante en une ligne (#197, décision 9) : `mots · 25 · ponctuation · Normal`.
 *
 * Elle dit exactement ce que la barre dépliée montre — un axe après l'autre, dans le même
 * ordre, et rien de plus. Les réglages qui n'existent pas pour le Mode courant en sont
 * absents, comme leurs boutons le sont de la barre : citations, zen et les entraînements
 * n'ont ni longueur ni Options de texte, et zen n'a pas de Difficulté.
 */
export function configSummary(config: RunConfig, difficulty: Difficulty): string {
  const noText = config.mode === "quotes" || config.mode === "zen" || config.mode.endsWith("drill");
  const parts = [MODE_LABELS[config.mode]];
  if (!noText) {
    parts.push(config.modeValue === 0 ? "∞" : String(config.modeValue));
    if (config.punctuation) parts.push("ponctuation");
    if (config.numbers) parts.push("chiffres");
  }
  if (config.mode !== "zen") parts.push(DIFFICULTY_LABELS[difficulty]);
  return parts.join(" · ");
}
