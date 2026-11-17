import { cached } from "../cache";
import { scoreSentiment } from "../sentiment";
import type { Bar, NewsItem, PriceHistory, QuoteInfo } from "../types";
import { ProviderError, RateLimiter, fetchJson } from "./http";

/**
 * Yahoo Finance public chart + search endpoints. No API key required.
 * Data is delayed (typically 15 min for US, 15-20 min for European exchanges) and the
 * endpoints are unofficial – availability is not guaranteed. Every failure surfaces as
 * an error; nothing is ever substituted.
 */

const PROVIDER = "Yahoo Finance";
const BASE = "https://query1.finance.yahoo.com";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; AIStockRadar/1.0)",
  Accept: "application/json",
};

const g = globalThis as unknown as { __yahooLimiter?: RateLimiter };
// Conservative: max 100 requests / minute, 6 concurrent.
if (!g.__yahooLimiter) g.__yahooLimiter = new RateLimiter(100, 60_000, 6);
const limiter = g.__yahooLimiter;

interface YahooChartResponse {
  chart: {
    result:
      | {
          meta: {
            currency: string;
            symbol: string;
            exchangeName: string;
            fullExchangeName?: string;
            instrumentType?: string;
            regularMarketPrice: number;
            regularMarketTime: number;
            regularMarketDayHigh?: number;
            regularMarketDayLow?: number;
            regularMarketVolume?: number;
            fiftyTwoWeekHigh?: number;
            fiftyTwoWeekLow?: number;
            longName?: string;
            shortName?: string;
            gmtoffset: number;
            exchangeTimezoneName: string;
            currentTradingPeriod?: {
              pre?: { start: number; end: number };
              regular?: { start: number; end: number };
              post?: { start: number; end: number };
            };
          };
          timestamp?: number[];
          indicators: {
            quote: {
              open: (number | null)[];
              high: (number | null)[];
              low: (number | null)[];
              close: (number | null)[];
              volume: (number | null)[];
            }[];
            adjclose?: { adjclose: (number | null)[] }[];
          };
        }[]
      | null;
    error: { code: string; description: string } | null;
  };
}

function isoDate(tSec: number, gmtoffset: number): string {
  return new Date((tSec + gmtoffset) * 1000).toISOString().slice(0, 10);
}

async function rawChart(symbol: string, range: string): Promise<PriceHistory> {
  const url = `${BASE}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false&events=div%2Csplit`;
  const json = await limiter.schedule(() =>
    fetchJson<YahooChartResponse>(PROVIDER, url, { headers: HEADERS })
  );
  if (json.chart.error) {
    throw new ProviderError(PROVIDER, `${symbol}: ${json.chart.error.description}`);
  }
  const r = json.chart.result?.[0];
  if (!r || !r.timestamp?.length) throw new ProviderError(PROVIDER, `${symbol}: no price data`);

  const m = r.meta;
  const q = r.indicators.quote[0];
  const adj = r.indicators.adjclose?.[0]?.adjclose;
  const rawBars: (Bar & { rawClose: number })[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const o = q.open[i];
    const h = q.high[i];
    const l = q.low[i];
    const c = q.close[i];
    const v = q.volume[i];
    if (o == null || h == null || l == null || c == null || c <= 0) continue;
    const a = adj?.[i];
    const f = a != null && a > 0 ? a / c : 1;
    rawBars.push({
      t: r.timestamp[i],
      date: isoDate(r.timestamp[i], m.gmtoffset),
      open: o * f,
      high: h * f,
      low: l * f,
      close: c * f,
      volume: v ?? 0,
      rawClose: c,
    });
  }
  // de-duplicate dates (Yahoo sometimes returns the live bar twice)
  const bars: (Bar & { rawClose: number })[] = [];
  for (const b of rawBars) {
    if (bars.length && bars[bars.length - 1].date === b.date) bars[bars.length - 1] = b;
    else bars.push(b);
  }
  if (bars.length < 2) throw new ProviderError(PROVIDER, `${symbol}: insufficient history`);

  const nowSec = Date.now() / 1000;
  const reg = m.currentTradingPeriod?.regular;
  const pre = m.currentTradingPeriod?.pre;
  const post = m.currentTradingPeriod?.post;
  let marketState: QuoteInfo["marketState"] = "closed";
  let sessionElapsed = 1;
  if (reg && nowSec >= reg.start && nowSec < reg.end) {
    marketState = "open";
    sessionElapsed = Math.min(1, Math.max(0, (nowSec - reg.start) / (reg.end - reg.start)));
  } else if (pre && nowSec >= pre.start && nowSec < pre.end) marketState = "pre";
  else if (post && nowSec >= post.start && nowSec < post.end) marketState = "post";

  const todayDate = isoDate(Math.floor(nowSec), m.gmtoffset);
  const last = bars[bars.length - 1];
  const lastBarPartial = marketState === "open" && last.date === todayDate;

  const price = m.regularMarketPrice;
  // previous close = raw close of the bar before the latest session
  const lastIsCurrentSession = last.date === isoDate(m.regularMarketTime, m.gmtoffset);
  const prevBar = lastIsCurrentSession ? bars[bars.length - 2] : last;
  const previousClose = prevBar.rawClose;
  const change = price - previousClose;
  const isIndex = m.instrumentType === "INDEX" || symbol.startsWith("^");

  const quote: QuoteInfo = {
    symbol: m.symbol,
    name: m.longName || m.shortName?.trim() || m.symbol,
    currency: m.currency,
    exchange: m.fullExchangeName || m.exchangeName,
    price,
    previousClose,
    change,
    changePct: (change / previousClose) * 100,
    dayHigh: m.regularMarketDayHigh ?? null,
    dayLow: m.regularMarketDayLow ?? null,
    volume: isIndex ? null : (m.regularMarketVolume ?? null),
    fiftyTwoWeekHigh: m.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: m.fiftyTwoWeekLow ?? null,
    marketTime: m.regularMarketTime * 1000,
    marketState,
    sessionElapsed,
    freshness: marketState === "open" ? "delayed" : "end-of-day",
    delayNote:
      marketState === "open"
        ? "Yahoo Finance – verzögerte Kurse (US i.d.R. bis 15 Min., EU 15–20 Min.)"
        : "Yahoo Finance – letzter Schlusskurs / Handel außerhalb der regulären Sitzung",
    source: PROVIDER,
  };

  return {
    quote,
    bars: bars.map(({ rawClose: _r, ...b }) => b),
    lastBarPartial,
    source: PROVIDER,
    fetchedAt: Date.now(),
  };
}

