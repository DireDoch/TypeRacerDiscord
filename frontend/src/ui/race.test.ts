import { describe, it, expect } from "vitest";
import { raceComplete, sourceLabel, currentCount, liveWpmOf, trackLabel } from "./race";
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
    expect(trackLabel(true, 0, 0)).toBe("abandon");
    expect(trackLabel(true, 0, 0)).not.toContain("wpm");
  });

  it("fini pour de vrai : WPM autoritaire coché", () => {
    expect(trackLabel(false, 72, 40)).toBe("72 wpm ✓");
  });

  it("en train de courir : WPM live dérivé", () => {
    expect(trackLabel(false, undefined, 55)).toBe("55 wpm");
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
