import { describe, it, expect } from "vitest";
import { computeScoreboard, type ScoreInput } from "./scoreboard";
import type { Keystroke } from "../types";

/** Construit un log à partir de tokens [t, k(, ctrl)]. */
function log(...events: Array<[number, string, ("backspace" | "backspace-word")?]>): Keystroke[] {
  return events.map(([t, k, ctrl]) => (ctrl ? { t, k: "", ctrl } : { t, k }));
}

const base = (over: Partial<ScoreInput>): ScoreInput => ({
  mode: "words",
  modeValue: 2,
  targetText: "the cat",
  keystrokes: [],
  endedAtMs: 1000,
  ...over,
});

describe("computeScoreboard — saisie parfaite", () => {
  it('"the cat" tapé sans faute', () => {
    const s = computeScoreboard(
      base({
        keystrokes: log([100, "t"], [200, "h"], [300, "e"], [400, " "], [500, "c"], [600, "a"], [700, "t"]),
        endedAtMs: 700,
      }),
    );
    expect(s.wpm).toBe(120); // 7 chars / 5 / (0.7/60)
    expect(s.raw).toBe(120);
    expect(s.accuracy).toBe(100);
    expect(s.characters).toEqual({ correct: 7, incorrect: 0, extra: 0, missed: 0 });
  });
});

describe("computeScoreboard — fautes / extra / missed", () => {
  it("faute interne : 'cxt' pour 'cat'", () => {
    const s = computeScoreboard(
      base({ modeValue: 1, targetText: "cat", keystrokes: log([100, "c"], [200, "x"], [300, "t"]), endedAtMs: 300 }),
    );
    expect(s.characters).toEqual({ correct: 2, incorrect: 1, extra: 0, missed: 0 });
    expect(s.accuracy).toBe(66.7);
    expect(s.wpm).toBe(80); // 2 corrects
    expect(s.raw).toBe(120); // 3 frappes
  });

  it("Extra : 'hixx' pour 'hi'", () => {
    const s = computeScoreboard(
      base({ modeValue: 1, targetText: "hi", keystrokes: log([100, "h"], [200, "i"], [300, "x"], [400, "x"]), endedAtMs: 400 }),
    );
    expect(s.characters).toEqual({ correct: 2, incorrect: 2, extra: 2, missed: 0 });
    expect(s.accuracy).toBe(50);
  });

  it("Missed : espace anticipé sur 'cat dog'", () => {
    const s = computeScoreboard(
      base({
        targetText: "cat dog",
        keystrokes: log([100, "c"], [200, "a"], [300, " "], [400, "d"], [500, "o"], [600, "g"]),
        endedAtMs: 600,
      }),
    );
    expect(s.characters).toEqual({ correct: 6, incorrect: 0, extra: 0, missed: 1 });
  });
});

describe("computeScoreboard — série par seconde et Burst", () => {
  it("cumulatif, point final exact, Burst = mot le plus rapide", () => {
    const s = computeScoreboard(
      base({
        modeValue: 3,
        targetText: "aa bb cc",
        keystrokes: log(
          [100, "a"], [200, "a"], [300, " "],
          [1100, "b"], [1200, "b"], [1300, " "],
          [2100, "c"], [2200, "c"],
        ),
        endedAtMs: 2200,
      }),
    );
    expect(s.perSecond).toHaveLength(3);
    expect(s.perSecond[0]).toEqual({ t: 1, wpm: 36, raw: 36, errors: 0, burst: 120 });
    expect(s.perSecond[1]).toEqual({ t: 2, wpm: 36, raw: 36, errors: 0, burst: 120 });
    expect(s.perSecond[2]).toEqual({ t: 2.2, wpm: 43.6, raw: 43.6, errors: 0, burst: 240 });
  });
});

describe("computeScoreboard — Zen et éligibilité PB", () => {
  it("Zen : ACC 100, Correct/0/0/0, exclu des PB", () => {
    const s = computeScoreboard({
      mode: "zen",
      modeValue: 0,
      targetText: "",
      keystrokes: log([100, "a"], [200, "b"], [300, "c"], [400, " "], [500, "d"], [600, "e"], [700, "f"]),
      endedAtMs: 1000,
    });
    expect(s.characters).toEqual({ correct: 7, incorrect: 0, extra: 0, missed: 0 });
    expect(s.accuracy).toBe(100);
    expect(s.wpm).toBe(84); // 7 / 5 / (1/60)
    expect(s.pbEligible).toBe(false);
  });

  it("Time infini exclu des PB ; Time fini éligible", () => {
    const k = log([100, "a"]);
    expect(computeScoreboard(base({ mode: "time", modeValue: 0, keystrokes: k })).pbEligible).toBe(false);
    expect(computeScoreboard(base({ mode: "time", modeValue: 30, keystrokes: k })).pbEligible).toBe(true);
  });
});
