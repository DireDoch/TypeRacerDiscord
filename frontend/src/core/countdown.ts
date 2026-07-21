// =============================================================================
//  countdown.ts — décompte de 3 s, ANNULABLE (issue #12).
//
//  Une seule chaîne de setTimeout vivante à la fois : chaque tick ne programme le
//  suivant qu'après avoir vérifié `cancel()`. Partagé par Practice et Race — un
//  seul exemplaire de la logique, plus de jumeau divergent.
// =============================================================================

export class Countdown {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cancelled = false;
  private n: number;

  constructor(
    seconds: number,
    private readonly onTick: (n: number) => void,
    private readonly onDone: () => void,
  ) {
    this.n = seconds;
  }

  start(): void {
    this.onTick(this.n);
    this.scheduleNext();
  }

  private scheduleNext(): void {
    this.timer = setTimeout(() => {
      if (this.cancelled) return;
      this.n -= 1;
      if (this.n <= 0) {
        this.onDone();
        return;
      }
      this.onTick(this.n);
      this.scheduleNext();
    }, 1000);
  }

  /** Idempotent : arrête la chaîne, `onDone` ne sera plus jamais appelé. */
  cancel(): void {
    this.cancelled = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
