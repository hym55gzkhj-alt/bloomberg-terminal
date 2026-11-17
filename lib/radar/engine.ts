import { COMPONENT_LABELS } from "./config";
import { type IndicatorSeries, indexAtOrBefore, snapshotAt } from "./indicators";
import type {
  Bar,
  ComponentKey,
  ComponentResult,
  EarningsSurprise,
  ExtensionInfo,
  Fundamentals,
  NewsItem,
  RecommendationTrend,
  TechnicalSnapshot,
} from "./types";

/**
 * AI EARLY SIGNAL ENGINE – component scoring.
 *
 * Every component returns a score in [0, 1] where 0.5 is neutral, plus the concrete
 * facts that produced it. Components without real data return score = null and are
 * excluded (their weight is redistributed) – a missing value is never guessed.
 *
 * The engine deliberately rewards EARLY change (rising volume, fresh crossovers,
 * relative-strength highs before price highs, volatility squeezes, estimate/rating
 * revisions) and penalises stocks that are already extended (see `extensionOf`).
 */

/** Piecewise-linear interpolation, clamped. */
export function interp(x: number, xs: number[], ys: number[]): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return ys[i - 1] + t * (ys[i] - ys[i - 1]);
    }
  }
  return ys[ys.length - 1];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const fmt = (x: number, d = 1) => (x >= 0 ? "+" : "") + x.toFixed(d);
const dirOf = (score: number): -1 | 0 | 1 => (score >= 0.58 ? 1 : score <= 0.42 ? -1 : 0);

function result(
  key: ComponentKey,
  score: number | null,
  facts: string[],
  reason?: string
): ComponentResult {
  return {
    key,
    label: COMPONENT_LABELS[key],
    score: score == null ? null : Math.round(clamp01(score) * 1000) / 1000,
    direction: score == null ? 0 : dirOf(score),
    facts,
    unavailableReason: score == null ? reason : undefined,
  };
}

export interface SeriesCtx {
  bars: Bar[];
  series: IndicatorSeries;
}

// ---------------------------------------------------------------- volume
export function volumeComponent(
  ctx: SeriesCtx,
  i: number,
  snap: TechnicalSnapshot,
  volumeOverride?: number
): ComponentResult {
  const { bars } = ctx;
  if (i < 70) return result("volume", null, [], "zu wenig Historie");
  const vols = bars.map((b) => b.volume);
  if (vols.slice(i - 60, i + 1).every((v) => v === 0)) {
    return result("volume", null, [], "Anbieter liefert kein Volumen");
  }
  const v = (k: number) => (k === i && volumeOverride != null ? volumeOverride : vols[k]);
  let recent = 0;
  for (let k = i - 4; k <= i; k++) recent += v(k);
  recent /= 5;
  let base = 0;
  for (let k = i - 55; k < i - 4; k++) base += vols[k];
  base /= 51;
  const ratio5 = base > 0 ? recent / base : 1;

  // accumulation / distribution days (proxy for institutional activity)
  let acc = 0;
  let dist = 0;
  let upVol = 0;
  let downVol = 0;
  for (let k = i - 19; k <= i; k++) {
    let avg = 0;
    for (let j = k - 50; j < k; j++) avg += vols[j];
    avg /= 50;
    const d = bars[k].close - bars[k - 1].close;
    const vk = v(k);
    if (d > 0) upVol += vk;
    else if (d < 0) downVol += vk;
    if (vk > avg * 1.25 && d / bars[k - 1].close > 0.002) acc++;
    if (vk > avg * 1.25 && d / bars[k - 1].close < -0.002) dist++;
  }
  const udr = downVol > 0 ? upVol / downVol : 2;
  const ret5 = snap.ret5 ?? 0;

  // intensity of the volume anomaly (0..1)
  const intensity = interp(ratio5, [0.85, 1.05, 1.4, 2.2], [0, 0.15, 0.65, 1]);
  const priceSign = Math.max(-1, Math.min(1, ret5 / Math.max(1, (snap.atrPct ?? 2) * 1.5)));
  const anomaly = 0.5 + 0.5 * intensity * priceSign;
  const udrScore = interp(udr, [0.6, 1, 1.8], [0, 0.5, 1]);
  const adScore = interp(acc - dist, [-4, 0, 4], [0, 0.5, 1]);
  const obvScore =
    snap.obvSlope20 != null ? interp(snap.obvSlope20, [-0.15, 0, 0.15], [0, 0.5, 1]) : 0.5;
  const score = 0.4 * anomaly + 0.2 * udrScore + 0.25 * adScore + 0.15 * obvScore;

  const facts: string[] = [];
  const ctxText =
    intensity < 0.15
      ? "unauffällig"
      : priceSign > 0.2
        ? "bei steigenden Kursen (Kaufdruck)"
        : priceSign < -0.2
          ? "bei fallenden Kursen (Verkaufsdruck)"
          : "ohne klare Kursrichtung";
  const accFact = `${acc} Akkumulations- vs. ${dist} Distributionstage (20 T, Proxy für institutionelle Aktivität)`;
  if (Math.abs(acc - dist) >= 2) facts.push(accFact);
  facts.push(`Ø-Volumen 5 Tage = ${ratio5.toFixed(2)}× des 50-Tage-Durchschnitts, ${ctxText}`);
  if (snap.volRatio50 != null)
    facts.push(
      `heutiges Volumen ${snap.volRatio50.toFixed(2)}× Ø50${volumeOverride != null ? " (hochgerechnet, Sitzung läuft)" : ""}`
    );
  if (Math.abs(acc - dist) < 2) facts.push(accFact);
  facts.push(`Aufwärts-/Abwärtsvolumen ${udr.toFixed(2)}`);
  return result("volume", score, facts);
}

