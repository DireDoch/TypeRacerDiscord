// =============================================================================
//  clock.ts — origine du temps (t=0) et horloge monotone.
//
//  FRONTIÈRE unique pour le temps : en solo, t=0 est la 1re frappe du Player (pas
//  de décompte — ADR 0004). En Race, t=0 est `RaceStart`, diffusé par le serveur.
//  Seul `RunClock.start()` change de source ; le reste du code lit `elapsed()` sans
//  rien savoir de l'origine.
//
//  On utilise performance.now() (monotone) et JAMAIS Date.now() : immunisé contre
//  les ajustements d'horloge système / NTP pendant un Run.
// =============================================================================

export class RunClock {
  private origin: number | null = null;

  /** Cale t=0. En solo : appelé à la 1re frappe. En Race : sur RaceStart. */
  start(): void {
    this.origin = performance.now();
  }

  /** ms écoulées depuis t=0. Lève si l'horloge n'a pas démarré. */
  elapsed(): number {
    if (this.origin === null) throw new Error("RunClock: start() non appelé.");
    return performance.now() - this.origin;
  }

  get started(): boolean {
    return this.origin !== null;
  }

  reset(): void {
    this.origin = null;
  }
}
