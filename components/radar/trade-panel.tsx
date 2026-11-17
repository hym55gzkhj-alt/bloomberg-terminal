"use client";

import { TRADE_RULES } from "@/lib/radar/trade";
import type { StockAnalysis, TradeSetup } from "@/lib/radar/types";
import { cn } from "@/lib/utils";
import { useBacktest } from "./hooks";
import { fmtNum, fmtPct } from "./lib/format";
import { Panel, TradeBadge } from "./ui";

function Level({
  label,
  value,
  sub,
  tone,
}: { label: string; value: string; sub?: string; tone?: "pos" | "neg" | "acc" }) {
  return (
    <div className="border border-neutral-800 px-2 py-1">
      <div className="text-[9px] uppercase text-neutral-500">{label}</div>
      <div
        className={cn(
          "text-sm font-bold tabular-nums",
          tone === "pos" && "text-emerald-400",
          tone === "neg" && "text-red-400",
          tone === "acc" && "text-amber-300"
        )}
      >
        {value}
      </div>
      {sub && <div className="text-[9px] text-neutral-500">{sub}</div>}
    </div>
  );
}

/** Same parameters as the default backtest view, so the cached result is shared. */
export const ruleBacktestParams = (direction: "long" | "short") => ({
  direction,
  minCategory: "EARLY_SIGNAL" as const,
  costBps: 10,
  entryDelayDays: 1,
  cooldownDays: 20,
  years: 5,
});

export function RuleTrackRecord({ direction }: { direction: "long" | "short" }) {
  const { data, isLoading, error } = useBacktest(ruleBacktestParams(direction));
  const label = direction === "long" ? "Long-Regeln" : "Short-Regeln";
  if (isLoading)
    return <div className="text-[10px] text-neutral-500">Lade historische Bilanz der {label}…</div>;
  if (error || !data)
    return (
      <div className="text-[10px] text-red-400">
        Historische Bilanz der {label} nicht verfügbar.
      </div>
    );
  const t = data.tradeStats;
  const good = (t.avgR ?? 0) > 0;
  return (
    <div
      className={cn(
        "border px-2 py-1 text-[11px]",
        good ? "border-emerald-900 bg-emerald-950/30" : "border-red-900 bg-red-950/30"
      )}
    >
      <span className="font-bold">Historische Bilanz der {label}</span> ({data.universe.length}{" "}
      Titel, {data.period.from.slice(0, 4)}–{data.period.to.slice(0, 4)}): {t.count} Trades,{" "}
      {fmtNum(t.winRate, 0)} % Gewinner, Ø{" "}
      <span className={good ? "text-emerald-400" : "text-red-400"}>
        {(t.avgR ?? 0) >= 0 ? "+" : ""}
        {fmtNum(t.avgR, 2)}R
      </span>{" "}
      je Trade nach Kosten ({fmtPct(t.avgPct, 2)}).{" "}
      {good ? (
        <span className="text-emerald-300">
          Die Regeln waren in der Vergangenheit im Schnitt leicht profitabel.
        </span>
      ) : (
        <span className="text-red-300">
          Achtung: Diese Regeln hätten in der Vergangenheit im Schnitt Verlust gebracht – das Setup
          mit großer Vorsicht betrachten.
        </span>
      )}
    </div>
  );
}