// ---------------------------------------------------------------- relative strength
export function relativeStrengthComponent(
  ctx: SeriesCtx,
  i: number,
  bench: SeriesCtx | null,
  benchName: string
): ComponentResult {
  if (!bench) return result("relativeStrength", null, [], "Benchmark-Daten nicht verfügbar");
  const { bars } = ctx;
  const bi = indexAtOrBefore(bench.bars, bars[i].date);
  if (i < 70 || bi < 70) return result("relativeStrength", null, [], "zu wenig Historie");
  // Align by date: ratio line over the last 80 stock bars
  const ratio: number[] = [];
  for (let k = i - 79; k <= i; k++) {
    const bk = indexAtOrBefore(bench.bars, bars[k].date);
    if (bk < 0) continue;
    ratio.push(bars[k].close / bench.bars[bk].close);
  }
  if (ratio.length < 60)
    return result("relativeStrength", null, [], "Benchmark-Historie unvollständig");
  const r = (n: number) => (ratio[ratio.length - 1] / ratio[ratio.length - 1 - n] - 1) * 100;
  const rs20 = r(20);
  const rs60 = r(59);
  const last = ratio[ratio.length - 1];
  const max60 = Math.max(...ratio.slice(-60, -1));
  const rsNewHigh = last >= max60;
  const priceMax60 = Math.max(...bars.slice(i - 59, i).map((b) => b.close));
  const priceNewHigh = bars[i].close >= priceMax60;
  // RS line making new highs BEFORE price does = classic early leadership signal
  const leadSignal = rsNewHigh && !priceNewHigh;

  const s20 = interp(rs20, [-8, 0, 8], [0, 0.5, 1]);
  const s60 = interp(rs60, [-15, 0, 15], [0, 0.5, 1]);
  const sHigh = rsNewHigh ? 1 : interp((last / max60 - 1) * 100, [-10, -3, 0], [0.1, 0.5, 0.8]);
  const score = 0.4 * s20 + 0.3 * s60 + 0.3 * sHigh;
  const facts = [
    `20 T ${fmt(rs20)} %-Pkt. vs. ${benchName}`,
    `60 T ${fmt(rs60)} %-Pkt. vs. ${benchName}`,
  ];
  if (leadSignal)
    facts.push(
      "Relative-Stärke-Linie auf 60-Tage-Hoch, bevor der Kurs selbst ein Hoch markiert (Frühindikator)"
    );
  else if (rsNewHigh) facts.push("Relative-Stärke-Linie auf 60-Tage-Hoch");
  return result("relativeStrength", score, facts);
}

