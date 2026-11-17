import { COMPONENT_LABELS } from "./config";
import type {
  ComponentResult,
  ExtensionInfo,
  SignalCategory,
  TechnicalSnapshot,
  TradeSetup,
} from "./types";

/**
 * Regelbasierte Trade-Einschätzung (Long / Short / kein Trade).
 *
 * Dieselbe Funktion wird live (Detailanalyse, Tabellen) und im Backtest verwendet, damit
 * die angezeigte Einschätzung exakt den historisch getesteten Regeln entspricht.
 * Es handelt sich um eine analytische Einordnung, NICHT um eine Anlageempfehlung.
 */

export const TRADE_RULES = {
  /** Stop-Abstand in ATR14 */
  stopAtr: 2,
  /** Kursziel 1 in Vielfachen des Risikos (R) */
  target1R: 1.5,
  /** Kursziel 2 in Vielfachen des Risikos (R) */
  target2R: 3,
  /** maximale Haltedauer in Handelstagen (Backtest-Simulation) */
  maxDays: 20,
  /** Überdehnung, ab der kein neuer Long-Einstieg erfolgt */
  maxLongExtension: 0.6,
  /** RSI, unter dem kein neuer Short eröffnet wird (überverkauft) */
  minShortRsi: 30,
  /** Abstand unter SMA50 in ATR, ab dem ein Short als überdehnt gilt */
  maxShortAtrBelowSma50: 5,
};

