"use client";

import {
  DEFAULT_DESK,
  type DeskPlan,
  addTradingDays,
  fxRate,
  orderTicket,
  riskCheck,
  sizePosition,
} from "@/lib/radar/desk";
import { type TimeMachineResult, runTimeMachine } from "@/lib/radar/timemachine";
import { TRADE_RULES } from "@/lib/radar/trade";
import type { DetailPayload, StockAnalysis } from "@/lib/radar/types";
import { cn } from "@/lib/utils";
import { useAtom, useAtomValue } from "jotai";
import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useBacktest, useOverview } from "./hooks";
import { fmtNum } from "./lib/format";
import { deskConfigAtom, tmSeedAtom } from "./state";
import { ruleBacktestParams } from "./trade-panel";
import { Panel } from "./ui";

const axis = { fontSize: 10, fill: "#777" };
const tooltipStyle = { background: "#111", border: "1px solid #444", fontSize: 11 };
const pc = (x: number | null | undefined, d = 1) =>
  x == null || !Number.isFinite(x) ? "–" : `${(x * 100).toFixed(d).replace(".", ",")} %`;

/** Konfiguration mit Standardwerten zusammengeführt (ältere gespeicherte Stände). */
export function useDeskConfig() {
  const [stored, set] = useAtom(deskConfigAtom);
  return [{ ...DEFAULT_DESK, ...stored }, set] as const;
}

export function useEurUsd(): number | null {
  const ov = useOverview();
  return ov.data?.rows.find((r) => r.symbol === "EURUSD=X")?.price ?? null;
}

/** Plan aus der regelbasierten Trade-Einschätzung; null ohne aktives Long/Short-Setup. */
export function planOf(a: StockAnalysis, currency: string, fx: number | null): DeskPlan | null {
  const t = a.trade;
  if (t.bias === "NEUTRAL" || t.entry == null || t.stop == null) return null;
  if (t.target1 == null || t.target2 == null) return null;
  return {
    ticker: a.entry.ticker,
    direction: t.bias === "SHORT" ? -1 : 1,
    entry: t.entry,
    stop: t.stop,
    target1: t.target1,
    target2: t.target2,
    currency,
    fx,
  };
}

function Odds({
  label,
  value,
  tone,
  sub,
}: { label: string; value: number | null; tone?: "pos" | "neg"; sub?: string }) {
  return (
    <div className="border border-neutral-800 px-2 py-1">
      <div className="text-[9px] uppercase text-neutral-500">{label}</div>
      <div
        className={cn(
          "text-sm font-bold tabular-nums",
          tone === "pos" && "text-emerald-400",
          tone === "neg" && "text-red-400"
        )}
      >
        {pc(value)}
      </div>
      {sub && <div className="text-[9px] text-neutral-500">{sub}</div>}
    </div>
  );
}

const LEAN_STYLE: Record<string, string> = {
  strong_target: "border-emerald-700 bg-emerald-950/40 text-emerald-200",
  lean_target: "border-emerald-900 bg-emerald-950/20 text-emerald-200",
  coin: "border-amber-800 bg-amber-950/20 text-amber-200",
  breakeven: "border-amber-800 bg-amber-950/20 text-amber-200",
  lean_stop: "border-red-900 bg-red-950/20 text-red-200",
  strong_stop: "border-red-700 bg-red-950/40 text-red-200",
  none: "border-neutral-700 text-neutral-300",
};

