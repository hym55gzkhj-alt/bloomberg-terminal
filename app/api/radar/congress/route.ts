import { congressTrades } from "@/lib/radar/congress";
import { jsonError, jsonOk } from "@/lib/radar/http-response";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const thisYear = new Date().getUTCFullYear();
  const year = Number(sp.get("year") ?? thisYear);
  if (!Number.isInteger(year) || year < 2008 || year > thisYear)
    return jsonError(new Error(`Ungültiges Jahr (2008–${thisYear})`), 400);
  const member = (sp.get("member") ?? "").slice(0, 80);
  try {
    return jsonOk(await congressTrades(year, member), 600);
  } catch (err) {
    return jsonError(err);
  }
}
