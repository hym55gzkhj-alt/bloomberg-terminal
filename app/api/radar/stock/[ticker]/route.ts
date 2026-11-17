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

const MIN_AVG_DOLLAR_VOLUME = 20_000_000; // liquidity guard for ad-hoc tickers
const MIN_PRICE = 5; // no penny stocks

export async function GET(_req: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  // keep rate-limited background requests alive after the response (fills the cache)
  after(drainPending);
  const { ticker: raw } = await params;
  const ticker = decodeURIComponent(raw).toUpperCase().trim();
  if (!/^[A-Z0-9.^=-]{1,15}$/.test(ticker))
    return jsonError(new Error("Ungültiges Tickersymbol"), 400);

  let entry: UniverseEntry | undefined = findEntry(ticker);
  if (!entry) {
    // Ad-hoc analysis of a ticker outside the universe – only liquid, established equities.
    try {
      const { data } = await getHistory(ticker, "2y");
      const last50 = data.bars.slice(-51, -1);
      const adv = last50.reduce((a, b) => a + b.close * b.volume, 0) / Math.max(1, last50.length);
      if (data.quote.price < MIN_PRICE)
        return jsonError(
          new Error(`${ticker}: Kurs unter ${MIN_PRICE} – Penny Stocks werden nicht analysiert`),
          422
        );
      if (adv < MIN_AVG_DOLLAR_VOLUME)
        return jsonError(
          new Error(
            `${ticker}: zu geringe Liquidität (Ø Handelswert ${(adv / 1e6).toFixed(1)} Mio./Tag)`
          ),
          422
        );
      if (data.bars.length < 260)
        return jsonError(new Error(`${ticker}: weniger als ein Jahr Kurshistorie`), 422);
      const us = !ticker.includes(".");
      entry = {
        ticker,
        name: data.quote.name,
        yahoo: ticker,
        finnhub: us ? ticker : null,
        sector: "Unbekannt",
        region: "US",
        benchmark: us ? "SPY" : "^STOXX50E",
        sectorEtf: "SPY",
      };
    } catch (err) {
      return jsonError(err, 404);
    }
  }
  try {
    return jsonOk(await stockDetail(entry), 30);
  } catch (err) {
    return jsonError(err);
  }
}
