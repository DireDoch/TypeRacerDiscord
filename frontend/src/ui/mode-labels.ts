// =============================================================================
//  ui/mode-labels.ts — libellés français des Modes (issue #21).
//
//  Source unique, hors de practice.ts : barre de config, filtres et colonne
//  « mode » de l'Historique le consommaient tous via practice.ts, créant un
//  couplage inutile (aucun des deux n'a besoin du reste de Practice).
// =============================================================================

import type { RunConfig } from "../core/types";

export const MODE_LABELS: Record<RunConfig["mode"], string> = {
  time: "temps",
  words: "mots",
  quotes: "citations",
  zen: "zen",
  drill: "entraînement",
  "trigram-drill": "triplets",
};
