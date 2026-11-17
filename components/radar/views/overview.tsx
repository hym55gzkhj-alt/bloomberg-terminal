"use client";

import { cn } from "@/lib/utils";
import { useMemo } from "react";
import { useOverview, useWeightedResults } from "../hooks";
import { fmtNum, fmtPct, fmtTime, signColor } from "../lib/format";
import { CategoryBadge, ErrorBox, Loading, Panel, Sparkline } from "../ui";
import { useOpenAnalysis } from "./common";

export function OverviewView() {
  const { data, isLoading, error, refetch } = useOverview();
  const scan = useWeightedResults();
  const open = useOpenAnalysis();
  const groups = useMemo(() => {
    const g: Record<string, NonNullable<typeof data>["rows"]> = {};
    for (const r of data?.rows ?? []) {
      if (!g[r.group]) g[r.group] = [];
      g[r.group].push(r);
    }
    return g;
  }, [data]);

  const breadth = useMemo(() => {
    const rs = scan.results;
    if (!rs.length) return null;
    return {
      up: rs.filter((r) => r.quote.changePct > 0).length,
      above50: rs.filter((r) => r.technical.sma50 != null && r.technical.close > r.technical.sma50)
        .length,
      positive: rs.filter((r) =>
        ["EARLY_SIGNAL", "BUILDING_MOMENTUM", "STRONG_MOMENTUM"].includes(r.category)
      ).length,
      negative: rs.filter((r) => r.category === "NEGATIVE").length,
      total: rs.length,
    };
  }, [scan.results]);

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={() => refetch()} />;
  if (!data) return null;

  return (
    <div className="grid gap-2 xl:grid-cols-[1fr_360px]">
      <div className="grid gap-2 md:grid-cols-2">
        {Object.entries(groups).map(([g, rows]) => (
          <Panel key={g} title={g}>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-[10px] uppercase text-neutral-500">
                  <th className="font-normal">Instrument</th>
                  <th className="text-right font-normal">Kurs</th>
                  <th className="text-right font-normal">Tag</th>
                  <th className="text-right font-normal">20T</th>
                  <th className="text-right font-normal">YTD</th>
                  <th className="pl-2 font-normal">30T</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.symbol}
                    className="border-t border-neutral-900"
                    title={r.error ?? `${r.delayNote ?? ""} · ${fmtTime(r.marketTime)}`}
                  >
                    <td className="py-0.5">
                      <span className="text-amber-300">{r.symbol}</span>{" "}
                      <span className="text-neutral-400">{r.name}</span>
                    </td>
                    {r.error ? (
                      <td colSpan={5} className="text-right text-[10px] text-red-400">
                        nicht verfügbar
                      </td>
                    ) : (
                      <>
                        <td className="text-right tabular-nums">{fmtNum(r.price)}</td>
                        <td className={cn("text-right tabular-nums", signColor(r.changePct))}>
                          {fmtPct(r.changePct)}
                        </td>
                        <td className={cn("text-right tabular-nums", signColor(r.ret20))}>
                          {fmtPct(r.ret20, 1)}
                        </td>
                        <td className={cn("text-right tabular-nums", signColor(r.ytd))}>
                          {fmtPct(r.ytd, 1)}
                        </td>
                        <td className="pl-2">
                          <Sparkline values={r.spark} width={70} height={14} />
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        ))}
      </div>
      <div className="space-y-2">
        <Panel title="Marktbreite (Radar-Universum)">
          {breadth ? (
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <Stat label="Im Plus heute" value={`${breadth.up}/${breadth.total}`} />
              <Stat label="Über SMA50" value={`${breadth.above50}/${breadth.total}`} />
              <Stat label="Positive Signale" value={String(breadth.positive)} tone="pos" />
              <Stat label="Negative Signale" value={String(breadth.negative)} tone="neg" />
            </div>
          ) : scan.error ? (
            <ErrorBox error={scan.error} />
          ) : (
            <Loading />
          )}
        </Panel>
        <Panel title="Stärkste Signale">
          {scan.results.slice(0, 8).map((r) => (
            <button
              type="button"
              key={r.entry.ticker}
              onClick={() => open(r.entry.ticker)}
              className="flex w-full items-center justify-between border-b border-neutral-900 py-1 text-left text-[11px] hover:bg-neutral-900"
            >
              <span>
                <span className="font-bold text-amber-300">{r.entry.ticker}</span>{" "}
                <span className="text-neutral-400">{r.entry.name}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums">{r.score.toFixed(0)}</span>
                <CategoryBadge category={r.category} small />
              </span>
            </button>
          ))}
        </Panel>
        <p className="text-[10px] text-neutral-500">
          Quelle: Yahoo Finance (verzögert). Stand {fmtTime(data.generatedAt)}. Indexwerte ohne
          Volumen.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div className="border border-neutral-800 p-2">
      <div className="text-[10px] uppercase text-neutral-500">{label}</div>
      <div
        className={cn(
          "text-lg font-bold tabular-nums",
          tone === "pos" && "text-emerald-400",
          tone === "neg" && "text-red-400"
        )}
      >
        {value}
      </div>
    </div>
  );
}
