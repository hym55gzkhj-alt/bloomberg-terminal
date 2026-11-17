"use client";

import { useMemo } from "react";
import { useWeightedResults } from "../hooks";
import { ErrorBox, Loading, Panel, StockTable } from "../ui";
import { ScanMeta, useOpenAnalysis } from "./common";

/**
 * Top Opportunities = positive signal categories WITHOUT a large prior run-up.
 * Ranking: score × (1 − extension level), i.e. early, not late.
 */
export function OpportunitiesView() {
  const { data, results, isLoading, error, refetch } = useWeightedResults();
  const open = useOpenAnalysis();
  const rows = useMemo(
    () =>
      results
        .filter(
          (r) =>
            ["EARLY_SIGNAL", "BUILDING_MOMENTUM", "STRONG_MOMENTUM"].includes(r.category) &&
            r.extension.level < 0.5
        )
        .map((r) => ({ r, early: r.score * (1 - r.extension.level) }))
        .sort((a, b) => b.early - a.early)
        .map((x) => x.r),
    [results]
  );
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={() => refetch()} />;
  if (!data) return null;
  return (
    <Panel
      title="Top Opportunities – positive Signale ohne bereits starke Überdehnung"
      right={<span>Ranking: Score × (1 − Überdehnung)</span>}
    >
      <p className="mb-2 text-[10px] text-neutral-500">
        Gezeigt werden nur Titel mit positiver Einstufung, deren Kurs noch nicht stark überdehnt ist
        (Abstand zur SMA50 in ATR, RSI, 60-Tage-Rendite). Bereits stark gestiegene Aktien werden
        bewusst nachrangig behandelt.
      </p>
      {rows.length === 0 ? (
        <div className="p-4 text-xs text-neutral-400">
          Derzeit keine Titel mit positivem, noch frühem Signal.
        </div>
      ) : (
        <StockTable
          rows={rows}
          onSelect={open}
          columns={[
            "name",
            "price",
            "change",
            "score",
            "category",
            "ret20",
            "ext",
            "detected",
            "reason",
          ]}
        />
      )}
      <div className="mt-2">
        <ScanMeta scan={data} />
      </div>
    </Panel>
  );
}
