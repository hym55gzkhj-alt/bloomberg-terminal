/**
 * Trading Desk: Positionsgröße und Risiko-Check (aus den Day-Trader-Skills
 * `trader-budget` und `trader-risk`, auf die regelbasierten Swing-Setups des Radars übertragen).
 *
 * Reine Funktionen ohne Netzwerk. Es wird NIE eine Order platziert: das Ergebnis ist ein
 * Order-Ticket zum Abschreiben, das der Nutzer selbst bei seinem Broker eingibt.
 */

export interface DeskConfig {
  /** Kontogröße in Kontowährung */
  account: number;
  /** Kontowährung (Positionsgrößen werden in diese umgerechnet) */
  accountCurrency: "EUR" | "USD";
  /** maximaler Verlust je Trade (beim Stop) in Kontowährung */
  maxLossPerTrade: number;
  /** Anteil des Kontos, der immer in bar bleibt */
  cashBufferPct: number;
  /** maximale Positionsgröße in % des Kontos */
  maxPositionPct: number;
  /** maximaler Orderwert in Kontowährung */
  maxOrder: number;
  /** minimaler Orderwert in Kontowährung */
  minOrder: number;
  /** Mindest-Chance/Risiko bis zum gewählten Ziel */
  minRewardRisk: number;
  /** Ziel für Chance/Risiko und Take-Profit: Kursziel 1 oder 2 */
  takeProfit: "target1" | "target2";
  allowShort: boolean;
  /** Trade sperren, wenn Earnings in den Haltezeitraum fallen */
  blockEarnings: boolean;
  /** Trade sperren, wenn die Time Machine deutlich Richtung Stop zeigt */
  blockStrongStop: boolean;
  /** gesperrte Ticker */
  blocked: string[];
}

export const DEFAULT_DESK: DeskConfig = {
  account: 5000,
  accountCurrency: "EUR",
  maxLossPerTrade: 50,
  cashBufferPct: 10,
  maxPositionPct: 50,
  maxOrder: 3000,
  minOrder: 50,
  minRewardRisk: 1.5,
  takeProfit: "target1",
  allowShort: false,
  blockEarnings: true,
  blockStrongStop: true,
  blocked: [],
};

export interface DeskPlan {
  ticker: string;
  direction: 1 | -1;
  entry: number;
  stop: number;
  target1: number;
  target2: number;
  /** Handelswährung der Aktie */
  currency: string;
  /** Wechselkurs: 1 Einheit Handelswährung = fx Einheiten Kontowährung; null = unbekannt */
  fx: number | null;
}

export type SizeLimit = "Max. Verlust" | "Positionsgrenze" | "Max. Orderwert" | "Bargeld";

export interface SizeResult {
  shares: number;
  /** begrenzende Regel */
  limit: SizeLimit | null;
  candidates: { rule: SizeLimit; shares: number }[];
  /** alle Beträge in Kontowährung */
  positionValue: number;
  riskPerShare: number;
  lossAtStop: number;
  gainAtTarget1: number;
  gainAtTarget2: number;
  positionPct: number;
  takeProfit: number;
  rewardRisk: number;
}

const floor = (x: number) => (Number.isFinite(x) && x > 0 ? Math.floor(x + 1e-9) : 0);

/** Ganze Stück: das Minimum aus Max. Verlust, Positionsgrenze, Max. Orderwert und Bargeld. */
export function sizePosition(plan: DeskPlan, cfg: DeskConfig): SizeResult {
  const fx = plan.fx ?? 1;
  const entryAcc = plan.entry * fx;
  const riskPerShare = Math.abs(plan.entry - plan.stop) * fx;
  const tp = cfg.takeProfit === "target2" ? plan.target2 : plan.target1;
  const candidates: { rule: SizeLimit; shares: number }[] = [
    { rule: "Max. Verlust", shares: floor(cfg.maxLossPerTrade / riskPerShare) },
    { rule: "Positionsgrenze", shares: floor((cfg.account * cfg.maxPositionPct) / 100 / entryAcc) },
    { rule: "Max. Orderwert", shares: floor(cfg.maxOrder / entryAcc) },
    {
      rule: "Bargeld",
      shares: floor((cfg.account * (1 - cfg.cashBufferPct / 100)) / entryAcc),
    },
  ];
  let best = candidates[0];
  for (const c of candidates) if (c.shares < best.shares) best = c;
  const shares = best.shares;
  const positionValue = shares * entryAcc;
  return {
    shares,
    limit: shares >= 0 ? best.rule : null,
    candidates,
    positionValue,
    riskPerShare,
    lossAtStop: shares * riskPerShare,
    gainAtTarget1: shares * Math.abs(plan.target1 - plan.entry) * fx,
    gainAtTarget2: shares * Math.abs(plan.target2 - plan.entry) * fx,
    positionPct: cfg.account > 0 ? (positionValue / cfg.account) * 100 : 0,
    takeProfit: tp,
    rewardRisk: Math.abs(tp - plan.entry) / Math.abs(plan.entry - plan.stop),
  };
}

