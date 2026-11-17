import { analyzeEntry, collectNews, getSignalHistory } from "./analyze";
import { runBacktest } from "./backtest";
import { cacheBackend, cached, hashGet, hashGetAll, hashSetMany } from "./cache";
import { serverWeights } from "./config";
import { computeSeries, snapshotAt } from "./indicators";
import { finnhubConfigured, probeFinnhub } from "./providers/finnhub";
import { runInBackground } from "./providers/http";
import { getHistory, probeYahoo } from "./providers/yahoo";
import type {
  DetailPayload,
  NewsItem,
  ProviderStatus,
  ScanResult,
  SlimAnalysis,
  StockAnalysis,
  UniverseEntry,
} from "./types";
import { MARKET_OVERVIEW, getUniverse } from "./universe";

let lastStatus: ProviderStatus[] = [];

export async function providerStatus(): Promise<ProviderStatus[]> {
  const res = await cached("providers:status", 120, async () => {
    const [y, f] = await Promise.all([probeYahoo(), probeFinnhub()]);
    const now = Date.now();
    const out: ProviderStatus[] = [
      { provider: "Yahoo Finance", ok: y.ok, message: y.message, checkedAt: now },
      { provider: "Finnhub", ok: f.ok, message: f.message, checkedAt: now },
      {
        provider: "Cache",
        ok: true,
        message:
          cacheBackend() === "redis"
            ? "Upstash Redis aktiv (geteilter Cache + persistente Signalhistorie)"
            : "In-Memory-Cache (Upstash nicht konfiguriert – Signalhistorie geht bei Neustart verloren)",
        checkedAt: now,
      },
    ];
    lastStatus = out;
    return out;
  });
  return res.data;
}

// ------------------------------------------------------------------ incremental scan
/**
 * The universe (~600 stocks) is far too large to analyse in one request with free data
 * providers. Results are therefore kept in a store (Redis hash + memory) and every scan
 * request refreshes the most outdated stocks within a time budget. The client polls
 * while work is pending and shows the progress.
 */
const STORE = "analyses";
const CORE_MAX_AGE = 5 * 60_000;
const OTHER_MAX_AGE = 30 * 60_000;
/** One background run (kept alive with next/server `after`, maxDuration 300 s). */
const SCAN_BUDGET_MS = 240_000;
const WORKERS = 6;
/** Partial results are persisted every N analysed stocks. */
const FLUSH_EVERY = 15;
const STORE_RELOAD_MS = 60_000;
const STORE_RELOAD_PENDING_MS = 15_000;

interface ScanState {
  running?: Promise<void>;
  loadedAt: number;
  pending: number;
  errors: Map<string, string>;
}
const gs = globalThis as unknown as { __radarScanState?: ScanState };
if (!gs.__radarScanState) gs.__radarScanState = { loadedAt: 0, pending: 1, errors: new Map() };
const state = gs.__radarScanState;

export function slim(a: StockAnalysis): SlimAnalysis {
  const { factors: _f, explanation: _e, trade: _t, ...rest } = a;
  return rest;
}

async function loadStore(): Promise<Record<string, SlimAnalysis>> {
  const maxAge = state.pending > 0 ? STORE_RELOAD_PENDING_MS : STORE_RELOAD_MS;
  if (Date.now() - state.loadedAt > maxAge) {
    state.loadedAt = Date.now();
    return hashGetAll<SlimAnalysis>(STORE);
  }
  return localStore();
}

function localStore(): Record<string, SlimAnalysis> {
  // hashGetAll merges Redis into memory; reading memory only avoids a Redis command
  const g = globalThis as unknown as { __radarHash?: Map<string, Map<string, unknown>> };
  return Object.fromEntries(g.__radarHash?.get(STORE) ?? new Map()) as Record<string, SlimAnalysis>;
}

export async function storedAnalysis(ticker: string): Promise<SlimAnalysis | null> {
  return localStore()[ticker] ?? (await hashGet<SlimAnalysis>(STORE, ticker));
}

function isStale(e: UniverseEntry, a: SlimAnalysis | undefined, now: number): boolean {
  return !a || now - a.computedAt > (e.core ? CORE_MAX_AGE : OTHER_MAX_AGE);
}

