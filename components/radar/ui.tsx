"use client";

import { CATEGORY_LABELS, COMPONENT_LABELS } from "@/lib/radar/config";
import type {
  ComponentResult,
  QuoteInfo,
  SignalCategory,
  StockAnalysis,
  TradeSetup,
} from "@/lib/radar/types";
import { cn } from "@/lib/utils";
import { AlertTriangle, Check, Copy, Loader2, RefreshCw } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  CATEGORY_STYLE,
  fmtAge,
  fmtNum,
  fmtPct,
  fmtTime,
  fmtVol,
  scoreColor,
  signColor,
} from "./lib/format";

/**
 * ISIN with one-tap copy (e.g. to search the stock at a broker such as Trade Republic).
 * Falls back to selecting the text if the clipboard API is not available.
 */
export function CopyIsin({
  isin,
  name,
  large,
}: {
  isin?: string | null;
  /** fallback: copy the company name (searchable at the broker) if no ISIN is known */
  name?: string;
  large?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const value = isin || name;
  const label = isin ? "ISIN" : "Name";
  if (!value) {
    return <span className="text-[9px] text-neutral-600">ISIN nicht hinterlegt</span>;
  }
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const sel = window.getSelection();
      const node = (e.currentTarget as HTMLElement).querySelector("[data-isin]");
      if (sel && node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      onKeyDown={(e) => e.stopPropagation()}
      title={
        isin
          ? "ISIN kopieren – z. B. in der Trade-Republic-Suche einfügen"
          : "Keine geprüfte ISIN hinterlegt – Firmennamen kopieren und in der Trade-Republic-Suche einfügen (Treffer prüfen)"
      }
      className={cn(
        "inline-flex items-center gap-1 border font-mono tabular-nums",
        large ? "px-2 py-1 text-xs" : "px-1 text-[9px] leading-4",
        copied
          ? "border-emerald-600 text-emerald-300"
          : "border-neutral-700 text-neutral-300 hover:border-amber-500 hover:text-amber-200"
      )}
    >
      <span className="text-neutral-500">{label}</span>
      <span data-isin className="max-w-[160px] select-all truncate">
        {value}
      </span>
      {copied ? (
        <Check className={large ? "h-3.5 w-3.5" : "h-2.5 w-2.5"} />
      ) : (
        <Copy className={large ? "h-3.5 w-3.5" : "h-2.5 w-2.5"} />
      )}
      {copied && <span>kopiert</span>}
    </button>
  );
}

export function Panel({
  title,
  right,
  children,
  className,
}: {
  title: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("border border-neutral-800 bg-[#0b0b0b]", className)}>
      <header className="flex items-center justify-between gap-2 border-b border-neutral-800 bg-[#151515] px-2 py-1">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-amber-400">{title}</h2>
        {right && (
          <div className="flex items-center gap-2 text-[11px] text-neutral-400">{right}</div>
        )}
      </header>
      <div className="p-2">{children}</div>
    </section>
  );
}

export function CategoryBadge({ category, small }: { category: SignalCategory; small?: boolean }) {
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap px-1.5 font-bold",
        small ? "text-[9px] leading-4" : "text-[10px] leading-5",
        CATEGORY_STYLE[category]
      )}
    >
      {CATEGORY_LABELS[category]}
    </span>
  );
}

export function ScoreBar({ score, width = 70 }: { score: number; width?: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("w-7 text-right font-bold tabular-nums", scoreColor(score))}>
        {score.toFixed(0)}
      </span>
      <div className="h-1.5 bg-neutral-800" style={{ width }}>
        <div
          className={cn(
            "h-full",
            score >= 72
              ? "bg-emerald-500"
              : score >= 63
                ? "bg-lime-400"
                : score >= 55
                  ? "bg-amber-400"
                  : score < 42
                    ? "bg-red-500"
                    : "bg-neutral-500"
          )}
          style={{ width: `${Math.max(2, score)}%` }}
        />
      </div>
    </div>
  );
}

