"use client";

import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { useNews } from "../hooks";
import { fmtAge, fmtTime } from "../lib/format";
import { ErrorBox, Loading, Panel } from "../ui";
import { useOpenAnalysis } from "./common";

export function NewsView() {
  const { data, isLoading, error, refetch, isFetching } = useNews();
  const open = useOpenAnalysis();
  const [ticker, setTicker] = useState("ALL");
  const [tone, setTone] = useState<"ALL" | "POS" | "NEG">("ALL");
  const tickers = useMemo(
    () => Array.from(new Set((data?.items ?? []).map((n) => n.ticker))).sort(),
    [data]
  );
  const items = useMemo(
    () =>
      (data?.items ?? [])
        .filter((n) => ticker === "ALL" || n.ticker === ticker)
        .filter(
          (n) => tone === "ALL" || (tone === "POS" ? n.sentiment > 0.15 : n.sentiment < -0.15)
        ),
    [data, ticker, tone]
  );
  if (isLoading) return <Loading label="Lade echte Unternehmensnachrichten…" />;
  if (error) return <ErrorBox error={error} onRetry={() => refetch()} />;
  if (!data) return null;
  const sel = "h-6 border border-neutral-700 bg-black px-1 text-[11px]";
  return (
    <Panel
      title="Live News – Universum"
      right={
        <span>
          {isFetching ? "aktualisiere…" : `Stand ${fmtTime(data.generatedAt)}`} · Quellen:{" "}
          {data.sources.join(", ")}
        </span>
      }
    >
      <div className="mb-2 flex flex-wrap gap-2">
        <select className={sel} value={ticker} onChange={(e) => setTicker(e.target.value)}>
          <option value="ALL">Alle Titel</option>
          {tickers.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          className={sel}
          value={tone}
          onChange={(e) => setTone(e.target.value as "ALL" | "POS" | "NEG")}
        >
          <option value="ALL">Alle Tonalitäten</option>
          <option value="POS">Positiv</option>
          <option value="NEG">Negativ</option>
        </select>
        <span className="text-[10px] leading-6 text-neutral-500">
          Tonalität: transparentes Finanz-Lexikon auf Basis der echten Schlagzeile – Treffer werden
          angezeigt.
        </span>
      </div>
      {data.errors.length > 0 && (
        <div className="mb-2 text-[10px] text-red-400">
          Nicht abrufbar: {data.errors.map((e) => e.ticker).join(", ")}
        </div>
      )}
      <NewsList items={items} onTicker={open} />
    </Panel>
  );
}

export function NewsList({
  items,
  onTicker,
}: {
  items: {
    id: string;
    headline: string;
    summary: string;
    url: string;
    source: string;
    publishedAt: number;
    sentiment: number;
    sentimentHits: { positive: string[]; negative: string[] };
    ticker?: string;
    provider: string;
  }[];
  onTicker?: (t: string) => void;
}) {
  if (!items.length)
    return <div className="p-3 text-xs text-neutral-500">Keine Nachrichten gefunden.</div>;
  return (
    <ul className="divide-y divide-neutral-900">
      {items.map((n) => (
        <li key={n.id} className="flex gap-2 py-1.5 text-[11px]">
          <span
            className={cn(
              "mt-1 h-2 w-2 shrink-0 rounded-full",
              n.sentiment > 0.15
                ? "bg-emerald-500"
                : n.sentiment < -0.15
                  ? "bg-red-500"
                  : "bg-neutral-600"
            )}
            title={`Tonalität ${n.sentiment.toFixed(2)}`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              {n.ticker && onTicker && (
                <button
                  type="button"
                  onClick={() => onTicker(n.ticker as string)}
                  className="font-bold text-amber-300 hover:underline"
                >
                  {n.ticker}
                </button>
              )}
              <a
                href={n.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-neutral-100 hover:text-amber-200 hover:underline"
              >
                {n.headline} <ExternalLink className="inline h-2.5 w-2.5" />
              </a>
            </div>
            {n.summary && (
              <p className="mt-0.5 line-clamp-2 text-[10px] text-neutral-400">{n.summary}</p>
            )}
            <div className="mt-0.5 text-[9px] text-neutral-500">
              {n.source} · {fmtTime(n.publishedAt)} (vor {fmtAge(n.publishedAt)}) · via {n.provider}
              {n.sentimentHits.positive.length > 0 && (
                <span className="text-emerald-500"> · +{n.sentimentHits.positive.join(", ")}</span>
              )}
              {n.sentimentHits.negative.length > 0 && (
                <span className="text-red-500"> · −{n.sentimentHits.negative.join(", ")}</span>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
