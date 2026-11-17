"use client";

import { DEFAULT_CONFIG } from "@/lib/radar/config";
import type { OverviewRow } from "@/lib/radar/scan";
import { buildFactors, combine, explain } from "@/lib/radar/scoring";
import { tradeSetup } from "@/lib/radar/trade";
import type {
  BacktestParams,
  BacktestResult,
  DetailPayload,
  NewsItem,
  ProviderStatus,
  ScanResult,
  StockAnalysis,
  Weights,
} from "@/lib/radar/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { weightsAtom } from "./state";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Ungültige Antwort von ${url} (HTTP ${res.status})`);
  }
  if (!res.ok) {
    const msg = (body as { error?: string })?.error ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body as T;
}

export const keys = {
  scan: ["radar", "scan"] as const,
  overview: ["radar", "overview"] as const,
  news: ["radar", "news"] as const,
  status: ["radar", "status"] as const,
  detail: (t: string) => ["radar", "detail", t] as const,
  backtest: (p: Partial<BacktestParams>) => ["radar", "backtest", p] as const,
};

export function useScan() {
  return useQuery({
    queryKey: keys.scan,
    queryFn: () => getJson<ScanResult>("/api/radar/scan"),
    // while rate-limited Finnhub data is still loading in the background, refresh sooner
    refetchInterval: (q) =>
      q.state.data?.results.some((r) => r.warnings.some((w) => w.includes("nachgeladen")))
        ? 60_000
        : 5 * 60_000,
    staleTime: 4 * 60_000,
    retry: 1,
  });
}

export function useOverview() {
  return useQuery({
    queryKey: keys.overview,
    queryFn: () => getJson<{ rows: OverviewRow[]; generatedAt: number }>("/api/radar/overview"),
    refetchInterval: 3 * 60_000,
    staleTime: 2 * 60_000,
    retry: 1,
  });
}

export function useNews() {
  return useQuery({
    queryKey: keys.news,
    queryFn: () =>
      getJson<{
        items: (NewsItem & { ticker: string })[];
        errors: { ticker: string; message: string }[];
        sources: string[];
        generatedAt: number;
      }>("/api/radar/news"),
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
    retry: 1,
  });
}

export function useStatus() {
  return useQuery({
    queryKey: keys.status,
    queryFn: () => getJson<{ providers: ProviderStatus[] }>("/api/radar/status"),
    refetchInterval: 2 * 60_000,
    retry: 0,
  });
}

export function useDetail(ticker: string | null) {
  return useQuery({
    queryKey: keys.detail(ticker ?? ""),
    queryFn: () => getJson<DetailPayload>(`/api/radar/stock/${encodeURIComponent(ticker ?? "")}`),
    enabled: Boolean(ticker),
    refetchInterval: 5 * 60_000,
    staleTime: 2 * 60_000,
    retry: 0,
  });
}

export function useBacktest(params: Partial<BacktestParams>, enabled = true) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    qs.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  return useQuery({
    queryKey: keys.backtest(params),
    queryFn: () => getJson<BacktestResult>(`/api/radar/backtest?${qs.toString()}`),
    enabled,
    staleTime: 30 * 60_000,
    placeholderData: keepPreviousData,
    retry: 0,
  });
}

/** Re-applies the user's weights to the REAL component data returned by the server. */
export function reweight(
  a: StockAnalysis,
  weights: Weights
): StockAnalysis & { serverCategory: string } {
  const c = combine(a.components, weights, a.extension, DEFAULT_CONFIG);
  return {
    ...a,
    score: c.score,
    coverage: c.coverage,
    category: c.category,
    factors: buildFactors(a.components, a.extension),
    explanation: explain(a.components, c, a.extension, weights),
    detectedAt: c.category === a.category ? a.detectedAt : null,
    trade: tradeSetup({
      category: c.category,
      score: c.score,
      coverage: c.coverage,
      technical: a.technical,
      extension: a.extension,
      components: a.components,
    }),
    serverCategory: a.category,
  };
}

export function useWeightedResults() {
  const scan = useScan();
  const weights = useAtomValue(weightsAtom);
  const results = useMemo(
    () =>
      (scan.data?.results ?? []).map((a) => reweight(a, weights)).sort((x, y) => y.score - x.score),
    [scan.data, weights]
  );
  return { ...scan, results, weights };
}
