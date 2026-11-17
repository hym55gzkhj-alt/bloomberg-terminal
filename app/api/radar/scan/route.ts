import { drainPending } from "@/lib/radar/analyze";
import { jsonError, jsonOk } from "@/lib/radar/http-response";
import { scanUniverse } from "@/lib/radar/scan";

import { after } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  // keep rate-limited background requests alive after the response (fills the cache)
  after(drainPending);
  try {
    const scan = await scanUniverse();
    if (scan.results.length === 0) {
      return jsonError(
        new Error(
          `Keine Marktdaten verfügbar. ${scan.errors
            .map((e) => `${e.ticker}: ${e.message}`)
            .slice(0, 3)
            .join(" | ")}`
        ),
        503
      );
    }
    return jsonOk(scan, 30);
  } catch (err) {
    return jsonError(err);
  }
}
