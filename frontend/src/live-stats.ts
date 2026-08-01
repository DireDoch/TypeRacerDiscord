// =============================================================================
//  live-stats.ts — stats CLIENT non autoritaires (compteur WPM mouvant).
//
//  Décision figée (CONTEXT.md) : les Live stats ne dupliquent PAS le replay complet.
//  La vérité vient du recompute (computeScoreboard en MVP, Rust en autoritaire). Ce
//  module ne sert qu'au feedback immédiat de l'UI pendant `running`. Il lit la vue du
//  contrôleur (mots verrouillés + buffer courant) et compte les chars corrects à la
//  volée — O(longueur tapée), assez léger pour tourner chaque frame.
// =============================================================================

import type { InputView } from "./core/input/controller";

/** Chars corrects de `typed` vis-à-vis de `target` (même règle que scoreboard.ts). */
function wordCorrect(typed: string, target: string): number {
  let n = 0;
  const lim = Math.min(typed.length, target.length);
  for (let i = 0; i < lim; i++) if (typed[i] === target[i]) n++;
  return n;
}

/**
 * WPM net live = chars corrects (mots verrouillés + buffer) ÷ 5 ÷ minutes écoulées.
 * Volontairement simple : un compteur d'affichage, pas un chiffre de record.
 */
export function liveWpm(targetWords: string[], view: InputView, elapsedMs: number): number {
  let correct = 0;
  for (let i = 0; i < view.lockedWords.length; i++) {
    correct += wordCorrect(view.lockedWords[i], targetWords[i] ?? "") + 1; // +1 = espace séparateur
  }
  correct += wordCorrect(view.typed, targetWords[view.wordIndex] ?? "");

  const minutes = elapsedMs / 60000;
  if (minutes <= 0) return 0;
  return Math.round(correct / 5 / minutes);
}

/**
 * WPM live pour Zen : pas de texte cible, donc TOUTE frappe imprimable compte
 * (miroir de `replay_zen` côté Rust). On somme les chars des mots verrouillés
 * (+ séparateur) et du buffer courant. Non autoritaire — feedback d'affichage.
 */
export function liveWpmZen(view: InputView, elapsedMs: number): number {
  let chars = view.typed.length;
  for (const w of view.lockedWords) chars += w.length + 1; // +1 = espace séparateur
  const minutes = elapsedMs / 60000;
  if (minutes <= 0) return 0;
  return Math.round(chars / 5 / minutes);
}

/**
 * Précision live (issue #67) = frappes correctes cumulées ÷ total, en %. Backspace
 * neutre (ni compté ni décompté) — même définition que l'ACC de scoreboard.ts. Aucune
 * frappe encore : 100 (rien de faux pour l'instant), même convention que le Scoreboard
 * pour `totalKeys === 0`.
 */
export function liveAccuracy(correctKeystrokes: number, totalKeystrokes: number): number {
  if (totalKeystrokes === 0) return 100;
  return Math.round((correctKeystrokes / totalKeystrokes) * 100);
}

/**
 * Burst live (issue #67) = vitesse du mot EN COURS depuis sa première frappe — un
 * ressenti "à quelle vitesse ce mot-ci part", pas un chiffre de record. `wordStartMs`
 * (horloge du Run, `null` si aucune frappe encore sur ce mot) vient de l'écran, qui
 * seul sait quand un nouveau mot a commencé (verrouillage/backspace-word).
 */
export function liveBurst(
  view: InputView,
  targetWords: string[],
  wordStartMs: number | null,
  elapsedMs: number,
): number {
  if (wordStartMs === null) return 0;
  const correct = wordCorrect(view.typed, targetWords[view.wordIndex] ?? "");
  const minutes = (elapsedMs - wordStartMs) / 60000;
  if (minutes <= 0) return 0;
  return Math.round(correct / 5 / minutes);
}