export interface RiskCheck {
  rule: string;
  status: "ok" | "block" | "warn";
  detail: string;
}

export interface RiskContext {
  /** Datum der nächsten Earnings (YYYY-MM-DD) */
  earningsDate?: string | null;
  /** letzter Handelstag des Haltezeitraums (YYYY-MM-DD) */
  horizonEnd?: string | null;
  /** Urteil der Time Machine */
  timeMachineLean?: string | null;
  timeMachineVerdict?: string | null;
  /** Ø R der Regeln im Backtest */
  ruleAvgR?: number | null;
  /** Datenabdeckung des Scores 0..1 */
  coverage?: number | null;
  /** eingeschränkte Analyse (Liquidität/Historie) */
  limited?: boolean;
}

export interface RiskResult {
  verdict: "PASS" | "BLOCK";
  checks: RiskCheck[];
}

const money = (x: number, cur: string) =>
  `${x.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;

/** Jede Regel liefert ok / block / warn. Ein einziges block sperrt den Trade. */
export function riskCheck(
  plan: DeskPlan,
  size: SizeResult,
  cfg: DeskConfig,
  ctx: RiskContext = {}
): RiskResult {
  const cur = cfg.accountCurrency;
  const checks: RiskCheck[] = [];
  const add = (rule: string, status: RiskCheck["status"], detail: string) =>
    checks.push({ rule, status, detail });

  const stopOk = plan.direction === 1 ? plan.stop < plan.entry : plan.stop > plan.entry;
  add(
    "Stop",
    stopOk ? "ok" : "block",
    stopOk
      ? `Stop ${plan.stop.toFixed(2)} auf der richtigen Seite des Einstiegs`
      : "Stop liegt auf der falschen Seite des Einstiegs"
  );

  if (plan.fx == null && plan.currency !== cur) {
    add(
      "Währung",
      "warn",
      `Kein Wechselkurs ${plan.currency}→${cur} verfügbar – Beträge in ${plan.currency} gerechnet`
    );
  }

  if (cfg.blocked.map((b) => b.toUpperCase()).includes(plan.ticker.toUpperCase())) {
    add("Sperrliste", "block", `${plan.ticker} steht auf der Sperrliste`);
  }

  if (plan.direction === -1) {
    add(
      "Short",
      cfg.allowShort ? "warn" : "block",
      cfg.allowShort
        ? "Short-Verkauf: theoretisch unbegrenztes Verlustrisiko, Kurslücken über den Stop möglich"
        : "Short-Verkauf ist in den Einstellungen nicht erlaubt"
    );
  }

  if (size.shares < 1) {
    const why = size.limit === "Max. Verlust" ? " – der Stop ist für den max. Verlust zu weit" : "";
    add("Stückzahl", "block", `0 Stück nach Regel „${size.limit}“${why}`);
  } else {
    add("Stückzahl", "ok", `${size.shares} Stück, begrenzt durch „${size.limit}“`);
  }

  if (size.shares >= 1) {
    add(
      "Max. Verlust",
      size.lossAtStop <= cfg.maxLossPerTrade + 1e-6 ? "ok" : "block",
      `Verlust beim Stop ${money(size.lossAtStop, cur)} (Grenze ${money(cfg.maxLossPerTrade, cur)})`
    );
    add(
      "Orderwert",
      size.positionValue < cfg.minOrder
        ? "block"
        : size.positionValue > cfg.maxOrder + 1e-6
          ? "block"
          : "ok",
      `${money(size.positionValue, cur)} (erlaubt ${money(cfg.minOrder, cur)} – ${money(cfg.maxOrder, cur)})`
    );
    add(
      "Position",
      size.positionPct <= cfg.maxPositionPct + 1e-6 ? "ok" : "block",
      `${size.positionPct.toFixed(1)} % des Kontos (Grenze ${cfg.maxPositionPct} %)`
    );
  }

  add(
    "Chance/Risiko",
    size.rewardRisk + 1e-9 >= cfg.minRewardRisk ? "ok" : "block",
    `${size.rewardRisk.toFixed(2)} : 1 bis ${cfg.takeProfit === "target2" ? "Kursziel 2" : "Kursziel 1"} (mindestens ${cfg.minRewardRisk.toFixed(1)} : 1)`
  );

  if (ctx.earningsDate && ctx.horizonEnd) {
    const today = new Date().toISOString().slice(0, 10);
    if (ctx.earningsDate >= today && ctx.earningsDate <= ctx.horizonEnd) {
      add(
        "Earnings",
        cfg.blockEarnings ? "block" : "warn",
        `Earnings am ${ctx.earningsDate} fallen in den Haltezeitraum – Kurslücken über Stop/Ziel möglich`
      );
    } else {
      add("Earnings", "ok", `Nächste Earnings am ${ctx.earningsDate}, nach dem Haltezeitraum`);
    }
  }

  if (ctx.timeMachineLean) {
    const strongStop = ctx.timeMachineLean === "strong_stop";
    const leanStop = ctx.timeMachineLean === "lean_stop";
    add(
      "Time Machine",
      strongStop ? (cfg.blockStrongStop ? "block" : "warn") : leanStop ? "warn" : "ok",
      ctx.timeMachineVerdict ?? ""
    );
  }

  if (ctx.ruleAvgR != null && ctx.ruleAvgR <= 0) {
    add(
      "Regel-Bilanz",
      "warn",
      `Diese Regeln brachten historisch Ø ${ctx.ruleAvgR.toFixed(2)}R je Trade (Backtest)`
    );
  }
  if (ctx.coverage != null && ctx.coverage < 0.8) {
    add(
      "Datenabdeckung",
      "warn",
      `Nur ${(ctx.coverage * 100).toFixed(0)} % der Score-Gewichtung mit Daten belegt`
    );
  }
  if (ctx.limited) {
    add("Liquidität", "warn", "Eingeschränkte Analyse (geringe Liquidität oder kurze Historie)");
  }

  return { verdict: checks.some((c) => c.status === "block") ? "BLOCK" : "PASS", checks };
}

/** Das Order-Ticket als Klartext zum Abschreiben – es wird nichts gesendet. */
export function orderTicket(plan: DeskPlan, size: SizeResult, cfg: DeskConfig): string {
  const side = plan.direction === 1 ? "KAUF" : "LEERVERKAUF";
  const exit = plan.direction === 1 ? "Verkauf" : "Rückkauf";
  const p = (x: number) => `${x.toFixed(2)} ${plan.currency}`;
  return [
    `${side} ${size.shares} × ${plan.ticker} zur Eröffnung (ca. ${p(plan.entry)})`,
    `Stop-Loss: ${exit} bei ${p(plan.stop)}  → max. Verlust ca. ${money(size.lossAtStop, cfg.accountCurrency)}`,
    `Take-Profit: ${exit} bei ${p(size.takeProfit)}  → Chance/Risiko ${size.rewardRisk.toFixed(2)} : 1`,
    `Positionswert ca. ${money(size.positionValue, cfg.accountCurrency)} (${size.positionPct.toFixed(1)} % des Kontos)`,
  ].join("\n");
}

/** Wechselkurs Handelswährung → Kontowährung aus EUR/USD; null wenn nicht ableitbar. */
export function fxRate(
  tradeCurrency: string,
  accountCurrency: DeskConfig["accountCurrency"],
  eurusd: number | null
): number | null {
  if (tradeCurrency === accountCurrency) return 1;
  if (!eurusd || eurusd <= 0) return null;
  if (tradeCurrency === "USD" && accountCurrency === "EUR") return 1 / eurusd;
  if (tradeCurrency === "EUR" && accountCurrency === "USD") return eurusd;
  return null;
}

/** n Handelstage (Mo–Fr) nach einem Datum, als YYYY-MM-DD. */
export function addTradingDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}