function TimeMachineBlock({
  tm,
  plan,
  exitTarget,
}: { tm: TimeMachineResult; plan: DeskPlan; exitTarget: number }) {
  const [seed, setSeed] = useAtom(tmSeedAtom);
  const fan = tm.bands.map((b) => ({ ...b, label: b.day === 0 ? "Start" : `T${b.day}` }));
  const hist = tm.histogram.map((h) => ({
    label: `${h.from.toFixed(1)}…${h.to.toFixed(1)}R`,
    mid: (h.from + h.to) / 2,
    count: h.count,
  }));
  const dirWord = plan.direction === 1 ? "über" : "unter";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-neutral-400">
        <span>
          {tm.replays.toLocaleString("de-DE")} Wiederholungen der nächsten {tm.maxDays} Handelstage
          aus {tm.poolDays} echten Tageskerzen ({tm.poolFrom} bis {tm.poolTo}), Seed
        </span>
        <input
          type="number"
          value={seed}
          onChange={(e) => setSeed(Number(e.target.value) || 0)}
          className="h-5 w-16 border border-neutral-700 bg-black px-1 text-amber-200 outline-none focus:border-amber-500"
          aria-label="Seed"
        />
        <button
          type="button"
          onClick={() => setSeed(Math.floor(Math.random() * 100_000))}
          className="border border-neutral-700 px-1.5 hover:border-amber-500"
        >
          neuer Seed
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
        <Odds
          label="Ziel zuerst"
          value={tm.pTarget}
          tone="pos"
          sub={`${fmtNum(exitTarget)} · ${tm.targetR.toFixed(1)}R`}
        />
        <Odds label="Stop zuerst" value={tm.pStop} tone="neg" sub={fmtNum(plan.stop)} />
        <Odds label="Weder noch" value={tm.pNeither} sub={`offen nach ${tm.maxDays} T`} />
        <Odds label="Im Plus" value={tm.pGreen} sub="Ziel oder Gewinn am Ende" />
        {tm.pTarget1 != null ? (
          <Odds label="Ziel 1 berührt" value={tm.pTarget1} sub={fmtNum(plan.target1)} />
        ) : (
          <div className="border border-neutral-800 px-2 py-1">
            <div className="text-[9px] uppercase text-neutral-500">Ø Ergebnis</div>
            <div
              className={cn(
                "text-sm font-bold tabular-nums",
                tm.avgR >= 0 ? "text-emerald-400" : "text-red-400"
              )}
            >
              {tm.avgR >= 0 ? "+" : ""}
              {tm.avgR.toFixed(2)}R
            </div>
            <div className="text-[9px] text-neutral-500">Median {tm.medianR.toFixed(2)}R</div>
          </div>
        )}
      </div>
      <div className="text-[11px] text-neutral-300">
        Kurs am Ende: Median {fmtNum(tm.final.median)}, 90 % der Wiederholungen zwischen{" "}
        {fmtNum(tm.final.p5)} und {fmtNum(tm.final.p95)} · Ø Ergebnis{" "}
        <span className={tm.avgR >= 0 ? "text-emerald-400" : "text-red-400"}>
          {tm.avgR >= 0 ? "+" : ""}
          {tm.avgR.toFixed(2)}R
        </span>{" "}
        nach Kosten · Ø Haltedauer {tm.avgDays.toFixed(1)} Tage
      </div>
      <div className={cn("border px-2 py-1 text-[11px]", LEAN_STYLE[tm.lean])}>
        <div className="font-bold">{tm.verdict}</div>
        {tm.notes.map((n) => (
          <div key={n}>{n}</div>
        ))}
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        <div>
          <div className="mb-0.5 text-[10px] uppercase text-neutral-500">
            Fächer: Kurs je Handelstag (5 / 25 / 50 / 75 / 95 %)
          </div>
          <div className="h-48">
            <ResponsiveContainer>
              <ComposedChart data={fan} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#1f1f1f" />
                <XAxis dataKey="label" tick={axis} interval={Math.ceil(fan.length / 8)} />
                <YAxis
                  tick={axis}
                  width={52}
                  domain={["auto", "auto"]}
                  tickFormatter={(v) => fmtNum(v, 0)}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number, name) => [fmtNum(v), name]}
                />
                <ReferenceLine y={plan.entry} stroke="#d97706" strokeDasharray="3 3" />
                <ReferenceLine y={plan.stop} stroke="#ef4444" strokeDasharray="4 2" />
                <ReferenceLine y={exitTarget} stroke="#10b981" strokeDasharray="4 2" />
                <Line dataKey="p95" name="95 %" stroke="#525252" dot={false} strokeWidth={1} />
                <Line dataKey="p75" name="75 %" stroke="#a3a3a3" dot={false} strokeWidth={1} />
                <Line dataKey="p50" name="Median" stroke="#fbbf24" dot={false} strokeWidth={2} />
                <Line dataKey="p25" name="25 %" stroke="#a3a3a3" dot={false} strokeWidth={1} />
                <Line dataKey="p5" name="5 %" stroke="#525252" dot={false} strokeWidth={1} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <div className="mb-0.5 text-[10px] uppercase text-neutral-500">
            Verteilung der Ergebnisse in R
          </div>
          <div className="h-48">
            <ResponsiveContainer>
              <BarChart data={hist} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#1f1f1f" />
                <XAxis dataKey="mid" tick={axis} tickFormatter={(v) => `${Number(v).toFixed(1)}`} />
                <YAxis tick={axis} width={40} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(_, p) => p?.[0]?.payload?.label ?? ""}
                  formatter={(v: number) => [v, "Wiederholungen"]}
                />
                <Bar dataKey="count" isAnimationActive={false}>
                  {hist.map((h) => (
                    <Cell key={h.label} fill={h.mid >= 0 ? "#10b981" : "#ef4444"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <div className="text-[9px] text-neutral-500">
        Jede Wiederholung zieht für jeden Tag zufällig eine echte Tageskerze der Aktie und skaliert
        sie auf den aktuellen Kurs. Stop vor Ziel geprüft (berührt eine Kerze beides, zählt der
        Stop), Kurslücken {dirWord} den Stop werden zum Eröffnungskurs ausgeführt, 2 × 10 bp Kosten.
        Eine Simulation aus der eigenen Historie ist keine Vorhersage – Earnings, News und
        Marktschocks können Dinge tun, die in diesen Tagen nie vorkamen.
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          },
          () => undefined
        );
      }}
      className="flex items-center gap-1 border border-neutral-700 px-1.5 text-[10px] hover:border-amber-500"
    >
      {done ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} kopieren
    </button>
  );
}

