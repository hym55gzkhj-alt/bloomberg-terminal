import { describe, expect, it } from "vitest";
import { mulberry32, runTimeMachine, verdictOf } from "../timemachine";
import type { Bar } from "../types";

/** Deterministic synthetic daily bars: random walk with ~2 % daily range. */
function bars(n: number, drift = 0, seed = 1): Bar[] {
  const rnd = mulberry32(seed);
  const out: Bar[] = [];
  let c = 100;
  for (let i = 0; i < n; i++) {
    const o = c * (1 + (rnd() - 0.5) * 0.01);
    const close = o * (1 + drift + (rnd() - 0.5) * 0.03);
    const high = Math.max(o, close) * (1 + rnd() * 0.01);
    const low = Math.min(o, close) * (1 - rnd() * 0.01);
    const d = new Date(Date.UTC(2025, 0, 1 + i));
    out.push({
      t: d.getTime() / 1000,
      date: d.toISOString().slice(0, 10),
      open: o,
      high,
      low,
      close,
      volume: 1e6,
    });
    c = close;
  }
  return out;
}

const plan = { direction: 1 as const, entry: 100, stop: 96, target: 106, target1: 102 };

describe("runTimeMachine", () => {
  it("is reproducible with the same seed and changes with another", () => {
    const b = bars(300);
    const a = runTimeMachine(b, plan, { replays: 2000, seed: 19 });
    const c = runTimeMachine(b, plan, { replays: 2000, seed: 19 });
    const d = runTimeMachine(b, plan, { replays: 2000, seed: 7 });
    expect(a.pTarget).toBe(c.pTarget);
    expect(a.avgR).toBe(c.avgR);
    expect(d.pTarget === a.pTarget && d.avgR === a.avgR).toBe(false);
  });

  it("odds add up and bands start at the entry", () => {
    const r = runTimeMachine(bars(300), plan, { replays: 3000 });
    expect(r.pTarget + r.pStop + r.pNeither).toBeCloseTo(1, 10);
    expect(r.bands).toHaveLength(r.maxDays + 1);
    expect(r.bands[0].p50).toBe(100);
    expect(r.pTarget1).not.toBeNull();
    expect(r.pTarget1 as number).toBeGreaterThanOrEqual(r.pTarget);
    expect(r.histogram.reduce((a, h) => a + h.count, 0)).toBe(3000);
    expect(r.targetR).toBeCloseTo(1.5, 10);
    expect(r.poolDays).toBe(250);
  });

  it("strong uptrend favours a long target, a short gets stopped", () => {
    const up = bars(300, 0.01);
    const long = runTimeMachine(up, plan, { replays: 3000 });
    expect(long.pTarget).toBeGreaterThan(long.pStop);
    expect(["lean_target", "strong_target"]).toContain(long.lean);
    const short = runTimeMachine(
      up,
      { direction: -1, entry: 100, stop: 104, target: 94 },
      { replays: 3000 }
    );
    expect(short.pStop).toBeGreaterThan(short.pTarget);
    expect(short.lean).toBe("strong_stop");
  });

  it("refuses invalid plans and short histories", () => {
    expect(() => runTimeMachine(bars(300), { ...plan, stop: 101 })).toThrow(/falschen Seite/);
    expect(() => runTimeMachine(bars(40), plan)).toThrow(/Zu wenig Kurshistorie/);
  });

  it("a stop hit counts as at most -1R before costs unless it gaps", () => {
    const r = runTimeMachine(bars(300), plan, { replays: 2000, costBps: 0 });
    expect(r.histogram[0].from).toBeGreaterThanOrEqual(-1.6);
  });
});

describe("verdictOf", () => {
  it("weighs the target R (break-even 1/(1+R))", () => {
    // 2R plan, 24.1 % target vs 50.5 % stop: share 32 % vs break-even 33 % -> close to break-even
    const v = verdictOf(0.241, 0.505, 0.254, -0.1, 2, 20);
    expect(v.lean).toBe("breakeven");
    expect(v.breakEven).toBeCloseTo(1 / 3, 10);
    expect(v.verdict).toMatch(/^Nahe an der Gewinnschwelle/);
  });
  it("1R coin flip and the many-neither note", () => {
    const v = verdictOf(0.294, 0.255, 0.451, 0.034, 1, 20);
    expect(v.lean).toBe("coin");
    expect(v.notes[0]).toMatch(/weder Ziel noch Stop/);
  });
  it("flags an average R against the lean", () => {
    const v = verdictOf(0.3, 0.1, 0.6, -0.2, 1, 20);
    expect(v.lean).toBe("strong_target");
    expect(v.notes.some((n) => n.includes("Gegenrichtung"))).toBe(true);
  });
  it("no side reached", () => {
    expect(verdictOf(0, 0, 1, 0, 1, 20).lean).toBe("none");
  });
});
