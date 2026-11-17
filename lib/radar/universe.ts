import large from "./data/universe-large.json";
import { isValidIsin } from "./isin";
import type { UniverseEntry } from "./types";

/**
 * The analysed stock universe: liquid, well-known large caps only.
 *
 * Extend it by adding entries here, or without code changes via the
 * RADAR_EXTRA_UNIVERSE environment variable (JSON array of UniverseEntry objects), e.g.
 * RADAR_EXTRA_UNIVERSE='[{"ticker":"CRM","name":"Salesforce","yahoo":"CRM","finnhub":"CRM",
 *   "sector":"Software","region":"US","benchmark":"SPY","sectorEtf":"IGV","isin":"US79466L3024"}]'
 */
export const BASE_UNIVERSE: UniverseEntry[] = [
  {
    ticker: "NVDA",
    isin: "US67066G1040",
    name: "NVIDIA",
    yahoo: "NVDA",
    finnhub: "NVDA",
    sector: "Semiconductors",
    region: "US",
    benchmark: "SPY",
    sectorEtf: "SMH",
  },
  {
    ticker: "MSFT",
    isin: "US5949181045",
    name: "Microsoft",
    yahoo: "MSFT",
    finnhub: "MSFT",
    sector: "Software",
    region: "US",
    benchmark: "SPY",
    sectorEtf: "IGV",
  },
  {
    ticker: "AAPL",
    isin: "US0378331005",
    name: "Apple",
    yahoo: "AAPL",
    finnhub: "AAPL",
    sector: "Tech Hardware",
    region: "US",
    benchmark: "SPY",
    sectorEtf: "XLK",
  },
  {
    ticker: "AMZN",
    isin: "US0231351067",
    name: "Amazon",
    yahoo: "AMZN",
    finnhub: "AMZN",
    sector: "Consumer Discretionary",
    region: "US",
    benchmark: "SPY",
    sectorEtf: "XLY",
  },
  {
    ticker: "GOOGL",
    isin: "US02079K3059",
    name: "Alphabet",
    yahoo: "GOOGL",
    finnhub: "GOOGL",
    sector: "Communication Services",
    region: "US",
    benchmark: "SPY",
    sectorEtf: "XLC",
  },
  {
    ticker: "META",
    isin: "US30303M1027",
    name: "Meta Platforms",
    yahoo: "META",
    finnhub: "META",
    sector: "Communication Services",
    region: "US",
    benchmark: "SPY",
    sectorEtf: "XLC",
  },
  {
    ticker: "TSLA",
    isin: "US88160R1014",
    name: "Tesla",
    yahoo: "TSLA",
    finnhub: "TSLA",
    sector: "Consumer Discretionary",
    region: "US",
    benchmark: "SPY",
    sectorEtf: "XLY",
  },
  {
    ticker: "AMD",
    isin: "US0079031078",
    name: "Advanced Micro Devices",
    yahoo: "AMD",
    finnhub: "AMD",
    sector: "Semiconductors",
    region: "US",
    benchmark: "SPY",
    sectorEtf: "SMH",
  },
  {
    ticker: "AVGO",
    isin: "US11135F1012",
    name: "Broadcom",
    yahoo: "AVGO",
    finnhub: "AVGO",
    sector: "Semiconductors",
    region: "US",
    benchmark: "SPY",
    sectorEtf: "SMH",
  },
  {
    ticker: "PLTR",
    isin: "US69608A1088",
    name: "Palantir",
    yahoo: "PLTR",
    finnhub: "PLTR",
    sector: "Software",
    region: "US",
    benchmark: "SPY",
    sectorEtf: "IGV",
  },
  {
    ticker: "NFLX",
    isin: "US64110L1061",
    name: "Netflix",
    yahoo: "NFLX",
    finnhub: "NFLX",
    sector: "Communication Services",
    region: "US",
    benchmark: "SPY",
    sectorEtf: "XLC",
  },
  {
    ticker: "QCOM",
    isin: "US7475251036",
    name: "Qualcomm",
    yahoo: "QCOM",
    finnhub: "QCOM",
    sector: "Semiconductors",
    region: "US",
    benchmark: "SPY",
    sectorEtf: "SMH",
  },
  {
    ticker: "ORCL",
    isin: "US68389X1054",
    name: "Oracle",
    yahoo: "ORCL",
    finnhub: "ORCL",
    sector: "Software",
    region: "US",
    benchmark: "SPY",
    sectorEtf: "IGV",
  },
  {
    ticker: "ASML",
    isin: "NL0010273215",
    name: "ASML Holding",
    yahoo: "ASML.AS",
    finnhub: "ASML",
    sector: "Semiconductors",
    region: "NL",
    benchmark: "^AEX",
    sectorEtf: "SMH",
  },
  {
    ticker: "SAP",
    isin: "DE0007164600",
    name: "SAP",
    yahoo: "SAP.DE",
    finnhub: "SAP",
    sector: "Software",
    region: "DE",
    benchmark: "^GDAXI",
    sectorEtf: "IGV",
  },
  {
    ticker: "SIE",
    isin: "DE0007236101",
    name: "Siemens",
    yahoo: "SIE.DE",
    finnhub: null,
    sector: "Industrials",
    region: "DE",
    benchmark: "^GDAXI",
    sectorEtf: "XLI",
  },
  {
    ticker: "BRK.B",
    isin: "US0846707026",
    name: "Berkshire Hathaway",
    yahoo: "BRK-B",
    finnhub: "BRK.B",
    sector: "Financials",
    region: "US",
    benchmark: "SPY",
    sectorEtf: "XLF",
  },
  {
    ticker: "JPM",
    isin: "US46625H1005",
    name: "JPMorgan Chase",
    yahoo: "JPM",
    finnhub: "JPM",
    sector: "Financials",
    region: "US",
    benchmark: "SPY",
    sectorEtf: "XLF",
  },
  {
    ticker: "LLY",
    isin: "US5324571083",
    name: "Eli Lilly",
    yahoo: "LLY",
    finnhub: "LLY",
    sector: "Healthcare",
    region: "US",
    benchmark: "SPY",
    sectorEtf: "XLV",
  },
  {
    ticker: "NOVO",
    isin: "DK0062498333",
    name: "Novo Nordisk",
    yahoo: "NOVO-B.CO",
    finnhub: "NVO",
    sector: "Healthcare",
    region: "DK",
    benchmark: "^OMXC25",
    sectorEtf: "XLV",
  },
];

