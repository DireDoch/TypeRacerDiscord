import { describe, it, expect } from "vitest";
import { gapSeconds, gapLabel } from "./podium";
import type { RaceResult } from "../core/net";

const finished = (playerId: string, wpm: number, durationMs: number): RaceResult => ({
  playerId,
  wpm,
  accuracy: 97,
  durationMs,
  forfeit: false,
  perSecond: [],
});

const forfeited = (playerId: string): RaceResult => ({
  playerId,
  wpm: 0,
  accuracy: 0,
  durationMs: 0,
  forfeit: true,
  perSecond: [],
});

describe("Gap — le chiffre qu'on dit à voix haute (ADR 0010)", () => {
  const results = [
    finished("alice", 92, 30_000),
    finished("bob", 78, 31_400),
    finished("carol", 64, 33_900),
  ];

  it("le vainqueur est la référence : écart nul", () => {
    expect(gapSeconds(results, 0)).toBe(0);
    expect(gapLabel(results, 0)).toBe("vainqueur");
  });

  it("les suivants se mesurent au vainqueur, en secondes", () => {
    expect(gapSeconds(results, 1)).toBeCloseTo(1.4);
    expect(gapLabel(results, 1)).toBe("+1.4 s");
    expect(gapLabel(results, 2)).toBe("+3.9 s");
  });

  it("un abandon n'a pas d'écart — pas un écart négatif absurde", () => {
    // durationMs vaut 0 sur un abandon (aucun recompute) : sans ce cas, il afficherait
    // « -30.0 s » et passerait pour le meilleur temps de la course.
    const withForfeit = [...results, forfeited("dave")];
    expect(gapSeconds(withForfeit, 3)).toBeNull();
    expect(gapLabel(withForfeit, 3)).toBe("abandon");
  });

  it("le Gap se mesure au premier FINISSEUR, même si un abandon le précède", () => {
    const odd = [forfeited("dave"), finished("alice", 92, 30_000), finished("bob", 78, 31_400)];
    expect(gapLabel(odd, 1)).toBe("vainqueur");
    expect(gapSeconds(odd, 2)).toBeCloseTo(1.4);
  });

  it("une course sans aucun finisseur n'a pas de Gap du tout", () => {
    const none = [forfeited("dave"), forfeited("erin")];
    expect(gapSeconds(none, 0)).toBeNull();
    expect(gapSeconds(none, 1)).toBeNull();
  });

  it("un index hors du tableau ne fait pas planter le podium", () => {
    expect(gapSeconds(results, 99)).toBeNull();
  });
});
