// =============================================================================
//  blocking-input.ts — BlockingInput : saisie bloquante TypeRacer (Race, Phase 2).
//
//  Modèle de CURSEUR NON LIBRE :
//   - une frappe incorrecte est acceptée UNE fois (visible en erreur) puis BLOQUE :
//     tant qu'elle n'est pas corrigée (backspace), la frappe suivante est ignorée ;
//   - le buffer ne dépasse jamais la longueur cible ⇒ Pas d'Extra possible ;
//   - l'espace n'avance QUE si le mot courant est tapé exactement (sinon ignoré) ;
//   - pas de retour aux mots précédents : une fois verrouillé, un mot est figé.
//
//  Même interface que FreeInput (InputController) : rebranché sans toucher au
//  reste (UI, horloge, log). Le contrôleur ne calcule aucune stat ; le recompute
//  Rust autoritaire (replay.rs) est le MÊME code qu'en solo.
// =============================================================================

import type { Keystroke } from "../types";
import type { InputController, InputView } from "./controller";

export class BlockingInput implements InputController {
  private readonly target: string[];
  private locked: string[] = [];
  private typed = "";

  constructor(targetWords: string[]) {
    this.target = targetWords;
  }

  private get wordIndex(): number {
    return this.locked.length;
  }

  private currentTarget(): string {
    return this.target[this.wordIndex] ?? "";
  }

  /** true si le buffer est un préfixe correct du mot cible (aucune erreur en attente). */
  private isCleanPrefix(): boolean {
    return this.currentTarget().startsWith(this.typed);
  }

  handleKey(key: string, ctrl: boolean, now: number): Keystroke | null {
    // --- Backspace mot (Ctrl+Backspace) : vide le buffer courant -------------
    if (key === "Backspace" && ctrl) {
      if (this.typed.length > 0) {
        this.typed = "";
        return { t: now, k: "", ctrl: "backspace-word" };
      }
      return null; // pas de retour aux mots précédents (curseur non libre)
    }

    // --- Backspace simple : recule dans le mot courant (débloque une erreur) --
    if (key === "Backspace") {
      if (this.typed.length > 0) {
        this.typed = this.typed.slice(0, -1);
        return { t: now, k: "", ctrl: "backspace" };
      }
      return null; // début de mot : rien à effacer, pas de retour arrière
    }

    // --- Espace : verrouille SEULEMENT si le mot courant est exact -----------
    if (key === " ") {
      if (this.typed.length > 0 && this.typed === this.currentTarget()) {
        this.locked.push(this.typed);
        this.typed = "";
        return { t: now, k: " " };
      }
      return null; // mot incomplet ou en erreur : l'espace n'avance pas
    }

    // --- Caractère imprimable ----------------------------------------------
    if (key.length === 1) {
      // Bloqué tant qu'une erreur est en attente, ou que le mot est déjà complet.
      if (!this.isCleanPrefix() || this.typed.length >= this.currentTarget().length) {
        return null;
      }
      // Accepte la frappe (correcte ou fautive) : journalisée pour le recompute.
      this.typed += key;
      return { t: now, k: key };
    }

    // Touche non gérée (flèches, etc.) : ignorée.
    return null;
  }

  view(): InputView {
    return { wordIndex: this.wordIndex, typed: this.typed, lockedWords: [...this.locked] };
  }

  isComplete(): boolean {
    if (this.target.length === 0) return false;
    if (this.wordIndex >= this.target.length) return true;
    const last = this.target.length - 1;
    return this.wordIndex === last && this.typed === this.target[last];
  }
}
