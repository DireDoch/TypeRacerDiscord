import { describe, it, expect } from "vitest";
import {
  raceComplete,
  sourceLabel,
  currentCount,
  liveWpmOf,
  trackLabel,
  trackPercent,
  lastPlaced,
  nextBurnIn,
} from "./race";
import { avatarUrl } from "../discord";
import { WORDS_LENGTHS } from "../core/net";
import type { InputView } from "../core/input/controller";

const view = (lockedWords: string[], typed: string): InputView => ({
  wordIndex: lockedWords.length,
  typed,
  lockedWords,
});

describe("raceComplete — fin de course = texte entièrement exact", () => {
  const target = ["the", "cat", "sat"];

  it("dernier mot en cours et exact + précédents exacts : terminé", () => {
    expect(raceComplete(target, view(["the", "cat"], "sat"))).toBe(true);
  });

  it("tous verrouillés exactement (espace après le dernier) : terminé", () => {
    expect(raceComplete(target, view(["the", "cat", "sat"], ""))).toBe(true);
  });

  it("une faute non corrigée dans un mot précédent : PAS terminé", () => {
    expect(raceComplete(target, view(["teh", "cat"], "sat"))).toBe(false);
  });

  it("dernier mot inexact : PAS terminé", () => {
    expect(raceComplete(target, view(["the", "cat"], "sxt"))).toBe(false);
  });

  it("pas encore au bout : PAS terminé", () => {
    expect(raceComplete(target, view(["the"], "cat"))).toBe(false);
  });
});

describe("Source de texte du lobby (ADR 0009)", () => {
  it("la longueur ne s'affiche que pour Mots — celle d'une Quote lui appartient", () => {
    expect(sourceLabel({ kind: "quote" })).toBe("Citation");
    expect(sourceLabel({ kind: "words", count: 15 })).toBe("Mots (15)");
  });

  it("repasser sur Mots garde la longueur courante", () => {
    expect(currentCount({ kind: "words", count: 50 })).toBe(50);
  });

  it("depuis Quote, Mots retombe sur une longueur que le serveur accepte", () => {
    const n = currentCount({ kind: "quote" });
    expect(WORDS_LENGTHS).toContain(n);
  });
});

describe("WPM live de la piste — dérivé de charsDone, jamais transporté", () => {
  it("150 caractères corrects en 60 s = 30 wpm (un mot = 5 caractères)", () => {
    expect(liveWpmOf(150, 60_000)).toBe(30);
  });

  it("avant le premier tick, pas de division par zéro", () => {
    expect(liveWpmOf(0, 0)).toBe(0);
    expect(liveWpmOf(42, 0)).toBe(0);
  });

  it("n'avoir rien tapé donne 0, pas NaN", () => {
    expect(liveWpmOf(0, 30_000)).toBe(0);
  });
});

describe("trackLabel — un abandon s'affiche « abandon », jamais « 0 wpm »", () => {
  it("abandon : le flag l'emporte, même avec un WPM à 0", () => {
    expect(trackLabel(true, undefined, 0, 0)).toBe("abandon");
    expect(trackLabel(true, undefined, 0, 0)).not.toContain("wpm");
  });

  it("fini pour de vrai : WPM autoritaire coché", () => {
    expect(trackLabel(false, undefined, 72, 40)).toBe("72 wpm ✓");
  });

  it("en train de courir : WPM live dérivé", () => {
    expect(trackLabel(false, undefined, undefined, 55)).toBe("55 wpm");
  });
});

describe("trackLabel — un Échec Master (ADR 0013) s'affiche « échec (X%) », distinct de l'abandon", () => {
  it("l'emporte sur tout le reste, même un WPM final présent", () => {
    expect(trackLabel(false, 42, 72, 40)).toBe("échec (42%)");
  });

  it("distinct d'un abandon même si les deux flags étaient vrais", () => {
    expect(trackLabel(true, 42, 0, 0)).toBe("échec (42%)");
  });
});

describe("avatarUrl — on reconstruit l'URL, on ne la transporte jamais", () => {
  it("avec un hash : l'avatar du joueur sur le CDN Discord", () => {
    expect(avatarUrl("123456789012345678", "abc123")).toContain(
      "/avatars/123456789012345678/abc123.png",
    );
  });

  it("sans hash : l'avatar Discord par défaut, dérivé du snowflake", () => {
    expect(avatarUrl("123456789012345678", null)).toMatch(/\/embed\/avatars\/[0-5]\.png$/);
  });

  it("en mode dev le playerId n'est pas numérique — pas de BigInt tenté", () => {
    expect(() => avatarUrl("dev-player-1", null)).not.toThrow();
    expect(avatarUrl("dev-player-1", null)).toContain("/embed/avatars/0.png");
  });
});