// ---------------------------------------------------------------- momentum / technicals
export function momentumComponent(
  ctx: SeriesCtx,
  i: number,
  snap: TechnicalSnapshot
): ComponentResult {
  const { bars, series } = ctx;
  if (i < 60 || snap.sma50 == null || snap.rsi14 == null || snap.macdHist == null) {
    return result("momentum", null, [], "zu wenig Historie");
  }
  const facts: string[] = [];
  let pts = 0;
  const c = snap.close;

  // 1) trend structure (max 0.25)
  let trend = 0;
  if (c > snap.sma50) trend += 0.1;
  if (snap.sma200 != null && c > snap.sma200) trend += 0.08;
  if (snap.sma200 != null && snap.sma50 > snap.sma200) trend += 0.07;
  pts += trend;
  facts.push(
    `Kurs ${c > snap.sma50 ? "über" : "unter"} SMA50${snap.sma200 != null ? `, ${c > snap.sma200 ? "über" : "unter"} SMA200` : ""}`
  );

  // 2) SMA50 slope (max 0.1)
  const s50prev = series.sma50[i - 10];
  if (s50prev != null) {
    const slope = (snap.sma50 / s50prev - 1) * 100;
    pts += interp(slope, [-3, 0, 3], [0, 0.05, 0.1]);
  }

  // 3) MACD (max 0.2): positive & rising histogram; fresh bullish crossover = early
  const h = series.macd.hist;
  let freshCross = false;
  for (let k = i - 4; k <= i; k++) {
    if (h[k] != null && h[k - 1] != null && (h[k] as number) > 0 && (h[k - 1] as number) <= 0)
      freshCross = true;
  }
  const rising = h[i - 3] != null && snap.macdHist > (h[i - 3] as number);
  if (snap.macdHist > 0) pts += 0.08;
  if (rising) pts += 0.06;
  if (freshCross) {
    pts += 0.06;
    facts.push("frisches bullisches MACD-Crossover (≤ 5 Tage)");
  } else
    facts.push(
      `MACD-Histogramm ${snap.macdHist > 0 ? "positiv" : "negativ"}${rising ? " und steigend" : ""}`
    );

  // 4) RSI zone (max 0.15). Healthy 52-68 best; overbought handled by extension penalty
  pts += interp(snap.rsi14, [30, 45, 55, 65, 75, 85], [0, 0.04, 0.13, 0.15, 0.08, 0.03]);
  facts.push(`RSI14 ${snap.rsi14.toFixed(0)}`);

  // 5) Breakout (max 0.2): close above prior 55-day closing high, fresh (≤ 3 days)
  const prior55 = Math.max(...bars.slice(i - 55, i).map((b) => b.close));
  const prior20 = Math.max(...bars.slice(i - 20, i).map((b) => b.close));
  let breakoutAge = -1;
  for (let k = i; k >= i - 3; k--) {
    const ph = Math.max(...bars.slice(k - 55, k).map((b) => b.close));
    if (bars[k].close > ph) breakoutAge = i - k;
  }
  if (c > prior55) {
    pts += 0.2;
    facts.push("Ausbruch über das 55-Tage-Schlusshoch");
  } else if (breakoutAge >= 0) {
    pts += 0.14;
    facts.push(`Ausbruch über 55-Tage-Hoch vor ${breakoutAge} Tag(en)`);
  } else if (c > prior20) {
    pts += 0.1;
    facts.push("Schlusskurs über dem 20-Tage-Hoch");
  }

  // 6) Volatility squeeze resolving upwards (max 0.1) – typical precursor of trend moves
  const bbPrev = series.bbWidth[i - 5];
  if (snap.bbWidthPctile != null && bbPrev != null) {
    let minPct = 1;
    for (let k = i - 10; k <= i; k++) {
      const hist: number[] = [];
      for (let j = Math.max(0, k - 125); j <= k; j++)
        if (series.bbWidth[j] != null) hist.push(series.bbWidth[j] as number);
      const w = series.bbWidth[k];
      if (w != null && hist.length >= 60)
        minPct = Math.min(minPct, hist.filter((x) => x <= w).length / hist.length);
    }
    if (minPct <= 0.2 && snap.sma20 != null && c > snap.sma20) {
      pts += 0.1;
      facts.push(
        "Volatilitäts-Squeeze (Bollinger-Bandbreite im unteren 20 %-Perzentil) löst sich nach oben auf"
      );
    }
  }

  // Negative signals
  if (snap.sma200 != null && c < snap.sma200 && snap.sma50 < snap.sma200)
    facts.push("Abwärtstrend (SMA50 < SMA200)");
  return result("momentum", pts, facts);
}

