import type { Bar, TechnicalSnapshot } from "./types";

/**
 * Causal technical indicators. Every series value at index i only uses data at
 * indices <= i, so the same series can be used for point-in-time backtesting
 * without look-ahead bias.
 */

type S = (number | null)[];

export function sma(values: number[], n: number): S {
  const out: S = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(values: number[], n: number): S {
  const out: S = new Array(values.length).fill(null);
  const k = 2 / (n + 1);
  let prev: number | null = null;
  let seed = 0;
  for (let i = 0; i < values.length; i++) {
    if (prev === null) {
      seed += values[i];
      if (i === n - 1) {
        prev = seed / n;
        out[i] = prev;
      }
    } else {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

export function rsi(closes: number[], n = 14): S {
  const out: S = new Array(closes.length).fill(null);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = Math.max(0, d);
    const loss = Math.max(0, -d);
    if (i <= n) {
      avgGain += gain / n;
      avgLoss += loss / n;
      if (i === n) out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    } else {
      avgGain = (avgGain * (n - 1) + gain) / n;
      avgLoss = (avgLoss * (n - 1) + loss) / n;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return out;
}

export function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const line: S = closes.map((_, i) =>
    ef[i] != null && es[i] != null ? (ef[i] as number) - (es[i] as number) : null
  );
  const firstIdx = line.findIndex((v) => v != null);
  const sig: S = new Array(closes.length).fill(null);
  if (firstIdx >= 0) {
    const sub = line.slice(firstIdx) as number[];
    const e = ema(sub, signal);
    for (let i = 0; i < e.length; i++) sig[firstIdx + i] = e[i];
  }
  const hist: S = line.map((v, i) => (v != null && sig[i] != null ? v - (sig[i] as number) : null));
  return { line, signal: sig, hist };
}

export function atr(bars: Bar[], n = 14): S {
  const out: S = new Array(bars.length).fill(null);
  let prev: number | null = null;
  let seed = 0;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const pc = bars[i - 1].close;
    const tr = Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
    if (prev === null) {
      seed += tr;
      if (i === n) {
        prev = seed / n;
        out[i] = prev;
      }
    } else {
      prev = (prev * (n - 1) + tr) / n;
      out[i] = prev;
    }
  }
  return out;
}

export function obv(bars: Bar[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < bars.length; i++) {
    const d = bars[i].close - bars[i - 1].close;
    out.push(out[i - 1] + (d > 0 ? bars[i].volume : d < 0 ? -bars[i].volume : 0));
  }
  return out;
}

/** Mean and std of the n values BEFORE index i (current bar excluded). */
function priorStats(values: number[], i: number, n: number): { mean: number; std: number } | null {
  if (i - n < 0) return null;
  let sum = 0;
  for (let k = i - n; k < i; k++) sum += values[k];
  const mean = sum / n;
  let v = 0;
  for (let k = i - n; k < i; k++) v += (values[k] - mean) ** 2;
  return { mean, std: Math.sqrt(v / n) };
}

function linSlope(values: number[]): number {
  const n = values.length;
  const mx = (n - 1) / 2;
  const my = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (values[i] - my);
    den += (i - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

export interface IndicatorSeries {
  closes: number[];
  volumes: number[];
  sma20: S;
  sma50: S;
  sma200: S;
  rsi14: S;
  macd: ReturnType<typeof macd>;
  atr14: S;
  obv: number[];
  bbWidth: S;
}

export function computeSeries(bars: Bar[]): IndicatorSeries {
  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);
  const s20 = sma(closes, 20);
  const bbWidth: S = closes.map((_, i) => {
    if (i < 19 || s20[i] == null) return null;
    const m = s20[i] as number;
    let v = 0;
    for (let k = i - 19; k <= i; k++) v += (closes[k] - m) ** 2;
    const sd = Math.sqrt(v / 20);
    return (4 * sd) / m;
  });
  return {
    closes,
    volumes,
    sma20: s20,
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    rsi14: rsi(closes, 14),
    macd: macd(closes),
    atr14: atr(bars, 14),
    obv: obv(bars),
    bbWidth,
  };
}

const ret = (closes: number[], i: number, n: number) =>
  i - n >= 0 ? (closes[i] / closes[i - n] - 1) * 100 : null;

/**
 * Snapshot of all indicators at index i using data up to and including i.
 * `volumeOverride` lets the live scanner replace a partial session volume by a
 * session-time-projected volume (clearly flagged in the UI).
 */
export function snapshotAt(
  bars: Bar[],
  s: IndicatorSeries,
  i: number,
  volumeOverride?: number
): TechnicalSnapshot {
  const c = s.closes[i];
  const vol = volumeOverride ?? s.volumes[i];
  const v20 = priorStats(s.volumes, i, 20);
  const v50 = priorStats(s.volumes, i, 50);
  const start52 = Math.max(0, i - 251);
  let hi = Number.NEGATIVE_INFINITY;
  let lo = Number.POSITIVE_INFINITY;
  for (let k = start52; k <= i; k++) {
    hi = Math.max(hi, bars[k].high);
    lo = Math.min(lo, bars[k].low);
  }
  let bbPct: number | null = null;
  if (s.bbWidth[i] != null) {
    const hist: number[] = [];
    for (let k = Math.max(0, i - 125); k <= i; k++)
      if (s.bbWidth[k] != null) hist.push(s.bbWidth[k] as number);
    if (hist.length >= 60)
      bbPct = hist.filter((x) => x <= (s.bbWidth[i] as number)).length / hist.length;
  }
  const obvWin = i >= 20 ? s.obv.slice(i - 19, i + 1) : null;
  const avgVol20 = v20?.mean ?? null;
  const at = s.atr14[i];
  const s50 = s.sma50[i];
  const s200 = s.sma200[i];
  return {
    close: c,
    sma20: s.sma20[i],
    sma50: s50,
    sma200: s200,
    rsi14: s.rsi14[i],
    macd: s.macd.line[i],
    macdSignal: s.macd.signal[i],
    macdHist: s.macd.hist[i],
    atr14: at,
    atrPct: at != null ? (at / c) * 100 : null,
    ret5: ret(s.closes, i, 5),
    ret20: ret(s.closes, i, 20),
    ret60: ret(s.closes, i, 60),
    ret120: ret(s.closes, i, 120),
    volRatio20: v20 && v20.mean > 0 ? vol / v20.mean : null,
    volRatio50: v50 && v50.mean > 0 ? vol / v50.mean : null,
    volZ50: v50 && v50.std > 0 ? (vol - v50.mean) / v50.std : null,
    // OBV slope over 20 bars normalised by average daily volume => "net accumulation days"
    obvSlope20: obvWin && avgVol20 ? linSlope(obvWin) / avgVol20 : null,
    high52w: Number.isFinite(hi) ? hi : null,
    low52w: Number.isFinite(lo) ? lo : null,
    distFrom52wHigh: Number.isFinite(hi) ? (c / hi - 1) * 100 : null,
    distFromSma50: s50 != null ? (c / s50 - 1) * 100 : null,
    distFromSma200: s200 != null ? (c / s200 - 1) * 100 : null,
    bbWidthPctile: bbPct,
  };
}

/** Find index of the last bar whose date is <= the given date (binary search). */
export function indexAtOrBefore(bars: Bar[], date: string): number {
  let lo = 0;
  let hi = bars.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].date <= date) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
