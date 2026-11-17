import { cached } from "../cache";
import { scoreSentiment } from "../sentiment";
import type {
  EarningsSurprise,
  Fundamentals,
  NewsItem,
  RecommendationTrend,
  UpcomingEarnings,
} from "../types";
import { ProviderError, RateLimiter, fetchJson } from "./http";

/**
 * Finnhub.io – free tier (60 calls/min) covers: company news, recommendation trends,
 * earnings surprises, earnings calendar, basic financial metrics, US real-time quotes.
 * Requires FINNHUB_API_KEY (free at https://finnhub.io/register).
 */

const PROVIDER = "Finnhub";
const BASE = "https://finnhub.io/api/v1";

const g = globalThis as unknown as {
  __finnhubLimiter?: RateLimiter;
  __finnhubBreaker?: { until: number; reason: string };
};
// Free tier: 60 calls/minute. Keep a small safety margin.
if (!g.__finnhubLimiter) g.__finnhubLimiter = new RateLimiter(55, 60_000, 5);
const limiter = g.__finnhubLimiter;

/**
 * Circuit breaker: after an authentication error (401/403) or a rate-limit response
 * (429) all Finnhub calls fail fast for a while instead of queueing behind the limiter.
 */
function breakerOpen(): string | null {
  const b = g.__finnhubBreaker;
  return b && b.until > Date.now() ? b.reason : null;
}
function trip(reason: string, ms: number) {
  g.__finnhubBreaker = { until: Date.now() + ms, reason };
}

export function finnhubConfigured(): boolean {
  return Boolean(process.env.FINNHUB_API_KEY);
}

async function call<T>(path: string): Promise<T> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new ProviderError(PROVIDER, "FINNHUB_API_KEY ist nicht konfiguriert");
  const open = breakerOpen();
  if (open) throw new ProviderError(PROVIDER, open);
  let json: T & { error?: string };
  try {
    json = await limiter.schedule(
      () =>
        fetchJson<T & { error?: string }>(PROVIDER, `${BASE}/${path}`, {
          headers: { "X-Finnhub-Token": key, Accept: "application/json" },
        }),
      () => {
        const reason = breakerOpen();
        return reason ? new ProviderError(PROVIDER, reason) : null;
      }
    );
  } catch (err) {
    if (err instanceof ProviderError && (err.status === 401 || err.status === 403)) {
      trip(`API-Key abgelehnt (HTTP ${err.status}) – bitte FINNHUB_API_KEY prüfen`, 10 * 60_000);
    } else if (err instanceof ProviderError && err.status === 429) {
      trip("Rate-Limit erreicht (HTTP 429) – neuer Versuch in 60 s", 60_000);
    }
    throw err;
  }
  if (json && typeof json === "object" && "error" in json && json.error) {
    throw new ProviderError(PROVIDER, String(json.error));
  }
  return json;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export async function getRecommendations(symbol: string): Promise<RecommendationTrend[]> {
  const res = await cached(`finnhub:rec:${symbol}`, 12 * 3600, async () => {
    const data = await call<RecommendationTrend[]>(
      `stock/recommendation?symbol=${encodeURIComponent(symbol)}`
    );
    return (Array.isArray(data) ? data : [])
      .map((d) => ({
        period: d.period,
        strongBuy: d.strongBuy ?? 0,
        buy: d.buy ?? 0,
        hold: d.hold ?? 0,
        sell: d.sell ?? 0,
        strongSell: d.strongSell ?? 0,
      }))
      .sort((a, b) => (a.period < b.period ? 1 : -1));
  });
  return res.data;
}

export async function getEarningsSurprises(symbol: string): Promise<EarningsSurprise[]> {
  const res = await cached(`finnhub:earn:${symbol}`, 24 * 3600, async () => {
    const data = await call<
      {
        period: string;
        actual: number | null;
        estimate: number | null;
        surprisePercent: number | null;
      }[]
    >(`stock/earnings?symbol=${encodeURIComponent(symbol)}&limit=8`);
    return (Array.isArray(data) ? data : [])
      .map((d) => ({
        period: d.period,
        actual: d.actual ?? null,
        estimate: d.estimate ?? null,
        surprisePercent: d.surprisePercent ?? null,
      }))
      .sort((a, b) => (a.period < b.period ? 1 : -1));
  });
  return res.data;
}

type CalRow = {
  symbol: string;
  date: string;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  quarter: number | null;
  year: number | null;
};

/**
 * Upcoming earnings for the whole market in ONE call (next 90 days), cached 12 h and
 * reduced to the requested symbols. Saves one API call per stock.
 */
