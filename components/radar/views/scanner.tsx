"use client";

import { CATEGORY_LABELS, CATEGORY_RANK } from "@/lib/radar/config";
import type { SignalCategory, StockAnalysis } from "@/lib/radar/types";
import { useMemo, useState } from "react";
import { useWeightedResults } from "../hooks";
import { type Column, ErrorBox, Loading, Panel, StockTable } from "../ui";
import { ScanMeta, useOpenAnalysis } from "./common";

const REGION_NAMES: Record<string, string> = {
  US: "USA",
  DE: "Deutschland",
  FR: "Frankreich",
  NL: "Niederlande",
  IT: "Italien",
  ES: "Spanien",
  BE: "Belgien",
  FI: "Finnland",
  DK: "Dänemark",
  IE: "Irland",
  PT: "Portugal",
};

const sorters: Partial<Record<Column, (a: StockAnalysis) => number | string>> = {
  name: (a) => a.entry.ticker,
  change: (a) => a.quote.changePct,
  volume: (a) => a.quote.volume ?? 0,
  volRatio: (a) => a.technical.volRatio50 ?? 0,
  score: (a) => a.score,
  category: (a) => CATEGORY_RANK[a.category],
  trade: (a) => (a.trade.bias === "LONG" ? 2 : a.trade.bias === "NEUTRAL" ? 1 : 0),
  ret20: (a) => a.technical.ret20 ?? 0,
  ext: (a) => a.extension.level,
  coverage: (a) => a.coverage,
  sector: (a) => a.entry.sector,
};

export function ScannerView() {
  const { data, results, isLoading, error, refetch } = useWeightedResults();
  const open = useOpenAnalysis();
  const [sort, setSort] = useState<{ key: Column; dir: 1 | -1 }>({ key: "score", dir: -1 });
  const [minScore, setMinScore] = useState(0);
  const [cat, setCat] = useState<SignalCategory | "ALL">("ALL");
  const [sector, setSector] = useState("ALL");
  const [region, setRegion] = useState("ALL");
  const [index, setIndex] = useState("ALL");
  const [limit, setLimit] = useState(100);
  const [q, setQ] = useState("");

  const sectors = useMemo(
    () => Array.from(new Set(results.map((r) => r.entry.sector))).sort(),
    [results]
  );
  const rows = useMemo(() => {
    const f = sorters[sort.key];
    return results
      .filter((r) => r.score >= minScore)
      .filter((r) => cat === "ALL" || r.category === cat)
      .filter((r) => sector === "ALL" || r.entry.sector === sector)
      .filter((r) => region === "ALL" || r.entry.region === region)
      .filter(
        (r) =>
          index === "ALL" ||
          (index === "CORE" ? r.entry.core : (r.entry.indices ?? []).includes(index))
      )
      .filter(
        (r) => !q || `${r.entry.ticker} ${r.entry.name}`.toLowerCase().includes(q.toLowerCase())
      )
      .sort((a, b) => {
        if (!f) return 0;
        const x = f(a);
        const y = f(b);
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
      });
  }, [results, sort, minScore, cat, sector, region, index, q]);
  const regions = useMemo(
    () => Array.from(new Set(results.map((r) => r.entry.region))).sort(),
    [results]
  );
  const indices = useMemo(
    () => Array.from(new Set(results.flatMap((r) => r.entry.indices ?? []))).sort(),
    [results]
  );

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={() => refetch()} />;
  if (!data) return null;

  const sel = "h-6 border border-neutral-700 bg-black px-1 text-[11px] text-neutral-200";
  return (
    <Panel
      title="Stock Scanner"
      right={
        <span>
          {rows.length} / {results.length} Titel
        </span>
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Suche…"
          className={`${sel} w-32`}
        />
        <label className="flex items-center gap-1">
          Min-Score
          <input
            type="range"
            min={0}
            max={90}
            step={5}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
          />
          <span className="w-6 tabular-nums text-amber-300">{minScore}</span>
        </label>
        <select
          className={sel}
          value={cat}
          onChange={(e) => setCat(e.target.value as SignalCategory | "ALL")}
        >
          <option value="ALL">Alle Signale</option>
          {(Object.keys(CATEGORY_LABELS) as SignalCategory[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <select className={sel} value={sector} onChange={(e) => setSector(e.target.value)}>
          <option value="ALL">Alle Sektoren</option>
          {sectors.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select className={sel} value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="ALL">Alle Regionen</option>
          {regions.map((r) => (
            <option key={r} value={r}>
              {REGION_NAMES[r] ?? r}
            </option>
          ))}
        </select>
        <select className={sel} value={index} onChange={(e) => setIndex(e.target.value)}>
          <option value="ALL">Alle Indizes</option>
          <option value="CORE">Kern-Universum (20)</option>
          {indices.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </div>
      <StockTable
        rows={rows.slice(0, limit)}
        onSelect={open}
        sortKey={sort.key}
        onSort={(key) => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : -1 }))}
        columns={[
          "name",
          "sector",
          "price",
          "change",
          "volume",
          "volRatio",
          "ret20",
          "score",
          "category",
          "trade",
          "ext",
          "coverage",
        ]}
      />
      <div className="mt-2">
        {rows.length > limit && (
          <button
            type="button"
            onClick={() => setLimit((l) => l + 100)}
            className="mb-2 border border-neutral-700 px-2 py-0.5 text-[11px] hover:border-amber-500"
          >
            Weitere {Math.min(100, rows.length - limit)} von {rows.length - limit} anzeigen
          </button>
        )}
        <ScanMeta scan={data} />
      </div>
    </Panel>
  );
}
