import { cached } from "./cache";
import { CATEGORY_RANK, DEFAULT_CONFIG, DEFAULT_WEIGHTS } from "./config";
import {
  type SeriesCtx,
  extensionOf,
  marketSectorComponent,
  momentumComponent,
  relativeStrengthComponent,
  volumeComponent,
} from "./engine";
import { computeSeries, indexAtOrBefore, snapshotAt } from "./indicators";
import { getHistory } from "./providers/yahoo";
import { combine } from "./scoring";
import { TRADE_RULES, tradeSetup } from "./trade";
import type {
  BacktestParams,
  BacktestResult,
  BacktestSignal,
  ComponentResult,
  HorizonStats,
  SignalCategory,
  TradeSimulation,
  TradeStats,
  UniverseEntry,
  Weights,
} from "./types";
import { getUniverse } from "./universe";

/**
 * Walk-forward historical validation of the Early Signal Engine.
 *
 * - Point-in-time: on day t only bars <= t are used (all indicators are causal).
 * - Execution delay: entry at the OPEN of day t + entryDelayDays (>= 1), never at the
 *   close of the signal day.
 * - Transaction costs: costBps per side, deducted twice (entry + exit).
 * - Only price/volume based components are historically reproducible from free data
 *   (volume, relative strength, momentum, market/sector). News, fundamentals and
 *   analyst revisions are NOT available point-in-time and are excluded rather than
 *   filled in with today's values (which would be look-ahead bias).
 */

const TECH_WEIGHTS: Weights = { ...DEFAULT_WEIGHTS, news: 0, fundamentals: 0, analysts: 0 };

export const DEFAULT_BT_PARAMS: BacktestParams = {
  direction: "long",
  minCategory: "EARLY_SIGNAL",
  costBps: 10,
  entryDelayDays: 1,
  cooldownDays: 20,
  horizons: [5, 10, 20, 60],
  years: 5,
};

const WARMUP = 260;

function rangeFor(years: number): "2y" | "5y" | "10y" {
  // fetch extra history so the full evaluation window remains after the warm-up period
  return years <= 2 ? "5y" : "10y";
}

interface TickerRun {
  signals: BacktestSignal[];
  baseline: Record<number, number[]>;
  from: string;
  to: string;
}

/** Simulates one trade with stop-loss / target / time exit. Gaps are filled at the open. */
export function simulateTrade(
  bars: SeriesCtx["bars"],
  eIdx: number,
  dir: 1 | -1,
  atr: number,
  cost: number
): TradeSimulation {
  const entry = bars[eIdx].open;
  const risk = TRADE_RULES.stopAtr * atr;
  const stop = entry - dir * risk;
  const target1 = entry + dir * risk * TRADE_RULES.target1R;
  const target2 = entry + dir * risk * TRADE_RULES.target2R;
  const last = Math.min(bars.length - 1, eIdx + TRADE_RULES.maxDays - 1);
  let exitPrice = bars[last].close;
  let exitIdx = last;
  let outcome: TradeSimulation["outcome"] =
    eIdx + TRADE_RULES.maxDays - 1 <= bars.length - 1 ? "Zeit" : "offen";
  let target1Hit = false;
  for (let k = eIdx; k <= last; k++) {
    const b = bars[k];
    const hitStopGap = k > eIdx && (dir === 1 ? b.open <= stop : b.open >= stop);
    const hitStop = dir === 1 ? b.low <= stop : b.high >= stop;
    const hitTargetGap = k > eIdx && (dir === 1 ? b.open >= target2 : b.open <= target2);
    const hitTarget = dir === 1 ? b.high >= target2 : b.low <= target2;
    if (dir === 1 ? b.high >= target1 : b.low <= target1) target1Hit = true;
    // conservative: if stop and target fall into the same bar, assume the stop came first
    if (hitStopGap || hitStop) {
      exitPrice = hitStopGap ? b.open : stop;
      exitIdx = k;
      outcome = "Stop";
      break;
    }
    if (hitTargetGap || hitTarget) {
      exitPrice = hitTargetGap ? b.open : target2;
      exitIdx = k;
      outcome = "Ziel";
      break;
    }
  }
  const pct = dir * (exitPrice / entry - 1) * 100 - cost;
  const riskPct = (risk / entry) * 100;
  const rd = (x: number) => Math.round(x * 100) / 100;
  return {
    stop: rd(stop),
    target1: rd(target1),
    target2: rd(target2),
    exitDate: bars[exitIdx].date,
    exitPrice: rd(exitPrice),
    outcome,
    r: rd(pct / riskPct),
    pct: rd(pct),
    target1Hit,
    days: exitIdx - eIdx + 1,
  };
}

