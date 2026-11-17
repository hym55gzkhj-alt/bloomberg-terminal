import { cached } from "./cache";
import { CATEGORY_RANK, DEFAULT_CONFIG, DEFAULT_WEIGHTS } from "./config";
import {
  extensionOf,
  marketSectorComponent,
  momentumComponent,
  relativeStrengthComponent,
  type SeriesCtx,
  volumeComponent,
} from "./engine";
import { computeSeries, indexAtOrBefore, snapshotAt } from "./indicators";
import { getHistory } from "./providers/yahoo";
import { combine } from "./scoring";
import type {
  BacktestParams,
  BacktestResult,
  BacktestSignal,
  ComponentResult,
  HorizonStats,
  SignalCategory,
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
  const signals: BacktestSignal[] = [];
  const baseline: Record<number, number[]> = Object.fromEntries(p.horizons.map((h) => [h, []]));
  let prevRank = -1;
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
    const rank = CATEGORY_RANK[c.category];

    // unconditional baseline: every day is a hypothetical entry
    const eIdx = i + delay;
    if (eIdx < bars.length) {
      for (const h of p.horizons) {
        const x = eIdx + h - 1;
        if (x < bars.length) baseline[h].push((bars[x].close / bars[eIdx].open - 1) * 100 - cost);
      }
    }

    const crossed = rank >= minRank && prevRank >= 0 && prevRank < minRank;
    if (crossed && i - lastSignalIdx >= p.cooldownDays) {
      lastSignalIdx = i;
      const sig: BacktestSignal = {
        ticker: entry.ticker,
        date: bars[i].date,
        category: c.category,
        score: c.score,
        entryDate: eIdx < bars.length ? bars[eIdx].date : null,
        entryPrice: eIdx < bars.length ? bars[eIdx].open : null,
        returns: {},
        benchmarkReturns: {},
        maxAdverse: null,
      };
      for (const h of p.horizons) {
        const x = eIdx + h - 1;
        if (eIdx < bars.length && x < bars.length) {
          sig.returns[h] =
            Math.round(((bars[x].close / bars[eIdx].open - 1) * 100 - cost) * 100) / 100;
          const br = benchRet(bars[eIdx].date, bars[x].date);
          sig.benchmarkReturns[h] = br == null ? null : Math.round(br * 100) / 100;
        } else {
          sig.returns[h] = null;
          sig.benchmarkReturns[h] = null;
        }
      }
      if (eIdx < bars.length) {
        let minLow = Number.POSITIVE_INFINITY;
        for (let k = eIdx; k < Math.min(bars.length, eIdx + maxH); k++)
          minLow = Math.min(minLow, bars[k].low);
        sig.maxAdverse = Math.round((minLow / bars[eIdx].open - 1) * 10000) / 100;
      }
      signals.push(sig);
    }
    prevRank = rank;
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

export function sanitizeParams(input: Partial<BacktestParams>): BacktestParams {
  const p = { ...DEFAULT_BT_PARAMS, ...input };
  const cats = ["EARLY_SIGNAL", "BUILDING_MOMENTUM", "STRONG_MOMENTUM"] as const;
  return {
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
  const key = `bt:v1:${JSON.stringify(p)}`;
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
  const cats: SignalCategory[] = ["EARLY_SIGNAL", "BUILDING_MOMENTUM", "STRONG_MOMENTUM"];
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
  statsOut.NEGATIVE = [];

  return {
    params: p,
    generatedAt: Date.now(),
    signals: all,
    stats: statsOut,
    universe: universe.map((e) => e.ticker),
    period: { from, to },
    errors,
    methodology: [
      "Walk-forward: Für jeden Handelstag t werden ausschließlich Daten bis einschließlich t verwendet (kausale Indikatoren).",
      `Ein Signal entsteht, wenn die Einstufung erstmals mindestens ${p.minCategory.replace("_", " ")} erreicht (Übergang von darunter); danach Sperrfrist ${p.cooldownDays} Handelstage.`,
      `Einstieg zum Eröffnungskurs ${p.entryDelayDays} Handelstag(e) nach dem Signal, Ausstieg zum Schlusskurs nach 5/10/20/60 Handelstagen.`,
      `Transaktionskosten: ${p.costBps} Basispunkte je Seite (${(p.costBps * 2) / 100} % pro Round-Trip) sind in allen Renditen abgezogen.`,
      "Bewertete Komponenten: Volumen, relative Stärke, Momentum, Markt/Sektor (Gewichtung renormalisiert). Nachrichten, Fundamentaldaten und Analystenrevisionen sind historisch nicht point-in-time verfügbar und daher NICHT Teil des Backtests.",
      "Baseline: durchschnittliche Rendite eines Einstiegs an JEDEM Handelstag in denselben Aktien (gleiche Kosten/Verzögerung) – das Signal muss diese schlagen, um Mehrwert zu zeigen.",
      "Überschussrendite: Signalrendite minus Rendite des jeweiligen Benchmarks über denselben Zeitraum.",
    ],
    biases: [
      "Survivorship Bias: Das Universum besteht aus heute bekannten, erfolgreichen Large Caps. Unternehmen, die abgestürzt oder aus Indizes gefallen sind, fehlen – die Ergebnisse sind dadurch tendenziell zu optimistisch.",
      "Selektionsbias: Die Auswahl der Titel (z. B. NVIDIA, Palantir, Eli Lilly) kennt deren spätere Entwicklung. Vergleiche daher stets mit der Baseline derselben Titel.",
      "Look-ahead Bias wird durch kausale Indikatoren, Einstieg frühestens am Folgetag und Ausschluss nicht point-in-time verfügbarer Daten vermieden. Adjustierte Kurse (Splits/Dividenden) werden verwendet; Dividenden fließen damit in die Rendite ein.",
      "Keine Berücksichtigung von Slippage über die Kostenannahme hinaus, Steuern, Währungseffekten (Renditen in Handelswährung) oder Leerverkaufsbeschränkungen.",
      "Kleine Stichproben (wenige Signale pro Kategorie) sind statistisch nicht belastbar.",
    ],
  };
}