// ---------------------------------------------------------------- market & sector
export function marketSectorComponent(
  date: string,
  bench: SeriesCtx | null,
  benchName: string,
  sector: SeriesCtx | null,
  sectorName: string,
  market: SeriesCtx | null
): ComponentResult {
  if (!bench && !sector)
    return result("marketSector", null, [], "Markt-/Sektordaten nicht verfügbar");
  const facts: string[] = [];
  let acc = 0;
  let n = 0;
  const trendScore = (ctx: SeriesCtx, name: string) => {
    const k = indexAtOrBefore(ctx.bars, date);
    if (k < 60) return null;
    const snap = snapshotAt(ctx.bars, ctx.series, k);
    let s = 0.5;
    if (snap.sma50 != null) s += snap.close > snap.sma50 ? 0.15 : -0.15;
    if (snap.sma200 != null) s += snap.close > snap.sma200 ? 0.1 : -0.1;
    if (snap.ret20 != null) s += interp(snap.ret20, [-6, 0, 6], [-0.25, 0, 0.25]);
    facts.push(
      `${name}: 20 T ${snap.ret20 != null ? fmt(snap.ret20) : "–"} %, ${snap.sma50 != null && snap.close > snap.sma50 ? "über" : "unter"} SMA50`
    );
    return { s: clamp01(s), ret20: snap.ret20 };
  };
  const b = bench ? trendScore(bench, benchName) : null;
  if (b) {
    acc += b.s * 0.5;
    n += 0.5;
  }
  const s = sector ? trendScore(sector, sectorName) : null;
  if (s) {
    let rel = 0.5;
    if (market && s.ret20 != null) {
      const mk = indexAtOrBefore(market.bars, date);
      if (mk >= 20) {
        const mret = (market.bars[mk].close / market.bars[mk - 20].close - 1) * 100;
        const d = s.ret20 - mret;
        rel = interp(d, [-5, 0, 5], [0, 0.5, 1]);
        facts.push(`Sektor ${fmt(d)} %-Pkt. vs. S&P 500 (20 T)`);
      }
    }
    acc += (0.6 * s.s + 0.4 * rel) * 0.5;
    n += 0.5;
  }
  if (n === 0) return result("marketSector", null, [], "zu wenig Historie");
  return result("marketSector", acc / n, facts);
}

