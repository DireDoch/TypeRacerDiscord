import { describe, it, expect } from "vitest";
import { normalizeCode, CODE_ALPHABET, CODE_LEN } from "./net";

describe("normalizeCode — saisie d'un Code de partie", () => {
  it("met en majuscules (un code se dicte, il s'entend sans casse)", () => {
    expect(normalizeCode("k7m2q")).toBe("K7M2Q");
  });

  it("retire les caractères que le serveur ne peut pas avoir tirés", () => {
    // 0, O, 1, I, L sont hors alphabet : ambigus à l'oral comme à l'écrit.
    expect(normalizeCode("K0O1IL")).toBe("K");
    expect(normalizeCode("K7-M2 Q")).toBe("K7M2Q");
  });

  it("tronque à CODE_LEN — un collage trop long ne bloque pas le champ", () => {
    expect(normalizeCode("K7M2QZZZ")).toHaveLength(CODE_LEN);
  });

  it("ne produit jamais que des caractères de l'alphabet", () => {
    const out = normalizeCode("aB3$éz9L1O0");
    expect([...out].every((c) => CODE_ALPHABET.includes(c))).toBe(true);
  });

  it("un code incomplet reste incomplet (le bouton Rejoindre s'y adosse)", () => {
    expect(normalizeCode("K7M").length).toBeLessThan(CODE_LEN);
    expect(normalizeCode("")).toBe("");
  });
});
