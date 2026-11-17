"use client";

import { CATEGORY_LABELS } from "@/lib/radar/config";
import { computeSeries } from "@/lib/radar/indicators";
import type { DetailPayload } from "@/lib/radar/types";
import { cn } from "@/lib/utils";
import { useAtom, useAtomValue } from "jotai";
import { Star } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { reweight, useDetail } from "../hooks";
import { fmtNum, fmtPct, fmtTime, fmtVol, signColor } from "../lib/format";
import { selectedTickerAtom, watchlistAtom, weightsAtom } from "../state";
import {
  CategoryBadge,
  ComponentBars,
  ErrorBox,
  FreshnessTag,
  Loading,
  Panel,
  ScoreBar,
} from "../ui";
import { NewsList } from "./news";

const RANGES = { "3M": 63, "6M": 126, "1J": 252, "2J": 504 } as const;
const axis = { fontSize: 10, fill: "#777" };
const tooltipStyle = { background: "#111", border: "1px solid #444", fontSize: 11 };

export function AnalysisView() {
  const [ticker, setTicker] = useAtom(selectedTickerAtom);
  const { data, isLoading, error, refetch, isFetching } = useDetail(ticker);
  const [input, setInput] = useState("");
  return (
    <div className="space-y-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) setTicker(input.trim().toUpperCase());
          setInput("");
        }}
        className="flex items-center gap-2 text-[11px]"
      >
        <span className="text-neutral-400">Analyse:</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={ticker}
          className="h-6 w-40 border border-neutral-700 bg-black px-2 uppercase"
        />
        <button
          type="submit"
          className="h-6 border border-amber-600 px-2 text-amber-300 hover:bg-amber-600 hover:text-black"
        >
          GO
        </button>
        {isFetching && !isLoading && <span className="text-neutral-500">aktualisiere…</span>}
      </form>
      {isLoading && (
        <Loading label={`Lade ${ticker}: Kurshistorie, Nachrichten, Kennzahlen, Backtest…`} />
      )}
      {error && <ErrorBox error={error} onRetry={() => refetch()} />}
      {data && <Detail data={data} />}
    </div>
  );
}

