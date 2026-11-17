import type { UniverseEntry } from "./types";

/**
 * The analysed stock universe: liquid, well-known large caps only.
 *
 * Extend it by adding entries here, or without code changes via the
 * RADAR_EXTRA_UNIVERSE environment variable (JSON array of UniverseEntry objects), e.g.
 * RADAR_EXTRA_UNIVERSE='[{"ticker":"CRM","name":"Salesforce","yahoo":"CRM","finnhub":"CRM",
 *   "sector":"Software","region":"US","benchmark":"SPY","sectorEtf":"IGV"}]'
 */
export const BASE_UNIVERSE: UniverseEntry[] = [
  {
    ticker: "NVDA",
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
      .map((e) => ({ ...e, finnhub: e.finnhub ?? null, region: e.region ?? "US" }));
  } catch {
    console.error("RADAR_EXTRA_UNIVERSE is not valid JSON – ignored");
    return [];
  }
}

export function getUniverse(): UniverseEntry[] {
  const extra = parseExtra();
  const seen = new Set<string>();
  const out: UniverseEntry[] = [];
  for (const e of [...BASE_UNIVERSE, ...extra]) {
    if (seen.has(e.ticker)) continue;
    seen.add(e.ticker);
    out.push(e);
  }
  return out;
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
