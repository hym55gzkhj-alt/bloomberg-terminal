/**
 * Shared types for AI STOCK RADAR.
 * Everything here describes REAL data fetched from a provider. Nothing is simulated.
 */

export type Region = "US" | "DE" | "NL" | "DK";

export interface UniverseEntry {
  /** Internal id / display ticker */
  ticker: string;
  name: string;
  /** Symbol used for price + volume data on Yahoo Finance (primary listing). */
  yahoo: string;
  /** US symbol (or ADR) used for Finnhub fundamentals / analysts / news. null = not covered. */
  finnhub: string | null;
  sector: string;
  region: Region;
  /** Yahoo symbol of the benchmark index/ETF used for relative strength. */
  benchmark: string;
  /** Yahoo symbol of a sector ETF used for sector trend. */
  sectorEtf: string;
}

/** One daily OHLCV bar. Prices are split- and dividend-adjusted. */
export interface Bar {
  /** Unix seconds (exchange session date at 00:00 UTC is NOT guaranteed; use date). */
  t: number;
  /** ISO date YYYY-MM-DD in exchange time zone */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type DataFreshness = "realtime" | "delayed" | "end-of-day" | "unknown";

export interface QuoteInfo {
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  price: number;
  previousClose: number;
  change: number;
  changePct: number;
  dayHigh: number | null;
  dayLow: number | null;
  /** Volume of the current/last session as reported by the provider. */
  volume: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  /** Unix ms of last trade reported by provider */
  marketTime: number;
  marketState: "open" | "closed" | "pre" | "post";
  /** Fraction (0..1) of the regular session that has elapsed. 1 if closed. */
  sessionElapsed: number;
  freshness: DataFreshness;
  /** Human readable explanation of delay */
  delayNote: string;
  source: string;
}

export interface PriceHistory {
  quote: QuoteInfo;
  bars: Bar[];
  /** True if the last bar is an incomplete, in-progress session. */
  lastBarPartial: boolean;
  source: string;
  fetchedAt: number;
}

export interface NewsItem {
  id: string;
  headline: string;
  summary: string;
  url: string;
  source: string;
  /** Unix ms */
  publishedAt: number;
  tickers: string[];
  /** Lexicon-based sentiment -1..1 computed from headline+summary */
  sentiment: number;
  sentimentHits: { positive: string[]; negative: string[] };
  provider: string;
}

export interface RecommendationTrend {
  period: string; // YYYY-MM-DD
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}

export interface EarningsSurprise {
  period: string;
  actual: number | null;
  estimate: number | null;
  surprisePercent: number | null;
}

export interface UpcomingEarnings {
  date: string;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  quarter: number | null;
  year: number | null;
}

export interface Fundamentals {
  marketCap: number | null; // in millions (Finnhub convention)
  peTTM: number | null;
  revenueGrowthTTMYoy: number | null;
  revenueGrowthQuarterlyYoy: number | null;
  epsGrowthTTMYoy: number | null;
  epsGrowthQuarterlyYoy: number | null;
  grossMarginTTM: number | null;
  operatingMarginTTM: number | null;
  netMarginTTM: number | null;
  roeTTM: number | null;
  beta: number | null;
  currentRatio: number | null;
  totalDebtToEquity: number | null;
}

export interface ProviderStatus {
  provider: string;
  ok: boolean;
  message: string;
  checkedAt: number;
}

/** Result of a single component of the score. */
export interface ComponentResult {
  key: ComponentKey;
  label: string;
  /** 0..1, null if data is unavailable (component excluded, weight redistributed) */
  score: number | null;
  /** -1 negative, 0 neutral, 1 positive */
  direction: -1 | 0 | 1;
  facts: string[];
  unavailableReason?: string;
}

export type ComponentKey =
  | "volume"
  | "relativeStrength"
  | "momentum"
  | "news"
  | "fundamentals"
  | "analysts"
  | "marketSector";

export type Weights = Record<ComponentKey, number>;

export type SignalCategory =
  | "STRONG_MOMENTUM"
  | "BUILDING_MOMENTUM"
  | "EARLY_SIGNAL"
  | "NEUTRAL"
  | "NEGATIVE";

export interface Factor {
  text: string;
  component: ComponentKey | "extension";
  impact: "positive" | "negative";
}

export interface ExtensionInfo {
  /** 0 = not extended, 1 = heavily extended */
  level: number;
  /** points subtracted from the total score */
  penalty: number;
  notes: string[];
}

export interface TechnicalSnapshot {
  close: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  atr14: number | null;
  atrPct: number | null;
  ret5: number | null;
  ret20: number | null;
  ret60: number | null;
  ret120: number | null;
  volRatio20: number | null;
  volRatio50: number | null;
  volZ50: number | null;
  obvSlope20: number | null;
  high52w: number | null;
  low52w: number | null;
  distFrom52wHigh: number | null;
  distFromSma50: number | null;
  distFromSma200: number | null;
  bbWidthPctile: number | null;
}

export interface StockAnalysis {
  entry: UniverseEntry;
  quote: QuoteInfo;
  technical: TechnicalSnapshot;
  components: ComponentResult[];
  /** Component scores are combined client- or server-side with weights. */
  score: number;
  /** share (0..1) of the configured weight for which real data exists */
  coverage: number;
  category: SignalCategory;
  extension: ExtensionInfo;
  factors: Factor[];
  explanation: string;
  computedAt: number;
  /** First time (unix ms) the current category was detected by a scan. */
  detectedAt: number | null;
  dataSources: string[];
  warnings: string[];
  /** Regelbasierte Trade-Einschätzung (Long/Short/kein Trade) */
  trade: TradeSetup;
}

export interface DetailPayload {
  analysis: StockAnalysis;
  bars: Bar[];
  benchmarkBars: Bar[];
  news: NewsItem[];
  fundamentals: Fundamentals | null;
  recommendations: RecommendationTrend[];
  earnings: EarningsSurprise[];
  upcomingEarnings: UpcomingEarnings | null;
  signalHistory: SignalHistoryEntry[];
  historicalSignals: BacktestSignal[];
}

export type TradeBias = "LONG" | "SHORT" | "NEUTRAL";

export interface TradeSetup {
  bias: TradeBias;
  /** Kurzbeschreibung, z. B. "Long-Einstieg möglich" */
  action: string;
  /** 0..100 – Stärke der Signallage, KEINE Gewinnwahrscheinlichkeit */
  conviction: number;
  convictionLabel: "niedrig" | "mittel" | "hoch";
  entry: number | null;
  entryNote: string;
  stop: number | null;
  target1: number | null;
  target2: number | null;
  /** Abstand Einstieg–Stop in % */
  riskPct: number | null;
  /** Chance/Risiko bis Kursziel 2 */
  rewardRisk: number;
  horizon: string;
  reasons: string[];
  risks: string[];
  invalidation: string;
}

export interface TradeSimulation {
  stop: number;
  target1: number;
  target2: number;
  exitDate: string;
  exitPrice: number;
  outcome: "Ziel" | "Stop" | "Zeit" | "offen";
  /** Ergebnis in Vielfachen des Risikos nach Kosten */
  r: number;
  /** Ergebnis in % nach Kosten (richtungsbereinigt) */
  pct: number;
  target1Hit: boolean;
  days: number;
}

export interface TradeStats {
  count: number;
  winRate: number | null;
  avgR: number | null;
  medianR: number | null;
  avgPct: number | null;
  pctTarget: number | null;
  pctStop: number | null;
  pctTime: number | null;
  pctTarget1: number | null;
  avgDays: number | null;
  bestR: number | null;
  worstR: number | null;
  open: number;
}

export interface SignalHistoryEntry {
  category: SignalCategory;
  score: number;
  detectedAt: number;
  price: number;
}

export interface ScanResult {
  generatedAt: number;
  results: StockAnalysis[];
  errors: { ticker: string; message: string }[];
  providers: ProviderStatus[];
  weights: Weights;
  cache: "redis" | "memory";
}

export interface BacktestSignal {
  ticker: string;
  direction: "long" | "short";
  date: string;
  category: SignalCategory;
  score: number;
  entryDate: string | null;
  entryPrice: number | null;
  /** Net return after costs in % for each horizon (null if not enough future data) */
  returns: Record<string, number | null>;
  /** Benchmark return over the same window, % */
  benchmarkReturns: Record<string, number | null>;
  /** Max adverse move from entry within the longest horizon, % (direction-adjusted) */
  maxAdverse: number | null;
  /** Trade-Simulation mit Stop-Loss und Kursziel (null wenn Einstieg noch aussteht) */
  trade: TradeSimulation | null;
}

export interface HorizonStats {
  horizon: number;
  count: number;
  hitRate: number | null;
  avgReturn: number | null;
  medianReturn: number | null;
  avgExcess: number | null;
  excessHitRate: number | null;
  best: number | null;
  worst: number | null;
  baselineAvg: number | null;
}

export interface BacktestResult {
  params: BacktestParams;
  generatedAt: number;
  signals: BacktestSignal[];
  stats: Record<SignalCategory | "ALL", HorizonStats[]>;
  tradeStats: TradeStats;
  universe: string[];
  period: { from: string; to: string };
  methodology: string[];
  biases: string[];
  errors: { ticker: string; message: string }[];
}

export interface BacktestParams {
  /** long = positive Trade-Setups, short = Short-Setups */
  direction: "long" | "short";
  minCategory: "EARLY_SIGNAL" | "BUILDING_MOMENTUM" | "STRONG_MOMENTUM";
  costBps: number;
  entryDelayDays: number;
  cooldownDays: number;
  horizons: number[];
  years: number;
  tickers?: string[];
}