export function ComponentBars({
  components,
  weights,
}: { components: ComponentResult[]; weights?: Record<string, number> }) {
  return (
    <div className="space-y-1">
      {components.map((c) => (
        <div key={c.key} className="grid grid-cols-[150px_1fr_44px] items-center gap-2 text-[11px]">
          <span className="truncate text-neutral-300" title={COMPONENT_LABELS[c.key]}>
            {COMPONENT_LABELS[c.key]}
            {weights && <span className="ml-1 text-neutral-500">({weights[c.key]})</span>}
          </span>
          {c.score == null ? (
            <span className="text-[10px] text-neutral-500" title={c.unavailableReason}>
              nicht verfügbar – {c.unavailableReason}
            </span>
          ) : (
            <div className="relative h-2 bg-neutral-800">
              <div className="absolute left-1/2 top-0 h-full w-px bg-neutral-600" />
              <div
                className={cn(
                  "h-full",
                  c.direction === 1
                    ? "bg-emerald-500"
                    : c.direction === -1
                      ? "bg-red-500"
                      : "bg-neutral-500"
                )}
                style={{ width: `${c.score * 100}%` }}
              />
            </div>
          )}
          <span className="text-right tabular-nums text-neutral-400">
            {c.score == null ? "–" : (c.score * 100).toFixed(0)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Sparkline({
  values,
  width = 80,
  height = 20,
}: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <span className="text-neutral-600">–</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const r = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * width},${height - ((v - min) / r) * height}`)
    .join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width={width} height={height} className="overflow-visible" role="img">
      <title>Kursverlauf</title>
      <polyline points={pts} fill="none" stroke={up ? "#34d399" : "#f87171"} strokeWidth={1.2} />
    </svg>
  );
}

export function Loading({ label = "Lade echte Marktdaten…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-4 text-xs text-amber-300">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-2 border border-red-800 bg-red-950/40 p-3 text-xs text-red-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">
        <div className="font-bold">
          Datenquelle nicht verfügbar – es werden keine Ersatz- oder Beispieldaten angezeigt.
        </div>
        <div className="mt-1 break-all text-red-400">
          {error instanceof Error ? error.message : String(error)}
        </div>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-1 border border-red-700 px-2 py-0.5 hover:bg-red-900"
        >
          <RefreshCw className="h-3 w-3" /> Erneut
        </button>
      )}
    </div>
  );
}

export function FreshnessTag({ quote }: { quote: QuoteInfo }) {
  const color =
    quote.freshness === "realtime"
      ? "text-emerald-400 border-emerald-800"
      : quote.freshness === "delayed"
        ? "text-amber-300 border-amber-800"
        : "text-neutral-400 border-neutral-700";
  const label =
    quote.freshness === "realtime"
      ? "ECHTZEIT"
      : quote.freshness === "delayed"
        ? "VERZÖGERT"
        : "SCHLUSS";
  return (
    <span
      className={cn("border px-1 text-[9px] font-bold", color)}
      title={`${quote.delayNote} · letzter Kurs ${fmtTime(quote.marketTime)}`}
    >
      {label}
    </span>
  );
}

export type Column =
  | "name"
  | "price"
  | "change"
  | "volume"
  | "volRatio"
  | "score"
  | "category"
  | "detected"
  | "reason"
  | "ret20"
  | "ext"
  | "coverage"
  | "sector"
  | "trade";

export function StockTable({
  rows,
  columns,
  onSelect,
  sortKey,
  onSort,
  rightSlot,
}: {
  rows: StockAnalysis[];
  columns: Column[];
  onSelect: (ticker: string) => void;
  sortKey?: string;
  onSort?: (key: Column) => void;
  rightSlot?: (row: StockAnalysis) => ReactNode;
}) {
  const head: Record<Column, string> = {
    name: "Unternehmen",
    price: "Kurs",
    change: "Tag %",
    volume: "Volumen",
    volRatio: "Vol/Ø50",
    score: "AI Score",
    category: "Signal",
    detected: "Erkannt",
    reason: "Begründung",
    ret20: "20T %",
    ext: "Überdehnung",
    coverage: "Daten",
    trade: "Trade",
    sector: "Sektor",
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-[10px] uppercase text-neutral-500">
            {columns.map((c) => (
              <th
                key={c}
                className={cn(
                  "whitespace-nowrap px-1.5 py-1 font-normal",
                  onSort && "cursor-pointer hover:text-amber-300",
                  sortKey === c && "text-amber-400"
                )}
                onClick={onSort ? () => onSort(c) : undefined}
                onKeyDown={onSort ? (e) => e.key === "Enter" && onSort(c) : undefined}
              >
                {head[c]}
              </th>
            ))}
            {rightSlot && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.entry.ticker}
              className="cursor-pointer border-b border-neutral-900 hover:bg-neutral-900"
              onClick={() => onSelect(r.entry.ticker)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSelect(r.entry.ticker);
              }}
              tabIndex={0}
            >
              {columns.map((c) => (
                <td key={c} className="px-1.5 py-1 align-top">
                  {cell(r, c)}
                </td>
              ))}
              {rightSlot && (
                <td
                  className="px-1.5 py-1"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  {rightSlot(r)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function cell(r: StockAnalysis, c: Column): ReactNode {
  const q = r.quote;
  switch (c) {
    case "name":
      return (
        <div className="min-w-[140px]">
          <span className="font-bold text-amber-300">{r.entry.ticker}</span>{" "}
          <span className="text-neutral-300">{r.entry.name}</span>
          <div className="flex flex-wrap items-center gap-1 text-[9px] text-neutral-500">
            {q.exchange} <CopyIsin isin={r.entry.isin} name={r.entry.name} />
          </div>
        </div>
      );
    case "price":
      return (
        <div className="whitespace-nowrap tabular-nums">
          {fmtNum(q.price)} <span className="text-[9px] text-neutral-500">{q.currency}</span>{" "}
          <FreshnessTag quote={q} />
        </div>
      );
    case "change":
      return (
        <span className={cn("tabular-nums", signColor(q.changePct))}>{fmtPct(q.changePct)}</span>
      );
    case "volume":
      return <span className="tabular-nums text-neutral-300">{fmtVol(q.volume)}</span>;
    case "volRatio": {
      const v = r.technical.volRatio50;
      return (
        <span
          className={cn(
            "tabular-nums",
            v != null && v > 1.5 ? "text-amber-300" : "text-neutral-300"
          )}
        >
          {v == null ? "–" : `${fmtNum(v, 2)}×`}
        </span>
      );
    }
    case "score":
      return <ScoreBar score={r.score} />;
    case "category":
      return <CategoryBadge category={r.category} />;
    case "detected":
      return (
        <span
          className="whitespace-nowrap text-neutral-400"
          title={
            r.detectedAt
              ? new Date(r.detectedAt).toLocaleString("de-DE")
              : "Erkennungszeitpunkt liegt nur für die Standardgewichtung vor"
          }
        >
          {r.detectedAt ? `${fmtTime(r.detectedAt)} (${fmtAge(r.detectedAt)})` : "–"}
        </span>
      );
    case "reason": {
      const pos = r.factors.filter((f) => f.impact === "positive").slice(0, 2);
      const neg = r.factors.filter((f) => f.impact === "negative").slice(0, 1);
      return (
        <div className="max-w-[440px] space-y-0.5 text-[10px]">
          {pos.map((f) => (
            <div key={f.text} className="text-emerald-300">
              ▲ {f.text}
            </div>
          ))}
          {neg.map((f) => (
            <div key={f.text} className="text-red-300">
              ▼ {f.text}
            </div>
          ))}
          {!pos.length && !neg.length && (
            <div className="text-neutral-500">keine ausgeprägten Signale</div>
          )}
        </div>
      );
    }
    case "ret20":
      return (
        <span className={cn("tabular-nums", signColor(r.technical.ret20))}>
          {fmtPct(r.technical.ret20, 1)}
        </span>
      );
    case "ext":
      return r.extension.level > 0.2 ? (
        <span className="text-[10px] text-orange-400" title={r.extension.notes.join(" · ")}>
          −{r.extension.penalty.toFixed(1)} Pkt
        </span>
      ) : (
        <span className="text-neutral-600">–</span>
      );
    case "coverage":
      return (
        <span
          className={cn("tabular-nums", r.coverage < 0.8 ? "text-amber-400" : "text-neutral-400")}
          title={r.warnings.join("\n")}
        >
          {(r.coverage * 100).toFixed(0)} %
        </span>
      );
    case "sector":
      return <span className="text-neutral-400">{r.entry.sector}</span>;
    case "trade":
      return <TradeBadge trade={r.trade} />;
  }
}

export function TradeBadge({ trade, large }: { trade: TradeSetup; large?: boolean }) {
  const style =
    trade.bias === "LONG"
      ? "border-emerald-500 text-emerald-300"
      : trade.bias === "SHORT"
        ? "border-red-500 text-red-300"
        : trade.entry != null
          ? "border-amber-600 text-amber-300"
          : "border-neutral-700 text-neutral-500";
  const label =
    trade.bias === "LONG"
      ? "▲ LONG"
      : trade.bias === "SHORT"
        ? "▼ SHORT"
        : trade.entry != null
          ? "ABWARTEN"
          : "KEIN TRADE";
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap border px-1.5 font-bold",
        large ? "text-sm leading-7" : "text-[10px] leading-5",
        style
      )}
      title={`${trade.action} · Überzeugung ${trade.convictionLabel}`}
    >
      {label}
    </span>
  );
}