export function TradePanel({ analysis, currency }: { analysis: StockAnalysis; currency: string }) {
  const t: TradeSetup = analysis.trade;
  const isTrade = t.bias !== "NEUTRAL";
  const dir = t.bias === "SHORT" ? -1 : 1;
  const pctFrom = (x: number | null) =>
    x == null || t.entry == null ? null : dir * (x / t.entry - 1) * 100;
  return (
    <Panel
      title="Trade-Einschätzung (regelbasiert)"
      right={<span>Horizont {t.horizon}</span>}
      className={cn(
        t.bias === "LONG" && "border-emerald-800",
        t.bias === "SHORT" && "border-red-800"
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <TradeBadge trade={t} large />
        <div>
          <div className="text-sm font-bold text-neutral-100">{t.action}</div>
          <div className="text-[10px] text-neutral-400">
            Überzeugung: <span className="text-amber-300">{t.convictionLabel}</span> ({t.conviction}
            /100) – Stärke der Signallage, keine Gewinnwahrscheinlichkeit
          </div>
        </div>
      </div>

      {t.entry != null && (
        <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-5">
          <Level
            label={isTrade ? "Einstieg" : "Einstieg erst bei"}
            value={`${fmtNum(t.entry)} ${currency}`}
            tone="acc"
            sub={isTrade ? "nächste Eröffnung" : "Rücksetzer/Erholung"}
          />
          {isTrade && (
            <>
              <Level
                label="Stop-Loss"
                value={fmtNum(t.stop)}
                tone="neg"
                sub={`${fmtPct(pctFrom(t.stop), 1)} · ${TRADE_RULES.stopAtr}× ATR`}
              />
              <Level
                label="Kursziel 1"
                value={fmtNum(t.target1)}
                tone="pos"
                sub={`${fmtPct(pctFrom(t.target1), 1)} · ${TRADE_RULES.target1R}R`}
              />
              <Level
                label="Kursziel 2"
                value={fmtNum(t.target2)}
                tone="pos"
                sub={`${fmtPct(pctFrom(t.target2), 1)} · ${TRADE_RULES.target2R}R`}
              />
              <Level
                label="Chance / Risiko"
                value={`${t.rewardRisk.toFixed(1)} : 1`}
                sub={`Risiko ${fmtNum(t.riskPct, 1)} % je Aktie`}
              />
            </>
          )}
        </div>
      )}

      <p className="mt-2 text-[11px] text-neutral-300">{t.entryNote}</p>
      {(t.bias !== "NEUTRAL" || t.entry != null) && (
        <div className="mt-2">
          <RuleTrackRecord
            direction={t.bias === "SHORT" || t.action.startsWith("Short") ? "short" : "long"}
          />
        </div>
      )}

      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <div>
          <div className="mb-0.5 text-[10px] font-bold uppercase text-emerald-400">
            {t.bias === "SHORT"
              ? "Gründe für Short"
              : t.bias === "LONG"
                ? "Gründe für Long"
                : "Signallage"}
          </div>
          {t.reasons.length ? (
            t.reasons.map((r) => (
              <div key={r} className="text-[11px] text-neutral-200">
                • {r}
              </div>
            ))
          ) : (
            <div className="text-[11px] text-neutral-500">keine ausgeprägten Signale</div>
          )}
        </div>
        <div>
          <div className="mb-0.5 text-[10px] font-bold uppercase text-red-400">
            Risiken / Gegenargumente
          </div>
          {t.risks.length ? (
            t.risks.map((r) => (
              <div key={r} className="text-[11px] text-neutral-200">
                • {r}
              </div>
            ))
          ) : (
            <div className="text-[11px] text-neutral-500">keine besonderen</div>
          )}
        </div>
      </div>
      {t.invalidation && (
        <div className="mt-2 text-[10px] text-neutral-400">Ungültig wenn: {t.invalidation}</div>
      )}
      <div className="mt-2 border-t border-neutral-800 pt-1 text-[9px] text-neutral-500">
        Regeln: Long bei positiver Einstufung ohne Überdehnung; Short bei NEGATIVE + bestätigtem
        Abwärtstrend, nicht überverkauft. Stop {TRADE_RULES.stopAtr}× ATR14, Ziele{" "}
        {TRADE_RULES.target1R}R/{TRADE_RULES.target2R}R, max. {TRADE_RULES.maxDays} Handelstage.
        Historische Trefferquote dieser Regeln: Ansicht BT (Long/Short). Keine Anlageberatung –
        Positionsgröße so wählen, dass ein Stop-Loss verkraftbar ist.
      </div>
    </Panel>
  );
}
