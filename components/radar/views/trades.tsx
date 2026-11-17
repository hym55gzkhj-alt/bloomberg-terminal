"use client";

import type { StockAnalysis } from "@/lib/radar/types";
import { cn } from "@/lib/utils";
import { useMemo } from "react";
import { useWeightedResults } from "../hooks";
import { fmtNum, fmtPct, signColor } from "../lib/format";
import { RuleTrackRecord } from "../trade-panel";
import { CategoryBadge, ErrorBox, Loading, Panel, ScoreBar, TradeBadge } from "../ui";
import { ScanMeta, useOpenAnalysis } from "./common";

function TradeTable({ rows, onSelect }: { rows: StockAnalysis[]; onSelect: (t: string) => void }) {
  if (!rows.length) {
    return (
      <div className="p-3 text-xs text-neutral-500">
        Derzeit keine Titel mit diesem Setup – es werden keine Trades erfunden.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-[10px] uppercase text-neutral-500">
            <th className="px-1.5 font-normal">Titel</th>
            <th className="px-1.5 font-normal">Setup</th>
            <th className="px-1.5 text-right font-normal">Kurs</th>
            <th className="px-1.5 text-right font-normal">Einstieg</th>
            <th className="px-1.5 text-right font-normal">Stop</th>
            <th className="px-1.5 text-right font-normal">Ziel 1</th>
            <th className="px-1.5 text-right font-normal">Ziel 2</th>
            <th className="px-1.5 text-right font-normal">Risiko</th>
            <th className="px-1.5 font-normal">Überzeugung</th>
            <th className="px-1.5 font-normal">Score</th>
            <th className="px-1.5 font-normal">Hauptgrund</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const t = r.trade;
            const dir = t.bias === "SHORT" ? -1 : 1;
            const rel = (x: number | null) =>
              x == null || t.entry == null ? null : dir * (x / t.entry - 1) * 100;
            return (
              <tr
                key={r.entry.ticker}
                tabIndex={0}
                className="cursor-pointer border-t border-neutral-900 hover:bg-neutral-900"
                onClick={() => onSelect(r.entry.ticker)}
                onKeyDown={(e) => e.key === "Enter" && onSelect(r.entry.ticker)}
              >
                <td className="px-1.5 py-1">
                  <span className="font-bold text-amber-300">{r.entry.ticker}</span>{" "}
                  <span className="text-neutral-300">{r.entry.name}</span>
                </td>
                <td className="px-1.5">
                  <div className="flex items-center gap-1">
                    <TradeBadge trade={t} />
                    <CategoryBadge category={r.category} small />
                  </div>
                </td>
                <td className="px-1.5 text-right tabular-nums">
                  {fmtNum(r.quote.price)}{" "}
                  <span className={cn("text-[9px]", signColor(r.quote.changePct))}>
                    {fmtPct(r.quote.changePct, 1)}
                  </span>
                </td>
                <td className="px-1.5 text-right tabular-nums text-amber-300">{fmtNum(t.entry)}</td>
                <td className="px-1.5 text-right tabular-nums text-red-400">
                  {t.stop == null ? (
                    "–"
                  ) : (
                    <>
                      {fmtNum(t.stop)} <span className="text-[9px]">{fmtPct(rel(t.stop), 1)}</span>
                    </>
                  )}
                </td>
                <td className="px-1.5 text-right tabular-nums text-emerald-400">
                  {t.target1 == null ? (
                    "–"
                  ) : (
                    <>
                      {fmtNum(t.target1)}{" "}
                      <span className="text-[9px]">{fmtPct(rel(t.target1), 1)}</span>
                    </>
                  )}
                </td>
                <td className="px-1.5 text-right tabular-nums text-emerald-400">
                  {t.target2 == null ? (
                    "–"
                  ) : (
                    <>
                      {fmtNum(t.target2)}{" "}
                      <span className="text-[9px]">{fmtPct(rel(t.target2), 1)}</span>
                    </>
                  )}
                </td>
                <td className="px-1.5 text-right tabular-nums">
                  {t.riskPct == null ? "–" : `${fmtNum(t.riskPct, 1)} %`}
                </td>
                <td className="px-1.5">
                  {t.convictionLabel} <span className="text-neutral-500">({t.conviction})</span>
                </td>
                <td className="px-1.5">
                  <ScoreBar score={r.score} width={50} />
                </td>
                <td className="max-w-[320px] px-1.5 text-[10px] text-neutral-400">
                  {t.reasons[0] ?? t.entryNote}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function TradesView() {
  const { data, results, isLoading, error, refetch } = useWeightedResults();
  const open = useOpenAnalysis();
  const { longs, shorts, waiting } = useMemo(
    () => ({
      longs: results
        .filter((r) => r.trade.bias === "LONG")
        .sort((a, b) => b.trade.conviction - a.trade.conviction),
      shorts: results
        .filter((r) => r.trade.bias === "SHORT")
        .sort((a, b) => b.trade.conviction - a.trade.conviction),
      waiting: results.filter((r) => r.trade.bias === "NEUTRAL" && r.trade.entry != null),
    }),
    [results]
  );
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={() => refetch()} />;
  if (!data) return null;
  return (
    <div className="space-y-2">
      <div className="border border-amber-800 bg-amber-950/30 p-2 text-[11px] text-amber-200">
        Regelbasierte Einschätzung aus echten Daten – keine Anlageberatung und keine Gewinngarantie.
        Wie oft genau diese Regeln in der Vergangenheit aufgegangen sind (inkl. Stop-Loss, Kosten,
        Fehlsignalen), zeigt die Ansicht <b>BT</b> (Richtung Long bzw. Short wählen).
      </div>
      <Panel title={`▲ Long-Setups (${longs.length})`} className="border-emerald-900">
        <div className="mb-2">
          <RuleTrackRecord direction="long" />
        </div>
        <TradeTable rows={longs} onSelect={open} />
      </Panel>
      <Panel title={`▼ Short-Setups (${shorts.length})`} className="border-red-900">
        <div className="mb-2">
          <RuleTrackRecord direction="short" />
        </div>
        <TradeTable rows={shorts} onSelect={open} />
      </Panel>
      <Panel
        title={`Abwarten – Setup vorhanden, aber Einstieg erst nach Rücksetzer/Erholung (${waiting.length})`}
      >
        <TradeTable rows={waiting} onSelect={open} />
      </Panel>
      <ScanMeta scan={data} />
    </div>
  );
}
