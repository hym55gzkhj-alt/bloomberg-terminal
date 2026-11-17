import type { SignalCategory } from "@/lib/radar/types";

export const fmtNum = (x: number | null | undefined, d = 2) =>
  x == null || !Number.isFinite(x)
    ? "–"
    : x.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });

export const fmtPct = (x: number | null | undefined, d = 2) =>
  x == null || !Number.isFinite(x) ? "–" : `${x > 0 ? "+" : ""}${fmtNum(x, d)} %`;

export const fmtVol = (x: number | null | undefined) => {
  if (x == null || !Number.isFinite(x)) return "–";
  if (x >= 1e9) return `${fmtNum(x / 1e9, 2)} Mrd`;
  if (x >= 1e6) return `${fmtNum(x / 1e6, 2)} Mio`;
  if (x >= 1e3) return `${fmtNum(x / 1e3, 1)} Tsd`;
  return fmtNum(x, 0);
};

export const fmtTime = (ms: number | null | undefined) =>
  ms
    ? new Date(ms).toLocaleString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "–";

export const fmtAge = (ms: number) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} T`;
};

export const signColor = (x: number | null | undefined) =>
  x == null
    ? "text-neutral-400"
    : x > 0
      ? "text-emerald-400"
      : x < 0
        ? "text-red-400"
        : "text-neutral-300";

export const CATEGORY_STYLE: Record<SignalCategory, string> = {
  STRONG_MOMENTUM: "bg-emerald-500 text-black",
  BUILDING_MOMENTUM: "bg-lime-400 text-black",
  EARLY_SIGNAL: "bg-amber-400 text-black",
  NEUTRAL: "bg-neutral-600 text-white",
  NEGATIVE: "bg-red-600 text-white",
};

export const scoreColor = (s: number) =>
  s >= 72
    ? "text-emerald-400"
    : s >= 63
      ? "text-lime-300"
      : s >= 55
        ? "text-amber-300"
        : s < 42
          ? "text-red-400"
          : "text-neutral-300";
