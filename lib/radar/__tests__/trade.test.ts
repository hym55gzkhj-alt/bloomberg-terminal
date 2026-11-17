import { describe, expect, it } from "vitest";
import { simulateTrade } from "../backtest";
import { TRADE_RULES, tradeSetup } from "../trade";
import type { Bar, ComponentResult, TechnicalSnapshot } from "../types";

const snap = (o: Partial<TechnicalSnapshot>): TechnicalSnapshot => ({
  close: 100,
  sma20: 98,
  sma50: 95,
  sma200: 90,
  rsi14: 58,
  macd: 1,
  macdSignal: 0.5,
  macdHist: 0.5,
  atr14: 2,
  atrPct: 2,
  ret5: 1,
  ret20: 3,
  ret60: 6,
  ret120: 10,
  volRatio20: 1.2,
  volRatio50: 1.3,
  volZ50: 1,
  obvSlope20: 0.1,
  high52w: 130,
  distFrom52wHigh: -23,
  low52w: 70,
  distFromSma50: 5,
  distFromSma200: 11,
  bbWidthPctile: 0.5,
  ...o,
});
const comp = (key: ComponentResult["key"], dir: -1 | 0 | 1): ComponentResult => ({
  key,
  label: key,
  score: dir === 1 ? 0.7 : dir === -1 ? 0.3 : 0.5,
  direction: dir,
  facts: ["x"],
});
const noExt = { level: 0, penalty: 0, notes: [] };

describe("tradeSetup", () => {
  it("gives a LONG with ATR-based stop and targets for a positive, non-extended stock", () => {
    const t = tradeSetup({
      category: "BUILDING_MOMENTUM",
      score: 66,
      coverage: 1,
      technical: snap({}),
      extension: noExt,
      components: [comp("momentum", 1)],
    });
    expect(t.bias).toBe("LONG");
    expect(t.stop).toBeCloseTo(100 - TRADE_RULES.stopAtr * 2);
    expect(t.target2).toBeCloseTo(100 + TRADE_RULES.stopAtr * 2 * TRADE_RULES.target2R);
  });
  it("does not go long when the stock is already extended", () => {
    const t = tradeSetup({
      category: "STRONG_MOMENTUM",
      score: 75,
      coverage: 1,
      technical: snap({}),
      extension: { level: 0.8, penalty: 0, notes: ["x"] },
      components: [],
    });
    expect(t.bias).toBe("NEUTRAL");
    expect(t.entry).toBe(98);
  });
  it("gives a SHORT for a negative stock in a confirmed downtrend", () => {
    const t = tradeSetup({
      category: "NEGATIVE",
      score: 30,
      coverage: 1,
      technical: snap({
        close: 80,
        sma20: 84,
        sma50: 88,
        sma200: 95,
        rsi14: 40,
        distFromSma50: -9,
        atrPct: 2.5,
      }),
      extension: noExt,
      components: [comp("momentum", -1)],
    });
    expect(t.bias).toBe("SHORT");
    expect(t.stop).toBeGreaterThan(80);
    expect(t.target1).toBeLessThan(80);
  });
  it("does not short an oversold stock", () => {
    const t = tradeSetup({
      category: "NEGATIVE",
      score: 25,
      coverage: 1,
      technical: snap({
        close: 80,
        sma50: 88,
        sma200: 95,
        rsi14: 22,
        distFromSma50: -9,
        atrPct: 2.5,
      }),
      extension: noExt,
      components: [comp("momentum", -1)],
    });
    expect(t.bias).toBe("NEUTRAL");
  });
  it("does not short without a confirmed downtrend", () => {
    const t = tradeSetup({
      category: "NEGATIVE",
      score: 35,
      coverage: 1,
      technical: snap({}),
      extension: noExt,
      components: [comp("momentum", -1)],
    });
    expect(t.bias).toBe("NEUTRAL");
  });
});

describe("simulateTrade", () => {
  const bar = (d: number, o: number, h: number, l: number, c: number): Bar => ({
    t: d,
    date: `2024-01-${String(d).padStart(2, "0")}`,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: 1,
  });
  it("exits at the stop (long)", () => {
    const bars = [
      bar(1, 100, 101, 99, 100),
      bar(2, 100, 101, 95, 96),
      ...Array.from({ length: 25 }, (_, k) => bar(k + 3, 96, 97, 95, 96)),
    ];
    const t = simulateTrade(bars, 0, 1, 2, 0);
    expect(t.outcome).toBe("Stop");
    expect(t.exitPrice).toBe(96);
    expect(t.r).toBeCloseTo(-1);
  });
  it("exits at the target (short) and fills gaps at the open", () => {
    const bars = [
      bar(1, 100, 100.5, 99, 99),
      bar(2, 85, 86, 84, 85),
      ...Array.from({ length: 25 }, (_, k) => bar(k + 3, 85, 86, 84, 85)),
    ];
    const t = simulateTrade(bars, 0, -1, 2, 0);
    expect(t.outcome).toBe("Ziel");
    expect(t.exitPrice).toBe(85);
    expect(t.r).toBeGreaterThan(3);
  });
  it("assumes the stop first when stop and target are hit on the same bar", () => {
    const bars = [
      bar(1, 100, 120, 90, 100),
      ...Array.from({ length: 25 }, (_, k) => bar(k + 2, 100, 101, 99, 100)),
    ];
    expect(simulateTrade(bars, 0, 1, 2, 0).outcome).toBe("Stop");
  });
});
