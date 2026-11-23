import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESK,
  type DeskPlan,
  addTradingDays,
  fxRate,
  orderTicket,
  riskCheck,
  sizePosition,
} from "../desk";

// The reel's trade from the day-trader skill: $5,000 account, $50 max loss, TSLA
const tsla: DeskPlan = {
  ticker: "TSLA",
  direction: 1,
  entry: 364.18,
  stop: 358.32,
  target1: 370.04,
  target2: 375.9,
  currency: "USD",
  fx: 1,
};
const usd = {
  ...DEFAULT_DESK,
  accountCurrency: "USD" as const,
  maxPositionPct: 75,
  maxOrder: 4000,
  minRewardRisk: 1,
};

describe("sizePosition", () => {
  it("sizes the reel trade to 8 shares by max loss", () => {
    const s = sizePosition(tsla, usd);
    expect(s.shares).toBe(8);
    expect(s.limit).toBe("Max. Verlust");
    expect(s.positionValue).toBeCloseTo(2913.44, 2);
    expect(s.lossAtStop).toBeCloseTo(46.88, 2);
    expect(s.rewardRisk).toBeCloseTo(1, 6);
  });

  it("caps by position size and converts currency", () => {
    const s = sizePosition(
      { ...tsla, fx: 1 / 1.25 },
      { ...DEFAULT_DESK, maxLossPerTrade: 10_000, maxPositionPct: 20 }
    );
    // 20 % of 5000 EUR = 1000 EUR; entry 364.18 USD = 291.34 EUR -> 3 shares
    expect(s.shares).toBe(3);
    expect(s.limit).toBe("Positionsgrenze");
    expect(s.positionValue).toBeCloseTo((3 * 364.18) / 1.25, 6);
  });

  it("zero shares when the stop is too far for the max loss", () => {
    const s = sizePosition({ ...tsla, stop: 300 }, { ...usd, maxLossPerTrade: 50 });
    expect(s.shares).toBe(0);
    const r = riskCheck({ ...tsla, stop: 300 }, s, usd);
    expect(r.verdict).toBe("BLOCK");
    expect(r.checks.find((c) => c.rule === "Stückzahl")?.detail).toMatch(/zu weit/);
  });
});

describe("riskCheck", () => {
  it("passes the reel trade", () => {
    const s = sizePosition(tsla, usd);
    const r = riskCheck(tsla, s, usd);
    expect(r.verdict).toBe("PASS");
  });

  it("blocks reward:risk below the minimum", () => {
    const cfg = { ...usd, minRewardRisk: 1.5 };
    const r = riskCheck(tsla, sizePosition(tsla, cfg), cfg);
    expect(r.verdict).toBe("BLOCK");
    expect(r.checks.find((c) => c.rule === "Chance/Risiko")?.status).toBe("block");
  });

  it("blocks shorts unless allowed, blocked tickers, earnings and a strong-stop time machine", () => {
    const short: DeskPlan = {
      ...tsla,
      direction: -1,
      stop: 370.04,
      target1: 358.32,
      target2: 352.46,
    };
    expect(riskCheck(short, sizePosition(short, usd), usd).verdict).toBe("BLOCK");
    expect(riskCheck(short, sizePosition(short, usd), { ...usd, allowShort: true }).verdict).toBe(
      "PASS"
    );
    expect(riskCheck(tsla, sizePosition(tsla, usd), { ...usd, blocked: ["tsla"] }).verdict).toBe(
      "BLOCK"
    );
    const today = new Date().toISOString().slice(0, 10);
    const ctx = { earningsDate: today, horizonEnd: addTradingDays(today, 20) };
    expect(riskCheck(tsla, sizePosition(tsla, usd), usd, ctx).verdict).toBe("BLOCK");
    expect(
      riskCheck(tsla, sizePosition(tsla, usd), { ...usd, blockEarnings: false }, ctx).verdict
    ).toBe("PASS");
    const tm = { timeMachineLean: "strong_stop", timeMachineVerdict: "Deutlich Richtung Stop" };
    expect(riskCheck(tsla, sizePosition(tsla, usd), usd, tm).verdict).toBe("BLOCK");
    expect(
      riskCheck(tsla, sizePosition(tsla, usd), usd, { timeMachineLean: "lean_stop" }).verdict
    ).toBe("PASS");
  });

  it("warns on a missing exchange rate", () => {
    const p = { ...tsla, currency: "GBp", fx: null };
    const r = riskCheck(p, sizePosition(p, DEFAULT_DESK), DEFAULT_DESK);
    expect(r.checks.find((c) => c.rule === "Währung")?.status).toBe("warn");
  });
});

describe("helpers", () => {
  it("fxRate", () => {
    expect(fxRate("EUR", "EUR", null)).toBe(1);
    expect(fxRate("USD", "EUR", 1.25)).toBeCloseTo(0.8, 10);
    expect(fxRate("EUR", "USD", 1.25)).toBe(1.25);
    expect(fxRate("USD", "EUR", null)).toBeNull();
    expect(fxRate("CHF", "EUR", 1.1)).toBeNull();
  });
  it("addTradingDays skips weekends", () => {
    expect(addTradingDays("2026-11-20", 1)).toBe("2026-11-23"); // Fri -> Mon
    expect(addTradingDays("2026-11-23", 5)).toBe("2026-11-30");
  });
  it("orderTicket", () => {
    const t = orderTicket(tsla, sizePosition(tsla, usd), usd);
    expect(t).toContain("KAUF 8 × TSLA");
    expect(t).toContain("358.32 USD");
  });
});
