import { describe, it, expect } from "vitest";
import { shouldRenderFrame } from "./fps";

describe("shouldRenderFrame — issue #70", () => {
  it("natif (0) : toujours vrai, quel que soit l'écart", () => {
    expect(shouldRenderFrame(0, 1, 0)).toBe(true);
    expect(shouldRenderFrame(1000, 1000, 0)).toBe(true);
  });

  it("plafonné : faux tant que l'intervalle minimal n'est pas écoulé", () => {
    // 30 fps → ~33.3 ms entre deux images.
    expect(shouldRenderFrame(1000, 1010, 30)).toBe(false);
    expect(shouldRenderFrame(1000, 1034, 30)).toBe(true);
  });

  it("frontière inclusive : l'intervalle minimal atteint ou dépassé rend", () => {
    expect(shouldRenderFrame(1000, 1017, 60)).toBe(true); // 1000/60 ≈ 16.67 ms
  });
});
