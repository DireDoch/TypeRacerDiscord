import { describe, it, expect, vi, afterEach } from "vitest";
import { playErrorSound, playTimeWarningSound } from "./sound";

afterEach(() => vi.unstubAllGlobals());

describe("sound — pas d'échec sans Web Audio (pas de jsdom dans ce projet)", () => {
  it("ne lève pas quand AudioContext est absent", () => {
    expect(() => playErrorSound(0.5)).not.toThrow();
    expect(() => playTimeWarningSound(0.5)).not.toThrow();
  });

  it("volume nul ou négatif : jamais d'AudioContext instancié", () => {
    const ctor = vi.fn();
    vi.stubGlobal("AudioContext", ctor);
    playErrorSound(0);
    playTimeWarningSound(-1);
    expect(ctor).not.toHaveBeenCalled();
  });
});
