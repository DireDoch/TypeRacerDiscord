import { describe, it, expect } from "vitest";
import { FreeInput } from "../core/input/free-input";
import { feedUntil } from "./replay";
import type { KeystrokeLog } from "../core/types";

// « cx<a t » sur la cible ["ca","t"] : faute, correction, espace, dernier mot.
const log: KeystrokeLog = [
  { t: 100, k: "c" },
  { t: 200, k: "x" },
  { t: 300, k: "", ctrl: "backspace" },
  { t: 400, k: "a" },
  { t: 500, k: " " },
  { t: 600, k: "t" },
];

describe("feedUntil — relecture du Keystroke log", () => {
  it("ne rejoue que les frappes dues à l'instant demandé (faute visible)", () => {
    const c = new FreeInput(["ca", "t"]);
    const i = feedUntil(c, log, 0, 250);
    expect(i).toBe(2);
    expect(c.view()).toEqual({ wordIndex: 0, typed: "cx", lockedWords: [] });
  });

  it("reprend où il était et rejoue backspace, espace et fin de mot", () => {
    const c = new FreeInput(["ca", "t"]);
    const mid = feedUntil(c, log, 0, 250);
    const end = feedUntil(c, log, mid, 10_000);
    expect(end).toBe(log.length);
    expect(c.view()).toEqual({ wordIndex: 1, typed: "t", lockedWords: ["ca"] });
    expect(c.isComplete()).toBe(true);
  });

  it("rejoue backspace-word comme un Ctrl+Backspace", () => {
    const c = new FreeInput(["ca", "t"]);
    const wipe: KeystrokeLog = [...log, { t: 700, k: "", ctrl: "backspace-word" }];
    feedUntil(c, wipe, 0, 10_000);
    expect(c.view()).toEqual({ wordIndex: 1, typed: "", lockedWords: ["ca"] });
  });
});
