import { describe, it, expect } from "vitest";
import { gapSeconds, gapLabel, isLava, survivalLabel, isSpam, repsLabel } from "./podium";
import type { RaceResult } from "../core/net";

const finished = (playerId: string, wpm: number, durationMs: number): RaceResult => ({
  playerId,
  wpm,
  accuracy: 97,
  durationMs,
  forfeit: false,
  failedPercent: null,
  burnedAtMs: null,
  reps: null,
  perSecond: [],
});

const forfeited = (playerId: string): RaceResult => ({
  playerId,
  wpm: 0,
  accuracy: 0,
  durationMs: 0,
  forfeit: true,
  failedPercent: null,
  burnedAtMs: null,
  reps: null,
  perSecond: [],
});

const failed = (playerId: string, percent: number): RaceResult => ({
  playerId,
  wpm: 0,
  accuracy: 0,
  durationMs: 0,
  forfeit: false,
  failedPercent: percent,
  burnedAtMs: null,
  reps: null,
  perSecond: [],
});

const results = [
  finished("alice", 92, 30_000),
  finished("bob", 78, 31_400),
  finished("carol", 64, 33_900),
];

describe("Gap — le chiffre qu'on dit à voix haute (ADR 0010)", () => {
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

describe("Gap — un Échec Master (ADR 0013) n'a pas d'écart, distinct d'un abandon", () => {
  it("un Échec affiche « échec », jamais « abandon » ni un WPM", () => {
    const withFailed = [...results, failed("dave", 42)];
    expect(gapSeconds(withFailed, 3)).toBeNull();
    expect(gapLabel(withFailed, 3)).toBe("échec");
  });

  it("un Échec n'est jamais choisi comme référence (vainqueur) du Gap", () => {
    // Même s'il arrive en tête du tableau, un Échec (durationMs=0) ne doit jamais servir
    // de référence — sinon tout le monde afficherait un Gap négatif absurde.
    const odd = [failed("dave", 90), finished("alice", 92, 30_000), finished("bob", 78, 31_400)];
    expect(gapLabel(odd, 1)).toBe("vainqueur");
    expect(gapSeconds(odd, 2)).toBeCloseTo(1.4);
  });
});

// --- Floor is lava (ADR 0015) -------------------------------------------------

const burned = (playerId: string, wpm: number, burnedAtMs: number): RaceResult => ({
  playerId,
  wpm,
  accuracy: 94,
  durationMs: burnedAtMs,
  forfeit: false,
  failedPercent: null,
  burnedAtMs,
  reps: null,
  perSecond: [],
});

describe("isLava — le mode se déduit des brûlés, aucun champ ne voyage", () => {
  it("une Race normale n'a jamais de brûlé", () => {
    expect(isLava(results)).toBe(false);
  });

  it("floor is lava en a toujours au moins un — la course s'arrête sur un décès", () => {
    expect(isLava([finished("winner", 60, 40_000), burned("bob", 58, 30_000)])).toBe(true);
  });
});

describe("survivalLabel — le temps de survie remplace le Gap (ADR 0015)", () => {
  // Classement = ordre des décès inversé : le survivant, puis le dernier brûlé, etc.
  const lava = [
    finished("winner", 55, 31_000),
    burned("bob", 30, 20_000),
    burned("alice", 40, 10_000),
  ];

  it("le survivant a survécu jusqu'à la dernière élimination", () => {
    expect(gapLabel(lava, 0)).toBe("survécu 20 s");
    expect(survivalLabel(lava, 0)).toBe("survécu 20 s"); // gapLabel n'est qu'un aiguillage
  });

  it("un brûlé affiche l'instant de son décès, jamais un écart", () => {
    expect(gapLabel(lava, 1)).toBe("brûlé à 20 s");
    expect(gapLabel(lava, 2)).toBe("brûlé à 10 s");
  });

  it("le Gap ne s'affiche JAMAIS dans ce mode — personne ne franchit la ligne", () => {
    expect(lava.map((_, i) => gapLabel(lava, i)).join(" ")).not.toContain("+");
  });

  it("un abandon reste un abandon, un échec reste un échec", () => {
    const mixed = [finished("w", 50, 30_000), burned("b", 40, 10_000), forfeited("q"), failed("f", 12)];
    expect(gapLabel(mixed, 2)).toBe("abandon");
    expect(gapLabel(mixed, 3)).toBe("échec");
  });

  it("un brûlé garde un VRAI score, contrairement à un abandon", () => {
    // C'est toute la différence du troisième état terminal (ADR 0015).
    const b = burned("bob", 41, 10_000);
    expect(b.wpm).toBeGreaterThan(0);
    expect(b.forfeit).toBe(false);
  });
});

// --- Spam (ADR 0016) ----------------------------------------------------------

const spammed = (playerId: string, wpm: number, reps: number): RaceResult => ({
  playerId,
  wpm,
  accuracy: 91,
  durationMs: 30_000,
  forfeit: false,
  failedPercent: null,
  burnedAtMs: null,
  reps,
  perSecond: [],
});

describe("isSpam — le mode se déduit des comptes de répétitions, aucun champ ne voyage", () => {
  it("une Race normale n'en a jamais", () => {
    expect(isSpam(results)).toBe(false);
  });

  it("floor is lava non plus — les deux modes restent distinguables", () => {
    expect(isSpam([finished("w", 60, 40_000), burned("bob", 58, 30_000)])).toBe(false);
  });

  it("sous Spam chaque arrivée en porte un, même à zéro répétition", () => {
    expect(isSpam([spammed("w", 60, 12), spammed("b", 58, 0)])).toBe(true);
  });
});

describe("repsLabel — le compte brut remplace le Gap (ADR 0016)", () => {
  // Classement = répétitions décroissantes ; l'ordre du tableau EST le classement.
  const spam = [spammed("alice", 70, 20), spammed("bob", 80, 17), spammed("carol", 40, 3)];

  it("le vainqueur affiche son compte, pas un écart", () => {
    expect(gapLabel(spam, 0)).toBe("20 répétitions · vainqueur");
    expect(repsLabel(spam, 0)).toBe("20 répétitions · vainqueur"); // gapLabel n'est qu'un aiguillage
  });

  it("les autres sont Devancé — ni un choix ni une faute, une comparaison", () => {
    expect(gapLabel(spam, 1)).toBe("17 répétitions · devancé");
    expect(gapLabel(spam, 2)).toBe("3 répétitions · devancé");
  });

  it("le classement ne suit pas le WPM : bob tape plus vite et finit derrière", () => {
    expect(spam[1].wpm).toBeGreaterThan(spam[0].wpm);
    expect(gapLabel(spam, 0)).toContain("vainqueur");
  });

  it("le Gap ne s'affiche JAMAIS dans ce mode — personne ne franchit la ligne", () => {
    expect(spam.map((_, i) => gapLabel(spam, i)).join(" ")).not.toContain("+");
  });

  it("le singulier est respecté à une répétition", () => {
    expect(gapLabel([spammed("solo", 20, 1)], 0)).toBe("1 répétition · vainqueur");
  });

  it("un abandon reste un abandon, un échec reste un échec — ce ne sont pas des Devancé", () => {
    const mixed = [spammed("w", 50, 12), spammed("d", 40, 4), forfeited("q"), failed("f", 12)];
    expect(gapLabel(mixed, 2)).toBe("abandon");
    expect(gapLabel(mixed, 3)).toBe("échec");
  });

  it("un Devancé garde un VRAI score, contrairement à un abandon", () => {
    // Même propriété que le Brûlé : il vient d'une comparaison, pas d'un renoncement.
    const d = spammed("bob", 41, 4);
    expect(d.wpm).toBeGreaterThan(0);
    expect(d.forfeit).toBe(false);
  });
});