function Detail({ data }: { data: DetailPayload }) {
  const weights = useAtomValue(weightsAtom);
  const [list, setList] = useAtom(watchlistAtom);
  const a = useMemo(() => reweight(data.analysis, weights), [data.analysis, weights]);
  const q = a.quote;
  const [range, setRange] = useState<keyof typeof RANGES>("1J");
  const inWl = list.includes(a.entry.ticker);

  const chart = useMemo(() => {
    const s = computeSeries(data.bars);
    const n = RANGES[range];
    const start = Math.max(0, data.bars.length - n);
    return data.bars.slice(start).map((b, k) => {
      const i = start + k;
      return {
        date: b.date,
        close: b.close,
        sma20: s.sma20[i],
        sma50: s.sma50[i],
        sma200: s.sma200[i],
        volume: b.volume,
        up: i > 0 ? b.close >= data.bars[i - 1].close : true,
        rsi: s.rsi14[i],
        macd: s.macd.line[i],
        signal: s.macd.signal[i],
        hist: s.macd.hist[i],
      };
    });
  }, [data.bars, range]);

  const firstDate = chart[0]?.date ?? "";
  const markers = data.historicalSignals.filter((s) => s.date >= firstDate);
  const t = a.technical;
  const f = data.fundamentals;
  const pos = a.factors.filter((x) => x.impact === "positive");
  const neg = a.factors.filter((x) => x.impact === "negative");

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border border-neutral-800 bg-[#0b0b0b] p-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-amber-400">{a.entry.ticker}</span>
            <span className="text-sm text-neutral-200">{q.name}</span>
            <button
              type="button"
              onClick={() =>
                setList(inWl ? list.filter((x) => x !== a.entry.ticker) : [...list, a.entry.ticker])
              }
              title={inWl ? "Aus Watchlist entfernen" : "Zur Watchlist hinzufügen"}
            >
              <Star
                className={cn(
                  "h-4 w-4",
                  inWl ? "fill-amber-400 text-amber-400" : "text-neutral-500"
                )}
              />
            </button>
          </div>
          <div className="text-[10px] text-neutral-500">
            {q.exchange} · {a.entry.sector} · Benchmark {a.entry.benchmark} · Sektor-ETF{" "}
            {a.entry.sectorEtf}
          </div>
        </div>
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold tabular-nums">{fmtNum(q.price)}</span>
            <span className="text-[10px] text-neutral-500">{q.currency}</span>
            <span className={cn("tabular-nums", signColor(q.changePct))}>
              {fmtNum(q.change)} ({fmtPct(q.changePct)})
            </span>
            <FreshnessTag quote={q} />
          </div>
          <div className="text-[10px] text-neutral-500">
            {q.delayNote} · letzter Kurs {fmtTime(q.marketTime)} · Volumen {fmtVol(q.volume)}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ScoreBar score={a.score} width={110} />
          <CategoryBadge category={a.category} />
        </div>
        <div className="text-[10px] text-neutral-400">
          Erkannt: {a.detectedAt ? fmtTime(a.detectedAt) : "–"} · Datenabdeckung{" "}
          {(a.coverage * 100).toFixed(0)} %
        </div>
      </div>

      <div className="grid gap-2 xl:grid-cols-[1fr_420px]">
        <div className="space-y-2">
          <Panel
            title="Kursverlauf (adjustiert) · SMA20/50/200 · historische Signale"
            right={
              <div className="flex gap-1">
                {(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((r) => (
                  <button
                    type="button"
                    key={r}
                    onClick={() => setRange(r)}
                    className={cn(
                      "px-1.5",
                      range === r ? "bg-amber-500 text-black" : "border border-neutral-700"
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
            }
          >
            <div className="h-72">
              <ResponsiveContainer>
                <ComposedChart data={chart} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#1f1f1f" />
                  <XAxis dataKey="date" tick={axis} minTickGap={40} />
                  <YAxis domain={["auto", "auto"]} tick={axis} width={55} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmtNum(v)} />
                  <Line
                    dataKey="close"
                    stroke="#fbbf24"
                    dot={false}
                    strokeWidth={1.5}
                    name="Kurs"
                    isAnimationActive={false}
                  />
                  <Line
                    dataKey="sma20"
                    stroke="#60a5fa"
                    dot={false}
                    strokeWidth={1}
                    name="SMA20"
                    isAnimationActive={false}
                  />
                  <Line
                    dataKey="sma50"
                    stroke="#a78bfa"
                    dot={false}
                    strokeWidth={1}
                    name="SMA50"
                    isAnimationActive={false}
                  />
                  <Line
                    dataKey="sma200"
                    stroke="#f87171"
                    dot={false}
                    strokeWidth={1}
                    name="SMA200"
                    isAnimationActive={false}
                  />
                  {markers.map((m) => {
                    const pt = chart.find((c) => c.date === m.date);
                    return pt ? (
                      <ReferenceDot
                        key={m.date}
                        x={m.date}
                        y={pt.close}
                        r={3.5}
                        fill={m.category === "EARLY_SIGNAL" ? "#fbbf24" : "#34d399"}
                        stroke="#000"
                      />
                    ) : null;
                  })}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="h-24">
              <ResponsiveContainer>
                <BarChart data={chart} margin={{ top: 0, right: 10, bottom: 0, left: 0 }}>
                  <XAxis dataKey="date" hide />
                  <YAxis tick={axis} width={55} tickFormatter={(v) => fmtVol(v)} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmtVol(v)} />
                  <Bar dataKey="volume" name="Volumen" isAnimationActive={false}>
                    {chart.map((c) => (
                      <Cell key={c.date} fill={c.up ? "#065f46" : "#7f1d1d"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="text-[9px] text-neutral-500">
              Punkte = historische Backtest-Signale (gelb EARLY, grün BUILDING/STRONG). Volumen
              grün/rot = Auf-/Abwärtstag.
            </div>
          </Panel>

          <div className="grid gap-2 md:grid-cols-2">
            <Panel title="RSI 14">
              <div className="h-32">
                <ResponsiveContainer>
                  <LineChart data={chart} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                    <XAxis dataKey="date" hide />
                    <YAxis domain={[0, 100]} tick={axis} width={30} />
                    <ReferenceLine y={70} stroke="#7f1d1d" />
                    <ReferenceLine y={30} stroke="#065f46" />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmtNum(v, 1)} />
                    <Line dataKey="rsi" stroke="#fbbf24" dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel title="MACD 12/26/9">
              <div className="h-32">
                <ResponsiveContainer>
                  <ComposedChart data={chart} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                    <XAxis dataKey="date" hide />
                    <YAxis tick={axis} width={40} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmtNum(v, 2)} />
                    <Bar dataKey="hist" isAnimationActive={false}>
                      {chart.map((c) => (
                        <Cell key={c.date} fill={(c.hist ?? 0) >= 0 ? "#065f46" : "#7f1d1d"} />
                      ))}
                    </Bar>
                    <Line dataKey="macd" stroke="#60a5fa" dot={false} isAnimationActive={false} />
                    <Line dataKey="signal" stroke="#f87171" dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          <Panel title="Warum wurde die Aktie erkannt?">
            <p className="text-[11px] leading-relaxed text-neutral-200">{a.explanation}</p>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <div>
                <div className="mb-1 text-[10px] font-bold uppercase text-emerald-400">
                  Positive Faktoren
                </div>
                {pos.length ? (
                  pos.map((x) => (
                    <div key={x.text} className="text-[11px] text-emerald-200">
                      ▲ {x.text}
                    </div>
                  ))
                ) : (
                  <div className="text-[11px] text-neutral-500">keine</div>
                )}
              </div>
              <div>
                <div className="mb-1 text-[10px] font-bold uppercase text-red-400">
                  Negative Faktoren
                </div>
                {neg.length ? (
                  neg.map((x) => (
                    <div key={x.text} className="text-[11px] text-red-200">
                      ▼ {x.text}
                    </div>
                  ))
                ) : (
                  <div className="text-[11px] text-neutral-500">keine</div>
                )}
              </div>
            </div>
            {a.warnings.length > 0 && (
              <div className="mt-2 border-t border-neutral-800 pt-1 text-[10px] text-amber-400">
                {a.warnings.map((w) => (
                  <div key={w}>⚠ {w}</div>
                ))}
              </div>
            )}
            <div className="mt-1 text-[9px] text-neutral-500">
              Quellen: {a.dataSources.join(" · ")}
            </div>
          </Panel>

          <Panel title={`Aktuelle Nachrichten (${data.news.length})`}>
            <NewsList items={data.news} />
          </Panel>
        </div>

        <div className="space-y-2">
          <Panel title="Score-Komponenten">
            <ComponentBars components={a.components} weights={weights} />
            {a.components.map((c) =>
              c.score != null && c.facts.length ? (
                <details key={c.key} className="mt-1 text-[10px] text-neutral-400">
                  <summary className="cursor-pointer text-neutral-300">{c.label}</summary>
                  <ul className="ml-3 list-disc">
                    {c.facts.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </details>
              ) : null
            )}
          </Panel>

          <Panel title="Technische Indikatoren">
            <KV
              rows={[
                [
                  "SMA20 / 50 / 200",
                  `${fmtNum(t.sma20)} / ${fmtNum(t.sma50)} / ${fmtNum(t.sma200)}`,
                ],
                [
                  "Abstand SMA50 / SMA200",
                  `${fmtPct(t.distFromSma50, 1)} / ${fmtPct(t.distFromSma200, 1)}`,
                ],
                ["RSI14", fmtNum(t.rsi14, 1)],
                [
                  "MACD / Signal / Hist",
                  `${fmtNum(t.macd)} / ${fmtNum(t.macdSignal)} / ${fmtNum(t.macdHist)}`,
                ],
                ["ATR14", `${fmtNum(t.atr14)} (${fmtNum(t.atrPct, 2)} %)`],
                [
                  "Rendite 5 / 20 / 60 / 120 T",
                  `${fmtPct(t.ret5, 1)} / ${fmtPct(t.ret20, 1)} / ${fmtPct(t.ret60, 1)} / ${fmtPct(t.ret120, 1)}`,
                ],
                [
                  "Volumen vs. Ø20 / Ø50",
                  `${fmtNum(t.volRatio20)}× / ${fmtNum(t.volRatio50)}× (z = ${fmtNum(t.volZ50, 1)})`,
                ],
                [
                  "52W Hoch / Tief",
                  `${fmtNum(t.high52w)} / ${fmtNum(t.low52w)} (${fmtPct(t.distFrom52wHigh, 1)} vom Hoch)`,
                ],
                [
                  "Bollinger-Bandbreite (Perzentil 6M)",
                  t.bbWidthPctile == null ? "–" : `${(t.bbWidthPctile * 100).toFixed(0)} %`,
                ],
                [
                  "Überdehnung",
                  a.extension.level > 0.2
                    ? `−${a.extension.penalty.toFixed(1)} Pkt (${a.extension.notes.join("; ")})`
                    : "keine",
                ],
              ]}
            />
          </Panel>

          <Panel title="Unternehmenskennzahlen (Finnhub)">
            {f ? (
              <KV
                rows={[
                  [
                    "Marktkapitalisierung",
                    f.marketCap ? `${fmtNum(f.marketCap / 1000, 1)} Mrd USD` : "–",
                  ],
                  ["KGV (TTM)", fmtNum(f.peTTM, 1)],
                  [
                    "Umsatzwachstum Q / TTM (YoY)",
                    `${fmtPct(f.revenueGrowthQuarterlyYoy, 1)} / ${fmtPct(f.revenueGrowthTTMYoy, 1)}`,
                  ],
                  [
                    "EPS-Wachstum Q / TTM (YoY)",
                    `${fmtPct(f.epsGrowthQuarterlyYoy, 1)} / ${fmtPct(f.epsGrowthTTMYoy, 1)}`,
                  ],
                  [
                    "Brutto- / Operative / Netto-Marge",
                    `${fmtNum(f.grossMarginTTM, 1)} / ${fmtNum(f.operatingMarginTTM, 1)} / ${fmtNum(f.netMarginTTM, 1)} %`,
                  ],
                  ["Eigenkapitalrendite (TTM)", `${fmtNum(f.roeTTM, 1)} %`],
                  ["Beta", fmtNum(f.beta, 2)],
                  ["Verschuldung / EK", fmtNum(f.totalDebtToEquity, 2)],
                ]}
              />
            ) : (
              <div className="text-[11px] text-neutral-500">
                Nicht verfügbar –{" "}
                {a.components.find((c) => c.key === "fundamentals")?.unavailableReason ??
                  "keine Daten"}
              </div>
            )}
            {data.upcomingEarnings && (
              <div className="mt-2 text-[11px] text-amber-300">
                Nächste Zahlen: {data.upcomingEarnings.date}
                {data.upcomingEarnings.epsEstimate != null &&
                  ` · EPS-Konsens ${fmtNum(data.upcomingEarnings.epsEstimate)}`}
              </div>
            )}
          </Panel>

          {data.earnings.length > 0 && (
            <Panel title="Earnings-Überraschungen">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-[10px] text-neutral-500">
                    <th className="font-normal">Quartal</th>
                    <th className="text-right font-normal">Ist</th>
                    <th className="text-right font-normal">Konsens</th>
                    <th className="text-right font-normal">Überr.</th>
                  </tr>
                </thead>
                <tbody>
                  {data.earnings.slice(0, 6).map((e) => (
                    <tr key={e.period} className="border-t border-neutral-900">
                      <td>{e.period}</td>
                      <td className="text-right tabular-nums">{fmtNum(e.actual)}</td>
                      <td className="text-right tabular-nums">{fmtNum(e.estimate)}</td>
                      <td className={cn("text-right tabular-nums", signColor(e.surprisePercent))}>
                        {fmtPct(e.surprisePercent, 1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}

          {data.recommendations.length > 0 && (
            <Panel title="Analystenempfehlungen (Verlauf)">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-[10px] text-neutral-500">
                    <th className="font-normal">Monat</th>
                    <th className="text-right font-normal">Strong Buy</th>
                    <th className="text-right font-normal">Buy</th>
                    <th className="text-right font-normal">Hold</th>
                    <th className="text-right font-normal">Sell</th>
                    <th className="text-right font-normal">Strong Sell</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recommendations.slice(0, 6).map((r) => (
                    <tr key={r.period} className="border-t border-neutral-900 tabular-nums">
                      <td>{r.period.slice(0, 7)}</td>
                      <td className="text-right text-emerald-400">{r.strongBuy}</td>
                      <td className="text-right text-emerald-300">{r.buy}</td>
                      <td className="text-right">{r.hold}</td>
                      <td className="text-right text-red-300">{r.sell}</td>
                      <td className="text-right text-red-400">{r.strongSell}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}

          <Panel title="Signalhistorie (Live-Scans)">
            {data.signalHistory.length ? (
              <table className="w-full text-[11px]">
                <tbody>
                  {[...data.signalHistory]
                    .reverse()
                    .slice(0, 12)
                    .map((h) => (
                      <tr key={h.detectedAt} className="border-t border-neutral-900">
                        <td className="text-neutral-400">{fmtTime(h.detectedAt)}</td>
                        <td>
                          <CategoryBadge category={h.category} small />
                        </td>
                        <td className="text-right tabular-nums">{h.score.toFixed(0)}</td>
                        <td className="text-right tabular-nums text-neutral-400">
                          {fmtNum(h.price)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ) : (
              <div className="text-[11px] text-neutral-500">
                Noch keine aufgezeichneten Kategoriewechsel (werden bei jedem Scan gespeichert).
              </div>
            )}
          </Panel>

          <Panel title="Historische Signale (Backtest, 5 J., technisch)">
            {data.historicalSignals.length ? (
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-[10px] text-neutral-500">
                      <th className="font-normal">Datum</th>
                      <th className="font-normal">Signal</th>
                      <th className="text-right font-normal">5T</th>
                      <th className="text-right font-normal">20T</th>
                      <th className="text-right font-normal">60T</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.historicalSignals.slice(0, 40).map((s) => (
                      <tr key={s.date} className="border-t border-neutral-900 tabular-nums">
                        <td>{s.date}</td>
                        <td className="text-[9px]">{CATEGORY_LABELS[s.category]}</td>
                        {[5, 20, 60].map((h) => (
                          <td key={h} className={cn("text-right", signColor(s.returns[h]))}>
                            {s.returns[h] == null ? "offen" : fmtPct(s.returns[h], 1)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-[11px] text-neutral-500">
                Keine historischen Signale im Zeitraum.
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function KV({ rows }: { rows: [string, string][] }) {
  return (
    <table className="w-full text-[11px]">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-t border-neutral-900">
            <td className="py-0.5 pr-2 text-neutral-500">{k}</td>
            <td className="py-0.5 text-right tabular-nums text-neutral-200">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
