import { drainPending } from "@/lib/radar/analyze";
import { jsonError, jsonOk } from "@/lib/radar/http-response";
import { getHistory } from "@/lib/radar/providers/yahoo";
import { stockDetail } from "@/lib/radar/scan";
import type { UniverseEntry } from "@/lib/radar/types";
import { findEntry } from "@/lib/radar/universe";
import type { NextRequest } from "next/server";

import { after } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Full analysis: liquid, established stocks (average daily turnover in trading currency). */
const LIQUID_TURNOVER = 20_000_000;
/** Below this, a stock is not analysed at all (signals would be dominated by noise). */
const MIN_TURNOVER = 250_000;
const MIN_PRICE = 5; // no penny stocks
const MIN_BARS = 80; // volume/relative-strength components need ~70 trading days
const FULL_HISTORY_BARS = 260;

/** Benchmark index by Yahoo exchange suffix. */
const BENCHMARKS: Record<string, string> = {
  DE: "^GDAXI",
  F: "^GDAXI",
  SG: "^GDAXI",
  MU: "^GDAXI",
  VI: "^ATX",
  AS: "^AEX",
  CO: "^OMXC25",
  PA: "^FCHI",
  MI: "FTSEMIB.MI",
  L: "^FTSE",
  SW: "^SSMI",
  MC: "^IBEX",
  ST: "^OMX",
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  // keep rate-limited background requests alive after the response (fills the cache)
  after(drainPending);
  const { ticker: raw } = await params;
  const ticker = decodeURIComponent(raw).toUpperCase().trim();
  if (!/^[A-Z0-9.^=-]{1,15}$/.test(ticker))
    return jsonError(new Error("Ungültiges Tickersymbol"), 400);

  let entry: UniverseEntry | undefined = findEntry(ticker);
  const limited: string[] = [];
  if (!entry) {
    // Ad-hoc analysis of a ticker outside the universe.
    try {
      const { data } = await getHistory(ticker, "2y");
      const cur = data.quote.currency;
      const last50 = data.bars.slice(-51, -1);
      const adv = last50.reduce((a, b) => a + b.close * b.volume, 0) / Math.max(1, last50.length);
      if (data.quote.price < MIN_PRICE)
        return jsonError(
          new Error(
            `${ticker}: Kurs unter ${MIN_PRICE} ${cur} – Penny Stocks werden nicht analysiert`
          ),
          422
        );
      if (data.bars.length < MIN_BARS)
        return jsonError(
          new Error(
            `${ticker}: erst ${data.bars.length} Handelstage Kurshistorie – mindestens ${MIN_BARS} nötig für eine Analyse`
          ),
          422
        );
      if (adv < MIN_TURNOVER)
        return jsonError(
          new Error(
            `${ticker}: extrem geringe Liquidität (Ø Handelswert ${(adv / 1e6).toFixed(2)} Mio. ${cur}/Tag) – Signale wären nicht aussagekräftig`
          ),
          422
        );
      if (adv < LIQUID_TURNOVER) {
        limited.push(
          `Geringe Liquidität: Ø Handelswert nur ${(adv / 1e6).toFixed(2)} Mio. ${cur}/Tag (Standard für volle Analyse: ${LIQUID_TURNOVER / 1e6} Mio.). Volumen-Signale sind leichter verfälschbar, Kauf-/Verkaufsspanne (Spread) kann groß sein.`
        );
      }
      if (data.bars.length < FULL_HISTORY_BARS) {
        limited.push(
          `Kurze Börsenhistorie: erst ${data.bars.length} Handelstage. SMA200, 52-Wochen-Werte und Backtest sind nicht oder nur eingeschränkt verfügbar.`
        );
      }
      const suffix = ticker.includes(".") ? (ticker.split(".").pop() as string) : "";
      const us = suffix === "";
      const benchmark = us ? "SPY" : (BENCHMARKS[suffix] ?? "^STOXX50E");
      entry = {
        ticker,
        isin: null,
        name: data.quote.name,
        yahoo: ticker,
        finnhub: us ? ticker : null,
        sector: "Unbekannt",
        region: "US",
        benchmark,
        // without a known sector, the broad market (S&P 500 / Euro Stoxx 50) is used
        sectorEtf: us ? "SPY" : "^STOXX50E",
      };
      if (!us) {
        limited.push(
          "Nicht-US-Titel außerhalb des Universums: Fundamentaldaten und Analystenrevisionen sind im kostenlosen Finnhub-Plan nicht verfügbar."
        );
      }
    } catch (err) {
      return jsonError(err, 404);
    }
  }
  try {
    const detail = await stockDetail(entry);
    if (limited.length) {
      detail.analysis.limited = limited;
      detail.analysis.warnings = [...limited, ...detail.analysis.warnings];
    }
    return jsonOk(detail, 30);
  } catch (err) {
    return jsonError(err);
  }
}
