import { describe, it, expect } from "vitest";
import { FreeInput } from "./free-input";
import type { Keystroke } from "../types";

/** Tape une chaîne ; " " = espace, "<" = backspace. Renvoie le log produit. */
function play(fi: FreeInput, s: string): Keystroke[] {
  const log: Keystroke[] = [];
  let t = 0;
  for (const ch of s) {
    t += 100;
    const k = fi.handleKey(ch === "<" ? "Backspace" : ch, false, t);
    if (k) log.push(k);
  }
  return log;
}

describe("FreeInput — curseur borné au mot", () => {
  it("verrouille les mots à l'espace", () => {
    const fi = new FreeInput(["the", "cat"]);
    play(fi, "the cat");
    expect(fi.view().lockedWords).toEqual(["the"]);
    expect(fi.view().typed).toBe("cat");
    expect(fi.isComplete()).toBe(true);
  });

  it("le backspace ne franchit pas un mot verrouillé", () => {
    const fi = new FreeInput(["the", "cat"]);
    play(fi, "the c<<<<<"); // 5 backspaces : ne doit effacer que "c"
    expect(fi.view().lockedWords).toEqual(["the"]);
    expect(fi.view().typed).toBe("");
  });

  it("ignore l'espace en tête / double espace", () => {
    const fi = new FreeInput(["hi"]);
    const log = play(fi, " ");
    expect(log).toHaveLength(0);
    expect(fi.view().lockedWords).toEqual([]);
  });

  it("Ctrl+Backspace efface le mot courant entier", () => {
    const fi = new FreeInput(["hello"]);
    play(fi, "hel");
    const k = fi.handleKey("Backspace", true, 999);
    expect(k).toEqual({ t: 999, k: "", ctrl: "backspace-word" });
    expect(fi.view().typed).toBe("");
  });

  it("plafonne le buffer d'Extra mais journalise quand même les frappes", () => {
    const fi = new FreeInput(["hi"]); // maxBuffer = 2 + max(4,2) = 6
    const log = play(fi, "hixxxxxxxx"); // 8 extra → buffer coupé à 6
    expect(fi.view().typed).toHaveLength(6);
    expect(log).toHaveLength(10); // toutes les frappes restent dans le log
  });
});
