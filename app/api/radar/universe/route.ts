import { DEFAULT_CONFIG, serverWeights } from "@/lib/radar/config";
import { jsonOk } from "@/lib/radar/http-response";
import { getUniverse } from "@/lib/radar/universe";

export const dynamic = "force-dynamic";

export async function GET() {
  return jsonOk({ universe: getUniverse(), weights: serverWeights(), config: DEFAULT_CONFIG });
}