async function earningsCalendar(): Promise<Record<string, UpcomingEarnings>> {
  const res = await cached("finnhub:calendar:90d", 12 * 3600, async () => {
    const from = new Date();
    const to = new Date(Date.now() + 90 * 86400_000);
    const data = await call<{ earningsCalendar?: CalRow[] }>(
      `calendar/earnings?from=${ymd(from)}&to=${ymd(to)}`
    );
    const out: Record<string, UpcomingEarnings> = {};
    for (const r of (data.earningsCalendar ?? []).sort((a, b) => (a.date < b.date ? -1 : 1))) {
      if (out[r.symbol]) continue;
      out[r.symbol] = {
        date: r.date,
        epsEstimate: r.epsEstimate ?? null,
        revenueEstimate: r.revenueEstimate ?? null,
        quarter: r.quarter ?? null,
        year: r.year ?? null,
      };
    }
    return out;
  });
  return res.data;
}

export async function getUpcomingEarnings(symbol: string): Promise<UpcomingEarnings | null> {
  const cal = await earningsCalendar();
  return cal[symbol] ?? null;
}

export async function getFundamentals(symbol: string): Promise<Fundamentals> {
  const res = await cached(`finnhub:metric:${symbol}`, 24 * 3600, async () => {
    const data = await call<{ metric?: Record<string, number | null> }>(
      `stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`
    );
    const m = data.metric ?? {};
    const n = (k: string) =>
      typeof m[k] === "number" && Number.isFinite(m[k]) ? (m[k] as number) : null;
    if (Object.keys(m).length === 0)
      throw new ProviderError(PROVIDER, `${symbol}: keine Kennzahlen verfügbar`);
    return {
      marketCap: n("marketCapitalization"),
      peTTM: n("peTTM") ?? n("peBasicExclExtraTTM"),
      revenueGrowthTTMYoy: n("revenueGrowthTTMYoy"),
      revenueGrowthQuarterlyYoy: n("revenueGrowthQuarterlyYoy"),
      epsGrowthTTMYoy: n("epsGrowthTTMYoy"),
      epsGrowthQuarterlyYoy: n("epsGrowthQuarterlyYoy"),
      grossMarginTTM: n("grossMarginTTM"),
      operatingMarginTTM: n("operatingMarginTTM"),
      netMarginTTM: n("netProfitMarginTTM"),
      roeTTM: n("roeTTM"),
      beta: n("beta"),
      currentRatio: n("currentRatioQuarterly"),
      totalDebtToEquity: n("totalDebt/totalEquityQuarterly"),
    };
  });
  return res.data;
}

export async function getCompanyNews(symbol: string, days = 14): Promise<NewsItem[]> {
  const res = await cached(`finnhub:news:${symbol}:${days}`, 900, async () => {
    const to = new Date();
    const from = new Date(Date.now() - days * 86400_000);
    const data = await call<
      {
        id: number;
        headline: string;
        summary: string;
        url: string;
        source: string;
        datetime: number;
        related: string;
      }[]
    >(`company-news?symbol=${encodeURIComponent(symbol)}&from=${ymd(from)}&to=${ymd(to)}`);
    return (Array.isArray(data) ? data : []).slice(0, 60).map((n): NewsItem => {
      const s = scoreSentiment(`${n.headline}. ${n.summary ?? ""}`);
      return {
        id: `f-${n.id}`,
        headline: n.headline,
        summary: n.summary ?? "",
        url: n.url,
        source: n.source,
        publishedAt: n.datetime * 1000,
        tickers: (n.related || symbol).split(",").filter(Boolean),
        sentiment: s.score,
        sentimentHits: s.hits,
        provider: PROVIDER,
      };
    });
  });
  return res.data;
}

export async function probeFinnhub(): Promise<{ ok: boolean; message: string }> {
  if (!finnhubConfigured()) {
    return {
      ok: false,
      message:
        "FINNHUB_API_KEY fehlt – Analysten, Earnings, Kennzahlen und Finnhub-News sind deaktiviert",
    };
  }
  try {
    const r = await getRecommendations("AAPL");
    return { ok: true, message: `OK – ${r.length} Empfehlungsperioden für AAPL` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

/** Real-time quote for US symbols (Finnhub free tier). Cached 60 s. */
export async function getFinnhubQuote(symbol: string): Promise<{
  price: number;
  change: number;
  changePct: number;
  previousClose: number;
  time: number;
} | null> {
  const res = await cached(`finnhub:quote:${symbol}`, 60, async () => {
    const q = await call<{ c: number; d: number; dp: number; pc: number; t: number }>(
      `quote?symbol=${encodeURIComponent(symbol)}`
    );
    if (!q || !q.c || !q.t) return null;
    return { price: q.c, change: q.d, changePct: q.dp, previousClose: q.pc, time: q.t * 1000 };
  });
  return res.data;
}
