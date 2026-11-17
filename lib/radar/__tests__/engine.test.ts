/**
 * Unit tests for the signal engine. The price series below is a deterministic
 * mathematical test fixture (used ONLY in tests, never shown in the app).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, DEFAULT_WEIGHTS } from "../config";
import {
  extensionOf,
  momentumComponent,
  relativeStrengthComponent,
  volumeComponent,
} from "../engine";
import { computeSeries, snapshotAt } from "../indicators";
import { combine } from "../scoring";
import { scoreSentiment } from "../sentiment";
import type { Bar, ComponentResult } from "../types";

function fixture(n: number, drift: number, seed = 1): Bar[] {
  let x = seed;
  const rnd = () => {
    x = (x * 16807) % 2147483647;
    return x / 2147483647;
  };
  const bars: Bar[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p;
    p = p * (1 + drift + (rnd() - 0.5) * 0.03);
    const d = new Date(Date.UTC(2020, 0, 1) + i * 86400_000).toISOString().slice(0, 10);
    bars.push({
      t: i,
      date: d,
      open: o,
      high: Math.max(o, p) * 1.005,
      low: Math.min(o, p) * 0.995,
      close: p,
      volume: 1e6 * (0.7 + rnd() * 0.6),
    });
  }
  return bars;
}

describe("no look-ahead", () => {
  it("indicator snapshot at t is identical with and without future bars", () => {
    const bars = fixture(600, 0.0005);
    const full = computeSeries(bars);
    for (const i of [260, 333, 450, 520]) {
      const trunc = bars.slice(0, i + 1);
      const a = snapshotAt(bars, full, i);
      const b = snapshotAt(trunc, computeSeries(trunc), i);
      expect(a).toEqual(b);
    }
  });

  it("component scores at t are identical with and without future bars", () => {
    const bars = fixture(600, 0.0008, 7);
    const bench = fixture(600, 0.0003, 9);
    const i = 400;
    const ctxFull = { bars, series: computeSeries(bars) };
    const benchFull = { bars: bench, series: computeSeries(bench) };
    const tb = bars.slice(0, i + 1);
    const ctxT = { bars: tb, series: computeSeries(tb) };
    const sf = snapshotAt(bars, ctxFull.series, i);
    const st = snapshotAt(tb, ctxT.series, i);
    expect(volumeComponent(ctxFull, i, sf)).toEqual(volumeComponent(ctxT, i, st));
    expect(momentumComponent(ctxFull, i, sf)).toEqual(momentumComponent(ctxT, i, st));
    expect(relativeStrengthComponent(ctxFull, i, benchFull, "B")).toEqual(
      relativeStrengthComponent(ctxT, i, benchFull, "B")
    );
  });
});

describe("scoring", () => {
  const comp = (key: ComponentResult["key"], score: number | null): ComponentResult => ({
    key,
    label: key,
    score,
    direction: score == null ? 0 : score >= 0.58 ? 1 : score <= 0.42 ? -1 : 0,
    facts: [],
  });
  it("redistributes the weight of unavailable components", () => {
    const c = [comp("volume", 0.8), comp("momentum", 0.8), comp("news", null)];
    const r = combine(c, DEFAULT_WEIGHTS, { level: 0, penalty: 0, notes: [] });
    expect(r.score).toBeCloseTo(80);
    expect(r.coverage).toBeLessThan(1);
  });
  it("penalises an extended stock", () => {
    const c = ["volume", "relativeStrength", "momentum", "news", "marketSector"].map((k) =>
      comp(k as ComponentResult["key"], 0.8)
    );
    const fresh = combine(c, DEFAULT_WEIGHTS, { level: 0, penalty: 0, notes: [] });
    const late = combine(c, DEFAULT_WEIGHTS, { level: 1, penalty: 0, notes: [] });
    expect(fresh.category).toBe("STRONG_MOMENTUM");
    expect(late.score).toBeCloseTo(fresh.score - DEFAULT_CONFIG.maxExtensionPenalty);
  });
  it("detects extension after a strong run-up", () => {
    const bars = fixture(400, 0.006, 3);
    const s = computeSeries(bars);
    expect(extensionOf(snapshotAt(bars, s, 399)).level).toBeGreaterThan(0.5);
  });
});

describe("sentiment", () => {
  it("scores finance headlines and reports matched terms", () => {
    expect(scoreSentiment("Nvidia beats estimates and raises guidance").score).toBeGreaterThan(0);
    expect(scoreSentiment("Oracle cuts guidance, shares plunge").score).toBeLessThan(0);
    expect(scoreSentiment("Company holds annual meeting").score).toBe(0);
    expect(scoreSentiment("Apple upgraded to buy").hits.positive).toContain("upgraded");
  });
});

describe("universe ISINs", () => {
  it("every base universe entry has a valid ISIN (check digit)", async () => {
    const { BASE_UNIVERSE } = await import("../universe");
    const { isValidIsin } = await import("../isin");
    for (const e of BASE_UNIVERSE) {
      expect(e.isin, e.ticker).toBeTruthy();
      expect(isValidIsin(e.isin as string), `${e.ticker} ${e.isin}`).toBe(true);
    }
    expect(isValidIsin("US0378331006")).toBe(false);
  });
});
