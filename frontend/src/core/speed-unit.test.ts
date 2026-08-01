import { describe, it, expect } from "vitest";
import { convertSpeed, formatSpeed, SPEED_UNITS } from "./speed-unit";

describe("convertSpeed — formules de l'issue #69", () => {
  it("wpm : identité", () => {
    expect(convertSpeed(80, "wpm")).toBe(80);
  });

  it("cpm = wpm × 5", () => {
    expect(convertSpeed(80, "cpm")).toBe(400);
  });

  it("wps = wpm ÷ 60", () => {
    expect(convertSpeed(120, "wps")).toBe(2);
  });

  it("cps = cpm ÷ 60", () => {
    expect(convertSpeed(120, "cps")).toBeCloseTo(10);
  });

  it("wph = wpm × 60", () => {
    expect(convertSpeed(80, "wph")).toBe(4800);
  });

  it("0 wpm converti reste 0 dans toutes les unités", () => {
    for (const unit of SPEED_UNITS) expect(convertSpeed(0, unit)).toBe(0);
  });
});

describe("formatSpeed — arrondi d'affichage", () => {
  it("wpm/cpm/wph : entier", () => {
    expect(formatSpeed(83.7, "wpm")).toBe("84 wpm");
    expect(formatSpeed(80, "cpm")).toBe("400 cpm");
  });

  it("wps/cps : une décimale, les petits nombres restent lisibles", () => {
    expect(formatSpeed(80, "wps")).toBe("1.3 wps");
    expect(formatSpeed(80, "cps")).toBe("6.7 cps");
  });
});
