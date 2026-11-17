"use client";

import { CATEGORY_LABELS, CATEGORY_RANK } from "@/lib/radar/config";
import type { SignalCategory } from "@/lib/radar/types";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import { useWeightedResults } from "../hooks";
import { CATEGORY_STYLE } from "../lib/format";
import { ErrorBox, Loading, Panel, StockTable } from "../ui";
import { ScanMeta, useOpenAnalysis } from "./common";

const CATS: SignalCategory[] = [
  "STRONG_MOMENTUM",
  "BUILDING_MOMENTUM",
  "EARLY_SIGNAL",
  "NEUTRAL",
  "NEGATIVE",
];

export function SignalsView() {
  const { data, results, isLoading, error, refetch } = useWeightedResults();
  const open = useOpenAnalysis();
  const [filter, setFilter] = useState<SignalCategory[]>([
    "STRONG_MOMENTUM",
    "BUILDING_MOMENTUM",
    "EARLY_SIGNAL",
  ]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of results) c[r.category] = (c[r.category] ?? 0) + 1;
    return c;
  }, [results]);

  const rows = useMemo(
    () =>
      results
        .filter((r) => filter.includes(r.category))
        .sort((a, b) => CATEGORY_RANK[b.category] - CATEGORY_RANK[a.category] || b.score - a.score),
    [results, filter]
  );

  if (isLoading)
    return (
      <Loading label="Analysiere Aktien-Universum mit echten Kurs-, Volumen-, Nachrichten- und Fundamentaldaten…" />
    );
  if (error) return <ErrorBox error={error} onRetry={() => refetch()} />;
  if (!data) return null;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {CATS.map((c) => (
          <button
            type="button"
            key={c}
            onClick={() => setFilter((f) => (f.includes(c) ? f.filter((x) => x !== c) : [...f, c]))}
            className={cn(
              "border p-2 text-left",
              filter.includes(c)
                ? "border-amber-500 bg-neutral-900"
                : "border-neutral-800 bg-[#0b0b0b] opacity-60"
            )}
          >
            <div className={cn("inline-block px-1 text-[10px] font-bold", CATEGORY_STYLE[c])}>
              {CATEGORY_LABELS[c]}
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{counts[c] ?? 0}</div>
          </button>
        ))}
      </div>
      <Panel
        title="AI Early Signals – erkannte Auffälligkeiten"
        right={<span>{rows.length} Titel · Klick = Detailanalyse</span>}
      >
        {rows.length === 0 ? (
          <div className="p-4 text-xs text-neutral-400">
            Aktuell erfüllt kein Titel die gewählten Signal-Kategorien. Das ist ein echtes Ergebnis
            – es werden keine Signale erfunden.
          </div>
        ) : (
          <StockTable
            rows={rows}
            onSelect={open}
            columns={[
              "name",
              "price",
              "change",
              "volume",
              "volRatio",
              "score",
              "category",
              "trade",
              "detected",
              "reason",
              "ext",
            ]}
          />
        )}
        <div className="mt-2">
          <ScanMeta scan={data} />
        </div>
      </Panel>
    </div>
  );
}