function parseExtra(): UniverseEntry[] {
  const raw = process.env.RADAR_EXTRA_UNIVERSE;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is UniverseEntry =>
          e &&
          typeof e.ticker === "string" &&
          typeof e.name === "string" &&
          typeof e.yahoo === "string" &&
          typeof e.sector === "string" &&
          typeof e.benchmark === "string" &&
          typeof e.sectorEtf === "string"
      )
      .map((e) => ({
        ...e,
        finnhub: e.finnhub ?? null,
        region: e.region ?? "US",
        isin: typeof e.isin === "string" && isValidIsin(e.isin) ? e.isin : null,
      }));
  } catch {
    console.error("RADAR_EXTRA_UNIVERSE is not valid JSON – ignored");
    return [];
  }
}

interface LargeEntry extends Omit<UniverseEntry, "isin"> {
  isin?: string | null;
  medium?: boolean;
  adv?: number;
}

/**
 * RADAR_UNIVERSE:
 *  - "medium" (default, ~130 stocks): all DAX 40 / Euro Stoxx 50 members + the 4 most
 *    traded US stocks of every sector + the 20 core stocks; full pass ≈ 3 min
 *  - "large" (~570): all S&P 500, Nasdaq-100, DAX 40, Euro Stoxx 50 members; ≈ 14 min
 *  - "core" (20): the core stocks only
 */
export function universeMode(): "core" | "medium" | "large" {
  const m = process.env.RADAR_UNIVERSE;
  return m === "core" || m === "large" ? m : "medium";
}

/**
 * Large universe (~570 stocks): current members of S&P 500, Nasdaq-100, DAX 40 and
 * Euro Stoxx 50, generated by scripts/build_universe.py from Wikipedia and verified
 * against live Yahoo Finance data. See universeMode() for the selectable sizes.
 */
