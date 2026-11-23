"use client";

import { DEFAULT_DESK, type DeskConfig, fxRate, riskCheck, sizePosition } from "@/lib/radar/desk";
import { cn } from "@/lib/utils";
import { useAtom, useAtomValue } from "jotai";
import { useMemo, useState } from "react";
import { TradeDeskPanel, planOf, useDeskConfig, useEurUsd } from "../desk-panel";
import { reweight, useDetail, useWeightedResults } from "../hooks";
import { fmtNum } from "../lib/format";
import { selectedTickerAtom, weightsAtom } from "../state";
import { ErrorBox, Loading, Panel, TradeBadge } from "../ui";

function NumField({
  label,
  value,
  onChange,
  step = 1,
  suffix,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  suffix?: string;
  hint?: string;
}) {
  return (
    <label className="grid grid-cols-[1fr_110px] items-center gap-2 text-[11px]">
      <span>
        <span className="text-neutral-200">{label}</span>
        {hint && <span className="block text-[9px] text-neutral-500">{hint}</span>}
      </span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          step={step}
          value={value}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          className="h-6 w-full border border-neutral-700 bg-black px-1 text-right text-amber-200 outline-none focus:border-amber-500"
        />
        {suffix && <span className="w-7 text-neutral-500">{suffix}</span>}
      </span>
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  hint,
}: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-[11px]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-amber-500"
      />
      <span>
        <span className="text-neutral-200">{label}</span>
        {hint && <span className="block text-[9px] text-neutral-500">{hint}</span>}
      </span>
    </label>
  );
}

function DeskSettings() {
  const [cfg, setCfg] = useDeskConfig();
  const [blocked, setBlocked] = useState(cfg.blocked.join(", "));
  const set = <K extends keyof DeskConfig>(k: K, v: DeskConfig[K]) => setCfg({ ...cfg, [k]: v });
  const acc = cfg.accountCurrency;
  return (
    <Panel
      title="Konto & Risikoregeln"
      right={
        <button
          type="button"
          onClick={() => {
            setCfg(DEFAULT_DESK);
            setBlocked("");
          }}
          className="border border-neutral-700 px-2 hover:border-amber-500"
        >
          Standard
        </button>
      }
    >
      <div className="space-y-2">
        <label className="grid grid-cols-[1fr_110px] items-center gap-2 text-[11px]">
          <span className="text-neutral-200">Kontowährung</span>
          <select
            value={acc}
            onChange={(e) =>
              set("accountCurrency", e.target.value as DeskConfig["accountCurrency"])
            }
            className="h-6 border border-neutral-700 bg-black px-1 text-amber-200"
          >
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
          </select>
        </label>
        <NumField
          label="Kontogröße"
          value={cfg.account}
          onChange={(v) => set("account", v)}
          step={100}
          suffix={acc}
        />
        <NumField
          label="Max. Verlust je Trade"
          value={cfg.maxLossPerTrade}
          onChange={(v) => set("maxLossPerTrade", v)}
          step={5}
          suffix={acc}
          hint="Verlust, wenn der Stop greift – bestimmt meist die Stückzahl"
        />
        <NumField
          label="Bargeldreserve"
          value={cfg.cashBufferPct}
          onChange={(v) => set("cashBufferPct", Math.min(100, v))}
          suffix="%"
        />
        <NumField
          label="Max. Positionsgröße"
          value={cfg.maxPositionPct}
          onChange={(v) => set("maxPositionPct", Math.min(100, v))}
          suffix="%"
          hint="Anteil des Kontos je Aktie"
        />
        <NumField
          label="Max. Orderwert"
          value={cfg.maxOrder}
          onChange={(v) => set("maxOrder", v)}
          step={100}
          suffix={acc}
        />
        <NumField
          label="Min. Orderwert"
          value={cfg.minOrder}
          onChange={(v) => set("minOrder", v)}
          step={10}
          suffix={acc}
        />
        <NumField
          label="Min. Chance/Risiko"
          value={cfg.minRewardRisk}
          onChange={(v) => set("minRewardRisk", v)}
          step={0.1}
          suffix=": 1"
        />
        <label className="grid grid-cols-[1fr_110px] items-center gap-2 text-[11px]">
          <span>
            <span className="text-neutral-200">Take-Profit</span>
            <span className="block text-[9px] text-neutral-500">
              Ziel für Time Machine, Chance/Risiko und Ticket
            </span>
          </span>
          <select
            value={cfg.takeProfit}
            onChange={(e) => set("takeProfit", e.target.value as DeskConfig["takeProfit"])}
            className="h-6 border border-neutral-700 bg-black px-1 text-amber-200"
          >
            <option value="target1">Kursziel 1 (1,5R)</option>
            <option value="target2">Kursziel 2 (3R)</option>
          </select>
        </label>
        <Toggle
          label="Short-Verkäufe erlauben"
          checked={cfg.allowShort}
          onChange={(v) => set("allowShort", v)}
          hint="Theoretisch unbegrenztes Verlustrisiko"
        />
        <Toggle
          label="Sperren, wenn Earnings in den Haltezeitraum fallen"
          checked={cfg.blockEarnings}
          onChange={(v) => set("blockEarnings", v)}
        />
        <Toggle
          label="Sperren, wenn die Time Machine deutlich Richtung Stop zeigt"
          checked={cfg.blockStrongStop}
          onChange={(v) => set("blockStrongStop", v)}
        />
        <label className="block text-[11px]">
          <span className="text-neutral-200">Sperrliste</span>
          <input
            value={blocked}
            onChange={(e) => setBlocked(e.target.value)}
            onBlur={() =>
              set(
                "blocked",
                blocked
                  .split(/[\s,;]+/)
                  .map((x) => x.trim().toUpperCase())
                  .filter(Boolean)
              )
            }
            placeholder="z. B. TSLA, GME"
            className="mt-0.5 h-6 w-full border border-neutral-700 bg-black px-1 uppercase text-amber-200 outline-none placeholder:normal-case placeholder:text-neutral-600 focus:border-amber-500"
          />
        </label>
        <div className="border-t border-neutral-800 pt-1 text-[9px] text-neutral-500">
          Nur in diesem Browser gespeichert. Positionsgröße = Minimum aus max. Verlust ÷ Risiko je
          Stück, Positionsgrenze, max. Orderwert und Bargeld (ganze Stück).
        </div>
      </div>
    </Panel>
  );
}

