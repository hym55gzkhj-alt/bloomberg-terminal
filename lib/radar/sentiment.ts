/**
 * Transparent, deterministic financial-news sentiment scoring.
 *
 * A curated lexicon of finance-specific phrases (inspired by the Loughran-McDonald
 * financial sentiment word lists, extended with market-news phrases such as
 * "raises guidance" or "price target cut"). Each match is reported back so the user can
 * see exactly WHY a headline counts as positive or negative. No black box, no made-up
 * scores – the input is always the real headline/summary text from the news provider.
 */

const POSITIVE: string[] = [
  "beats estimates",
  "beat estimates",
  "tops estimates",
  "topped estimates",
  "beats expectations",
  "above expectations",
  "better-than-expected",
  "better than expected",
  "record revenue",
  "record quarter",
  "record high",
  "all-time high",
  "raises guidance",
  "raised guidance",
  "raises outlook",
  "raised outlook",
  "lifts forecast",
  "boosts forecast",
  "raises forecast",
  "hikes forecast",
  "upgrade",
  "upgraded",
  "upgrades",
  "outperform",
  "overweight",
  "buy rating",
  "price target raised",
  "raises price target",
  "raised price target",
  "lifts price target",
  "boosts price target",
  "strong demand",
  "surge",
  "surges",
  "surged",
  "soar",
  "soars",
  "soared",
  "jump",
  "jumps",
  "jumped",
  "rally",
  "rallies",
  "rallied",
  "gains",
  "climbs",
  "rebound",
  "rebounds",
  "breakthrough",
  "partnership",
  "partners with",
  "collaboration",
  "contract win",
  "wins contract",
  "awarded",
  "approval",
  "approved",
  "fda approves",
  "clearance",
  "launches",
  "expands",
  "expansion",
  "buyback",
  "share repurchase",
  "dividend increase",
  "raises dividend",
  "profit rises",
  "profit jumps",
  "revenue growth",
  "accelerat",
  "bullish",
  "momentum",
  "strong results",
  "strong earnings",
  "robust",
  "exceeds",
  "exceeded",
  "outperforms",
  "milestone",
  "acquire",
  "acquisition of",
  "deal to buy",
  "optimistic",
  "upbeat",
  "tailwind",
  "market share gains",
  "best-selling",
  "beats",
  "tops",
];

const NEGATIVE: string[] = [
  "misses estimates",
  "missed estimates",
  "miss estimates",
  "below expectations",
  "worse-than-expected",
  "worse than expected",
  "cuts guidance",
  "cut guidance",
  "lowers guidance",
  "lowered guidance",
  "cuts outlook",
  "lowers outlook",
  "slashes forecast",
  "cuts forecast",
  "warns",
  "warning",
  "profit warning",
  "downgrade",
  "downgraded",
  "downgrades",
  "underperform",
  "underweight",
  "sell rating",
  "price target cut",
  "cuts price target",
  "lowers price target",
  "lowered price target",
  "weak demand",
  "plunge",
  "plunges",
  "plunged",
  "tumble",
  "tumbles",
  "tumbled",
  "slump",
  "slumps",
  "slumped",
  "sinks",
  "sank",
  "drops",
  "dropped",
  "falls",
  "fell",
  "slides",
  "slid",
  "selloff",
  "sell-off",
  "crash",
  "lawsuit",
  "sued",
  "sues",
  "probe",
  "investigation",
  "antitrust",
  "fine",
  "fined",
  "penalty",
  "recall",
  "recalls",
  "layoffs",
  "lay off",
  "job cuts",
  "cuts jobs",
  "restructuring",
  "bankruptcy",
  "default",
  "fraud",
  "delay",
  "delays",
  "delayed",
  "halt",
  "halts",
  "suspends",
  "ban",
  "banned",
  "tariff",
  "sanction",
  "export curbs",
  "export restrictions",
  "bearish",
  "headwind",
  "slowdown",
  "decline",
  "declines",
  "loss widens",
  "net loss",
  "shortfall",
  "concern",
  "concerns",
  "resigns",
  "steps down",
  "short seller",
  "overvalued",
  "bubble",
  "disappointing",
  "disappoints",
  "misses",
  "fails",
  "failed",
  "rejects",
  "rejected",
  "volatile",
];

const NEGATIONS = ["not ", "no ", "fails to ", "failed to ", "without "];

export interface SentimentResult {
  /** -1 (very negative) .. 1 (very positive) */
  score: number;
  hits: { positive: string[]; negative: string[] };
}

function findHits(text: string, lexicon: string[]): string[] {
  const hits: string[] = [];
  for (const term of lexicon) {
    // word-boundary aware match (prefix-match allowed for stems like "accelerat")
    const idx = text.indexOf(term);
    if (idx === -1) continue;
    const before = idx === 0 ? " " : text[idx - 1];
    if (/[a-z0-9]/.test(before)) continue;
    const preceding = text.slice(Math.max(0, idx - 12), idx);
    if (NEGATIONS.some((n) => preceding.endsWith(n))) continue;
    // avoid double counting a shorter term inside an already matched longer term
    if (hits.some((h) => h.includes(term))) continue;
    hits.push(term);
  }
  return hits;
}

export function scoreSentiment(text: string): SentimentResult {
  const t = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  const positive = findHits(t, POSITIVE);
  const negative = findHits(t, NEGATIVE);
  const p = positive.length;
  const n = negative.length;
  const score = p + n === 0 ? 0 : (p - n) / Math.max(2, p + n);
  return { score: Math.max(-1, Math.min(1, score)), hits: { positive, negative } };
}
