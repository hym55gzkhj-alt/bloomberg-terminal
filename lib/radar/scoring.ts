import { CATEGORY_LABELS, COMPONENT_LABELS, DEFAULT_CONFIG, type EngineConfig } from "./config";
import type { ComponentResult, ExtensionInfo, Factor, SignalCategory, Weights } from "./types";

/**
 * Pure combination step of the AI Early Signal Engine. It runs on the server for the
 * scan and on the client when the user changes weights – so a custom weighting is
 * always applied to exactly the same real component data.
 *
 * NOTE: the score is an analytical indicator (0-100), NOT a probability of a price rise.
 */

export interface Combined {
  score: number;
  coverage: number;
  category: SignalCategory;
  positives: number;
  negatives: number;
}

export function combine(
  components: ComponentResult[],
  weights: Weights,
  extension: ExtensionInfo,
  config: EngineConfig = DEFAULT_CONFIG
): Combined {
  let wSum = 0;
  let wAvail = 0;
  let acc = 0;
  let positives = 0;
  let negatives = 0;
  for (const c of components) {
    const w = weights[c.key] ?? 0;
    wSum += w;
    if (c.score == null || w <= 0) continue;
    wAvail += w;
    acc += c.score * w;
    if (c.direction === 1) positives++;
    if (c.direction === -1) negatives++;
  }
  const raw = wAvail > 0 ? (acc / wAvail) * 100 : 50;
  const penalty = extension.level * config.maxExtensionPenalty;
  const score = Math.max(0, Math.min(100, raw - penalty));
  const coverage = wSum > 0 ? wAvail / wSum : 0;

  const t = config.thresholds;
  const mp = config.minPositive;
  let category: SignalCategory = "NEUTRAL";
  if (wAvail === 0) category = "NEUTRAL";
  else if (score < t.negative || (negatives >= 3 && negatives > positives + 1 && score < 50))
    category = "NEGATIVE";
  else if (score >= t.strong && positives >= mp.strong) category = "STRONG_MOMENTUM";
  else if (score >= t.building && positives >= mp.building) category = "BUILDING_MOMENTUM";
  else if (score >= t.early && positives >= mp.early) category = "EARLY_SIGNAL";

  return { score: Math.round(score * 10) / 10, coverage, category, positives, negatives };
}

export function buildFactors(components: ComponentResult[], extension: ExtensionInfo): Factor[] {
  const out: Factor[] = [];
  for (const c of components) {
    if (c.score == null) continue;
    if (c.direction !== 0) {
      for (const f of c.facts) {
        out.push({
          text: `${COMPONENT_LABELS[c.key]}: ${f}`,
          component: c.key,
          impact: c.direction === 1 ? "positive" : "negative",
        });
      }
    }
  }
  for (const n of extension.notes)
    out.push({ text: n, component: "extension", impact: "negative" });
  return out;
}

export function explain(
  components: ComponentResult[],
  combined: Combined,
  extension: ExtensionInfo,
  weights: Weights
): string {
  const avail = components.filter((c) => c.score != null && (weights[c.key] ?? 0) > 0);
  const pos = avail
    .filter((c) => c.direction === 1)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const neg = avail
    .filter((c) => c.direction === -1)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  const parts: string[] = [];
  parts.push(
    `Einstufung ${CATEGORY_LABELS[combined.category]} mit Score ${combined.score.toFixed(0)}/100 ` +
      `(${combined.positives} positive, ${combined.negatives} negative von ${avail.length} bewerteten Komponenten; ` +
      `Datenabdeckung ${(combined.coverage * 100).toFixed(0)} % der Gewichtung).`
  );
  if (pos.length) {
    parts.push(
      `Treiber: ${pos
        .slice(0, 3)
        .map((c) => `${COMPONENT_LABELS[c.key]} (${c.facts[0] ?? ""})`)
        .join("; ")}.`
    );
  }
  if (neg.length) {
    parts.push(
      `Belastend: ${neg
        .slice(0, 3)
        .map((c) => `${COMPONENT_LABELS[c.key]} (${c.facts[0] ?? ""})`)
        .join("; ")}.`
    );
  }
  if (extension.penalty > 0.5) {
    parts.push(
      `Abzug von ${extension.penalty.toFixed(1)} Punkten, weil der Kurs bereits deutlich gestiegen ist – ein spätes Signal ist kein Frühsignal.`
    );
  }
  const missing = components.filter((c) => c.score == null);
  if (missing.length) {
    parts.push(
      `Nicht bewertet (fehlende Daten, Gewicht umverteilt): ${missing.map((c) => COMPONENT_LABELS[c.key]).join(", ")}.`
    );
  }
  parts.push(
    "Der Score ist ein analytischer Indikator, keine Wahrscheinlichkeit eines Kursanstiegs."
  );
  return parts.join(" ");
}