function largeUniverse(): UniverseEntry[] {
  const mode = universeMode();
  if (mode === "core") return [];
  return (large.entries as LargeEntry[])
    .filter((e) => mode === "large" || e.medium)
    .map(({ medium: _m, adv: _a, ...e }) => ({
      ...e,
      isin: e.isin && isValidIsin(e.isin) ? e.isin : null,
    }));
}

export const LARGE_UNIVERSE_META = { generatedAt: large.generatedAt, source: large.source };

const g = globalThis as unknown as { __radarUniverse?: UniverseEntry[] };

export function getUniverse(): UniverseEntry[] {
  if (g.__radarUniverse) return g.__radarUniverse;
  const big = largeUniverse();
  const byTicker = new Map(big.map((e) => [e.ticker, e]));
  const byYahoo = new Map(big.map((e) => [e.yahoo.toUpperCase(), e]));
  const seenTicker = new Set<string>();
  const seenYahoo = new Set<string>();
  const out: UniverseEntry[] = [];
  const push = (e: UniverseEntry) => {
    const y = e.yahoo.toUpperCase();
    if (seenTicker.has(e.ticker) || seenYahoo.has(y)) return;
    seenTicker.add(e.ticker);
    seenYahoo.add(y);
    out.push(e);
  };
  // core entries win; they inherit index memberships of the same company from the big list
  for (const e of BASE_UNIVERSE) {
    const twin = byTicker.get(e.ticker) ?? byYahoo.get(e.yahoo.toUpperCase());
    push({ ...e, core: true, indices: twin?.indices ?? [] });
    // the same company from the big list (possibly another listing) must not appear twice
    if (twin) {
      seenTicker.add(twin.ticker);
      seenYahoo.add(twin.yahoo.toUpperCase());
    }
  }
  for (const e of [...big, ...parseExtra()]) push(e);
  g.__radarUniverse = out;
  return out;
}

export function getCoreUniverse(): UniverseEntry[] {
  return getUniverse().filter((e) => e.core);
}

export function findEntry(ticker: string): UniverseEntry | undefined {
  const t = ticker.toUpperCase();
  return getUniverse().find((e) => e.ticker === t || e.yahoo.toUpperCase() === t);
}

/** Instruments shown on the Market Overview (all real Yahoo Finance symbols). */
export const MARKET_OVERVIEW = [
  { symbol: "SPY", name: "S&P 500 ETF", group: "US" },
  { symbol: "QQQ", name: "Nasdaq 100 ETF", group: "US" },
  { symbol: "DIA", name: "Dow Jones ETF", group: "US" },
  { symbol: "IWM", name: "Russell 2000 ETF", group: "US" },
  { symbol: "^VIX", name: "CBOE Volatility Index", group: "US" },
  { symbol: "^GDAXI", name: "DAX", group: "Europe" },
  { symbol: "^STOXX50E", name: "Euro Stoxx 50", group: "Europe" },
  { symbol: "^AEX", name: "AEX", group: "Europe" },
  { symbol: "^OMXC25", name: "OMX Copenhagen 25", group: "Europe" },
  { symbol: "^N225", name: "Nikkei 225", group: "Asia" },
  { symbol: "^HSI", name: "Hang Seng", group: "Asia" },
  { symbol: "SMH", name: "Semiconductors ETF", group: "Sectors" },
  { symbol: "IGV", name: "Software ETF", group: "Sectors" },
  { symbol: "XLK", name: "Technology", group: "Sectors" },
  { symbol: "XLC", name: "Communication Svcs", group: "Sectors" },
  { symbol: "XLY", name: "Consumer Discretionary", group: "Sectors" },
  { symbol: "XLF", name: "Financials", group: "Sectors" },
  { symbol: "XLV", name: "Healthcare", group: "Sectors" },
  { symbol: "XLI", name: "Industrials", group: "Sectors" },
  { symbol: "EURUSD=X", name: "EUR/USD", group: "FX & Rates" },
  { symbol: "^TNX", name: "US 10Y Yield", group: "FX & Rates" },
] as const;