// ---------------------------------------------------------------- news
export function newsComponent(
  news: NewsItem[] | null,
  asOf: number,
  reason?: string
): ComponentResult {
  if (news == null) return result("news", null, [], reason ?? "keine Nachrichtenquelle verfügbar");
  const recent = news.filter(
    (n) => n.publishedAt <= asOf && asOf - n.publishedAt <= 10 * 86400_000
  );
  if (recent.length === 0)
    return result("news", 0.5, ["keine Unternehmensnachrichten in den letzten 10 Tagen"]);
  let wSum = 0;
  let sSum = 0;
  for (const n of recent) {
    const ageDays = (asOf - n.publishedAt) / 86400_000;
    const w = 0.5 ** (ageDays / 3); // half-life 3 days
    wSum += w;
    sSum += w * n.sentiment;
  }
  const avg = wSum > 0 ? sSum / wSum : 0;
  const confidence = Math.min(1, recent.length / 6);
  const last3 = recent.filter((n) => asOf - n.publishedAt <= 3 * 86400_000).length;
  const prior = recent.length - last3;
  const flowRatio = last3 / 3 / Math.max(0.3, prior / 7);
  const pos = recent.filter((n) => n.sentiment > 0.15).length;
  const neg = recent.filter((n) => n.sentiment < -0.15).length;
  const score = 0.5 + 0.5 * Math.max(-1, Math.min(1, avg * 1.6)) * confidence;
  const facts = [
    `${recent.length} Meldungen (10 T): ${pos} positiv, ${neg} negativ, gewichtete Tonalität ${fmt(avg, 2)}`,
  ];
  if (flowRatio > 1.8 && last3 >= 3)
    facts.push(`Nachrichtenfluss beschleunigt (${last3} Meldungen in 3 Tagen)`);
  const top = [...recent].sort((a, b) => Math.abs(b.sentiment) - Math.abs(a.sentiment))[0];
  if (top && top.sentiment !== 0) facts.push(`„${top.headline.slice(0, 110)}“ (${top.source})`);
  return result("news", score, facts);
}

// ---------------------------------------------------------------- fundamentals
export function fundamentalsComponent(
  f: Fundamentals | null,
  earnings: EarningsSurprise[] | null,
  reason?: string
): ComponentResult {
  if (!f && !earnings?.length)
    return result("fundamentals", null, [], reason ?? "keine Fundamentaldaten");
  const facts: string[] = [];
  const parts: { s: number; w: number }[] = [];
  if (f) {
    const rq = f.revenueGrowthQuarterlyYoy;
    const rt = f.revenueGrowthTTMYoy;
    if (rq != null) {
      parts.push({ s: interp(rq, [-10, 0, 10, 30], [0, 0.35, 0.65, 1]), w: 0.3 });
      facts.push(`Umsatzwachstum letztes Quartal ${fmt(rq)} % ggü. Vorjahr`);
    }
    if (rq != null && rt != null) {
      const accel = rq - rt;
      parts.push({ s: interp(accel, [-10, 0, 10], [0, 0.5, 1]), w: 0.2 });
      if (Math.abs(accel) >= 2)
        facts.push(
          `Wachstum ${accel > 0 ? "beschleunigt" : "verlangsamt"} sich (${fmt(accel)} %-Pkt. vs. TTM)`
        );
    }
    const eq = f.epsGrowthQuarterlyYoy;
    if (eq != null) {
      parts.push({ s: interp(eq, [-25, 0, 15, 40], [0, 0.35, 0.65, 1]), w: 0.2 });
      facts.push(`EPS-Wachstum letztes Quartal ${fmt(eq)} %`);
    }
    if (f.operatingMarginTTM != null) {
      parts.push({ s: interp(f.operatingMarginTTM, [0, 15, 35], [0.2, 0.55, 0.8]), w: 0.1 });
    }
  }
  if (earnings?.length) {
    const last4 = earnings.slice(0, 4).filter((e) => e.surprisePercent != null);
    if (last4.length) {
      const beats = last4.filter((e) => (e.surprisePercent as number) > 0).length;
      const latest = last4[0].surprisePercent as number;
      parts.push({ s: interp(beats, [0, 2, 4], [0.1, 0.5, 0.9]), w: 0.1 });
      parts.push({ s: interp(latest, [-10, 0, 10], [0, 0.5, 1]), w: 0.1 });
      facts.push(
        `${beats}/${last4.length} Quartale über Konsens, letzte EPS-Überraschung ${fmt(latest)} % (${last4[0].period})`
      );
    }
  }
  if (!parts.length) return result("fundamentals", null, [], "Kennzahlen unvollständig");
  const w = parts.reduce((a, p) => a + p.w, 0);
  return result("fundamentals", parts.reduce((a, p) => a + p.s * p.w, 0) / w, facts);
}