function runTicker(
  entry: UniverseEntry,
  stock: SeriesCtx,
  bench: SeriesCtx | null,
  sector: SeriesCtx | null,
  market: SeriesCtx | null,
  p: BacktestParams,
  startDate: string
): TickerRun {
  const bars = stock.bars;
  const minRank = CATEGORY_RANK[p.minCategory];
  const maxH = Math.max(...p.horizons);
  const cost = (2 * p.costBps) / 100; // in %
  const dir: 1 | -1 = p.direction === "short" ? -1 : 1;
  const wanted = p.direction === "short" ? "SHORT" : "LONG";
  const signals: BacktestSignal[] = [];
  const baseline: Record<number, number[]> = Object.fromEntries(p.horizons.map((h) => [h, []]));
  let prevActive = true; // no signal on the very first evaluated day
  let lastSignalIdx = -1e9;
  const start = Math.max(WARMUP, indexAtOrBefore(bars, startDate) + 1);
  const delay = Math.max(1, Math.round(p.entryDelayDays));

  const benchRet = (fromDate: string, toDate: string): number | null => {
    if (!bench) return null;
    const a = indexAtOrBefore(bench.bars, fromDate);
    const b = indexAtOrBefore(bench.bars, toDate);
    if (a < 1 || b < 0 || b <= a) return null;
    // benchmark entry approximated at previous close (index opens are not reliable)
    return (bench.bars[b].close / bench.bars[a - 1].close - 1) * 100;
  };

  for (let i = start; i < bars.length; i++) {
    const snap = snapshotAt(bars, stock.series, i);
    const components: ComponentResult[] = [
      volumeComponent(stock, i, snap),
      relativeStrengthComponent(stock, i, bench, entry.benchmark),
      momentumComponent(stock, i, snap),
      marketSectorComponent(bars[i].date, bench, entry.benchmark, sector, entry.sectorEtf, market),
    ];
    const ext = extensionOf(snap);
    const c = combine(components, TECH_WEIGHTS, ext, DEFAULT_CONFIG);
    const setup = tradeSetup({
      category: c.category,
      score: c.score,
      coverage: c.coverage,
      technical: snap,
      extension: ext,
      components,
    });
    const active = setup.bias === wanted && (dir === -1 || CATEGORY_RANK[c.category] >= minRank);

    // unconditional baseline: every day is a hypothetical entry in the same direction
    const eIdx = i + delay;
    if (eIdx < bars.length) {
      for (const h of p.horizons) {
        const x = eIdx + h - 1;
        if (x < bars.length) {
          baseline[h].push(dir * (bars[x].close / bars[eIdx].open - 1) * 100 - cost);
        }
      }
    }

    if (active && !prevActive && i - lastSignalIdx >= p.cooldownDays) {
      lastSignalIdx = i;
      const sig: BacktestSignal = {
        ticker: entry.ticker,
        direction: p.direction,
        date: bars[i].date,
        category: c.category,
        score: c.score,
        entryDate: eIdx < bars.length ? bars[eIdx].date : null,
        entryPrice: eIdx < bars.length ? bars[eIdx].open : null,
        returns: {},
        benchmarkReturns: {},
        maxAdverse: null,
        trade: null,
      };
      for (const h of p.horizons) {
        const x = eIdx + h - 1;
        if (eIdx < bars.length && x < bars.length) {
          sig.returns[h] =
            Math.round((dir * (bars[x].close / bars[eIdx].open - 1) * 100 - cost) * 100) / 100;
          const br = benchRet(bars[eIdx].date, bars[x].date);
          sig.benchmarkReturns[h] = br == null ? null : Math.round(dir * br * 100) / 100;
        } else {
          sig.returns[h] = null;
          sig.benchmarkReturns[h] = null;
        }
      }
      if (eIdx < bars.length) {
        let worst = dir === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
        for (let k = eIdx; k < Math.min(bars.length, eIdx + maxH); k++) {
          worst = dir === 1 ? Math.min(worst, bars[k].low) : Math.max(worst, bars[k].high);
        }
        sig.maxAdverse = Math.round(-Math.abs(worst / bars[eIdx].open - 1) * 10000) / 100;
        if (dir === 1 && worst > bars[eIdx].open) sig.maxAdverse = 0;
        if (dir === -1 && worst < bars[eIdx].open) sig.maxAdverse = 0;
        if (snap.atr14 != null) sig.trade = simulateTrade(bars, eIdx, dir, snap.atr14, cost);
      }
      signals.push(sig);
    }
    prevActive = active;
  }
  return { signals, baseline, from: bars[start]?.date ?? "", to: bars[bars.length - 1].date };
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r2 = (x: number | null) => (x == null ? null : Math.round(x * 100) / 100);

function stats(
  signals: BacktestSignal[],
  horizons: number[],
  baseline: Record<number, number[]>
): HorizonStats[] {
  return horizons.map((h) => {
    const rets = signals.map((s) => s.returns[h]).filter((x): x is number => x != null);
    const ex = signals
      .filter((s) => s.returns[h] != null && s.benchmarkReturns[h] != null)
      .map((s) => (s.returns[h] as number) - (s.benchmarkReturns[h] as number));
    return {
      horizon: h,
      count: rets.length,
      hitRate: rets.length ? r2((rets.filter((r) => r > 0).length / rets.length) * 100) : null,
      avgReturn: r2(mean(rets)),
      medianReturn: r2(median(rets)),
      avgExcess: r2(mean(ex)),
      excessHitRate: ex.length ? r2((ex.filter((r) => r > 0).length / ex.length) * 100) : null,
      best: rets.length ? r2(Math.max(...rets)) : null,
      worst: rets.length ? r2(Math.min(...rets)) : null,
      baselineAvg: r2(mean(baseline[h] ?? [])),
    };
  });
}

function tradeStats(signals: BacktestSignal[]): TradeStats {
  const all = signals.map((s) => s.trade).filter((t): t is TradeSimulation => t != null);
  const done = all.filter((t) => t.outcome !== "offen");
  const n = done.length;
  const share = (f: (t: TradeSimulation) => boolean) =>
    n ? r2((done.filter(f).length / n) * 100) : null;
  const rs = done.map((t) => t.r);
  return {
    count: n,
    winRate: share((t) => t.r > 0),
    avgR: r2(mean(rs)),
    medianR: r2(median(rs)),
    avgPct: r2(mean(done.map((t) => t.pct))),
    pctTarget: share((t) => t.outcome === "Ziel"),
    pctStop: share((t) => t.outcome === "Stop"),
    pctTime: share((t) => t.outcome === "Zeit"),
    pctTarget1: share((t) => t.target1Hit),
    avgDays: r2(mean(done.map((t) => t.days))),
    bestR: rs.length ? r2(Math.max(...rs)) : null,
    worstR: rs.length ? r2(Math.min(...rs)) : null,
    open: all.length - n,
  };
}

export function sanitizeParams(input: Partial<BacktestParams>): BacktestParams {
  const p = { ...DEFAULT_BT_PARAMS, ...input };
  const cats = ["EARLY_SIGNAL", "BUILDING_MOMENTUM", "STRONG_MOMENTUM"] as const;
  return {
    direction: p.direction === "short" ? "short" : "long",
    minCategory: cats.includes(p.minCategory) ? p.minCategory : "EARLY_SIGNAL",
    costBps: Math.max(0, Math.min(200, Number(p.costBps) || 0)),
    entryDelayDays: Math.max(1, Math.min(5, Math.round(Number(p.entryDelayDays) || 1))),
    cooldownDays: Math.max(1, Math.min(120, Math.round(Number(p.cooldownDays) || 20))),
    horizons: [5, 10, 20, 60],
    years: [2, 5, 10].includes(Number(p.years)) ? Number(p.years) : 5,
    tickers:
      Array.isArray(p.tickers) && p.tickers.length
        ? p.tickers.map((t) => String(t).toUpperCase()).slice(0, 40)
        : undefined,
  };
}

export async function runBacktest(input: Partial<BacktestParams>): Promise<BacktestResult> {
  const p = sanitizeParams(input);
  const key = `bt:v2:${JSON.stringify(p)}`;
  const res = await cached(key, 6 * 3600, () => computeBacktest(p));
  return res.data;
}

async function computeBacktest(p: BacktestParams): Promise<BacktestResult> {
  const universe = getUniverse().filter((e) => !p.tickers || p.tickers.includes(e.ticker));
  const range = rangeFor(p.years);
  const startDate = new Date(Date.now() - p.years * 365.25 * 86400_000).toISOString().slice(0, 10);
  const ctxCache = new Map<string, Promise<SeriesCtx | null>>();
  const load = (sym: string) => {
    if (!ctxCache.has(sym)) {
      ctxCache.set(
        sym,
        getHistory(sym, range)
          .then((r) => ({ bars: r.data.bars, series: computeSeries(r.data.bars) }))
          .catch(() => null)
      );
    }
    return ctxCache.get(sym) as Promise<SeriesCtx | null>;
  };
  const market = await load("SPY");
  const errors: { ticker: string; message: string }[] = [];
  const all: BacktestSignal[] = [];
  const baseline: Record<number, number[]> = Object.fromEntries(p.horizons.map((h) => [h, []]));
  let from = "9999";
  let to = "0000";

  await Promise.all(
    universe.map(async (e) => {
      try {
        const [stock, bench, sector] = await Promise.all([
          getHistory(e.yahoo, range).then((r) => ({
            bars: r.data.bars,
            series: computeSeries(r.data.bars),
          })),
          load(e.benchmark),
          load(e.sectorEtf),
        ]);
        if (stock.bars.length < WARMUP + 30) throw new Error("zu wenig Historie für Backtest");
        const run = runTicker(e, stock, bench, sector, market, p, startDate);
        all.push(...run.signals);
        for (const h of p.horizons) baseline[h].push(...run.baseline[h]);
        if (run.from && run.from < from) from = run.from;
        if (run.to > to) to = run.to;
      } catch (err) {
        errors.push({ ticker: e.ticker, message: (err as Error).message });
      }
    })
  );

  all.sort((a, b) => (a.date < b.date ? 1 : -1));
  const cats: SignalCategory[] = [
    "EARLY_SIGNAL",
    "BUILDING_MOMENTUM",
    "STRONG_MOMENTUM",
    "NEGATIVE",
  ];
  const statsOut = {
    ALL: stats(all, p.horizons, baseline),
  } as BacktestResult["stats"];
  for (const c of cats)
    statsOut[c] = stats(
      all.filter((s) => s.category === c),
      p.horizons,
      baseline
    );
  statsOut.NEUTRAL = [];
  const short = p.direction === "short";

  return {
    params: p,
    generatedAt: Date.now(),
    signals: all,
    stats: statsOut,
    tradeStats: tradeStats(all),
    universe: universe.map((e) => e.ticker),
    period: { from, to },
    errors,
    methodology: [
      "Walk-forward: Für jeden Handelstag t werden ausschließlich Daten bis einschließlich t verwendet (kausale Indikatoren).",
      short
        ? `Short-Signal: Die Trade-Einschätzung wechselt auf SHORT (Einstufung NEGATIVE, Kurs unter SMA50 und SMA200 bzw. SMA50 < SMA200, schwache Technik, nicht überverkauft). Sperrfrist ${p.cooldownDays} Handelstage.`
        : `Long-Signal: Die Trade-Einschätzung wechselt auf LONG (Einstufung mindestens ${p.minCategory.replace("_", " ")}, Kurs nicht überdehnt). Sperrfrist ${p.cooldownDays} Handelstage.`,
      `Einstieg zum Eröffnungskurs ${p.entryDelayDays} Handelstag(e) nach dem Signal. Renditen über 5/10/20/60 Handelstage bis zum jeweiligen Schlusskurs${short ? " – bei Shorts mit umgekehrtem Vorzeichen (Kursrückgang = Gewinn)" : ""}.`,
      `Trade-Simulation: Stop-Loss ${TRADE_RULES.stopAtr}× ATR14, Kursziel ${TRADE_RULES.target2R}R (Kursziel 1 bei ${TRADE_RULES.target1R}R wird nur als „erreicht“ protokolliert), Zeitausstieg nach ${TRADE_RULES.maxDays} Handelstagen. Kurslücken über Stop/Ziel werden zum Eröffnungskurs abgerechnet; liegen Stop und Ziel am selben Tag, wird konservativ der Stop angenommen.`,
      `Transaktionskosten: ${p.costBps} Basispunkte je Seite (${(p.costBps * 2) / 100} % pro Round-Trip) sind in allen Renditen abgezogen.`,
      "Bewertete Komponenten: Volumen, relative Stärke, Momentum, Markt/Sektor (Gewichtung renormalisiert). Nachrichten, Fundamentaldaten und Analystenrevisionen sind historisch nicht point-in-time verfügbar und daher NICHT Teil des Backtests.",
      `Baseline: durchschnittliche Rendite eines ${short ? "Shorts" : "Einstiegs"} an JEDEM Handelstag in denselben Aktien (gleiche Kosten/Verzögerung) – das Signal muss diese schlagen, um Mehrwert zu zeigen.`,
      short
        ? "Überschussrendite: Short-Rendite minus Short-Rendite des Benchmarks über denselben Zeitraum."
        : "Überschussrendite: Signalrendite minus Rendite des jeweiligen Benchmarks über denselben Zeitraum.",
    ],
    biases: [
      "Survivorship Bias: Das Universum besteht aus heute bekannten, erfolgreichen Large Caps. Unternehmen, die abgestürzt oder aus Indizes gefallen sind, fehlen – die Ergebnisse sind dadurch tendenziell zu optimistisch.",
      "Selektionsbias: Die Auswahl der Titel (z. B. NVIDIA, Palantir, Eli Lilly) kennt deren spätere Entwicklung. Vergleiche daher stets mit der Baseline derselben Titel.",
      "Look-ahead Bias wird durch kausale Indikatoren, Einstieg frühestens am Folgetag und Ausschluss nicht point-in-time verfügbarer Daten vermieden. Adjustierte Kurse (Splits/Dividenden) werden verwendet; Dividenden fließen damit in die Rendite ein.",
      "Keine Berücksichtigung von Slippage über die Kostenannahme hinaus, Steuern, Währungseffekten (Renditen in Handelswährung) oder Leerverkaufsbeschränkungen.",
      "Kleine Stichproben (wenige Signale pro Kategorie) sind statistisch nicht belastbar.",
      ...(short
        ? [
            "Shorts: Leihgebühren, Verfügbarkeit von Leihaktien, Dividendenzahlungen an den Verleiher und Margin-Anforderungen sind nicht berücksichtigt. Im langfristig steigenden Markt dieser Large Caps ist die Baseline für Shorts negativ.",
          ]
        : []),
    ],
  };
}
