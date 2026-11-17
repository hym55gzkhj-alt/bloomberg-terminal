import { runBacktest } from "@/lib/radar/backtest";
import { jsonError, jsonOk } from "@/lib/radar/http-response";
import type { BacktestParams } from "@/lib/radar/types";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const params: Partial<BacktestParams> = {};
  if (sp.get("direction")) params.direction = sp.get("direction") as BacktestParams["direction"];
  const mc = sp.get("minCategory");
  if (mc) params.minCategory = mc as BacktestParams["minCategory"];
  if (sp.get("costBps")) params.costBps = Number(sp.get("costBps"));
  if (sp.get("entryDelayDays")) params.entryDelayDays = Number(sp.get("entryDelayDays"));
  if (sp.get("cooldownDays")) params.cooldownDays = Number(sp.get("cooldownDays"));
  if (sp.get("years")) params.years = Number(sp.get("years"));
  if (sp.get("tickers")) params.tickers = (sp.get("tickers") as string).split(",").filter(Boolean);
  try {
    return jsonOk(await runBacktest(params), 300);
  } catch (err) {
    return jsonError(err);
  }
}
