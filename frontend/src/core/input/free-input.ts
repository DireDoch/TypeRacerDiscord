// =============================================================================
//  free-input.ts — FreeInput : saisie libre Monkeytype (Practice, MVP).
//
//  Modèle de CURSEUR LIBRE (modèle de pile, décision CONTEXT.md) :
//   - l'espace verrouille le mot courant et avance ;
//   - le backspace en début de buffer ROUVRE le dernier mot verrouillé (son contenu
//     redevient éditable), qu'il contienne une erreur ou non ; Ctrl+Backspace en début
//     de buffer SUPPRIME le mot précédent entier ;
//   - le retour se fait mot par mot, de la droite vers la gauche (pile `locked`) ;
//   - les frappes au-delà de (longueur cible + plafond) sont JOURNÉES (pour que le
//     recompute Rust les compte comme Extra/incorrect) mais NON ajoutées au buffer.
//
//  Le contrôleur ne calcule aucune stat : il produit le buffer affichable et le
//  Keystroke log brut. Modes time / words / quotes (avec texte cible). Zen est
//  géré à part (pas de texte cible).
// =============================================================================

import type { Keystroke } from "../types";
import type { InputController, InputView } from "./controller";

export class FreeInput implements InputController {
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

  /** Buffer maximal accepté pour le mot courant (plafond d'Extra). */
  private maxBuffer(): number {
    const t = this.currentTarget();
    return t.length + Math.max(4, t.length); // au plus ~2× la longueur cible
  }

  handleKey(key: string, ctrl: boolean, now: number): Keystroke | null {
    // --- Backspace mot (Ctrl+Backspace) -----------------------------------
    if (key === "Backspace" && ctrl) {
      if (this.typed.length > 0) {
        this.typed = "";
        return { t: now, k: "", ctrl: "backspace-word" };
      }
      if (this.locked.length > 0) {
        // Curseur libre : supprime le mot précédent entier.
        this.locked.pop();
        this.typed = "";
        return { t: now, k: "", ctrl: "backspace-word" };
      }
      return null; // début du tout premier mot : rien à effacer
    }

    // --- Backspace simple --------------------------------------------------
    if (key === "Backspace") {
      if (this.typed.length > 0) {
        this.typed = this.typed.slice(0, -1);
        return { t: now, k: "", ctrl: "backspace" };
      }
      if (this.locked.length > 0) {
        // Curseur libre : rouvre le dernier mot verrouillé (contenu réédité).
        this.typed = this.locked.pop()!;
        return { t: now, k: "", ctrl: "backspace" };
      }
      return null; // début du tout premier mot : rien à effacer
    }

    // --- Espace : verrouille le mot et avance ------------------------------
    if (key === " ") {
      if (this.typed.length === 0) return null; // espace en tête / double espace ignoré
      this.locked.push(this.typed);
      this.typed = "";
      return { t: now, k: " " };
    }

    // --- Caractère imprimable ---------------------------------------------
    if (key.length === 1) {
      // Toujours journalisé (Rust compte l'Extra) ; ajouté au buffer si sous le plafond.
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
    // Tous les mots verrouillés…
    if (this.wordIndex >= this.target.length) return true;
    // …ou dernier mot atteint en longueur (Monkeytype termine sur la dernière frappe).
    const last = this.target.length - 1;
    return this.wordIndex === last && this.typed.length >= this.target[last].length;
  }
}
