import { describe, it, expect } from "vitest";
import { raceWordHtml } from "./race";

/** Classe appliquée à chaque caractère TAPÉ (dans l'ordre), pour vérifier la cascade. */
function typedClasses(html: string): string[] {
  return [...html.matchAll(/<span class="(correct|incorrect|extra)">/g)].map((m) => m[1]);
}

describe("raceWordHtml — cascade TypeRacer", () => {
  it("tout correct : que des 'correct'", () => {
    expect(typedClasses(raceWordHtml("the", "the", false))).toEqual(["correct", "correct", "correct"]);
  });

  it("dès la 1re faute, tout ce qui suit est rouge — même un char juste par hasard", () => {
    // cible "the", tapé "txe" : t ok, x faux, e (=cible) mais APRÈS la faute → incorrect.
    expect(typedClasses(raceWordHtml("the", "txe", false))).toEqual(["correct", "incorrect", "incorrect"]);
  });

  it("caractères au-delà de la cible : 'extra' (rouge aussi)", () => {
    expect(typedClasses(raceWordHtml("hi", "hixx", false))).toEqual(["correct", "correct", "extra", "extra"]);
  });

  it("préfixe correct incomplet : pas d'erreur, le reste non tapé reste untyped", () => {
    const html = raceWordHtml("the", "th", false);
    expect(typedClasses(html)).toEqual(["correct", "correct"]);
    expect(html).toContain('class="untyped"');
  });
});