export interface TradeInput {
  category: SignalCategory;
  score: number;
  coverage: number;
  technical: TechnicalSnapshot;
  extension: ExtensionInfo;
  components: ComponentResult[];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const POSITIVE: SignalCategory[] = ["EARLY_SIGNAL", "BUILDING_MOMENTUM", "STRONG_MOMENTUM"];

function convictionLabel(c: number): TradeSetup["convictionLabel"] {
  return c >= 70 ? "hoch" : c >= 40 ? "mittel" : "niedrig";
}

function levels(direction: 1 | -1, entry: number, atr: number) {
  const risk = TRADE_RULES.stopAtr * atr;
  return {
    stop: entry - direction * risk,
    target1: entry + direction * risk * TRADE_RULES.target1R,
    target2: entry + direction * risk * TRADE_RULES.target2R,
    riskPct: (risk / entry) * 100,
  };
}

function compFacts(components: ComponentResult[], dir: 1 | -1): string[] {
  // strongest components first, so the main reason is the most pronounced signal
  return components
    .filter((c) => c.score != null && c.direction === dir)
    .sort((a, b) => Math.abs((b.score ?? 0.5) - 0.5) - Math.abs((a.score ?? 0.5) - 0.5))
    .map((c) => `${COMPONENT_LABELS[c.key]}: ${c.facts[0] ?? ""}`);
}

export function tradeSetup(input: TradeInput): TradeSetup {
  const { category, score, coverage, technical: t, extension, components } = input;
  const atr = t.atr14;
  const price = t.close;
  const base: TradeSetup = {
    bias: "NEUTRAL",
    action: "Kein Trade",
    conviction: 0,
    convictionLabel: "niedrig",
    entry: null,
    entryNote: "",
    stop: null,
    target1: null,
    target2: null,
    riskPct: null,
    rewardRisk: TRADE_RULES.target2R,
    horizon: `bis ${TRADE_RULES.maxDays} Handelstage`,
    reasons: [],
    risks: [],
    invalidation: "",
  };
  if (atr == null || t.sma50 == null || t.rsi14 == null) {
    return { ...base, entryNote: "Zu wenig Kurshistorie für eine Einschätzung." };
  }

  const momentum = components.find((c) => c.key === "momentum");
  const rs = components.find((c) => c.key === "relativeStrength");
  const coverageFactor = 0.6 + 0.4 * coverage;
  const coverageRisk =
    coverage < 0.8
      ? [
          `Nur ${(coverage * 100).toFixed(0)} % der Score-Gewichtung mit Daten belegt – Einschätzung weniger belastbar.`,
        ]
      : [];

  // ------------------------------------------------------------------ LONG
  if (POSITIVE.includes(category)) {
    const reasons = compFacts(components, 1);
    const risks = [...compFacts(components, -1), ...coverageRisk];
    const conviction = Math.round(clamp01((score - 50) / 35) * 100 * coverageFactor);
    if (extension.level >= TRADE_RULES.maxLongExtension) {
      const pullback = t.sma20 ?? t.sma50;
      return {
        ...base,
        bias: "NEUTRAL",
        action: "Long-Setup, aber überdehnt – Rücksetzer abwarten",
        conviction,
        convictionLabel: convictionLabel(conviction),
        entry: pullback,
        entryNote: `Positives Signal, aber der Kurs ist bereits stark gelaufen. Ein Einstieg wäre erst bei einem Rücksetzer Richtung SMA20 (≈ ${pullback.toFixed(2)}) regelkonform.`,
        reasons,
        risks: [...extension.notes, ...risks],
        invalidation: `Signal entfällt, wenn die Einstufung unter EARLY SIGNAL fällt oder der Kurs unter die SMA50 (${t.sma50.toFixed(2)}) schließt.`,
      };
    }
    const lv = levels(1, price, atr);
    if (t.high52w != null && t.high52w > price * 1.005 && t.high52w < lv.target2) {
      risks.push(
        `52-Wochen-Hoch bei ${t.high52w.toFixed(2)} liegt vor Kursziel 2 – möglicher Widerstand.`
      );
    }
    if (extension.notes.length) risks.push(...extension.notes);
    return {
      ...base,
      bias: "LONG",
      action: "Long-Einstieg möglich",
      conviction,
      convictionLabel: convictionLabel(conviction),
      entry: price,
      entryNote:
        "Einstieg regelbasiert zum nächsten Eröffnungskurs (Signal wird auf Tagesbasis bewertet).",
      ...lv,
      reasons,
      risks,
      invalidation: `Schlusskurs unter ${lv.stop.toFixed(2)} (Stop, ${TRADE_RULES.stopAtr}× ATR) oder Rückstufung auf NEUTRAL/NEGATIVE.`,
    };
  }

  // ------------------------------------------------------------------ SHORT
  const downtrend = price < t.sma50 && (t.sma200 == null || price < t.sma200 || t.sma50 < t.sma200);
  const weakTechnicals = momentum?.direction === -1 || rs?.direction === -1;
  if (category === "NEGATIVE" && downtrend && weakTechnicals) {
    const reasons = compFacts(components, -1);
    const risks = [...compFacts(components, 1), ...coverageRisk];
    const conviction = Math.round(clamp01((50 - score) / 35) * 100 * coverageFactor);
    const atrBelow = t.distFromSma50 != null && t.atrPct ? -t.distFromSma50 / t.atrPct : 0;
    if (t.rsi14 < TRADE_RULES.minShortRsi || atrBelow > TRADE_RULES.maxShortAtrBelowSma50) {
      const pullback = t.sma20 ?? t.sma50;
      return {
        ...base,
        bias: "NEUTRAL",
        action: "Short-Setup, aber überverkauft – Erholung abwarten",
        conviction,
        convictionLabel: convictionLabel(conviction),
        entry: pullback,
        entryNote: `Der Abwärtstrend ist intakt, aber der Kurs ist bereits stark gefallen (RSI ${t.rsi14.toFixed(0)}, ${atrBelow.toFixed(1)} ATR unter SMA50). Gegenbewegungen sind dann häufig – ein Short wäre erst bei einer Erholung Richtung SMA20 (≈ ${pullback.toFixed(2)}) regelkonform.`,
        reasons,
        risks,
        invalidation: `Setup entfällt, wenn der Kurs über die SMA50 (${t.sma50.toFixed(2)}) steigt.`,
      };
    }
    const lv = levels(-1, price, atr);
    if (t.low52w != null && t.low52w < price * 0.995 && t.low52w > lv.target2) {
      risks.push(
        `52-Wochen-Tief bei ${t.low52w.toFixed(2)} liegt vor Kursziel 2 – mögliche Unterstützung.`
      );
    }
    risks.push(
      "Short-Positionen haben theoretisch unbegrenztes Verlustrisiko (Kurslücken über den Stop möglich)."
    );
    return {
      ...base,
      bias: "SHORT",
      action: "Short-Einstieg möglich",
      conviction,
      convictionLabel: convictionLabel(conviction),
      entry: price,
      entryNote:
        "Einstieg regelbasiert zum nächsten Eröffnungskurs (Signal wird auf Tagesbasis bewertet).",
      ...lv,
      reasons,
      risks,
      invalidation: `Schlusskurs über ${lv.stop.toFixed(2)} (Stop, ${TRADE_RULES.stopAtr}× ATR) oder Hochstufung aus NEGATIVE.`,
    };
  }

  // ------------------------------------------------------------------ NEUTRAL
  const why =
    category === "NEGATIVE"
      ? "Überwiegend negative Signale, aber kein bestätigter Abwärtstrend (Kurs nicht klar unter SMA50/SMA200 bzw. Technik nicht schwach) – kein Short-Setup."
      : "Keine eindeutige Richtung: weder genug positive Signale für Long noch ein bestätigter Abwärtstrend für Short.";
  return {
    ...base,
    entryNote: why,
    reasons: [...compFacts(components, 1), ...compFacts(components, -1)].slice(0, 4),
    risks: coverageRisk,
    invalidation: "Neubewertung bei jedem Scan.",
  };
}
