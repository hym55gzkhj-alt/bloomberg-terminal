"use client";

import { DEFAULT_WEIGHTS } from "@/lib/radar/config";
import { DEFAULT_DESK, type DeskConfig } from "@/lib/radar/desk";
import type { BacktestParams, Weights } from "@/lib/radar/types";
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export type ViewKey =
  | "overview"
  | "signals"
  | "trades"
  | "opportunities"
  | "scanner"
  | "analysis"
  | "news"
  | "watchlist"
  | "backtest"
  | "desk"
  | "congress"
  | "settings";

export const VIEWS: { key: ViewKey; code: string; label: string; hotkey: string }[] = [
  { key: "overview", code: "MKT", label: "Market Overview", hotkey: "1" },
  { key: "signals", code: "SIG", label: "AI Early Signals", hotkey: "2" },
  { key: "trades", code: "TRD", label: "Trade-Ideen", hotkey: "0" },
  { key: "opportunities", code: "TOP", label: "Top Opportunities", hotkey: "3" },
  { key: "scanner", code: "SCAN", label: "Stock Scanner", hotkey: "4" },
  { key: "analysis", code: "ANLY", label: "Company Analysis", hotkey: "5" },
  { key: "news", code: "NEWS", label: "Live News", hotkey: "6" },
  { key: "watchlist", code: "WL", label: "Watchlist", hotkey: "7" },
  { key: "backtest", code: "BT", label: "Signal Performance", hotkey: "8" },
  { key: "desk", code: "DESK", label: "Trading Desk", hotkey: "d" },
  { key: "congress", code: "CONG", label: "Congress Trades", hotkey: "c" },
  { key: "settings", code: "CFG", label: "Gewichtung", hotkey: "9" },
];

export const viewAtom = atom<ViewKey>("signals");
export const selectedTickerAtom = atom<string>("NVDA");

/** Stored per browser (convenience only – the server never relies on it). */
export const watchlistAtom = atomWithStorage<string[]>("radar.watchlist", [
  "NVDA",
  "MSFT",
  "SAP",
  "ASML",
]);
export const weightsAtom = atomWithStorage<Weights>("radar.weights", DEFAULT_WEIGHTS);

export const backtestParamsAtom = atom<Partial<BacktestParams>>({
  direction: "long",
  minCategory: "EARLY_SIGNAL",
  costBps: 10,
  entryDelayDays: 1,
  cooldownDays: 20,
  years: 5,
});

/** Konto- und Risikoregeln des Trading Desks (nur im Browser gespeichert). */
export const deskConfigAtom = atomWithStorage<DeskConfig>("radar.desk", DEFAULT_DESK);
/** Seed der Time Machine – gleicher Seed, gleiche Zahlen. */
export const tmSeedAtom = atomWithStorage<number>("radar.tmSeed", 19);
