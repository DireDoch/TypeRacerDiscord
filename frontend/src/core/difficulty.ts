// =============================================================================
//  difficulty.ts — détection d'échec Expert/Master (issue #64, ADR 0013).
//
//  PORT de référence ; `backend/src/domain/difficulty.rs` doit la reproduire bit
//  pour bit (recompute autoritaire en Race, ADR 0013).
//
//  Rejoue le keystroke log avec le MÊME modèle de curseur libre (pile) que
//  `stats/scoreboard.ts` — mais pur et indépendant de FreeInput à l'exécution :
//  Expert/Master n'ont pas besoin du Scoreboard complet, juste du premier point
//  d'échec (s'il existe).
//   - Normal   : jamais d'échec.
//   - Expert   : échec au premier ESPACE qui verrouille un mot encore inexact
//     (contenu différent OU incomplet) — l'erreur n'a pas été corrigée avant soumission.
//   - Master   : échec à la toute première frappe de caractère incorrecte, avant
//     toute correction possible. Un espace ne compte jamais comme "incorrect" —
//     même définition que l'ACC de scoreboard.ts (Backspace neutre).
// =============================================================================

import type { Keystroke } from "./types";

export type Difficulty = "normal" | "expert" | "master";

export interface DifficultyFailure {
  /** Caractères corrects accumulés (mots verrouillés + séparateurs + préfixe exact
   *  du mot en cours), au même sens que `Race.charsDone()`. */
  charsDone: number;
  /** `charsDone` / longueur du texte cible, en pourcentage entier (0-100). */
  percent: number;
}

const percentOf = (done: number, total: number): number =>
  total <= 0 ? 0 : Math.min(100, Math.round((done / total) * 100));

/**
 * Premier point d'échec pour la Difficulté donnée, ou `null` si le log ne fait
 * échouer le Run à aucun moment (Normal, ou Expert/Master jamais déclenchés).
 * Pure : ne dépend que du texte cible et du log, jamais de FreeInput en direct.
 */
export function detectDifficultyFailure(
  difficulty: Difficulty,
  targetWords: string[],
  keystrokes: Keystroke[],
): DifficultyFailure | null {
  if (difficulty === "normal") return null;
  const totalLen = Math.max(1, targetWords.join(" ").length);

  const locked: string[] = [];
  let typed = "";

  for (const k of keystrokes) {
    const tgt = targetWords[locked.length] ?? "";

    if (k.ctrl === "backspace-word") {
      if (typed.length > 0) typed = "";
      else if (locked.length > 0) typed = locked.pop()!;
      continue;
    }
    if (k.ctrl === "backspace") {
      if (typed.length > 0) typed = typed.slice(0, -1);
      else if (locked.length > 0) typed = locked.pop()!;
      continue;
    }
    if (k.k === " ") {
      if (typed.length === 0) continue; // espace en tête (ne devrait pas être loggé) : ignoré
      if (difficulty === "expert" && typed !== tgt) {
        const charsDone = locked.reduce((a, w) => a + w.length, 0) + locked.length;
        return { charsDone, percent: percentOf(charsDone, totalLen) };
      }
      locked.push(typed);
      typed = "";
      continue;
    }
    if (k.k.length === 1) {
      if (difficulty === "master") {
        const pos = typed.length;
        const correct = pos < tgt.length && k.k === tgt[pos];
        if (!correct) {
          const charsDone = locked.reduce((a, w) => a + w.length, 0) + locked.length + pos;
          return { charsDone, percent: percentOf(charsDone, totalLen) };
        }
      }
      typed += k.k;
    }
  }
  return null;
}
