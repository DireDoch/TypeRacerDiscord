import { describe, it, expect } from "vitest";
import { computeScoreboard, type ScoreInput } from "./scoreboard";
import { FreeInput } from "../input/free-input";
import type { Keystroke } from "../types";
import vectorsFile from "../../../../test-vectors/scoreboard.json";

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

describe("computeScoreboard — Zen et éligibilité PB", () => {
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

  it("Trigram Drill exclu des PB (ADR 0005) : même règle que Drill, texte personnalisé", () => {
    const k = log([100, "a"]);
    expect(computeScoreboard(base({ mode: "trigram-drill", modeValue: 0, keystrokes: k })).pbEligible).toBe(false);
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

describe("computeScoreboard — divergence TS/Rust connue, non résolue ici (issue #19)", () => {
  // Durée négative (Time, modeValue < 0) : l'issue #19 la documentait comme divergente
  // (WPM négatif en TS, nul en Rust). Vérifié : déjà clos par le fix #11 — resolveDuration
  // ne renvoie `modeValue * 1000` QUE si modeValue > 0 ; sinon (0 ou négatif) elle dérive
  // du dernier t du log, toujours clampée ≥ 0, des deux côtés. Voir le vecteur
  // "time_infini_ou_negatif_derive_du_log" dans test-vectors/scoreboard.json — les deux
  // ports s'accordent déjà, rien à documenter comme divergent ici.

  it("émoji en Zen : ignoré côté TS (UTF-16), compté côté Rust (codepoints)", () => {
    // "😀".length === 2 en UTF-16 (JS) : k.k.length===1 est faux → la frappe est ignorée.
    // Rust compte les codepoints (clen("😀") === 1) → la frappe est acceptée et comptée.
    // Documente le bug, ne le corrige pas ici (issue #19).
    const s = computeScoreboard({ mode: "zen", modeValue: 0, targetText: "", keystrokes: log([100, "😀"]) });
    expect(s.characters).toEqual({ correct: 0, incorrect: 0, extra: 0, missed: 0 }); // frappe ignorée
  });
});

// ----------------------------------------------------------------------------
//  Vecteurs de parité TS/Rust (issue #19) — lus tels quels par replay.rs.
//  Un cas ajouté ou changé ici fait échouer les DEUX ports s'ils divergent.
// ----------------------------------------------------------------------------

interface VectorExpected {
  wpm?: number;
  raw?: number;
  accuracy?: number;
  characters?: { correct: number; incorrect: number; extra: number; missed: number };
  durationMs?: number;
  pbEligible?: boolean;
  perSecond?: unknown[];
}

interface VectorCase {
  name: string;
  mode: ScoreInput["mode"];
  modeValue: number;
  targetText: string;
  keystrokes: Keystroke[];
  expected: VectorExpected;
}

const vectors = vectorsFile as unknown as { cases: VectorCase[] };

describe("computeScoreboard — vecteurs de parité TS/Rust (issue #19)", () => {
  for (const c of vectors.cases) {
    it(c.name, () => {
      const s = computeScoreboard({
        mode: c.mode,
        modeValue: c.modeValue,
        targetText: c.targetText,
        keystrokes: c.keystrokes,
      });
      const e = c.expected;
      if (e.wpm !== undefined) expect(s.wpm).toBe(e.wpm);
      if (e.raw !== undefined) expect(s.raw).toBe(e.raw);
      if (e.accuracy !== undefined) expect(s.accuracy).toBe(e.accuracy);
      if (e.characters !== undefined) expect(s.characters).toEqual(e.characters);
      if (e.durationMs !== undefined) expect(s.durationMs).toBe(e.durationMs);
      if (e.pbEligible !== undefined) expect(s.pbEligible).toBe(e.pbEligible);
      if (e.perSecond !== undefined) expect(s.perSecond).toEqual(e.perSecond);
    });
  }
});
