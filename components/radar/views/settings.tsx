"use client";

import {
  COMPONENT_LABELS,
  COMPONENT_ORDER,
  DEFAULT_CONFIG,
  DEFAULT_WEIGHTS,
} from "@/lib/radar/config";
import { useAtom } from "jotai";
import { weightsAtom } from "../state";
import { Panel } from "../ui";

const DESCRIPTIONS: Record<string, string> = {
  volume:
    "5-Tage-Volumen vs. 50-Tage-Ø, Akkumulations-/Distributionstage, Auf-/Abwärtsvolumen, OBV-Trend (Proxy für institutionelle Aktivität).",
  relativeStrength:
    "Performance vs. Benchmark über 20/60 Tage, RS-Linie auf 60-Tage-Hoch (vor dem Kurs = Frühindikator).",
  momentum:
    "Trendstruktur (SMA50/200), MACD-Crossover, RSI-Zone, 20/55-Tage-Ausbrüche, Volatilitäts-Squeeze.",
  news: "Tonalität (Finanzlexikon) und Frequenz echter Unternehmensnachrichten der letzten 10 Tage, zeitgewichtet.",
  fundamentals:
    "Umsatz-/EPS-Wachstum, Wachstumsbeschleunigung, operative Marge, Earnings-Überraschungen (Finnhub).",
  analysts:
    "Veränderung der Analystenempfehlungen über 3 Monate (Revisionen) und aktuelles Niveau (Finnhub).",
  marketSector: "Trend des Benchmarks und des Sektor-ETFs, Sektor relativ zum S&P 500.",
};

export function SettingsView() {
  const [w, setW] = useAtom(weightsAtom);
  const total = COMPONENT_ORDER.reduce((a, k) => a + (w[k] ?? 0), 0);
  return (
    <div className="grid gap-2 lg:grid-cols-[1fr_380px]">
      <Panel
        title="Gewichtung der AI Early Signal Engine"
        right={
          <button
            type="button"
            onClick={() => setW(DEFAULT_WEIGHTS)}
            className="border border-neutral-700 px-2 hover:border-amber-500"
          >
            Standard wiederherstellen
          </button>
        }
      >
        <div className="space-y-3">
          {COMPONENT_ORDER.map((k) => (
            <div key={k} className="grid grid-cols-[180px_1fr_60px] items-center gap-3 text-[11px]">
              <div>
                <div className="text-neutral-200">{COMPONENT_LABELS[k]}</div>
                <div className="text-[9px] text-neutral-500">Standard {DEFAULT_WEIGHTS[k]}</div>
              </div>
              <div>
                <input
                  type="range"
                  min={0}
                  max={40}
                  step={1}
                  value={w[k]}
                  onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })}
                  className="w-full"
                />
                <div className="text-[9px] text-neutral-500">{DESCRIPTIONS[k]}</div>
              </div>
              <div className="text-right tabular-nums text-amber-300">
                {w[k]}{" "}
                <span className="text-neutral-500">
                  ({total ? ((w[k] / total) * 100).toFixed(0) : 0} %)
                </span>
              </div>
            </div>
          ))}
          <div className="text-[11px] text-neutral-400">
            Summe: {total} Punkte (wird intern auf 100 % normiert).
          </div>
        </div>
      </Panel>
      <Panel title="So funktioniert der Score">
        <ul className="list-disc space-y-1 pl-4 text-[11px] text-neutral-300">
          <li>
            Jede Komponente liefert 0–100 (50 = neutral) aus echten Daten. Fehlen Daten, wird die
            Komponente ausgelassen und ihr Gewicht umverteilt; die Datenabdeckung wird angezeigt.
          </li>
          <li>
            Gesamtscore = gewichteter Mittelwert − Überdehnungsabzug (max.{" "}
            {DEFAULT_CONFIG.maxExtensionPenalty} Punkte), damit bereits stark gestiegene Kurse nicht
            als Frühsignal gelten.
          </li>
          <li>
            Kategorien: STRONG ≥ {DEFAULT_CONFIG.thresholds.strong} (≥{" "}
            {DEFAULT_CONFIG.minPositive.strong} positive Komponenten), BUILDING ≥{" "}
            {DEFAULT_CONFIG.thresholds.building} (≥ {DEFAULT_CONFIG.minPositive.building}), EARLY ≥{" "}
            {DEFAULT_CONFIG.thresholds.early} (≥ {DEFAULT_CONFIG.minPositive.early}), NEGATIVE &lt;{" "}
            {DEFAULT_CONFIG.thresholds.negative}.
          </li>
          <li>
            Die Gewichtung wird im Browser gespeichert und sofort auf die echten Komponentenwerte
            angewendet. Erkennungszeitpunkte und Backtest basieren auf der Standardgewichtung
            (serverseitig via RADAR_WEIGHTS änderbar).
          </li>
          <li className="text-amber-300">
            Der Score ist ein analytischer Indikator und keine Wahrscheinlichkeit eines
            Kursanstiegs. Keine Anlageberatung.
          </li>
        </ul>
      </Panel>
    </div>
  );
}
