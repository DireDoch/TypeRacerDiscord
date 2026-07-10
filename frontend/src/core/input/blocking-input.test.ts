import { describe, it, expect } from "vitest";
import { BlockingInput } from "./blocking-input";
import type { Keystroke } from "../types";

/** Tape une chaîne ; " " = espace, "<" = backspace. Renvoie le log produit. */
function play(bi: BlockingInput, s: string): Keystroke[] {
  const log: Keystroke[] = [];
  let t = 0;
  for (const ch of s) {
    t += 100;
    const k = bi.handleKey(ch === "<" ? "Backspace" : ch, false, t);
    if (k) log.push(k);
  }
  return log;
}

describe("BlockingInput — TypeRacer (mot exact pour avancer)", () => {
  it("verrouille un mot exact à l'espace", () => {
    const bi = new BlockingInput(["the", "cat"]);
    play(bi, "the cat");
    expect(bi.view().lockedWords).toEqual(["the"]);
    expect(bi.view().typed).toBe("cat");
    expect(bi.isComplete()).toBe(true);
  });

  it("saisie libre dans le mot : les fautes sont acceptées (rendu rouge) et journalisées", () => {
    const bi = new BlockingInput(["the"]);
    const log = play(bi, "txe"); // 'x' fautif accepté, on continue à taper
    expect(bi.view().typed).toBe("txe");
    expect(log).toHaveLength(3);
  });

  it("l'espace n'avance PAS sur un mot inexact — il faut corriger", () => {
    const bi = new BlockingInput(["the", "cat"]);
    play(bi, "txe "); // faute + espace : refusé
    expect(bi.view().lockedWords).toEqual([]);
    expect(bi.view().typed).toBe("txe");
    // Corrige l'erreur puis avance.
    play(bi, "<<he "); // efface "xe", tape "he" → "the", espace verrouille
    expect(bi.view().lockedWords).toEqual(["the"]);
    expect(bi.view().typed).toBe("");
  });

  it("espace sur mot incomplet (mais correct) : refusé aussi", () => {
    const bi = new BlockingInput(["the"]);
    const log = play(bi, "th "); // préfixe correct mais incomplet
    expect(bi.view().typed).toBe("th");
    expect(log).toHaveLength(2); // les 2 lettres seulement, pas l'espace
  });

  it("pas de retour aux mots précédents une fois verrouillés", () => {
    const bi = new BlockingInput(["the", "cat"]);
    play(bi, "the "); // verrouille "the", buffer vide
    const log = play(bi, "<"); // rien à effacer, pas de retour arrière
    expect(log).toHaveLength(0);
    expect(bi.view().lockedWords).toEqual(["the"]);
    expect(bi.view().typed).toBe("");
  });

  it("plafonne les caractères fautifs mais journalise quand même", () => {
    const bi = new BlockingInput(["hi"]); // maxBuffer = 2 + max(4,2) = 6
    const log = play(bi, "hixxxxxxxx"); // 8 extra → buffer coupé à 6
    expect(bi.view().typed).toHaveLength(6);
    expect(log).toHaveLength(10); // toutes les frappes restent dans le log
  });

  it("Ctrl+Backspace vide le mot courant mais pas les précédents", () => {
    const bi = new BlockingInput(["hello", "world"]);
    play(bi, "hello hel");
    const k = bi.handleKey("Backspace", true, 999);
    expect(k).toEqual({ t: 999, k: "", ctrl: "backspace-word" });
    expect(bi.view().typed).toBe("");
    expect(bi.view().lockedWords).toEqual(["hello"]);
    // buffer déjà vide : Ctrl+Backspace ne remonte pas au mot précédent
    expect(bi.handleKey("Backspace", true, 1000)).toBeNull();
    expect(bi.view().lockedWords).toEqual(["hello"]);
  });

  it("isComplete exige le dernier mot EXACT", () => {
    const bi = new BlockingInput(["go"]);
    play(bi, "gx"); // faute sur le dernier mot
    expect(bi.isComplete()).toBe(false);
    play(bi, "<o"); // corrige → "go"
    expect(bi.isComplete()).toBe(true);
  });
});
