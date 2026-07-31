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

describe("FreeInput — curseur libre", () => {
  it("verrouille les mots à l'espace", () => {
    const fi = new FreeInput(["the", "cat"]);
    play(fi, "the cat");
    expect(fi.view().lockedWords).toEqual(["the"]);
    expect(fi.view().typed).toBe("cat");
    expect(fi.isComplete()).toBe(true);
  });

  it("le backspace rouvre le mot précédent (avec ou sans erreur)", () => {
    const fi = new FreeInput(["the", "cat"]);
    play(fi, "the c"); // verrouille "the", buffer "c"
    play(fi, "<"); // efface "c" → buffer vide
    play(fi, "<"); // rouvre "the" : il redevient éditable
    expect(fi.view().lockedWords).toEqual([]);
    expect(fi.view().typed).toBe("the");
    play(fi, "<"); // on peut maintenant éditer ce mot pourtant correct
    expect(fi.view().typed).toBe("th");
  });

  it("le backspace au tout début ne fait rien", () => {
    const fi = new FreeInput(["the"]);
    const log = play(fi, "<"); // rien à effacer
    expect(log).toHaveLength(0);
    expect(fi.view().typed).toBe("");
  });

  it("Ctrl+Backspace en début de buffer supprime le mot précédent entier", () => {
    const fi = new FreeInput(["the", "cat"]);
    play(fi, "the "); // verrouille "the", buffer vide
    const k = fi.handleKey("Backspace", true, 500);
    expect(k).toEqual({ t: 500, k: "", ctrl: "backspace-word" });
    expect(fi.view().lockedWords).toEqual([]);
    expect(fi.view().typed).toBe(""); // mot précédent supprimé, pas rouvert
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

describe("FreeInput — stop on error (issue #65, Solo only)", () => {
  it("lettre : une frappe fausse est bloquée, jamais journalisée ni ajoutée au buffer", () => {
    const fi = new FreeInput(["the"], "letter");
    const k = fi.handleKey("x", false, 100); // 'x' au lieu de 't'
    expect(k).toBeNull();
    expect(fi.view().typed).toBe("");
  });

  it("lettre : une frappe correcte passe normalement", () => {
    const fi = new FreeInput(["the"], "letter");
    const log = play(fi, "the");
    expect(log).toHaveLength(3);
    expect(fi.view().typed).toBe("the");
  });

  it("lettre : bloque aussi un caractère en trop au-delà du mot cible", () => {
    const fi = new FreeInput(["hi"], "letter");
    play(fi, "hi");
    const k = fi.handleKey("x", false, 400); // le mot cible est déjà entièrement tapé
    expect(k).toBeNull();
    expect(fi.view().typed).toBe("hi");
  });

  it("mot : l'espace est bloqué tant que le mot courant n'est pas exact", () => {
    const fi = new FreeInput(["the", "cat"], "word");
    const log = play(fi, "th "); // mot incomplet, espace prématuré
    expect(log.at(-1)?.k).not.toBe(" "); // l'espace n'a pas été journalisé
    expect(fi.view().lockedWords).toEqual([]);
    expect(fi.view().typed).toBe("th");
  });

  it("mot : les erreurs restent libres À L'INTÉRIEUR du mot (seul l'espace bloque)", () => {
    const fi = new FreeInput(["the"], "word");
    play(fi, "txe"); // 'x' au lieu de 'h' : accepté quand même
    expect(fi.view().typed).toBe("txe");
  });

  it("mot : une fois corrigé, l'espace verrouille normalement", () => {
    const fi = new FreeInput(["the", "cat"], "word");
    play(fi, "txe"); // faute
    play(fi, "<<"); // corrige
    play(fi, "he ");
    expect(fi.view().lockedWords).toEqual(["the"]);
  });

  it("off (défaut) : aucun blocage, comportement inchangé", () => {
    const fi = new FreeInput(["the"]);
    const log = play(fi, "xhe");
    expect(log).toHaveLength(3);
    expect(fi.view().typed).toBe("xhe");
  });

  it("Zen (pas de texte cible) : jamais bloqué, quelle que soit la valeur", () => {
    const fi = new FreeInput([], "letter");
    const log = play(fi, "xyz");
    expect(log).toHaveLength(3);
    expect(fi.view().typed).toBe("xyz");
  });
});
