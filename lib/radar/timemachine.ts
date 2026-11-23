import { TRADE_RULES } from "./trade";
import type { Bar } from "./types";

/**
 * Time Machine (aus dem Day-Trader-Skill `trader-timemachine`, auf Tageskerzen übertragen).
 *
 * Spielt einen geplanten Trade vor dem Einstieg 10.000-mal durch. Jede Wiederholung baut
 * die nächsten `maxDays` Handelstage aus den echten Tageskerzen der Aktie selbst nach
 * (Bootstrap): für jeden Tag wird zufällig eine Kerze aus den letzten `poolDays` Tagen
 * gezogen und als Verhältnis zum Vortagesschluss auf den aktuellen Kurs skaliert.
 *
 * Regeln wie im Backtest (`simulateTrade`): Einstieg zur Eröffnung, Stop vor Ziel geprüft
 * (berührt eine Kerze beides, zählt der Stop), eine Kurslücke über den Stop/das Ziel wird
 * zum Eröffnungskurs ausgeführt, Kosten je Seite werden abgezogen.
 *
 * Gleicher Plan + gleiche Daten + gleicher Seed = gleiche Zahlen. Eine Simulation aus der
 * eigenen jüngeren Historie ist KEINE Vorhersage: Earnings, News und Marktschocks können
 * Dinge tun, die in diesen Tagen nie vorkamen.
 */

export interface TimeMachinePlan {
  direction: 1 | -1;
  entry: number;
  stop: number;
  /** Ausstiegsziel (beendet den Trade) */
  target: number;
  /** optionales Zwischenziel, nur gezählt (z. B. Kursziel 1) */
  target1?: number | null;
}

export interface TimeMachineOptions {
  replays?: number;
  seed?: number;
  maxDays?: number;
  poolDays?: number;
  costBps?: number;
}

export type Lean =
  | "coin"
  | "breakeven"
  | "lean_target"
  | "lean_stop"
  | "strong_target"
  | "strong_stop"
  | "none";

export interface TimeMachineResult {
  replays: number;
  seed: number;
  maxDays: number;
  poolDays: number;
  poolFrom: string;
  poolTo: string;
  targetR: number;
  /** Anteile 0..1 */
  pTarget: number;
  pStop: number;
  pNeither: number;
  /** Ziel zuerst oder am Ende im Gewinn */
  pGreen: number;
  /** Zwischenziel (Kursziel 1) mindestens einmal berührt */
  pTarget1: number | null;
  avgR: number;
  medianR: number;
  /** Ø Haltedauer in Handelstagen */
  avgDays: number;
  /** Kurs am Ende (Ausstieg oder Tag maxDays) */
  final: { p5: number; median: number; p95: number };
  /** Fächer: Quantile des Kurses je Tag (Index 0 = Einstieg) */
  bands: { day: number; p5: number; p25: number; p50: number; p75: number; p95: number }[];
  /** Histogramm der R-Ergebnisse */
  histogram: { from: number; to: number; count: number }[];
  breakEven: number;
  /** Anteil Ziel an allen Wiederholungen, die eine Seite erreicht haben */
  targetShare: number | null;
  lean: Lean;
  verdict: string;
  notes: string[];
}

const COIN_FLIP = 0.05;
const STRONG = 0.15;
const MANY_NEITHER = 0.4;
const BAND_PATHS = 2000;
const HIST_BINS = 20;

/** Kleiner, schneller, reproduzierbarer PRNG (mulberry32). */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Ratio {
  /** Eröffnung, Hoch, Tief, Schluss relativ zum Vortagesschluss */
  o: number;
  h: number;
  l: number;
  c: number;
}

function buildPool(bars: Bar[], poolDays: number): { pool: Ratio[]; from: string; to: string } {
  const clean = bars.filter(
    (b) => b.open > 0 && b.high > 0 && b.low > 0 && b.close > 0 && b.high >= b.low
  );
  const start = Math.max(1, clean.length - poolDays);
  const pool: Ratio[] = [];
  for (let i = start; i < clean.length; i++) {
    const p = clean[i - 1].close;
    const b = clean[i];
    pool.push({ o: b.open / p, h: b.high / p, l: b.low / p, c: b.close / p });
  }
  return { pool, from: clean[start]?.date ?? "", to: clean[clean.length - 1]?.date ?? "" };
}

