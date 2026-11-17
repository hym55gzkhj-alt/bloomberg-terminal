import { jsonError, jsonOk } from "@/lib/radar/http-response";
import { scanUniverse } from "@/lib/radar/scan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
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