function SetupList({ selected, onSelect }: { selected: string; onSelect: (t: string) => void }) {
  const { results, isLoading, error } = useWeightedResults();
  const [cfg] = useDeskConfig();
  const eurusd = useEurUsd();
  const rows = useMemo(
    () =>
      results
        .filter((r) => r.trade.bias !== "NEUTRAL")
        .map((r) => {
          const plan = planOf(
            r,
            r.quote.currency,
            fxRate(r.quote.currency, cfg.accountCurrency, eurusd)
          );
          if (!plan) return null;
          const size = sizePosition(plan, cfg);
          const risk = riskCheck(plan, size, cfg, { coverage: r.coverage });
          return { r, plan, size, risk };
        })
        .filter((x): x is NonNullable<typeof x> => x != null),
    [results, cfg, eurusd]
  );
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return (
    <Panel
      title={`Aktive Setups (${rows.length})`}
      right={<span>Schnell-Check ohne Time Machine/Earnings – Details per Klick</span>}
    >
      {!rows.length ? (
        <div className="text-[11px] text-neutral-500">
          Derzeit keine Long- oder Short-Setups – es werden keine Trades erfunden.
        </div>
      ) : (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-[10px] uppercase text-neutral-500">
                <th className="px-1 font-normal">Titel</th>
                <th className="px-1 font-normal">Setup</th>
                <th className="px-1 text-right font-normal">Stück</th>
                <th className="px-1 text-right font-normal">Wert</th>
                <th className="px-1 text-right font-normal">Verlust b. Stop</th>
                <th className="px-1 text-right font-normal">C/R</th>
                <th className="px-1 font-normal">Check</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ r, size, risk }) => (
                <tr
                  key={r.entry.ticker}
                  tabIndex={0}
                  onClick={() => onSelect(r.entry.ticker)}
                  onKeyDown={(e) => e.key === "Enter" && onSelect(r.entry.ticker)}
                  className={cn(
                    "cursor-pointer border-t border-neutral-900 hover:bg-neutral-900",
                    selected === r.entry.ticker && "bg-neutral-900"
                  )}
                >
                  <td className="px-1 py-1">
                    <span className="font-bold text-amber-300">{r.entry.ticker}</span>{" "}
                    <span className="text-neutral-400">{r.entry.name}</span>
                  </td>
                  <td className="px-1">
                    <TradeBadge trade={r.trade} />
                  </td>
                  <td className="px-1 text-right tabular-nums">{size.shares}</td>
                  <td className="px-1 text-right tabular-nums">{fmtNum(size.positionValue, 0)}</td>
                  <td className="px-1 text-right tabular-nums text-red-300">
                    {fmtNum(size.lossAtStop, 0)}
                  </td>
                  <td className="px-1 text-right tabular-nums">{size.rewardRisk.toFixed(1)}</td>
                  <td className="px-1">
                    <span
                      className={cn(
                        "font-bold",
                        risk.verdict === "PASS" ? "text-emerald-400" : "text-red-400"
                      )}
                      title={risk.checks
                        .filter((c) => c.status === "block")
                        .map((c) => `${c.rule}: ${c.detail}`)
                        .join("\n")}
                    >
                      {risk.verdict}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function SelectedDesk({ ticker }: { ticker: string }) {
  const { data, isLoading, error } = useDetail(ticker);
  const weights = useAtomValue(weightsAtom);
  const analysis = useMemo(
    () => (data ? reweight(data.analysis, weights) : undefined),
    [data, weights]
  );
  if (isLoading) return <Loading label={`Lade ${ticker}…`} />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  return <TradeDeskPanel detail={data} analysis={analysis} />;
}

export function DeskView() {
  const [ticker, setTicker] = useAtom(selectedTickerAtom);
  return (
    <div className="grid gap-2 xl:grid-cols-[1fr_360px]">
      <div className="space-y-2">
        <div className="border border-neutral-800 bg-[#0b0b0b] px-2 py-1 text-[11px] text-neutral-400">
          Die Kette der Day-Trader-Skills auf dem Radar-Setup:{" "}
          <span className="text-amber-300">
            Signal → Time Machine → Positionsgröße → Risiko-Check → Order-Ticket
          </span>
          . Es wird nie eine Order gesendet. Aktuell: <b className="text-amber-300">{ticker}</b>
        </div>
        <SetupList selected={ticker} onSelect={setTicker} />
        <SelectedDesk ticker={ticker} />
      </div>
      <DeskSettings />
    </div>
  );
}