async function processBatch(queue: UniverseEntry[], store: Record<string, SlimAnalysis>) {
  const deadline = Date.now() + SCAN_BUDGET_MS;
  let updated: Record<string, SlimAnalysis> = {};
  let count = 0;
  const flush = async () => {
    const batch = updated;
    updated = {};
    await hashSetMany(STORE, batch);
  };
  let next = 0;
  const worker = async () => {
    // stop starting new stocks early enough that queued provider calls still finish
    while (next < queue.length && Date.now() < deadline - 20_000) {
      const e = queue[next++];
      try {
        const prev = store[e.ticker];
        const { analysis } = await analyzeEntry(e, {
          recordHistory: true,
          previous: prev ? { category: prev.category, detectedAt: prev.detectedAt } : null,
          deadline: Math.min(deadline, Date.now() + 12_000),
        });
        updated[e.ticker] = slim(analysis);
        state.errors.delete(e.ticker);
        if (++count % FLUSH_EVERY === 0) await flush();
      } catch (err) {
        state.errors.set(e.ticker, String((err as Error)?.message ?? err));
      }
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
  await flush();
}

/** Background work of the current scan run (for next/server `after`). */
export function scanWork(): Promise<void> {
  return state.running ?? Promise.resolve();
}

export async function scanUniverse(): Promise<ScanResult> {
  const universe = getUniverse();
  const store = await loadStore();
  const now = Date.now();
  const stale = universe
    .filter((e) => isStale(e, store[e.ticker], now))
    .sort((a, b) => {
      const pa = store[a.ticker] ? 2 : a.core ? 0 : 1;
      const pb = store[b.ticker] ? 2 : b.core ? 0 : 1;
      if (pa !== pb) return pa - pb;
      if (a.core !== b.core) return a.core ? -1 : 1;
      return (store[a.ticker]?.computedAt ?? 0) - (store[b.ticker]?.computedAt ?? 0);
    });
  if (stale.length && !state.running) {
    // runs in the background; the response returns immediately with the current state
    state.running = runInBackground(() => processBatch(stale, store))
      .catch((err) => console.error("[scan] batch failed:", err))
      .finally(() => {
        state.running = undefined;
      });
    // give the first stocks a moment so that an empty store shows progress quickly
    if (Object.keys(store).length === 0) {
      await Promise.race([state.running, new Promise((r) => setTimeout(r, 8_000))]);
    }
  }
  const current = localStore();
  const results = universe
    .map((e) => current[e.ticker])
    .filter((a): a is SlimAnalysis => Boolean(a))
    .sort((a, b) => b.score - a.score);
  const after = Date.now();
  const pending = universe.filter((e) => isStale(e, current[e.ticker], after)).length;
  state.pending = pending;
  const errors = universe
    .filter((e) => state.errors.has(e.ticker))
    .map((e) => ({ ticker: e.ticker, message: state.errors.get(e.ticker) as string }));
  return {
    generatedAt: after,
    results,
    progress: { total: universe.length, analyzed: results.length, pending, failed: errors.length },
    errors,
    providers: await Promise.race([
      providerStatus(),
      new Promise<ProviderStatus[]>((r) => setTimeout(() => r(lastStatus), 3_000)),
    ]),
    weights: serverWeights(),
    cache: cacheBackend(),
  };
}

export async function stockDetail(entry: UniverseEntry): Promise<DetailPayload> {
  const prev = await storedAnalysis(entry.ticker);
  const [bundle, signalHistory, bt, btShort] = await Promise.all([
    analyzeEntry(entry, {
      recordHistory: false,
      previous: prev ? { category: prev.category, detectedAt: prev.detectedAt } : null,
      realtimeQuote: true,
      deadline: Date.now() + 15_000,
    }),
    getSignalHistory(entry.ticker),
    runBacktest({ tickers: [entry.ticker], years: 5, direction: "long" }).catch(() => null),
    runBacktest({ tickers: [entry.ticker], years: 5, direction: "short" }).catch(() => null),
  ]);
  return {
    analysis: bundle.analysis,
    bars: bundle.history.bars,
    benchmarkBars: bundle.benchmark?.bars ?? [],
    news: bundle.news.slice(0, 40),
    fundamentals: bundle.fundamentals,
    recommendations: bundle.recommendations,
    earnings: bundle.earnings,
    upcomingEarnings: bundle.upcomingEarnings,
    signalHistory,
    historicalSignals: [...(bt?.signals ?? []), ...(btShort?.signals ?? [])].sort((a, b) =>
      a.date < b.date ? 1 : -1
    ),
  };
}

export interface OverviewRow {
  symbol: string;
  name: string;
  group: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  ret20: number | null;
  ytd: number | null;
  aboveSma50: boolean | null;
  aboveSma200: boolean | null;
  spark: number[];
  currency: string | null;
  marketTime: number | null;
  marketState: string | null;
  delayNote: string | null;
  error?: string;
}

export async function marketOverview(): Promise<{ rows: OverviewRow[]; generatedAt: number }> {
  const res = await cached("overview:v1", 180, async () => {
    const rows = await Promise.all(
      MARKET_OVERVIEW.map(async (m): Promise<OverviewRow> => {
        try {
          const { data } = await getHistory(m.symbol, "1y");
          const bars = data.bars;
          const s = computeSeries(bars);
          const snap = snapshotAt(bars, s, bars.length - 1);
          const year = new Date().getFullYear();
          const prevYear = [...bars].reverse().find((b) => Number(b.date.slice(0, 4)) < year);
          return {
            symbol: m.symbol,
            name: m.name,
            group: m.group,
            price: data.quote.price,
            change: data.quote.change,
            changePct: data.quote.changePct,
            ret20: snap.ret20,
            ytd: prevYear ? (data.quote.price / prevYear.close - 1) * 100 : null,
            aboveSma50: snap.sma50 != null ? snap.close > snap.sma50 : null,
            aboveSma200: snap.sma200 != null ? snap.close > snap.sma200 : null,
            spark: bars.slice(-30).map((b) => b.close),
            currency: data.quote.currency,
            marketTime: data.quote.marketTime,
            marketState: data.quote.marketState,
            delayNote: data.quote.delayNote,
          };
        } catch (err) {
          return {
            symbol: m.symbol,
            name: m.name,
            group: m.group,
            price: null,
            change: null,
            changePct: null,
            ret20: null,
            ytd: null,
            aboveSma50: null,
            aboveSma200: null,
            spark: [],
            currency: null,
            marketTime: null,
            marketState: null,
            delayNote: null,
            error: (err as Error).message,
          };
        }
      })
    );
    return { rows, generatedAt: Date.now() };
  });
  return res.data;
}

export async function newsFeed(): Promise<{
  items: (NewsItem & { ticker: string })[];
  errors: { ticker: string; message: string }[];
  sources: string[];
  generatedAt: number;
}> {
  const res = await cached("newsfeed:v2", 600, async () => {
    // Core stocks + the 40 highest-scoring stocks of the large universe (fetching news for
    // all ~600 stocks would take minutes with the free provider limits).
    const store = localStore();
    const top = new Set(
      Object.values(store)
        .sort((a, b) => b.score - a.score)
        .slice(0, 40)
        .map((a) => a.entry.ticker)
    );
    const universe = getUniverse().filter((e) => e.core || top.has(e.ticker));
    const errors: { ticker: string; message: string }[] = [];
    const items: (NewsItem & { ticker: string })[] = [];
    const seen = new Set<string>();
    await Promise.all(
      universe.map(async (e) => {
        const r = await collectNews(e, { finnhub: false });
        if (!r.news) {
          errors.push({ ticker: e.ticker, message: r.reason ?? "keine Nachrichten" });
          return;
        }
        for (const n of r.news) {
          if (seen.has(n.url)) continue;
          seen.add(n.url);
          items.push({ ...n, ticker: e.ticker });
        }
      })
    );
    items.sort((a, b) => b.publishedAt - a.publishedAt);
    // Finnhub company news is used per stock (detail/scan); the feed uses Yahoo only to
    // keep the free Finnhub quota (60 calls/min) for analyst and fundamental data.
    const sources = ["Yahoo Finance News"];
    return { items: items.slice(0, 400), errors, sources, generatedAt: Date.now() };
  });
  return res.data;
}
