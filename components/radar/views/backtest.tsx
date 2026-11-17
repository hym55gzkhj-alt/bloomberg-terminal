"use client";

import { CATEGORY_LABELS } from "@/lib/radar/config";
import { TRADE_RULES } from "@/lib/radar/trade";
import type {
  BacktestParams,
  BacktestResult,
  HorizonStats,
  SignalCategory,
} from "@/lib/radar/types";
import { cn } from "@/lib/utils";
import { useAtom } from "jotai";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useBacktest } from "../hooks";
import { fmtNum, fmtPct, fmtTime, signColor } from "../lib/format";
import { backtestParamsAtom } from "../state";
import { ErrorBox, Loading, Panel } from "../ui";
import { useOpenAnalysis } from "./common";

const HORIZONS = [5, 10, 20, 60];

export function BacktestView() {
  const [params, setParams] = useAtom(backtestParamsAtom);
  const [draft, setDraft] = useState<Partial<BacktestParams>>(params);
  const { data, isLoading, error, refetch, isFetching } = useBacktest(params);
  const open = useOpenAnalysis();
  const [horizon, setHorizon] = useState(20);
  const [onlyLosers, setOnlyLosers] = useState(false);
  const [tickerFilter, setTickerFilter] = useState("ALL");

  const signals = useMemo(
    () =>
      (data?.signals ?? [])
        .filter((s) => tickerFilter === "ALL" || s.ticker === tickerFilter)
        .filter(
          (s) => !onlyLosers || (s.returns[horizon] != null && (s.returns[horizon] as number) <= 0)
        ),
    [data, tickerFilter, onlyLosers, horizon]
  );

  const distribution = useMemo(() => {
    const rets = (data?.signals ?? [])
      .map((s) => s.returns[horizon])
      .filter((x): x is number => x != null);
    const bins = [-30, -20, -10, -5, 0, 5, 10, 20, 30];
    const out = bins.slice(0, -1).map((lo, i) => ({ label: `${lo}…${bins[i + 1]}`, lo, count: 0 }));
    const under = { label: "< -30", lo: -999, count: 0 };
    const over = { label: "> 30", lo: 30, count: 0 };
    for (const r of rets) {
      if (r < -30) under.count++;
      else if (r >= 30) over.count++;
      else {
        const b = out.find((x, i) => r >= x.lo && r < bins[i + 1]);
        if (b) b.count++;
      }
    }
    return [under, ...out, over];
  }, [data, horizon]);

  const sel = "h-6 border border-neutral-700 bg-black px-1 text-[11px]";
  return (
    <div className="space-y-2">
      <Panel title="Historische Validierung – Parameter">
        <form
          className="flex flex-wrap items-end gap-3 text-[11px]"
          onSubmit={(e) => {
            e.preventDefault();
            setParams({ ...draft });
          }}
        >
          <label className="flex flex-col gap-0.5">
            <span className="text-neutral-500">Richtung</span>
            <select
              className={sel}
              value={draft.direction ?? "long"}
              onChange={(e) =>
                setDraft({ ...draft, direction: e.target.value as BacktestParams["direction"] })
              }
            >
              <option value="long">▲ LONG-Setups</option>
              <option value="short">▼ SHORT-Setups</option>
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-neutral-500">Long ab Kategorie</span>
            <select
              className={sel}
              value={draft.minCategory}
              onChange={(e) =>
                setDraft({ ...draft, minCategory: e.target.value as BacktestParams["minCategory"] })
              }
            >
              <option value="EARLY_SIGNAL">EARLY SIGNAL</option>
              <option value="BUILDING_MOMENTUM">BUILDING MOMENTUM</option>
              <option value="STRONG_MOMENTUM">STRONG MOMENTUM</option>
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-neutral-500">Kosten je Seite (bp)</span>
            <input
              type="number"
              min={0}
              max={200}
              className={`${sel} w-20`}
              value={draft.costBps}
              onChange={(e) => setDraft({ ...draft, costBps: Number(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-neutral-500">Einstiegsverzögerung (Tage)</span>
            <input
              type="number"
              min={1}
              max={5}
              className={`${sel} w-20`}
              value={draft.entryDelayDays}
              onChange={(e) => setDraft({ ...draft, entryDelayDays: Number(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-neutral-500">Sperrfrist (Tage)</span>
            <input
              type="number"
              min={1}
              max={120}
              className={`${sel} w-20`}
              value={draft.cooldownDays}
              onChange={(e) => setDraft({ ...draft, cooldownDays: Number(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-neutral-500">Zeitraum</span>
            <select
              className={sel}
              value={draft.years}
              onChange={(e) => setDraft({ ...draft, years: Number(e.target.value) })}
            >
              <option value={2}>2 Jahre</option>
              <option value={5}>5 Jahre</option>
              <option value={10}>~10 Jahre</option>
            </select>
          </label>
          <button
            type="submit"
            className="h-6 border border-amber-600 px-3 text-amber-300 hover:bg-amber-600 hover:text-black"
          >
            {isFetching ? "BERECHNE…" : "BACKTEST STARTEN"}
          </button>
        </form>
      </Panel>

      {isLoading && (
        <Loading label="Lade bis zu 10 Jahre echte Kurshistorie und berechne Signale point-in-time…" />
      )}
      {error && <ErrorBox error={error} onRetry={() => refetch()} />}
      {data && (
        <>
          <TradeStatsPanel data={data} />
          <div className="grid gap-2 xl:grid-cols-[1fr_380px]">
            <Panel
              title={`Ergebnisse ${data.period.from} – ${data.period.to} · ${data.signals.length} Signale · ${data.universe.length} Titel`}
              right={<span>berechnet {fmtTime(data.generatedAt)}</span>}
            >
              <StatsTable title="Alle Signale" rows={data.stats.ALL} />
              {(
                [
                  "EARLY_SIGNAL",
                  "BUILDING_MOMENTUM",
                  "STRONG_MOMENTUM",
                  "NEGATIVE",
                ] as SignalCategory[]
              ).map((c) =>
                data.stats[c]?.some((r) => r.count > 0) ? (
                  <StatsTable key={c} title={CATEGORY_LABELS[c]} rows={data.stats[c]} />
                ) : null
              )}
              <p className="mt-2 text-[10px] text-neutral-500">
                Netto-Renditen nach Kosten. „Baseline“ = Ø-Rendite bei Einstieg an jedem beliebigen
                Tag in denselben Titeln. Ein Signal hat nur dann Mehrwert, wenn es die Baseline und
                den Benchmark nachhaltig schlägt. Trefferquote = Anteil Signale mit Rendite &gt; 0.
              </p>
              {data.errors.length > 0 && (
                <p className="mt-1 text-[10px] text-red-400">
                  Ohne Daten: {data.errors.map((e) => `${e.ticker} (${e.message})`).join(", ")}
                </p>
              )}
            </Panel>
            <Panel
              title="Renditeverteilung"
              right={
                <select
                  className={sel}
                  value={horizon}
                  onChange={(e) => setHorizon(Number(e.target.value))}
                >
                  {HORIZONS.map((h) => (
                    <option key={h} value={h}>
                      {h} Tage
                    </option>
                  ))}
                </select>
              }
            >
              <div className="h-56">
                <ResponsiveContainer>
                  <BarChart data={distribution} margin={{ top: 5, right: 5, bottom: 0, left: -15 }}>
                    <CartesianGrid stroke="#1f1f1f" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 9, fill: "#777" }}
                      interval={0}
                      angle={-35}
                      textAnchor="end"
                      height={40}
                    />
                    <YAxis tick={{ fontSize: 10, fill: "#777" }} allowDecimals={false} />
                    <ReferenceLine x="0…5" stroke="#555" />
                    <Tooltip
                      contentStyle={{ background: "#111", border: "1px solid #444", fontSize: 11 }}
                    />
                    <Bar dataKey="count" name="Signale" isAnimationActive={false}>
                      {distribution.map((d) => (
                        <Cell key={d.label} fill={d.lo < 0 ? "#b91c1c" : "#059669"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="text-[10px] text-neutral-500">
                Netto-Rendite in % nach {horizon} Handelstagen (rot = Verlust / Fehlsignal).
              </div>
            </Panel>
          </div>

          <Panel
            title="Einzelsignale inkl. Fehlsignale"
            right={
              <div className="flex items-center gap-2">
                <select
                  className={sel}
                  value={tickerFilter}
                  onChange={(e) => setTickerFilter(e.target.value)}
                >
                  <option value="ALL">Alle Titel</option>
                  {data.universe.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={onlyLosers}
                    onChange={(e) => setOnlyLosers(e.target.checked)}
                  />{" "}
                  nur Fehlsignale ({horizon} T)
                </label>
              </div>
            }
          >
            <div className="max-h-[480px] overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-[#0b0b0b]">
                  <tr className="text-left text-[10px] uppercase text-neutral-500">
                    <th className="font-normal">Signal</th>
                    <th className="font-normal">Titel</th>
                    <th className="font-normal">Kategorie</th>
                    <th className="text-right font-normal">Score</th>
                    <th className="font-normal">Einstieg</th>
                    {HORIZONS.map((h) => (
                      <th key={h} className="text-right font-normal">
                        {h}T
                      </th>
                    ))}
                    <th className="text-right font-normal">vs. Bench {horizon}T</th>
                    <th className="text-right font-normal">Max. Verlust</th>
                    <th className="font-normal">Trade (Stop/Ziel)</th>
                    <th className="text-right font-normal">Ergebnis</th>
                  </tr>
                </thead>
                <tbody>
                  {signals.slice(0, 500).map((s) => {
                    const ex =
                      s.returns[horizon] != null && s.benchmarkReturns[horizon] != null
                        ? (s.returns[horizon] as number) - (s.benchmarkReturns[horizon] as number)
                        : null;
                    return (
                      <tr
                        key={`${s.ticker}-${s.date}`}
                        className="border-t border-neutral-900 tabular-nums"
                      >
                        <td>{s.date}</td>
                        <td>
                          <button
                            type="button"
                            onClick={() => open(s.ticker)}
                            className="font-bold text-amber-300 hover:underline"
                          >
                            {s.ticker}
                          </button>
                        </td>
                        <td className="text-[9px]">{CATEGORY_LABELS[s.category]}</td>
                        <td className="text-right">{s.score.toFixed(0)}</td>
                        <td className="text-neutral-400">
                          {s.entryDate ? `${s.entryDate} @ ${fmtNum(s.entryPrice)}` : "ausstehend"}
                        </td>
                        {HORIZONS.map((h) => (
                          <td key={h} className={cn("text-right", signColor(s.returns[h]))}>
                            {s.returns[h] == null ? "offen" : fmtPct(s.returns[h], 1)}
                          </td>
                        ))}
                        <td className={cn("text-right", signColor(ex))}>
                          {ex == null ? "–" : fmtPct(ex, 1)}
                        </td>
                        <td className="text-right text-red-400">{fmtPct(s.maxAdverse, 1)}</td>
                        <td
                          className={cn(
                            "pl-2 text-[10px]",
                            s.trade?.outcome === "Ziel" && "text-emerald-400",
                            s.trade?.outcome === "Stop" && "text-red-400",
                            s.trade?.outcome === "Zeit" && "text-neutral-300",
                            s.trade?.outcome === "offen" && "text-neutral-500"
                          )}
                          title={
                            s.trade
                              ? `Stop ${fmtNum(s.trade.stop)} · Ziel 1 ${fmtNum(s.trade.target1)}${s.trade.target1Hit ? " (erreicht)" : ""} · Ziel 2 ${fmtNum(s.trade.target2)} · Ausstieg ${s.trade.exitDate} @ ${fmtNum(s.trade.exitPrice)}`
                              : ""
                          }
                        >
                          {s.trade ? `${s.trade.outcome} nach ${s.trade.days} T` : "–"}
                        </td>
                        <td className={cn("text-right", signColor(s.trade?.r))}>
                          {s.trade ? `${s.trade.r >= 0 ? "+" : ""}${fmtNum(s.trade.r, 2)}R` : "–"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {signals.length > 500 && (
                <div className="p-1 text-[10px] text-neutral-500">
                  … {signals.length - 500} weitere (Filter verwenden)
                </div>
              )}
            </div>
          </Panel>

          <div className="grid gap-2 md:grid-cols-2">
            <Panel title="Methodik">
              <ul className="list-disc space-y-1 pl-4 text-[11px] text-neutral-300">
                {data.methodology.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Panel>
            <Panel title="Bekannte Verzerrungen & Grenzen">
              <ul className="list-disc space-y-1 pl-4 text-[11px] text-amber-200">
                {data.biases.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function StatsTable({ title, rows }: { title: string; rows: HorizonStats[] }) {
  return (
    <div className="mb-2">
      <div className="mb-0.5 text-[10px] font-bold uppercase text-amber-400">{title}</div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-right text-[10px] text-neutral-500">
            <th className="text-left font-normal">Horizont</th>
            <th className="font-normal">n</th>
            <th className="font-normal">Treffer</th>
            <th className="font-normal">Ø Rendite</th>
            <th className="font-normal">Median</th>
            <th className="font-normal">Baseline Ø</th>
            <th className="font-normal">Ø vs. Bench</th>
            <th className="font-normal">schlägt Bench</th>
            <th className="font-normal">Bestes</th>
            <th className="font-normal">Schlechtestes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const edge =
              r.avgReturn != null && r.baselineAvg != null ? r.avgReturn - r.baselineAvg : null;
            return (
              <tr key={r.horizon} className="border-t border-neutral-900 text-right tabular-nums">
                <td className="text-left">{r.horizon} T</td>
                <td>{r.count}</td>
                <td>{r.hitRate == null ? "–" : `${fmtNum(r.hitRate, 1)} %`}</td>
                <td className={signColor(r.avgReturn)}>{fmtPct(r.avgReturn)}</td>
                <td className={signColor(r.medianReturn)}>{fmtPct(r.medianReturn)}</td>
                <td
                  className="text-neutral-400"
                  title={edge == null ? "" : `Signal − Baseline: ${fmtPct(edge)}`}
                >
                  {fmtPct(r.baselineAvg)}{" "}
                  {edge != null && (
                    <span className={cn("text-[9px]", signColor(edge))}>
                      ({edge >= 0 ? "+" : ""}
                      {fmtNum(edge)})
                    </span>
                  )}
                </td>
                <td className={signColor(r.avgExcess)}>{fmtPct(r.avgExcess)}</td>
                <td>{r.excessHitRate == null ? "–" : `${fmtNum(r.excessHitRate, 1)} %`}</td>
                <td className="text-emerald-400">{fmtPct(r.best, 1)}</td>
                <td className="text-red-400">{fmtPct(r.worst, 1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TradeStatsPanel({ data }: { data: BacktestResult }) {
  const t = data.tradeStats;
  const short = data.params.direction === "short";
  const cell = (label: string, value: string, tone?: string, sub?: string) => (
    <div className="border border-neutral-800 px-2 py-1">
      <div className="text-[9px] uppercase text-neutral-500">{label}</div>
      <div className={cn("text-base font-bold tabular-nums", tone)}>{value}</div>
      {sub && <div className="text-[9px] text-neutral-500">{sub}</div>}
    </div>
  );
  return (
    <Panel
      title={`Trade-Simulation ${short ? "▼ SHORT" : "▲ LONG"} – Stop ${TRADE_RULES.stopAtr}× ATR · Ziel ${TRADE_RULES.target2R}R · max. ${TRADE_RULES.maxDays} T`}
      className={short ? "border-red-900" : "border-emerald-900"}
    >
      {t.count === 0 ? (
        <div className="text-xs text-neutral-500">Keine abgeschlossenen Trades im Zeitraum.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-8">
            {cell(
              "Trades",
              String(t.count),
              undefined,
              t.open ? `+${t.open} noch offen` : undefined
            )}
            {cell("Gewinn-Trades", t.winRate == null ? "–" : `${fmtNum(t.winRate, 1)} %`)}
            {cell(
              "Ø Ergebnis",
              t.avgR == null ? "–" : `${t.avgR >= 0 ? "+" : ""}${fmtNum(t.avgR, 2)}R`,
              signColor(t.avgR),
              `Ø ${fmtPct(t.avgPct, 2)} je Trade`
            )}
            {cell(
              "Median",
              t.medianR == null ? "–" : `${fmtNum(t.medianR, 2)}R`,
              signColor(t.medianR)
            )}
            {cell(
              "Ziel erreicht",
              `${fmtNum(t.pctTarget, 1)} %`,
              "text-emerald-400",
              `Ziel 1: ${fmtNum(t.pctTarget1, 1)} %`
            )}
            {cell("Stop ausgelöst", `${fmtNum(t.pctStop, 1)} %`, "text-red-400")}
            {cell("Zeitausstieg", `${fmtNum(t.pctTime, 1)} %`)}
            {cell(
              "Ø Haltedauer",
              `${fmtNum(t.avgDays, 1)} T`,
              undefined,
              `bestes ${fmtNum(t.bestR, 1)}R / schlechtestes ${fmtNum(t.worstR, 1)}R`
            )}
          </div>
          <p className="mt-2 text-[10px] text-neutral-400">
            R = Vielfaches des eingesetzten Risikos (Abstand Einstieg–Stop). Ein Ø-Ergebnis über 0R
            bedeutet, dass die Regeln nach Kosten im Schnitt Gewinn gebracht hätten; darunter
            Verlust.{" "}
            {short ? "Short-Ergebnisse sind richtungsbereinigt (Kursrückgang = Gewinn). " : ""}
            Vergangene Ergebnisse sind keine Garantie für die Zukunft.
          </p>
        </>
      )}
    </Panel>
  );
}
