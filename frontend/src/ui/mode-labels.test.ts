import { describe, it, expect } from "vitest";
import { configSummary } from "./mode-labels";
import type { RunConfig } from "../core/types";

const cfg = (over: Partial<RunConfig> = {}): RunConfig => ({
  mode: "words",
  modeValue: 25,
  language: "english",
  punctuation: false,
  numbers: false,
  ...over,
});

describe("configSummary", () => {
  it("dit le Mode, sa valeur, les Options actives et la Difficulté", () => {
    expect(configSummary(cfg({ punctuation: true }), "normal")).toBe("mots · 25 · ponctuation · Normal");
    expect(configSummary(cfg({ mode: "time", modeValue: 60, numbers: true }), "expert")).toBe(
      "temps · 60 · chiffres · Expert",
    );
  });

  it("tait les Options inactives — la ligne dit ce qui EST, pas ce qui pourrait être", () => {
    expect(configSummary(cfg(), "normal")).toBe("mots · 25 · Normal");
  });

  it("note Time infini du même ∞ que son bouton", () => {
    expect(configSummary(cfg({ mode: "time", modeValue: 0 }), "normal")).toBe("temps · ∞ · Normal");
  });

  it("omet ce que le Mode n'a pas : ni longueur ni Options sous citations et entraînements", () => {
    expect(configSummary(cfg({ mode: "quotes", modeValue: 0, punctuation: true }), "master")).toBe(
      "citations · Master",
    );
    expect(configSummary(cfg({ mode: "trigram-drill", modeValue: 0 }), "normal")).toBe("triplets · Normal");
  });

  it("omet la Difficulté sous zen, qui n'a pas de texte cible à rater (#64)", () => {
    expect(configSummary(cfg({ mode: "zen", modeValue: 0 }), "master")).toBe("zen");
  });
});
