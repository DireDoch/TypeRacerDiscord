import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Countdown } from "./countdown";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Countdown", () => {
  it("tick immédiat puis un par seconde, onDone une fois à 0", () => {
    const ticks: number[] = [];
    let done = 0;
    new Countdown(3, (n) => ticks.push(n), () => done++).start();

    expect(ticks).toEqual([3]);
    vi.advanceTimersByTime(1000);
    expect(ticks).toEqual([3, 2]);
    vi.advanceTimersByTime(1000);
    expect(ticks).toEqual([3, 2, 1]);
    expect(done).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(done).toBe(1);
    expect(ticks).toEqual([3, 2, 1]); // pas de tick à 0 : onDone remplace le dernier tick
  });

  it("cancel() arrête la chaîne : plus aucun tick ni onDone après", () => {
    const ticks: number[] = [];
    let done = 0;
    const c = new Countdown(3, (n) => ticks.push(n), () => done++);
    c.start();
    vi.advanceTimersByTime(1000); // tick à 2
    c.cancel();
    vi.advanceTimersByTime(10_000);
    expect(ticks).toEqual([3, 2]);
    expect(done).toBe(0);
  });

  it("cancel() est idempotent (sûr à appeler plusieurs fois, avant ou après start)", () => {
    const c = new Countdown(3, () => {}, () => {});
    expect(() => {
      c.cancel();
      c.cancel();
      c.start();
      c.cancel();
      c.cancel();
    }).not.toThrow();
  });
});
