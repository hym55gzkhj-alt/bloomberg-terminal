import { jsonError, jsonOk } from "@/lib/radar/http-response";
import { searchSymbols } from "@/lib/radar/providers/yahoo";
import { getUniverse } from "@/lib/radar/universe";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return jsonOk({ hits: [] });
  try {
    const lower = q.toLowerCase();
    // universe matches first (they get the full analysis incl. ISIN)
    const own = getUniverse()
      .filter(
        (e) => e.ticker.toLowerCase().startsWith(lower) || e.name.toLowerCase().includes(lower)
      )
      .map((e) => ({
        symbol: e.ticker,
        name: e.name,
        exchange: "Radar-Universum",
        type: "EQUITY",
      }));
    let hits = await searchSymbols(q);
    // "Fitgroup" → also search "Fit group" (Yahoo's fuzzy search would otherwise return
    // unrelated names); exact-word matches are shown first
    const spaced = q.replace(/(?<=\w)(group|holding)$/i, " $1");
    if (spaced !== q) {
      const extra = await searchSymbols(spaced);
      const known = new Set(extra.map((h) => h.symbol));
      hits = [...extra, ...hits.filter((h) => !known.has(h.symbol))];
    }
    const seen = new Set(own.map((h) => h.symbol));
    return jsonOk({ hits: [...own, ...hits.filter((h) => !seen.has(h.symbol))].slice(0, 12) }, 300);
  } catch (err) {
    return jsonError(err);
  }
}
