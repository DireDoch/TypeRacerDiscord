// =============================================================================
//  BlockingInput — STUB (Phase 2, Race / TypeRacer-style).
//
//  Frontière isolée, NON implémentée au MVP. Sémantique cible :
//   une frappe incorrecte BLOQUE l'avancée — elle doit être corrigée (backspace)
//   avant que la frappe suivante du mot soit acceptée. Pas d'Extra possible.
//
//  Le contrôleur respecte la même interface que FreeInput pour pouvoir être
//  rebranché sans toucher au reste (UI, horloge, log). À implémenter en Phase 2.
// =============================================================================

import type { Keystroke } from "../types";
import type { InputController, InputView } from "./controller";

export class BlockingInput implements InputController {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_targetWords: string[]) {
    // Phase 2.
  }

  handleKey(_key: string, _ctrl: boolean, _now: number): Keystroke | null {
    throw new Error("BlockingInput: non implémenté (Phase 2 — Race).");
  }

  view(): InputView {
    throw new Error("BlockingInput: non implémenté (Phase 2 — Race).");
  }

  isComplete(): boolean {
    throw new Error("BlockingInput: non implémenté (Phase 2 — Race).");
  }
}