describe("trackPercent — le remplissage de la piste", () => {
  const running = { finished: false, forfeited: false, failed: false };

  it("suit la progression tant qu'on court", () => {
    expect(trackPercent(50, 200, running)).toBe(25);
    expect(trackPercent(0, 200, running)).toBe(0);
  });

  it("remplit la piste à l'arrivée, même sans espace après le dernier mot", () => {
    // Depuis #94, Progress ne part qu'au verrouillage d'un mot : `done` est en retard
    // d'un mot quand on finit sans taper d'espace derrière.
    expect(trackPercent(190, 200, { ...running, finished: true })).toBe(100);
  });

  it("laisse un abandon là où il s'est arrêté", () => {
    // Un abandon arrive par le MÊME PlayerFinished qu'une arrivée : sans l'exclure, la
    // voiture se téléporte sur la ligne pendant que l'étiquette dit « abandon ».
    expect(trackPercent(20, 200, { finished: true, forfeited: true, failed: false })).toBe(10);
  });

  it("laisse un échec Master là où il s'est arrêté", () => {
    expect(trackPercent(6, 200, { finished: true, forfeited: false, failed: true })).toBe(3);
  });

  it("ne dépasse jamais 100 % ni ne divise par zéro", () => {
    expect(trackPercent(500, 200, running)).toBe(100);
    expect(trackPercent(0, 0, running)).toBe(0);
  });
});

// --- Floor is lava (ADR 0015) -------------------------------------------------

describe("trackLabel — un Brûlé passe avant tout le reste", () => {
  it("affiche l'instant du décès, pas un WPM", () => {
    expect(trackLabel(false, undefined, undefined, 55, 32_000)).toBe("brûlé à 32 s");
  });

  it("reste « brûlé » même après le PlayerFinished que son log déclenche", () => {
    // Son log revient par `Finish` (ADR 0015) : un PlayerFinished SUIT toujours son
    // décès. Sans cette priorité, sa ligne redeviendrait « 32 wpm ✓ » juste après
    // avoir pris feu.
    expect(trackLabel(false, undefined, 32, 0, 10_000)).toBe("brûlé à 10 s");
  });

  it("arrondit à la seconde", () => {
    expect(trackLabel(false, undefined, undefined, 0, 7_600)).toBe("brûlé à 8 s");
  });
});

describe("lastPlaced — qui brûlera au prochain tic", () => {
  const a = (playerId: string, done: number) => ({ playerId, done });

  it("désigne le moins avancé", () => {
    expect([...lastPlaced([a("p1", 100), a("p2", 20), a("p3", 60)])]).toEqual(["p2"]);
  });

  it("désigne TOUS les ex æquo — aucun départage n'est honnête", () => {
    const doomed = lastPlaced([a("p1", 100), a("p2", 20), a("p3", 20)]);
    expect(doomed.size).toBe(2);
    expect(doomed.has("p2") && doomed.has("p3")).toBe(true);
  });

  it("ne condamne personne quand il reste moins de deux vivants", () => {
    expect(lastPlaced([a("p1", 0)]).size).toBe(0);
    expect(lastPlaced([]).size).toBe(0);
  });

  it("traite le zéro comme une valeur — pas encore tapé, c'est bien le dernier", () => {
    expect([...lastPlaced([a("p1", 0), a("p2", 5)])]).toEqual(["p1"]);
  });
});

describe("nextBurnIn — le décompte avant la prochaine brûlure", () => {
  it("part de l'intervalle plein au départ", () => {
    expect(nextBurnIn(0, 10)).toBe(10);
  });

  it("décroît puis se réarme au tic suivant", () => {
    expect(nextBurnIn(3_000, 10)).toBe(7);
    expect(nextBurnIn(9_500, 10)).toBe(1);
    expect(nextBurnIn(10_000, 10)).toBe(10);
    expect(nextBurnIn(12_000, 10)).toBe(8);
  });

  it("n'affiche jamais zéro — un « 0 s » resterait figé une seconde entière", () => {
    for (let ms = 0; ms < 40_000; ms += 137) {
      const n = nextBurnIn(ms, 5);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(5);
    }
  });
});
