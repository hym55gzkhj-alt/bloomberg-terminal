import { kvGet, kvSet } from "./cache";
import { DEFAULT_CONFIG, serverWeights } from "./config";
import {
  type SeriesCtx,
  analystsComponent,
  extensionOf,
  fundamentalsComponent,
  marketSectorComponent,
  momentumComponent,
  newsComponent,
  relativeStrengthComponent,
  volumeComponent,
} from "./engine";
import { computeSeries, snapshotAt } from "./indicators";
import {
  finnhubConfigured,
  getCompanyNews,
  getEarningsSurprises,
  getFinnhubQuote,
  getFundamentals,
  getRecommendations,
  getUpcomingEarnings,
} from "./providers/finnhub";
import { getHistory, getYahooNews } from "./providers/yahoo";
import { buildFactors, combine, explain } from "./scoring";
import { tradeSetup } from "./trade";
import type {
  EarningsSurprise,
  Fundamentals,
  NewsItem,
  PriceHistory,
  RecommendationTrend,
  SignalHistoryEntry,
  StockAnalysis,
  UniverseEntry,
  UpcomingEarnings,
  Weights,
} from "./types";

export interface AnalysisBundle {
  analysis: StockAnalysis;
  history: PriceHistory;
  benchmark: PriceHistory | null;
  news: NewsItem[];
  fundamentals: Fundamentals | null;
  recommendations: RecommendationTrend[];
  earnings: EarningsSurprise[];
  upcomingEarnings: UpcomingEarnings | null;
}

const errMsg = (r: PromiseSettledResult<unknown>) =>
  r.status === "rejected" ? String((r.reason as Error)?.message ?? r.reason) : "";

/**
 * Typical intraday cumulative volume profile (U-shaped trading activity):
 * fraction of daily volume traded after x (0..1) of the session ≈ x^0.8.
 */
function projectVolume(partialVolume: number, elapsed: number): number {
  return partialVolume / Math.max(0.1, elapsed ** 0.8);
}

export function dedupeNews(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const n of items.sort((a, b) => b.publishedAt - a.publishedAt)) {
    const k = n.headline
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 60);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}

export const FINNHUB_PENDING =
  "Finnhub-Daten werden nachgeladen (Limit 60 Abfragen/Min.) – beim nächsten Scan verfügbar";

const g = globalThis as unknown as { __radarPending?: Set<Promise<unknown>> };
if (!g.__radarPending) g.__radarPending = new Set();
const pending = g.__radarPending;

/**
 * Waits for a (slow, rate-limited) provider call only until `deadline`. If it is not done
 * by then, the caller continues without it (component marked as "wird nachgeladen") while
 * the request keeps running in the background and fills the cache for the next scan.
 */
