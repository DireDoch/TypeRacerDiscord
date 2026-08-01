import { describe, it, expect } from "vitest";
import { liveAccuracy, liveBurst } from "./live-stats";
import type { InputView } from "./core/input/controller";

const view = (typed: string, wordIndex = 0, lockedWords: string[] = []): InputView => ({
  typed,
  wordIndex,
  lockedWords,
});

describe("liveAccuracy — issue #67", () => {
  it("aucune frappe encore : 100 (rien de faux pour l'instant)", () => {
    expect(liveAccuracy(0, 0)).toBe(100);
  });

  it("toutes correctes : 100", () => {
    expect(liveAccuracy(10, 10)).toBe(100);
  });

  it("arrondit au pourcentage entier le plus proche", () => {
    expect(liveAccuracy(2, 3)).toBe(67);
  });
});

describe("liveBurst — vitesse du mot en cours (issue #67)", () => {
  it("pas encore de frappe sur ce mot : 0", () => {
    expect(liveBurst(view(""), ["the"], null, 1000)).toBe(0);
  });

  it("dérive du préfixe correct et du temps depuis la 1re frappe du mot", () => {
    // "th" correct sur 2 lettres en 500 ms depuis le début du mot → 2/5/(0.5/60) = 48 wpm
    const burst = liveBurst(view("th"), ["the"], 500, 1000);
    expect(burst).toBe(48);
  });

  it("temps négatif ou nul depuis le début du mot : 0 (pas de division absurde)", () => {
    expect(liveBurst(view("t"), ["the"], 1000, 1000)).toBe(0);
  });
});
