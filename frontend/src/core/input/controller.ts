// =============================================================================
//  InputController — interface commune aux contrôleurs de saisie.
//
//  Une seule implémentation : FreeInput (free-input.ts), curseur libre. Utilisée en
//  solo (Practice) ET en Race : le flux n'est jamais bloqué. La Race ajoute par-dessus
//  une condition de fin stricte (ui/race.ts::raceComplete) — tout le texte doit être
//  exact pour terminer — sans changer le contrôleur.
//
//  Le contrôleur ne calcule AUCUNE stat. Sa seule responsabilité :
//  transformer les frappes physiques en (a) buffer affichable et (b) Keystroke log brut.
//  Toute statistique vient ensuite : live-stats.ts (client) et le recompute Rust (autoritaire).
// =============================================================================

import type { Keystroke } from "../types";

/** Vue de l'état de saisie destinée au rendu (ce que l'UI doit dessiner). */
export interface InputView {
  /** Index du mot cible courant. */
  wordIndex: number;
  /** Ce que le joueur a tapé pour le mot courant (peut dépasser la longueur cible → Extra). */
  typed: string;
  /** Mots déjà verrouillés (par espace). Curseur libre : le backspace peut rouvrir le dernier (pile). */
  lockedWords: string[];
}

export interface InputController {
  /**
   * Traite une frappe physique. Retourne le Keystroke à journaliser, ou null
   * si la frappe est ignorée (ex. backspace en début de buffer borné).
   * `now` = ms écoulées depuis t=0 (fourni par l'horloge, pas mesuré ici).
   */
  handleKey(key: string, ctrl: boolean, now: number): Keystroke | null;

  /** État courant pour le rendu. */
  view(): InputView;

  /** true si le texte cible est entièrement satisfait (fin de Run pour Words/Quotes). */
  isComplete(): boolean;
}