// ---------------------------------------------------------------- analysts
function netBullish(r: RecommendationTrend): { net: number; total: number } {
  const total = r.strongBuy + r.buy + r.hold + r.sell + r.strongSell;
  if (total === 0) return { net: 0, total: 0 };
  return { net: (2 * r.strongBuy + r.buy - r.sell - 2 * r.strongSell) / (2 * total), total };
}

export function analystsComponent(
  recs: RecommendationTrend[] | null,
  reason?: string
): ComponentResult {
  if (!recs || recs.length === 0)
    return result("analysts", null, [], reason ?? "keine Analystendaten");
  const cur = netBullish(recs[0]);
  if (cur.total === 0) return result("analysts", null, [], "keine Analystenabdeckung");
  const prev = recs[Math.min(3, recs.length - 1)];
  const p = netBullish(prev);
  const change = cur.net - p.net;
  const level = interp(cur.net, [-0.2, 0.2, 0.6, 0.85], [0, 0.4, 0.7, 0.9]);
  const revision = interp(change, [-0.1, 0, 0.1], [0, 0.5, 1]);
  const totalChange = cur.total - p.total;
  // revisions matter more for EARLY detection than the absolute level
  const score = 0.35 * level + 0.65 * revision;
  const facts = [
    `${recs[0].strongBuy + recs[0].buy} Kauf / ${recs[0].hold} Halten / ${recs[0].sell + recs[0].strongSell} Verkauf (${recs[0].period.slice(0, 7)})`,
    `Netto-Bullish-Quote ${fmt(change * 100)} %-Pkt. ggü. ${prev.period.slice(0, 7)}${totalChange ? `, Abdeckung ${totalChange > 0 ? "+" : ""}${totalChange} Analysten` : ""}`,
  ];
  return result("analysts", score, facts);
}

// ---------------------------------------------------------------- extension penalty
/**
 * Measures how far a stock has ALREADY run. A heavily extended stock is not an early
 * signal, so the combined score is reduced by level × maxPenalty.
 */
export function extensionOf(snap: TechnicalSnapshot): ExtensionInfo {
  const notes: string[] = [];
  const atrPct = snap.atrPct ?? 2;
  const lv: number[] = [];
  if (snap.distFromSma50 != null) {
    const atrs = snap.distFromSma50 / atrPct;
    const l = interp(atrs, [3, 5, 8], [0, 0.5, 1]);
    lv.push(l);
    if (l > 0.2)
      notes.push(
        `Überdehnt: ${snap.distFromSma50.toFixed(1)} % (${atrs.toFixed(1)} ATR) über SMA50`
      );
  }
  if (snap.rsi14 != null) {
    const l = interp(snap.rsi14, [70, 77, 85], [0, 0.5, 1]);
    lv.push(l);
    if (l > 0.2) notes.push(`Überkauft: RSI14 ${snap.rsi14.toFixed(0)}`);
  }
  if (snap.ret60 != null) {
    const l = interp(snap.ret60 / Math.max(1, atrPct), [10, 16, 25], [0, 0.5, 1]);
    lv.push(l);
    if (l > 0.2) notes.push(`Bereits gelaufen: ${fmt(snap.ret60)} % in 60 Tagen`);
  }
  const level = lv.length
    ? Math.max(...lv) * 0.7 + (lv.reduce((a, b) => a + b, 0) / lv.length) * 0.3
    : 0;
  return { level: Math.round(level * 1000) / 1000, penalty: 0, notes };
}