/**
 * Daily history (adjusted) + current quote. TTL is short while the market is open and
 * longer when it is closed, which keeps provider traffic low.
 */
export async function getHistory(symbol: string, range: "1y" | "2y" | "5y" | "10y" = "2y") {
  const key = `yahoo:chart:${symbol}:${range}`;
  const res = await cached(key, 300, () => rawChart(symbol, range));
  return res;
}

interface YahooSearchResponse {
  news?: {
    uuid: string;
    title: string;
    publisher: string;
    link: string;
    providerPublishTime: number;
    relatedTickers?: string[];
    type?: string;
  }[];
}

export async function getYahooNews(symbol: string, count = 15): Promise<NewsItem[]> {
  const key = `yahoo:news:${symbol}:${count}`;
  const res = await cached(key, 900, async () => {
    const url = `${BASE}/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=0&newsCount=${count}&enableFuzzyQuery=false`;
    const json = await limiter.schedule(() =>
      fetchJson<YahooSearchResponse>(PROVIDER, url, { headers: HEADERS })
    );
    return (json.news ?? []).map((n): NewsItem => {
      const s = scoreSentiment(n.title);
      return {
        id: `y-${n.uuid}`,
        headline: n.title,
        summary: "",
        url: n.link,
        source: n.publisher,
        publishedAt: n.providerPublishTime * 1000,
        tickers: n.relatedTickers ?? [symbol],
        sentiment: s.score,
        sentimentHits: s.hits,
        provider: PROVIDER,
      };
    });
  });
  return res.data;
}

/** Health probe used in the provider status panel. */
export async function probeYahoo(): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await getHistory("SPY", "1y");
    return {
      ok: true,
      message: `OK – SPY ${r.data.quote.price.toFixed(2)} (${r.data.quote.delayNote})`,
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export interface SearchHit {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

/** Company-name search (Yahoo Finance). Returns equities only. */
export async function searchSymbols(query: string): Promise<SearchHit[]> {
  const q = query.trim().slice(0, 60);
  if (q.length < 2) return [];
  const res = await cached(`yahoo:search:${q.toLowerCase()}`, 3600, async () => {
    const url = `${BASE}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&enableFuzzyQuery=true`;
    const json = await limiter.schedule(() =>
      fetchJson<{
        quotes?: {
          symbol: string;
          shortname?: string;
          longname?: string;
          exchDisp?: string;
          quoteType?: string;
        }[];
      }>(PROVIDER, url, { headers: HEADERS })
    );
    return (json.quotes ?? [])
      .filter((x) => x.quoteType === "EQUITY" && x.symbol)
      .map((x) => ({
        symbol: x.symbol,
        name: (x.longname || x.shortname || x.symbol).trim(),
        exchange: x.exchDisp ?? "",
        type: x.quoteType ?? "",
      }));
  });
  return res.data;
}
