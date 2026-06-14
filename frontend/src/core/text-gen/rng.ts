// =============================================================================
//  rng.ts — PRNG seedé déterministe (mulberry32).
//
//  Déterministe et portable : la même graine produit la même suite côté TS (MVP)
//  et côté Rust (Phase 2, port à l'identique). Indépendant de Math.random.
// =============================================================================

export class Rng {
  private state: number;

  constructor(seed: number) {
    // Force un entier 32 bits non signé.
    this.state = seed >>> 0;
  }

  /** Flottant dans [0, 1). */
  next(): number {
    // mulberry32
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Entier dans [0, max). */
  int(max: number): number {
    return Math.floor(this.next() * max);
  }

  /** Élément aléatoire d'un tableau non vide. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }

  /** true avec la probabilité p (0..1). */
  chance(p: number): boolean {
    return this.next() < p;
  }
}

/** Graine aléatoire 32 bits (côté client). */
export function randomSeed(): number {
  return (Math.random() * 0x100000000) >>> 0;
}
