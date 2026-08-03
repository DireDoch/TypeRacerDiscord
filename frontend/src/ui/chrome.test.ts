import { describe, expect, it } from "vitest";
import { fitScale } from "./chrome";

describe("fitScale (#91)", () => {
  it("ne touche à rien quand le contenu tient", () => {
    expect(fitScale(400, 800)).toBe(1);
    expect(fitScale(800, 800)).toBe(1);
  });

  it("réduit juste ce qu'il faut quand le contenu déborde, marge comprise", () => {
    expect(fitScale(1000, 800)).toBeCloseTo(0.792);
  });

  it("réduit encore juste au-dessus du plancher", () => {
    expect(fitScale(1500, 800)).toBeCloseTo(0.528);
  });

  it("renonce à réduire ce qui ne tiendrait de toute façon pas", () => {
    // Une liste longue (Paramètres sur fenêtre basse) : la réduire au plancher ne la
    // ferait pas tenir, elle défilerait quand même — autant la garder lisible.
    expect(fitScale(10000, 800)).toBe(1);
  });

  it("survit à un contenu pas encore mesuré (0)", () => {
    expect(fitScale(0, 800)).toBe(1);
  });
});
