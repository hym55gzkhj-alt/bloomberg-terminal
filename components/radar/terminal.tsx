"use client";

import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useAtom, useSetAtom } from "jotai";
import { Radar, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useScan, useStatus } from "./hooks";
import { fmtAge } from "./lib/format";
import { VIEWS, selectedTickerAtom, viewAtom } from "./state";
import { AnalysisView } from "./views/analysis";
import { BacktestView } from "./views/backtest";
import { ScanProgressBar } from "./views/common";
import { NewsView } from "./views/news";
import { OpportunitiesView } from "./views/opportunities";
import { OverviewView } from "./views/overview";
import { ScannerView } from "./views/scanner";
import { SettingsView } from "./views/settings";
import { SignalsView } from "./views/signals";
import { TradesView } from "./views/trades";
import { WatchlistView } from "./views/watchlist";

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="tabular-nums">{now ? now.toLocaleTimeString("de-DE") : ""}</span>;
}

export default function RadarTerminal() {
  const [view, setView] = useAtom(viewAtom);
  const setTicker = useSetAtom(selectedTickerAtom);
  const [cmd, setCmd] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const scan = useScan();
  const status = useStatus();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT"
      )
        return;
      if (e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      const v = VIEWS.find((x) => x.hotkey === e.key);
      if (v && !e.metaKey && !e.ctrlKey && !e.altKey) setView(v.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setView]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = cmd.trim().toUpperCase();
    if (!t) return;
    const v = VIEWS.find((x) => x.code === t);
    if (v) setView(v.key);
    else {
      setTicker(t);
      setView("analysis");
    }
    setCmd("");
    inputRef.current?.blur();
  };

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["radar"] });
  };

  return (
    <div className="flex min-h-screen flex-col bg-black font-mono text-neutral-200">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-amber-700 bg-[#111] px-2 py-1">
        <div className="flex items-center gap-1.5 pr-2 text-sm font-bold text-amber-400">
          <Radar className="h-4 w-4" /> AI STOCK RADAR
        </div>
        <form onSubmit={submit} className="flex items-center">
          <span className="bg-amber-500 px-1.5 text-[11px] font-bold leading-6 text-black">
            CMD
          </span>
          <input
            ref={inputRef}
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            placeholder="Ticker (z. B. NVDA, SAP, CRM) oder Funktion (SIG, BT) …  [/]"
            className="h-6 w-72 border border-neutral-700 bg-black px-2 text-[11px] uppercase text-amber-200 outline-none placeholder:normal-case placeholder:text-neutral-600 focus:border-amber-500"
          />
        </form>
        <button
          type="button"
          onClick={refresh}
          className="flex h-6 items-center gap-1 border border-neutral-700 px-2 text-[11px] hover:border-amber-500 hover:text-amber-300"
          title="Alle Ansichten neu laden (Server-Cache bleibt bestehen, um Anbieter-Limits zu schonen)"
        >
          <RefreshCw className={cn("h-3 w-3", scan.isFetching && "animate-spin")} /> REFR
        </button>
        <div className="ml-auto flex items-center gap-3 text-[10px] text-neutral-400">
          {scan.data && <span>Scan: vor {fmtAge(scan.data.generatedAt)}</span>}
          <Clock />
        </div>
      </div>

      {/* Function keys */}
      <nav className="flex flex-wrap gap-px border-b border-neutral-800 bg-neutral-900 px-1 py-1">
        {VIEWS.map((v) => (
          <button
            type="button"
            key={v.key}
            onClick={() => setView(v.key)}
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 text-[11px]",
              view === v.key
                ? "bg-amber-500 font-bold text-black"
                : "bg-[#1c1c1c] text-neutral-300 hover:bg-neutral-800"
            )}
            title={`Taste ${v.hotkey}`}
          >
            <span className={cn("text-[9px]", view === v.key ? "text-black/70" : "text-amber-500")}>
              {v.hotkey}
            </span>
            {v.code}
            <span className="hidden lg:inline">· {v.label}</span>
          </button>
        ))}
      </nav>

      <main className="flex-1 p-2">
        {scan.data && <ScanProgressBar scan={scan.data} />}
        {view === "overview" && <OverviewView />}
        {view === "signals" && <SignalsView />}
        {view === "trades" && <TradesView />}
        {view === "opportunities" && <OpportunitiesView />}
        {view === "scanner" && <ScannerView />}
        {view === "analysis" && <AnalysisView />}
        {view === "news" && <NewsView />}
        {view === "watchlist" && <WatchlistView />}
        {view === "backtest" && <BacktestView />}
        {view === "settings" && <SettingsView />}
      </main>

      {/* Status bar */}
      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-neutral-800 bg-[#0d0d0d] px-2 py-1 text-[10px]">
        {status.data?.providers.map((p) => (
          <span key={p.provider} className="flex items-center gap-1" title={p.message}>
            <span className={cn("h-2 w-2 rounded-full", p.ok ? "bg-emerald-500" : "bg-red-500")} />
            <span className={p.ok ? "text-neutral-300" : "text-red-300"}>{p.provider}</span>
            <span className="max-w-[360px] truncate text-neutral-500">{p.message}</span>
          </span>
        ))}
        {status.isError && <span className="text-red-400">Statusabfrage fehlgeschlagen</span>}
        <span className="ml-auto text-neutral-600">
          Keine Anlageberatung · Score = analytischer Indikator, keine Wahrscheinlichkeit
        </span>
      </footer>
    </div>
  );
}