const quantile = (sorted: number[], q: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : Number.NaN;

interface Path {
  outcome: "target" | "stop" | "neither";
  r: number;
  exitPrice: number;
  days: number;
  target1: boolean;
  closes: number[];
}

function replay(
  plan: TimeMachinePlan,
  pool: Ratio[],
  rnd: () => number,
  maxDays: number,
  cost: number,
  keepPath: boolean
): Path {
  const { direction: dir, entry, stop, target } = plan;
  const t1 = plan.target1 ?? null;
  const risk = Math.abs(entry - stop);
  const riskPct = (risk / entry) * 100;
  let prev = entry;
  let target1 = false;
  const closes = keepPath ? [entry] : [];
  for (let d = 0; d < maxDays; d++) {
    const k = pool[Math.floor(rnd() * pool.length)];
    // Tag 1: Einstieg zur Eröffnung – die Kerze wird relativ zu ihrer Eröffnung angewendet
    const base = d === 0 ? entry / k.o : prev;
    const open = d === 0 ? entry : base * k.o;
    const high = base * k.h;
    const low = base * k.l;
    const close = base * k.c;
    if (t1 != null && (dir === 1 ? high >= t1 : low <= t1)) target1 = true;
    const stopGap = d > 0 && (dir === 1 ? open <= stop : open >= stop);
    const stopHit = dir === 1 ? low <= stop : high >= stop;
    const tgtGap = d > 0 && (dir === 1 ? open >= target : open <= target);
    const tgtHit = dir === 1 ? high >= target : low <= target;
    let exit: number | null = null;
    let outcome: Path["outcome"] = "neither";
    if (stopGap || stopHit) {
      exit = stopGap ? open : stop;
      outcome = "stop";
    } else if (tgtGap || tgtHit) {
      exit = tgtGap ? open : target;
      outcome = "target";
    }
    if (exit != null) {
      if (keepPath) closes.push(exit);
      const pct = dir * (exit / entry - 1) * 100 - cost;
      return { outcome, r: pct / riskPct, exitPrice: exit, days: d + 1, target1, closes };
    }
    if (keepPath) closes.push(close);
    prev = close;
  }
  const pct = dir * (prev / entry - 1) * 100 - cost;
  return {
    outcome: "neither",
    r: pct / riskPct,
    exitPrice: prev,
    days: maxDays,
    target1,
    closes,
  };
}

/** Urteil wie im Skill: Anteil Ziel an allen entschiedenen Wiederholungen vs. Gewinnschwelle 1/(1+R). */
export function verdictOf(
  pTarget: number,
  pStop: number,
  pNeither: number,
  avgR: number,
  targetR: number,
  maxDays: number
): Pick<TimeMachineResult, "breakEven" | "targetShare" | "lean" | "verdict" | "notes"> {
  const breakEven = 1 / (1 + targetR);
  const decided = pTarget + pStop;
  const pc = (x: number) => `${(x * 100).toFixed(1)} %`;
  const notes: string[] = [];
  if (decided <= 0) {
    return {
      breakEven,
      targetShare: null,
      lean: "none",
      verdict: `Keine Wiederholung hat Ziel oder Stop innerhalb von ${maxDays} Handelstagen erreicht.`,
      notes,
    };
  }
  const share = pTarget / decided;
  const gap = share - breakEven;
  const one = Math.abs(targetR - 1) < 0.05;
  let lean: Lean;
  let head: string;
  if (Math.abs(gap) < COIN_FLIP) {
    lean = one ? "coin" : "breakeven";
    head = one ? "Nahe am Münzwurf" : "Nahe an der Gewinnschwelle";
  } else if (Math.abs(gap) < STRONG) {
    lean = gap > 0 ? "lean_target" : "lean_stop";
    head = gap > 0 ? "Tendenz zum Ziel" : "Tendenz zum Stop";
  } else {
    lean = gap > 0 ? "strong_target" : "strong_stop";
    head = gap > 0 ? "Deutlich Richtung Ziel" : "Deutlich Richtung Stop";
  }
  const verdict = `${head}: Ziel zuerst ${pc(pTarget)} vs. Stop zuerst ${pc(pStop)} (bei ${targetR.toFixed(1)}R reichen ${pc(breakEven)} der entschiedenen Fälle, erreicht: ${pc(share)}).`;
  if (pNeither > MANY_NEITHER) {
    notes.push(
      `${pc(pNeither)} der Wiederholungen erreichen nach ${maxDays} Handelstagen weder Ziel noch Stop – dort entscheidet der Kurs am Ende.`
    );
  }
  const leansUp = lean === "lean_target" || lean === "strong_target";
  const leansDown = lean === "lean_stop" || lean === "strong_stop";
  if ((leansUp && avgR < 0) || (leansDown && avgR > 0)) {
    notes.push(
      `Ø Ergebnis ${avgR >= 0 ? "+" : ""}${avgR.toFixed(2)}R zeigt in die Gegenrichtung (wegen der unentschiedenen Fälle).`
    );
  }
  return { breakEven, targetShare: share, lean, verdict, notes };
}

export function runTimeMachine(
  bars: Bar[],
  plan: TimeMachinePlan,
  opts: TimeMachineOptions = {}
): TimeMachineResult {
  const replays = Math.max(100, Math.min(100_000, Math.round(opts.replays ?? 10_000)));
  const seed = Math.round(opts.seed ?? 19);
  const maxDays = Math.max(1, Math.round(opts.maxDays ?? TRADE_RULES.maxDays));
  const poolDays = Math.max(20, Math.round(opts.poolDays ?? 250));
  const cost = ((opts.costBps ?? 10) * 2) / 100;
  const { direction: dir, entry, stop, target } = plan;
  if (!(entry > 0) || !(stop > 0) || !(target > 0))
    throw new Error("Plan unvollständig: Einstieg, Stop und Ziel müssen gesetzt sein.");
  if (dir === 1 ? !(stop < entry && target > entry) : !(stop > entry && target < entry))
    throw new Error("Plan ungültig: Stop und Ziel liegen auf der falschen Seite des Einstiegs.");
  const { pool, from, to } = buildPool(bars, poolDays);
  if (pool.length < 60)
    throw new Error(
      `Zu wenig Kurshistorie: ${pool.length} Tageskerzen, mindestens 60 nötig für einen fairen Pool.`
    );
  const risk = Math.abs(entry - stop);
  const targetR = Math.abs(target - entry) / risk;

  const rnd = mulberry32(seed);
  let nT = 0;
  let nS = 0;
  let nGreen = 0;
  let nT1 = 0;
  let sumR = 0;
  let sumDays = 0;
  const rs: number[] = new Array(replays);
  const finals: number[] = new Array(replays);
  for (let i = 0; i < replays; i++) {
    const p = replay(plan, pool, rnd, maxDays, cost, false);
    if (p.outcome === "target") nT++;
    else if (p.outcome === "stop") nS++;
    if (p.outcome === "target" || (p.outcome === "neither" && dir * (p.exitPrice - entry) > 0))
      nGreen++;
    if (p.target1) nT1++;
    sumR += p.r;
    sumDays += p.days;
    rs[i] = p.r;
    finals[i] = p.exitPrice;
  }

  // Fächer: zweiter Lauf mit demselben Seed, Pfade nach Ausstieg mit dem Ausstiegskurs fortgeschrieben
  const bandRnd = mulberry32(seed);
  const cols: number[][] = Array.from({ length: maxDays + 1 }, () => []);
  for (let i = 0; i < Math.min(BAND_PATHS, replays); i++) {
    const p = replay(plan, pool, bandRnd, maxDays, cost, true);
    for (let d = 0; d <= maxDays; d++) cols[d].push(p.closes[Math.min(d, p.closes.length - 1)]);
  }
  const bands = cols.map((c, day) => {
    const s = [...c].sort((a, b) => a - b);
    return {
      day,
      p5: quantile(s, 0.05),
      p25: quantile(s, 0.25),
      p50: quantile(s, 0.5),
      p75: quantile(s, 0.75),
      p95: quantile(s, 0.95),
    };
  });

  const sortedR = [...rs].sort((a, b) => a - b);
  const lo = quantile(sortedR, 0.01);
  const hi = quantile(sortedR, 0.99);
  const width = (hi - lo) / HIST_BINS || 1;
  const histogram = Array.from({ length: HIST_BINS }, (_, i) => ({
    from: lo + i * width,
    to: lo + (i + 1) * width,
    count: 0,
  }));
  for (const r of rs) {
    const idx = Math.min(HIST_BINS - 1, Math.max(0, Math.floor((r - lo) / width)));
    histogram[idx].count++;
  }

  const sortedF = [...finals].sort((a, b) => a - b);
  const pTarget = nT / replays;
  const pStop = nS / replays;
  const pNeither = 1 - pTarget - pStop;
  const avgR = sumR / replays;
  return {
    replays,
    seed,
    maxDays,
    poolDays: pool.length,
    poolFrom: from,
    poolTo: to,
    targetR,
    pTarget,
    pStop,
    pNeither,
    pGreen: nGreen / replays,
    pTarget1: plan.target1 != null ? nT1 / replays : null,
    avgR,
    medianR: quantile(sortedR, 0.5),
    avgDays: sumDays / replays,
    final: {
      p5: quantile(sortedF, 0.05),
      median: quantile(sortedF, 0.5),
      p95: quantile(sortedF, 0.95),
    },
    bands,
    histogram,
    ...verdictOf(pTarget, pStop, pNeither, avgR, targetR, maxDays),
  };
}
