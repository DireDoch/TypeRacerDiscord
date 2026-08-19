// =============================================================================
//  core/run-session.ts — une Run tapée : horloge, contrôleur, log, Difficulté (#199).
//
//  Les briques étaient déjà pures et testées séparément (`RunClock`, `FreeInput`,
//  `detectDifficultyFailure`) ; leur ASSEMBLAGE ne l'était nulle part, et c'est là que
//  vivent les bugs réels — quel événement cale t=0, dans quel ordre le log se remplit,
//  ce qui arrive à une frappe reçue avant le départ. Practice, Race et Apprendre
//  recâblaient les trois à la main, chacun un peu différemment (Apprendre lisait même
//  `performance.now()` en direct, alors que CONTEXT.md pose `RunClock` comme la SEULE
//  frontière du temps).
//
//  Ce que ce module possède : le temps, le buffer, le log, l'échec de Difficulté.
//  Ce qu'il ne possède pas, et ne doit pas : le rendu, le réseau, les stats live, la
//  règle de fin (Practice finit sur `complete`, une Race sur `raceComplete` — le texte
//  entier exact —, une Lesson sur `complete` aussi). Les écrans gardent tout ça.
//
//  ORIGINE DU TEMPS (CONTEXT.md « Origine du temps ») — deux cas, un seul mécanisme :
//   - solo (Practice, Apprendre) : t=0 = la 1re frappe, calée par `press()` lui-même ;
//   - Race : t=0 = la fin du décompte, calée par `start()` sur `RaceStart`. Une frappe
//     arrivée avant est REFUSÉE plutôt que d'ouvrir le chrono en avance.
// =============================================================================

import { RunClock } from "./clock";
import { FreeInput } from "./input/free-input";
import type { InputView } from "./input/controller";
import { detectDifficultyFailure, type Difficulty, type DifficultyFailure } from "./difficulty";
import type { StopOnError } from "./preferences";
import type { Keystroke } from "./types";

/** Ce qu'une frappe a produit. Tout ce dont un écran a besoin pour se redessiner. */
export interface SessionStep {
  /** Le Keystroke journalisé, ou `null` si la frappe a été ignorée (backspace en début
   *  de buffer borné, frappe bloquée par stop-on-error). */
  keystroke: Keystroke | null;
  /** ms depuis t=0 au moment de la frappe. */
  at: number;
  /** Vue AVANT la frappe — le Burst live et le son d'erreur se jugent là-dessus. */
  before: InputView;
  /** Vue APRÈS la frappe : ce que l'écran doit dessiner. */
  after: InputView;
  /** L'échec de Difficulté que ce log déclenche (ADR 0013), ou `null`. */
  failure: DifficultyFailure | null;
  /** Le texte cible est entièrement satisfait. Fin d'une Run `words`/`quotes` et d'une
   *  Lesson ; une Race a sa propre règle, plus stricte (`raceComplete`). */
  complete: boolean;
}

/**
 * Les seules touches qu'une Run journalise (CONTEXT.md « Keystroke log ») : imprimables,
 * espace, Backspace (Ctrl+Backspace compris). Pas de navigation au curseur.
 *
 * Exportée parce que les écrans doivent trancher AVANT d'appeler `press` : ils ont leurs
 * propres raccourcis (Tab, Shift+Entrée, Échap) et ne peuvent pas `preventDefault` tout.
 */
export function isTypingKey(key: string): boolean {
  return key === "Backspace" || key === " " || key.length === 1;
}

export class RunSession {
  private readonly clock = new RunClock();
  private readonly controller: FreeInput;
  private readonly keystrokes: Keystroke[] = [];

  /**
   * `targetWords` est gardé PAR RÉFÉRENCE jusque dans `FreeInput` : un appelant dont le
   * texte s'allonge en cours de route (Spam, ADR 0016 ; Time infini) pousse dedans sans
   * reconstruire la session, donc sans perdre sa pile ni son log.
   *
   * `difficulty` est évaluée sur le LOG, jamais sur le contrôleur (ADR 0013) — et jamais
   * du tout sans texte cible : Zen n'a rien à être « juste » contre, même raison
   * structurelle que le `stopOnError` neutralisé de `FreeInput`.
   */
  constructor(
    private readonly targetWords: string[],
    private readonly difficulty: Difficulty = "normal",
    stopOnError: StopOnError = "off",
  ) {
    this.controller = new FreeInput(targetWords, stopOnError);
  }

  /** Cale t=0 sans frappe — c'est `RaceStart` en multijoueur (fin du décompte). */
  start(): void {
    this.clock.start();
  }

  get started(): boolean {
    return this.clock.started;
  }

  /** ms depuis t=0, ou 0 tant que la session n'a pas démarré (au lieu de lever). */
  get elapsed(): number {
    return this.clock.started ? this.clock.elapsed() : 0;
  }

  /** Le log brut, à envoyer tel quel (`POST /api/runs`, `Finish`, `Fail`). */
  get log(): Keystroke[] {
    return this.keystrokes;
  }

  view(): InputView {
    return this.controller.view();
  }

  /**
   * Traite une frappe tapable. En solo, la toute première CALE t=0 et compte déjà — il
   * n'y a pas de décompte à attendre (ADR 0004).
   *
   * `requireStart` (Race) inverse la règle : sans `start()` préalable, la frappe est
   * refusée et rien n'entre au log. Le chrono d'une Race appartient au serveur, une
   * frappe anticipée ne doit pas l'ouvrir.
   */
  press(key: string, ctrl: boolean, requireStart = false): SessionStep | null {
    if (!this.clock.started) {
      if (requireStart) return null;
      this.clock.start(); // t=0 = la 1re frappe (solo)
    }
    const before = this.controller.view();
    const at = this.clock.elapsed();
    const keystroke = this.controller.handleKey(key, ctrl, at);
    if (keystroke) this.keystrokes.push(keystroke);
    return {
      keystroke,
      at,
      before,
      after: this.controller.view(),
      failure: this.failureNow(),
      complete: this.controller.isComplete(),
    };
  }

  /** L'échec de Difficulté que le log porte À CET INSTANT, ou `null`. */
  private failureNow(): DifficultyFailure | null {
    if (this.difficulty === "normal" || this.targetWords.length === 0) return null;
    return detectDifficultyFailure(this.difficulty, this.targetWords, this.keystrokes);
  }
}
