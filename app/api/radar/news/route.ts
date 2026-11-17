import { jsonError, jsonOk } from "@/lib/radar/http-response";
import { newsFeed } from "@/lib/radar/scan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  try {
    return jsonOk(await newsFeed(), 60);
  } catch (err) {
    return jsonError(err);
  }
}
