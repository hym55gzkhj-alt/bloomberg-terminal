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

export function ScanProgressBar({ scan }: { scan: ScanResult }) {
  const p = scan.progress;
  if (!p || p.pending === 0) return null;
  const pct = Math.round((p.analyzed / Math.max(1, p.total)) * 100);
  const initial = p.analyzed < p.total;
  return (
    <div className="my-1 border border-amber-800 bg-amber-950/30 p-2 text-[11px] text-amber-200">
      <div className="flex items-center justify-between">
        <span>
          {initial
            ? `Erster Durchlauf: ${p.analyzed} von ${p.total} Aktien analysiert`
            : `Aktualisierung läuft: ${p.pending} von ${p.total} Aktien werden neu berechnet`}
        </span>
        <span className="tabular-nums">{pct} %</span>
      </div>
      <div className="mt-1 h-1.5 bg-neutral-800">
        <div className="h-full bg-amber-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-[10px] text-amber-300/80">
        Mit kostenlosen Datenquellen werden ca. 50 Aktien pro Minute geladen. Die Liste füllt sich
        automatisch, solange die Seite geöffnet ist.
      </div>
    </div>
  );
}
