import { runBacktest } from "./backtest";
import { cacheBackend, cached } from "./cache";
import { serverWeights } from "./config";
import { analyzeEntry, collectNews, getSignalHistory } from "./analyze";
import { computeSeries, snapshotAt } from "./indicators";
import { finnhubConfigured, probeFinnhub } from "./providers/finnhub";
import { getHistory, probeYahoo } from "./providers/yahoo";
import type { DetailPayload, NewsItem, ProviderStatus, ScanResult, UniverseEntry } from "./types";
import { MARKET_OVERVIEW, getUniverse } from "./universe";

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
    return out;
  });
  return res.data;
}

/** Full scan of the universe. Cached for 4 minutes (data underneath has its own TTLs). */
export async function scanUniverse(): Promise<ScanResult> {
  const res = await cached("scan:v1", 240, async () => {
    const universe = getUniverse();
    const errors: ScanResult["errors"] = [];
    const settled = await Promise.allSettled(
      universe.map((e) => analyzeEntry(e, { recordHistory: true }))
    );
    const results = [];
    for (let k = 0; k < settled.length; k++) {
      const s = settled[k];
      if (s.status === "fulfilled") results.push(s.value.analysis);
      else
        errors.push({
          ticker: universe[k].ticker,
          message: String((s.reason as Error)?.message ?? s.reason),
        });
    }
    results.sort((a, b) => b.score - a.score);
    return {
      generatedAt: Date.now(),
      results,
      errors,
      providers: await providerStatus(),
      weights: serverWeights(),
      cache: cacheBackend(),
    } satisfies ScanResult;
  });
  return res.data;
}

export async function stockDetail(entry: UniverseEntry): Promise<DetailPayload> {
  const [bundle, signalHistory, bt] = await Promise.all([
    analyzeEntry(entry, { recordHistory: false, realtimeQuote: true }),
    getSignalHistory(entry.ticker),
    runBacktest({ tickers: [entry.ticker], years: 5 }).catch(() => null),
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
    historicalSignals: bt?.signals ?? [],
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
  const res = await cached("newsfeed:v1", 600, async () => {
    const universe = getUniverse();
    const errors: { ticker: string; message: string }[] = [];
    const items: (NewsItem & { ticker: string })[] = [];
    const seen = new Set<string>();
    await Promise.all(
      universe.map(async (e) => {
        const r = await collectNews(e);
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
    const sources = ["Yahoo Finance News"];
    if (finnhubConfigured()) sources.push("Finnhub Company News");
    return { items: items.slice(0, 400), errors, sources, generatedAt: Date.now() };
  });
  return res.data;
}
