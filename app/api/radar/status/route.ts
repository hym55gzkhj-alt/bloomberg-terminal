import { jsonError, jsonOk } from "@/lib/radar/http-response";
import { providerStatus } from "@/lib/radar/scan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return jsonOk({ providers: await providerStatus() });
  } catch (err) {
    return jsonError(err);
  }
}
