// =============================================================================
//  run-session.test.ts — l'ASSEMBLAGE d'une Run tapée (#199).
//
//  Les briques ont déjà leurs tests (clock, free-input, difficulty). Ici on teste ce
//  qui n'était testé nulle part : quel événement cale t=0, ce qui entre au log et dans
//  quel ordre, ce qu'une frappe anticipée devient. Sans DOM, sans réseau.
// =============================================================================

import { describe, it, expect } from "vitest";
import { RunSession, isTypingKey } from "./run-session";

const type = (s: RunSession, text: string): void => {
  for (const ch of text) s.press(ch, false);
};

describe("isTypingKey — ce qu'une Run journalise (CONTEXT.md « Keystroke log »)", () => {
  it("imprimables, espace et Backspace", () => {
    for (const k of ["a", "Z", "1", "!", " ", "é", "Backspace"]) expect(isTypingKey(k)).toBe(true);
  });

  it("pas la navigation au curseur ni les modificateurs", () => {
    for (const k of ["ArrowLeft", "Home", "End", "Shift", "Control", "Tab", "Enter", "Escape"]) {
      expect(isTypingKey(k)).toBe(false);
    }
  });
});

describe("origine du temps — deux cas, un seul mécanisme (CONTEXT.md)", () => {
  it("solo : la 1re frappe cale t=0, et elle COMPTE déjà (ADR 0004)", () => {
    const s = new RunSession(["abc"]);
    expect(s.started).toBe(false);
    const step = s.press("a", false);
    expect(s.started).toBe(true);
    expect(step?.keystroke?.k).toBe("a");
    expect(s.log).toHaveLength(1);
  });

  it("solo : t=0 est la 1re frappe, donc elle est journalisée à ~0 ms", () => {
    const s = new RunSession(["abc"]);
    const step = s.press("a", false);
    expect(step?.at).toBeGreaterThanOrEqual(0);
    expect(step?.at).toBeLessThan(50); // pas le temps écoulé depuis la construction
  });

  it("Race : sans start(), une frappe anticipée est REFUSÉE et n'ouvre pas le chrono", () => {
    const s = new RunSession(["abc"]);
    expect(s.press("a", false, true)).toBeNull();
    expect(s.started).toBe(false);
    expect(s.log).toHaveLength(0);
  });

  it("Race : après start(), les frappes entrent normalement", () => {
    const s = new RunSession(["abc"]);
    s.start();
    expect(s.press("a", false, true)).not.toBeNull();
    expect(s.log).toHaveLength(1);
  });

  it("`elapsed` vaut 0 avant le départ, au lieu de lever", () => {
    expect(new RunSession(["abc"]).elapsed).toBe(0);
  });
});

describe("le log — ce qui y entre, et dans quel ordre", () => {
  it("l'ordre du log est l'ordre des frappes, espaces compris", () => {
    const s = new RunSession(["ab", "cd"]);
    type(s, "ab cd");
    expect(s.log.map((k) => k.k)).toEqual(["a", "b", " ", "c", "d"]);
  });

  it("un Backspace est journalisé comme contrôle, jamais comme caractère", () => {
    const s = new RunSession(["ab"]);
    type(s, "ax");
    s.press("Backspace", false);
    const last = s.log[s.log.length - 1];
    expect(last.ctrl).toBe("backspace");
    expect(last.k).toBe("");
  });

  it("Ctrl+Backspace est un contrôle distinct (mot entier)", () => {
    const s = new RunSession(["ab", "cd"]);
    type(s, "ab ");
    s.press("Backspace", true);
    expect(s.log[s.log.length - 1].ctrl).toBe("backspace-word");
  });

  it("une frappe ignorée ne pousse rien — le log reste le reflet du réel", () => {
    const s = new RunSession(["ab"]);
    const step = s.press("Backspace", false); // début de buffer, rien à effacer
    expect(step?.keystroke).toBeNull();
    expect(s.log).toHaveLength(0);
  });

  it("les instants du log ne reculent jamais", () => {
    const s = new RunSession(["ab", "cd"]);
    type(s, "ab cd");
    const ts = s.log.map((k) => k.t);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });
});

describe("la vue avant/après — ce dont Practice a besoin pour le Burst et le son", () => {
  it("`before` est l'état AVANT la frappe, `after` celui d'après", () => {
    const s = new RunSession(["ab"]);
    s.press("a", false);
    const step = s.press("b", false);
    expect(step?.before.typed).toBe("a");
    expect(step?.after.typed).toBe("ab");
  });

  it("un espace verrouille le mot : l'index avance entre before et after", () => {
    const s = new RunSession(["ab", "cd"]);
    type(s, "ab");
    const step = s.press(" ", false);
    expect(step?.before.wordIndex).toBe(0);
    expect(step?.after.wordIndex).toBe(1);
  });
});

describe("fin du texte cible", () => {
  it("`complete` bascule quand tout le texte est tapé", () => {
    const s = new RunSession(["ab", "cd"]);
    type(s, "ab ");
    expect(s.press("c", false)?.complete).toBe(false);
    expect(s.press("d", false)?.complete).toBe(true);
  });
});

describe("Difficulté — évaluée sur le log, jamais sur le contrôleur (ADR 0013)", () => {
  it("Normal ne fait jamais échouer, même en tapant tout de travers", () => {
    const s = new RunSession(["ab", "cd"], "normal");
    for (const ch of "xy zw") expect(s.press(ch, false)?.failure).toBeNull();
  });

  it("Master échoue à la TOUTE première frappe incorrecte", () => {
    const s = new RunSession(["ab"], "master");
    expect(s.press("a", false)?.failure).toBeNull();
    expect(s.press("x", false)?.failure).not.toBeNull();
  });

  it("Expert échoue au mot validé avec une faute non corrigée, pas avant", () => {
    const s = new RunSession(["ab", "cd"], "expert");
    type(s, "ax");
    expect(s.view().typed).toBe("ax"); // le flux n'est pas bloqué
    expect(s.press(" ", false)?.failure).not.toBeNull();
  });

  it("Zen (aucun texte cible) n'échoue jamais — rien à être « juste » contre", () => {
    const s = new RunSession([], "master");
    type(s, "n'importe quoi");
    expect(s.log.length).toBeGreaterThan(0);
    expect(s.press("!", false)?.failure).toBeNull();
  });
});

describe("texte qui s'allonge en cours de Run (Spam, Time infini)", () => {
  it("pousser dans le tableau cible suffit — ni pile ni log perdus", () => {
    const words = ["go", "go"];
    const s = new RunSession(words);
    type(s, "go go");
    expect(s.view().lockedWords).toEqual(["go"]);
    words.push("go", "go"); // le MÊME tableau, par référence — rien à reconstruire
    type(s, " go");
    expect(s.view().lockedWords).toEqual(["go", "go"]);
    expect(s.view().typed).toBe("go");
    expect(s.log.filter((k) => k.k === "g")).toHaveLength(3);
  });
});