export function withBudget<T>(p: Promise<T>, deadline: number | undefined): Promise<T> {
  p.catch(() => undefined);
  if (!deadline) return p;
  const ms = Math.max(1500, deadline - Date.now());
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.add(p);
      p.finally(() => pending.delete(p)).catch(() => undefined);
      reject(new Error(FINNHUB_PENDING));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/** Lets a route keep background provider calls alive after responding (next/server `after`). */
export async function drainPending(): Promise<void> {
  await Promise.allSettled([...pending]);
}

export async function collectNews(
  entry: UniverseEntry,
  opts: { finnhub?: boolean; deadline?: number } = {}
): Promise<{ news: NewsItem[] | null; reason?: string; sources: string[] }> {
  const tasks: Promise<NewsItem[]>[] = [getYahooNews(entry.yahoo, 15)];
  if (opts.finnhub !== false && finnhubConfigured() && entry.finnhub) {
    tasks.push(withBudget(getCompanyNews(entry.finnhub, 14), opts.deadline));
  }
  const settled = await Promise.allSettled(tasks);
  const ok = settled.filter(
    (s): s is PromiseFulfilledResult<NewsItem[]> => s.status === "fulfilled"
  );
  if (!ok.length) return { news: null, reason: settled.map(errMsg).join("; "), sources: [] };
  const sources = ["Yahoo Finance News"];
  if (settled[1]?.status === "fulfilled") sources.push("Finnhub Company News");
  return { news: dedupeNews(ok.flatMap((s) => s.value)), sources };
}

async function updateHistory(
  ticker: string,
  entry: SignalHistoryEntry
): Promise<SignalHistoryEntry[]> {
  const key = `history:${ticker}`;
  const hist = (await kvGet<SignalHistoryEntry[]>(key)) ?? [];
  const last = hist[hist.length - 1];
  if (!last || last.category !== entry.category) {
    hist.push(entry);
    await kvSet(key, hist.slice(-200));
  }
  return hist;
}

export async function getSignalHistory(ticker: string): Promise<SignalHistoryEntry[]> {
  return (await kvGet<SignalHistoryEntry[]>(`history:${ticker}`)) ?? [];
}

export async function analyzeEntry(
  entry: UniverseEntry,
  opts: {
    weights?: Weights;
    recordHistory?: boolean;
    realtimeQuote?: boolean;
    /** unix ms after which slow Finnhub calls are no longer awaited */
    deadline?: number;
  } = {}
): Promise<AnalysisBundle> {
  const fhb = <T>(p: Promise<T>) => withBudget(p, opts.deadline);
  const weights = opts.weights ?? serverWeights();
  const fh = finnhubConfigured() && entry.finnhub;
  const noFh = entry.finnhub
    ? "FINNHUB_API_KEY nicht konfiguriert"
    : "Titel wird vom Finnhub-Free-Tier nicht abgedeckt";

  const [hist, bench, sector, market, newsR, fundR, earnR, recR, upR, fq] =
    await Promise.allSettled([
      getHistory(entry.yahoo, "2y"),
      getHistory(entry.benchmark, "2y"),
      getHistory(entry.sectorEtf, "2y"),
      getHistory("SPY", "2y"),
      collectNews(entry, { deadline: opts.deadline }),
      fh ? fhb(getFundamentals(entry.finnhub as string)) : Promise.reject(new Error(noFh)),
      fh ? fhb(getEarningsSurprises(entry.finnhub as string)) : Promise.reject(new Error(noFh)),
      fh ? fhb(getRecommendations(entry.finnhub as string)) : Promise.reject(new Error(noFh)),
      fh ? fhb(getUpcomingEarnings(entry.finnhub as string)) : Promise.reject(new Error(noFh)),
      fh && opts.realtimeQuote && entry.region === "US"
        ? fhb(getFinnhubQuote(entry.finnhub as string))
        : Promise.resolve(null),
    ]);

  if (hist.status === "rejected") {
    throw new Error(`Kursdaten für ${entry.ticker} nicht verfügbar: ${errMsg(hist)}`);
  }
  const history = hist.value.data;
  const ctx: SeriesCtx = { bars: history.bars, series: computeSeries(history.bars) };
  const toCtx = (r: PromiseSettledResult<{ data: PriceHistory }>): SeriesCtx | null =>
    r.status === "fulfilled"
      ? { bars: r.value.data.bars, series: computeSeries(r.value.data.bars) }
      : null;
  const benchCtx = toCtx(bench);
  const sectorCtx = toCtx(sector);
  const marketCtx = toCtx(market);

  const i = history.bars.length - 1;
  const volumeOverride =
    history.lastBarPartial && history.quote.sessionElapsed < 0.98
      ? projectVolume(history.bars[i].volume, history.quote.sessionElapsed)
      : undefined;
  const snap = snapshotAt(history.bars, ctx.series, i, volumeOverride);
  const benchName = bench.status === "fulfilled" ? bench.value.data.quote.name : entry.benchmark;
  const sectorName = entry.sectorEtf;

  const newsData =
    newsR.status === "fulfilled" ? newsR.value : { news: null, reason: errMsg(newsR), sources: [] };
  const fundamentals = fundR.status === "fulfilled" ? fundR.value : null;
  const earnings = earnR.status === "fulfilled" ? earnR.value : null;
  const recs = recR.status === "fulfilled" ? recR.value : null;

  const components = [
    volumeComponent(ctx, i, snap, volumeOverride),
    relativeStrengthComponent(ctx, i, benchCtx, benchName),
    momentumComponent(ctx, i, snap),
    newsComponent(newsData.news, Date.now(), newsData.reason),
    fundamentalsComponent(
      fundamentals,
      earnings,
      fundR.status === "rejected" ? errMsg(fundR) : undefined
    ),
    analystsComponent(recs, recR.status === "rejected" ? errMsg(recR) : undefined),
    marketSectorComponent(
      history.bars[i].date,
      benchCtx,
      benchName,
      sectorCtx,
      sectorName,
      marketCtx
    ),
  ];

  const extension = extensionOf(snap);
  extension.penalty = Math.round(extension.level * DEFAULT_CONFIG.maxExtensionPenalty * 10) / 10;
  const combined = combine(components, weights, extension, DEFAULT_CONFIG);

  // quote: prefer real-time Finnhub for US listings if available
  const quote = { ...history.quote };
  const warnings: string[] = [];
  if (fq.status === "fulfilled" && fq.value && Math.abs(fq.value.price / quote.price - 1) < 0.2) {
    quote.price = fq.value.price;
    quote.change = fq.value.change;
    quote.changePct = fq.value.changePct;
    quote.previousClose = fq.value.previousClose;
    quote.marketTime = fq.value.time;
    quote.freshness = quote.marketState === "open" ? "realtime" : "end-of-day";
    quote.delayNote =
      quote.marketState === "open"
        ? "Finnhub – Echtzeitkurs (US-Handelsplätze, laut Anbieter)"
        : "Finnhub – letzter Kurs, Markt geschlossen";
    quote.source = "Finnhub";
  }
  if (volumeOverride != null) {
    warnings.push(
      "Sitzung läuft: Tagesvolumen ist hochgerechnet (typisches Intraday-Volumenprofil)."
    );
  }
  for (const c of components) {
    if (c.score == null && c.unavailableReason) warnings.push(`${c.label}: ${c.unavailableReason}`);
  }

  const dataSources = ["Yahoo Finance (Kurse/Volumen/Historie)", ...newsData.sources];
  if (fundamentals || recs || earnings) dataSources.push("Finnhub (Kennzahlen/Analysten/Earnings)");
  if (quote.source === "Finnhub") dataSources.push("Finnhub (Echtzeitkurs)");

  const now = Date.now();
  let detectedAt: number | null = null;
  if (opts.recordHistory) {
    const h = await updateHistory(entry.ticker, {
      category: combined.category,
      score: combined.score,
      detectedAt: now,
      price: quote.price,
    });
    detectedAt = h[h.length - 1]?.detectedAt ?? now;
  } else {
    const h = await getSignalHistory(entry.ticker);
    const last = h[h.length - 1];
    detectedAt = last && last.category === combined.category ? last.detectedAt : null;
  }

  const analysis: StockAnalysis = {
    entry,
    quote,
    technical: snap,
    components,
    score: combined.score,
    coverage: combined.coverage,
    category: combined.category,
    extension,
    factors: buildFactors(components, extension),
    explanation: explain(components, combined, extension, weights),
    computedAt: now,
    detectedAt,
    dataSources,
    warnings,
    trade: tradeSetup({
      category: combined.category,
      score: combined.score,
      coverage: combined.coverage,
      technical: snap,
      extension,
      components,
    }),
  };

  return {
    analysis,
    history,
    benchmark: bench.status === "fulfilled" ? bench.value.data : null,
    news: newsData.news ?? [],
    fundamentals,
    recommendations: recs ?? [],
    earnings: earnings ?? [],
    upcomingEarnings: upR.status === "fulfilled" ? upR.value : null,
  };
}
