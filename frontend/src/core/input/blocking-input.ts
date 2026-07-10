// =============================================================================
//  blocking-input.ts — BlockingInput : saisie bloquante TypeRacer (Race, Phase 2).
//
//  Modèle TypeRacer (≠ FreeInput/Monkeytype qui tolère les fautes) :
//   - saisie LIBRE dans le mot courant : on peut taper des caractères fautifs, ils
//     s'affichent en rouge (le rendu casse à la 1re divergence) jusqu'au plafond ;
//   - l'espace n'avance QUE si le mot courant est tapé EXACTEMENT (sinon ignoré) —
//     il faut donc corriger (backspace) avant de continuer ;
//   - pas de retour aux mots précédents : une fois verrouillé, un mot est figé
//     (curseur NON libre, contrairement à FreeInput) ;
//   - le texte final est donc toujours parfait ⇒ la course est de la vitesse pure.
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

  /** Plafond du buffer courant (borne les caractères fautifs / Extra) : ~2× la cible. */
  private maxBuffer(): number {
    const t = this.currentTarget();
    return t.length + Math.max(4, t.length);
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

    // --- Backspace simple : recule dans le mot courant ----------------------
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
      // Saisie libre dans le mot (fautes autorisées, rendues en rouge) sous le plafond.
      // Toujours journalisé : le recompute Rust compte correct/incorrect/Extra.
      if (this.typed.length < this.maxBuffer()) {
        this.typed += key;
      }
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
