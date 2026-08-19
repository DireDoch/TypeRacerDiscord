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
import type { StopOnError } from "../preferences";

export class FreeInput implements InputController {
  private readonly target: string[];
  private readonly stopOnError: StopOnError;
  private locked: string[] = [];
  private typed = "";

  /** `stopOnError` (issue #65, Solo only — Race ne le passe jamais, défaut "off") :
   *  "letter" bloque toute frappe fausse avant qu'elle n'entre au buffer ; "word"
   *  bloque l'espace tant que le mot courant n'est pas exact. Zen (target vide)
   *  n'a rien à être "juste" contre : jamais bloqué, quelle que soit la valeur. */
  /** `targetWords` est gardé PAR RÉFÉRENCE, pas copié : un appelant dont le texte
   *  s'allonge en cours de route (Spam, ADR 0016 — le mot répété sans fin) n'a qu'à
   *  pousser dedans, sans reconstruire le contrôleur et donc sans perdre sa pile. */
  constructor(targetWords: string[], stopOnError: StopOnError = "off") {
    this.target = targetWords;
    this.stopOnError = targetWords.length > 0 ? stopOnError : "off";
  }

  private get wordIndex(): number {
    return this.locked.length;
  }

  private currentTarget(): string {
    return this.target[this.wordIndex] ?? "";
  }

  /** Buffer maximal accepté pour le mot courant (plafond d'Extra). */
  private maxBuffer(): number {
    // Zen (aucun texte cible) : pas de plafond, le mot tapé s'affiche en entier.
    // Sans incidence sur la parité Rust : Zen passe par replay_zen (pas de max_buffer).
    if (this.target.length === 0) return Infinity;
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
      // Stop on error (mot) : bloque l'espace tant que le mot courant n'est pas exact —
      // la frappe n'est même pas journalisée, comme si elle n'avait pas eu lieu.
      if (this.stopOnError === "word" && this.typed !== this.currentTarget()) return null;
      this.locked.push(this.typed);
      this.typed = "";
      return { t: now, k: " " };
    }

    // --- Caractère imprimable ---------------------------------------------
    if (key.length === 1) {
      // Stop on error (lettre) : une frappe fausse est bloquée avant d'exister — jamais
      // journalisée, jamais ajoutée au buffer. Même correction possible pas nécessaire :
      // il n'y a jamais d'erreur à corriger.
      if (this.stopOnError === "letter") {
        const tgt = this.currentTarget();
        const pos = this.typed.length;
        if (!(pos < tgt.length && key === tgt[pos])) return null;
      }
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
