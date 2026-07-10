import { describe, it, expect } from "vitest";
import { raceComplete } from "./race";
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