/**
 * Trading Desk für eine Aktie: Time Machine → Positionsgröße → Risiko-Check → Order-Ticket.
 * Die Kette der Day-Trader-Skills, angewendet auf das regelbasierte Setup des Radars.
 */
export function TradeDeskPanel({
  detail,
  analysis,
}: {
  detail: DetailPayload;
  /** mit den Gewichten des Nutzers neu bewertete Analyse (Standard: Server-Analyse) */
  analysis?: StockAnalysis;
}) {
  const a = analysis ?? detail.analysis;
  const currency = a.quote.currency;
  const [cfg] = useDeskConfig();
  const seed = useAtomValue(tmSeedAtom);
  const eurusd = useEurUsd();
  const fx = fxRate(currency, cfg.accountCurrency, eurusd);
  const plan = planOf(a, currency, fx);
  const exitTarget = plan ? (cfg.takeProfit === "target2" ? plan.target2 : plan.target1) : null;
  const rules = useBacktest(ruleBacktestParams(plan?.direction === -1 ? "short" : "long"), !!plan);

  const dir = plan?.direction ?? null;
  const entry = plan?.entry ?? null;
  const stop = plan?.stop ?? null;
  const t1 = cfg.takeProfit === "target2" ? (plan?.target1 ?? null) : null;
  const tm = useMemo((): { ok: TimeMachineResult } | { error: string } | null => {
    if (dir == null || entry == null || stop == null || exitTarget == null) return null;
    try {
      return {
        ok: runTimeMachine(
          detail.bars,
          { direction: dir, entry, stop, target: exitTarget, target1: t1 },
          { seed }
        ),
      };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }, [detail.bars, dir, entry, stop, t1, exitTarget, seed]);
  const tmOk = tm && "ok" in tm ? tm.ok : null;

  if (!plan || exitTarget == null) {
    return (
      <Panel title="Trading Desk · Time Machine · Positionsgröße · Risiko-Check">
        <div className="text-[11px] text-neutral-400">
          Kein aktives Long- oder Short-Setup ({a.trade.action}). Time Machine, Positionsgröße und
          Risiko-Check rechnen nur mit einem regelbasierten Einstieg, Stop und Ziel – es wird kein
          Trade erfunden.
        </div>
      </Panel>
    );
  }

  const size = sizePosition(plan, cfg);
  const lastDate = detail.bars[detail.bars.length - 1]?.date ?? new Date().toISOString();
  const risk = riskCheck(plan, size, cfg, {
    earningsDate: detail.upcomingEarnings?.date ?? null,
    horizonEnd: addTradingDays(lastDate.slice(0, 10), TRADE_RULES.maxDays),
    timeMachineLean: tmOk?.lean ?? null,
    timeMachineVerdict: tmOk?.verdict ?? null,
    ruleAvgR: rules.data?.tradeStats.avgR ?? null,
    coverage: a.coverage,
    limited: !!a.limited?.length,
  });
  const ticket = orderTicket(plan, size, cfg);
  const acc = cfg.accountCurrency;
  const pass = risk.verdict === "PASS";

  return (
    <Panel
      title="Trading Desk · Time Machine · Positionsgröße · Risiko-Check"
      right={
        <span>
          Konto {fmtNum(cfg.account, 0)} {acc} · max. Verlust {fmtNum(cfg.maxLossPerTrade, 0)} {acc}{" "}
          (Einstellungen: DESK)
        </span>
      }
      className={pass ? "border-emerald-900" : "border-red-900"}
    >
      <div className="space-y-3">
        <section>
          <h3 className="mb-1 text-[10px] font-bold uppercase text-amber-400">
            1 · Time Machine – {plan.direction === 1 ? "Long" : "Short"} {plan.ticker} ab{" "}
            {fmtNum(plan.entry)} {currency}
          </h3>
          {tmOk ? (
            <TimeMachineBlock tm={tmOk} plan={plan} exitTarget={exitTarget} />
          ) : (
            <div className="text-[11px] text-red-400">{tm && "error" in tm ? tm.error : ""}</div>
          )}
        </section>

        <section>
          <h3 className="mb-1 text-[10px] font-bold uppercase text-amber-400">
            2 · Positionsgröße
          </h3>
          <div className="grid gap-2 md:grid-cols-[1fr_1fr]">
            <div className="text-[11px]">
              <div className="text-lg font-bold text-neutral-100">
                {size.shares} Stück{" "}
                <span className="text-[11px] font-normal text-neutral-400">
                  begrenzt durch „{size.limit}“
                </span>
              </div>
              <div className="text-neutral-300">
                Positionswert {fmtNum(size.positionValue)} {acc} ({fmtNum(size.positionPct, 1)} %
                des Kontos)
              </div>
              <div className="text-red-300">
                Verlust beim Stop: {fmtNum(size.lossAtStop)} {acc} ({fmtNum(size.riskPerShare)}{" "}
                {acc} je Stück)
              </div>
              <div className="text-emerald-300">
                Bei Ziel 1: +{fmtNum(size.gainAtTarget1)} {acc} · bei Ziel 2: +
                {fmtNum(size.gainAtTarget2)} {acc}
              </div>
              {fx != null && currency !== acc && (
                <div className="text-[10px] text-neutral-500">
                  Umrechnung {currency}→{acc} zum Kurs {fx.toFixed(4)} (EUR/USD aus der
                  Marktübersicht)
                </div>
              )}
            </div>
            <table className="text-[11px]">
              <tbody>
                {size.candidates.map((c) => (
                  <tr
                    key={c.rule}
                    className={cn(c.rule === size.limit ? "text-amber-300" : "text-neutral-400")}
                  >
                    <td className="pr-2">{c.rule}</td>
                    <td className="text-right tabular-nums">{c.shares} Stück</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase text-amber-400">
            3 · Risiko-Check
            <span
              className={cn(
                "border px-1.5 text-[11px]",
                pass ? "border-emerald-500 text-emerald-300" : "border-red-500 text-red-300"
              )}
            >
              {risk.verdict}
            </span>
          </h3>
          <ul className="grid gap-x-4 text-[11px] md:grid-cols-2">
            {risk.checks.map((c) => (
              <li key={c.rule} className="flex gap-1.5">
                <span
                  className={cn(
                    "w-10 shrink-0 font-bold",
                    c.status === "ok" && "text-emerald-400",
                    c.status === "warn" && "text-amber-400",
                    c.status === "block" && "text-red-400"
                  )}
                >
                  {c.status === "ok" ? "OK" : c.status === "warn" ? "HINW." : "STOP"}
                </span>
                <span className="text-neutral-300">
                  <span className="text-neutral-500">{c.rule}:</span> {c.detail}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase text-amber-400">
            4 · Order-Ticket {pass && <CopyButton text={ticket} />}
          </h3>
          {pass ? (
            <pre className="whitespace-pre-wrap border border-neutral-800 bg-black p-2 text-[11px] text-neutral-200">
              {ticket}
            </pre>
          ) : (
            <div className="text-[11px] text-red-300">
              Kein Ticket: Der Risiko-Check hat den Trade gesperrt. Grenzen anpassen nur, wenn du
              das Risiko bewusst tragen willst.
            </div>
          )}
          <div className="mt-1 text-[9px] text-neutral-500">
            Das Terminal sendet keine Orders. Das Ticket ist eine Vorlage, die du selbst bei deinem
            Broker eingibst und prüfst. Keine Anlageberatung.
          </div>
        </section>
      </div>
    </Panel>
  );
}
