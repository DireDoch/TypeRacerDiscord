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

describe("BlockingInput — curseur non libre", () => {
  it("verrouille un mot exact à l'espace", () => {
    const bi = new BlockingInput(["the", "cat"]);
    play(bi, "the cat");
    expect(bi.view().lockedWords).toEqual(["the"]);
    expect(bi.view().typed).toBe("cat");
    expect(bi.isComplete()).toBe(true);
  });

  it("une frappe fautive est acceptée une fois puis bloque l'avance", () => {
    const bi = new BlockingInput(["the"]);
    const log = play(bi, "thx"); // 'x' fautif accepté
    expect(bi.view().typed).toBe("thx");
    expect(log).toHaveLength(3);
    // Bloqué : toute frappe suivante est ignorée tant que non corrigée.
    const log2 = play(bi, "eee");
    expect(log2).toHaveLength(0);
    expect(bi.view().typed).toBe("thx");
  });

  it("le backspace corrige l'erreur et débloque", () => {
    const bi = new BlockingInput(["the"]);
    play(bi, "thx");
    play(bi, "<"); // corrige → "th"
    expect(bi.view().typed).toBe("th");
    const log = play(bi, "e"); // débloqué, 'e' accepté
    expect(log).toHaveLength(1);
    expect(bi.isComplete()).toBe(true);
  });

  it("aucun Extra : le buffer ne dépasse jamais la longueur cible", () => {
    const bi = new BlockingInput(["hi"]);
    play(bi, "hi"); // mot complet
    const log = play(bi, "xxxx"); // frappes au-delà : toutes ignorées
    expect(bi.view().typed).toBe("hi");
    expect(log).toHaveLength(0);
  });

  it("l'espace n'avance pas sur un mot incomplet ou en erreur", () => {
    const bi = new BlockingInput(["the", "cat"]);
    play(bi, "th "); // incomplet : espace ignoré
    expect(bi.view().lockedWords).toEqual([]);
    expect(bi.view().typed).toBe("th");
    play(bi, "x "); // erreur en attente : espace ignoré
    expect(bi.view().lockedWords).toEqual([]);
  });

  it("pas de retour aux mots précédents une fois verrouillés", () => {
    const bi = new BlockingInput(["the", "cat"]);
    play(bi, "the "); // verrouille "the", buffer vide
    const log = play(bi, "<"); // rien à effacer, pas de retour arrière
    expect(log).toHaveLength(0);
    expect(bi.view().lockedWords).toEqual(["the"]);
    expect(bi.view().typed).toBe("");
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
});
