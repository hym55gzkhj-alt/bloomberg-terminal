"use client";

import type { ScanResult } from "@/lib/radar/types";
import { useSetAtom } from "jotai";
import { useCallback } from "react";
import { fmtTime } from "../lib/format";
import { selectedTickerAtom, viewAtom } from "../state";

export function useOpenAnalysis() {
  const setTicker = useSetAtom(selectedTickerAtom);
  const setView = useSetAtom(viewAtom);
  return useCallback(
    (t: string) => {
      setTicker(t);
      setView("analysis");
    },
    [setTicker, setView]
  );
}

export function ScanMeta({ scan }: { scan: ScanResult }) {
  const delayed = scan.results.filter((r) => r.quote.freshness === "delayed").length;
  return (
    <div className="space-y-1 text-[10px] text-neutral-500">
      <div>
        Scan {fmtTime(scan.generatedAt)} · {scan.results.length} Titel analysiert · Cache:{" "}
        {scan.cache}
        {delayed > 0 && (
          <span className="text-amber-400">
            {" "}
            · {delayed} Kurse verzögert (Yahoo Finance, i.d.R. 15–20 Min.)
          </span>
        )}
      </div>
      {scan.results.some((r) => r.warnings.some((w) => w.includes("nachgeladen"))) && (
        <div className="text-amber-400">
          Analysten- und Firmendaten von Finnhub werden im Hintergrund nachgeladen (kostenloses
          Limit: 60 Abfragen/Minute). Die Ansicht aktualisiert sich automatisch in etwa einer
          Minute.
        </div>
      )}
      {scan.errors.length > 0 && (
        <div className="text-red-400">
          Fehler (Titel ausgelassen, keine Ersatzdaten):{" "}
          {scan.errors.map((e) => `${e.ticker}: ${e.message}`).join(" | ")}
        </div>
      )}
    </div>
  );
}
