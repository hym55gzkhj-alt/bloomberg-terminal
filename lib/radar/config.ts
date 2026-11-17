import type { ComponentKey, SignalCategory, Weights } from "./types";

/** Default weights (sum = 100). Configurable in the UI (Settings) and via RADAR_WEIGHTS env. */
export const DEFAULT_WEIGHTS: Weights = {
  volume: 20,
  relativeStrength: 15,
  momentum: 15,
  news: 15,
  fundamentals: 15,
  analysts: 10,
  marketSector: 10,
};

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  volume: "Handelsvolumen-Anomalie",
  relativeStrength: "Relative Kursstärke",
  momentum: "Technisches Momentum",
  news: "Unternehmensnachrichten",
  fundamentals: "Fundamentale Entwicklung",
  analysts: "Analystenrevisionen",
  marketSector: "Markt & Sektor",
};

export const COMPONENT_ORDER: ComponentKey[] = [
  "volume",
  "relativeStrength",
  "momentum",
  "news",
  "fundamentals",
  "analysts",
  "marketSector",
];

export interface EngineConfig {
  /** Minimum total score for each category */
  thresholds: { strong: number; building: number; early: number; negative: number };
  /** Minimum number of positive components required for each category */
  minPositive: { strong: number; building: number; early: number };
  /** Maximum points subtracted for an over-extended (already rallied) price */
  maxExtensionPenalty: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
  thresholds: { strong: 72, building: 63, early: 55, negative: 42 },
  minPositive: { strong: 4, building: 3, early: 2 },
  maxExtensionPenalty: 25,
};

export const CATEGORY_LABELS: Record<SignalCategory, string> = {
  STRONG_MOMENTUM: "STRONG MOMENTUM",
  BUILDING_MOMENTUM: "BUILDING MOMENTUM",
  EARLY_SIGNAL: "EARLY SIGNAL",
  NEUTRAL: "NEUTRAL",
  NEGATIVE: "NEGATIVE",
};

export const CATEGORY_RANK: Record<SignalCategory, number> = {
  STRONG_MOMENTUM: 4,
  BUILDING_MOMENTUM: 3,
  EARLY_SIGNAL: 2,
  NEUTRAL: 1,
  NEGATIVE: 0,
};

export function normalizeWeights(input: Partial<Weights> | undefined): Weights {
  const w: Weights = { ...DEFAULT_WEIGHTS };
  if (!input) return w;
  for (const k of COMPONENT_ORDER) {
    const v = input[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100) w[k] = v;
  }
  return w;
}

export function serverWeights(): Weights {
  const raw = process.env.RADAR_WEIGHTS;
  if (!raw) return DEFAULT_WEIGHTS;
  try {
    return normalizeWeights(JSON.parse(raw));
  } catch {
    return DEFAULT_WEIGHTS;
  }
}
