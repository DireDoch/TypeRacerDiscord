import { describe, it, expect } from "vitest";
import { computeScoreboard, type ScoreInput } from "./scoreboard";
import { FreeInput } from "../input/free-input";
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
  ...over,
});

describe("computeScoreboard — saisie parfaite", () => {
  it('"the cat" tapé sans faute', () => {
    const s = computeScoreboard(
      base({
        keystrokes: log([100, "t"], [200, "h"], [300, "e"], [400, " "], [500, "c"], [600, "a"], [700, "t"]),
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
      base({ modeValue: 1, targetText: "cat", keystrokes: log([100, "c"], [200, "x"], [300, "t"]) }),
    );
    expect(s.characters).toEqual({ correct: 2, incorrect: 1, extra: 0, missed: 0 });
    expect(s.accuracy).toBe(66.7);
    expect(s.wpm).toBe(80); // 2 corrects
    expect(s.raw).toBe(120); // 3 frappes
  });

  it("Extra : 'hixx' pour 'hi'", () => {
    const s = computeScoreboard(
      base({ modeValue: 1, targetText: "hi", keystrokes: log([100, "h"], [200, "i"], [300, "x"], [400, "x"]) }),
    );
    expect(s.characters).toEqual({ correct: 2, incorrect: 2, extra: 2, missed: 0 });
    expect(s.accuracy).toBe(50);
  });

  it("curseur libre : corriger un mot antérieur retire sa pénalité du WPM net, pas de l'ACC", () => {
    // "ab cd" : on tape "xb" (1 faute), espace, puis on revient corriger en "ab", espace, "cd".
    const s = computeScoreboard(
      base({
        targetText: "ab cd",
        keystrokes: log(
          [100, "x"], [200, "b"], [300, " "],
          [400, "", "backspace"], // buffer vide → rouvre "xb"
          [500, "", "backspace"], // "xb" → "x"
          [600, "", "backspace"], // "x" → ""
          [700, "a"], [800, "b"], [900, " "],
          [1000, "c"], [1100, "d"],
        ),
      }),
    );
    // État final "ab cd" parfait → aucun extra/missed ; la frappe "x" reste comptée en incorrect.
    expect(s.characters).toEqual({ correct: 7, incorrect: 1, extra: 0, missed: 0 });
    expect(s.accuracy).toBe(87.5); // 7 / 8 frappes (la faute corrigée pèse encore)
    expect(s.wpm).toBe(54.5); // 5 chars corrects à l'état final (la faute ne pèse plus)
  });

  it("Missed : espace anticipé sur 'cat dog'", () => {
    const s = computeScoreboard(
      base({
        targetText: "cat dog",
        keystrokes: log([100, "c"], [200, "a"], [300, " "], [400, "d"], [500, "o"], [600, "g"]),
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
    });
    expect(s.characters).toEqual({ correct: 7, incorrect: 0, extra: 0, missed: 0 });
    expect(s.accuracy).toBe(100);
    expect(s.wpm).toBe(120); // 7 / 5 / (0.7/60) — durée dérivée du dernier t du log
    expect(s.pbEligible).toBe(false);
  });

  it("Zen : le retour arrière efface (WPM = état visible, Raw = effort brut)", () => {
    // "teh" → 2× backspace → "he" ⇒ visible "the" (3 chars) ; 5 frappes au total.
    const s = computeScoreboard({
      mode: "zen",
      modeValue: 0,
      targetText: "",
      keystrokes: log(
        [100, "t"], [200, "e"], [300, "h"],
        [400, "", "backspace"], [500, "", "backspace"],
        [600, "h"], [700, "e"],
      ),
    });
    expect(s.wpm).toBe(51.4); // 3 chars visibles / 5 / (0.7/60)
    expect(s.raw).toBe(85.7); // 5 frappes / 5 / (0.7/60)
    expect(s.accuracy).toBe(100);
    expect(s.characters).toEqual({ correct: 5, incorrect: 0, extra: 0, missed: 0 });
    expect(s.pbEligible).toBe(false);
  });

  it("Time infini exclu des PB ; Time fini éligible", () => {
    const k = log([100, "a"]);
    expect(computeScoreboard(base({ mode: "time", modeValue: 0, keystrokes: k })).pbEligible).toBe(false);
    expect(computeScoreboard(base({ mode: "time", modeValue: 30, keystrokes: k })).pbEligible).toBe(true);
  });

  it("Quotes exclu des PB (issue #14, ADR 0003) : longueur non capturée par le bucket", () => {
    const k = log([100, "a"]);
    expect(computeScoreboard(base({ mode: "quotes", modeValue: 0, keystrokes: k })).pbEligible).toBe(false);
    // Une Quote courte et une longue ne se disputent donc jamais un PB.
    const short = computeScoreboard(base({ mode: "quotes", modeValue: 0, targetText: "hi", keystrokes: log([100, "h"], [200, "i"]) }));
    const long = computeScoreboard(base({ mode: "quotes", modeValue: 0, targetText: "the cat sat", keystrokes: k }));
    expect(short.pbEligible).toBe(false);
    expect(long.pbEligible).toBe(false);
  });
});

describe("computeScoreboard — durée : le client n'est jamais la source (issue #11)", () => {
  it("la durée vient du dernier t du log, jamais d'un champ fourni par le client", () => {
    const s = computeScoreboard(
      base({ keystrokes: log([100, "t"], [200, "h"], [300, "e"]), targetText: "the", modeValue: 1 }),
    );
    expect(s.durationMs).toBe(300);
  });

  it("durée aberrante (log au t énorme) : bornée, pas d'allocation disproportionnée", () => {
    const s = computeScoreboard(
      base({ keystrokes: log([100_000_000, "t"]), targetText: "the", modeValue: 1 }),
    );
    expect(s.durationMs).toBe(30 * 60 * 1000); // plafond anti-DoS
    expect(s.perSecond.length).toBeLessThanOrEqual(30 * 60 + 1);
  });

  it("log vide : durée à 0, aucun point de série", () => {
    const s = computeScoreboard(base({ keystrokes: [], targetText: "the", modeValue: 1 }));
    expect(s.durationMs).toBe(0);
    expect(s.perSecond).toHaveLength(0);
  });
});

describe("computeScoreboard — cohérence avec un log RÉEL produit par FreeInput (issue #15)", () => {
  it("un log FreeInput (avec correction) rejoue à l'identique de l'état des mots de FreeInput", () => {
    const target = ["the", "cat"];
    const input = new FreeInput(target);
    const keystrokes: Keystroke[] = [];
    let t = 0;
    const type = (key: string) => {
      t += 100;
      const k = input.handleKey(key, false, t);
      if (k) keystrokes.push(k);
    };
    for (const c of "the") type(c);
    type(" ");
    type("c");
    type("x"); // faute à la position du 2e char de "cat"
    type("Backspace");
    type("a");
    type("t");

    // État des mots de FreeInput lui-même, indépendamment du scoreboard.
    expect(input.view()).toEqual({ wordIndex: 1, typed: "cat", lockedWords: ["the"] });

    const s = computeScoreboard(base({ targetText: target.join(" "), keystrokes }));
    // "the" + espace + "cat" (état final, la faute corrigée ne pèse plus) : 7 frappes
    // correctes ("t","h","e"," ","c","a","t"), la frappe "x" reste en incorrect.
    expect(s.characters).toEqual({ correct: 7, incorrect: 1, extra: 0, missed: 0 });
  });
});
