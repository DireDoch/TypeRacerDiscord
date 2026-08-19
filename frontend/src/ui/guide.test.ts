import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { guideHtml, hasSeenGuide, markGuideSeen } from "./guide";

// Même approche que preferences.test.ts : pas de jsdom dans ce projet, on remplace
// localStorage par le strict minimum que le module touche.
const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("drapeau « déjà vu » (issue #173)", () => {
  it("non vu tant que rien n'a été écrit", () => {
    expect(hasSeenGuide()).toBe(false);
  });

  it("vu après markGuideSeen", () => {
    markGuideSeen();
    expect(hasSeenGuide()).toBe(true);
  });

  // Le stockage peut refuser : navigation privée, quota plein, iframe restreinte. Le
  // Guide se rouvrira au lancement suivant — désagréable, jamais bloquant. Ce qui
  // compte est que le démarrage du jeu ne dépende pas de cette écriture.
  it("un stockage qui lève ne fait pas planter la lecture ni l'écriture", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("refusé");
      },
      setItem: () => {
        throw new Error("refusé");
      },
    });
    expect(() => markGuideSeen()).not.toThrow();
    expect(hasSeenGuide()).toBe(false);
  });
});

describe("guideHtml", () => {
  // Le Guide est un plan du menu : si une entrée y manque, il ment sur ce que le
  // joueur va trouver à l'écran.
  it("décrit les cinq entrées du menu, sous leurs libellés exacts", () => {
    const html = guideHtml();
    for (const label of ["Solo", "Multijoueur", "Apprendre", "Historique", "Paramètres"]) {
      expect(html).toContain(`<dt>${label}</dt>`);
    }
  });

  it("porte le bouton « Continuer » et son titre", () => {
    expect(guideHtml()).toContain("Comment jouer");
    expect(guideHtml()).toContain("Continuer");
  });
});
