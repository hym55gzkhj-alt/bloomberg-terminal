import { jsonError, jsonOk } from "@/lib/radar/http-response";
import { marketOverview } from "@/lib/radar/scan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return jsonOk(await marketOverview(), 30);
  } catch (err) {
    return jsonError(err);
  }
}
