import { describe, it, expect } from "vitest";
import { modeLabel } from "./history";
import type { RunConfig } from "../core/types";

const cfg = (mode: RunConfig["mode"], modeValue: number): RunConfig => ({
  mode,
  modeValue,
  language: "english",
  punctuation: false,
  numbers: false,
});

describe("modeLabel — libellé compact d'un Run de l'historique", () => {
  it("time fini, Time infini, words, quotes, zen", () => {
    expect(modeLabel(cfg("time", 30))).toBe("time 30s");
    expect(modeLabel(cfg("time", 0))).toBe("time ∞");
    expect(modeLabel(cfg("words", 25))).toBe("words 25");
    expect(modeLabel(cfg("quotes", 0))).toBe("quotes");
    expect(modeLabel(cfg("zen", 0))).toBe("zen");
  });
});
