"use client";

import { useAtom } from "jotai";
import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useWeightedResults } from "../hooks";
import { watchlistAtom } from "../state";
import { ErrorBox, Loading, Panel, StockTable } from "../ui";
import { useOpenAnalysis } from "./common";

export function WatchlistView() {
  const [list, setList] = useAtom(watchlistAtom);
  const { results, isLoading, error, refetch } = useWeightedResults();
  const open = useOpenAnalysis();
  const [input, setInput] = useState("");
  const inUniverse = useMemo(() => new Set(results.map((r) => r.entry.ticker)), [results]);
  const rows = useMemo(() => results.filter((r) => list.includes(r.entry.ticker)), [results, list]);
  const outside = list.filter((t) => !inUniverse.has(t));

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const t = input.trim().toUpperCase();
    if (t && !list.includes(t)) setList([...list, t]);
    setInput("");
  };
  const remove = (t: string) => setList(list.filter((x) => x !== t));

  return (
    <Panel title="Watchlist" right={<span>lokal im Browser gespeichert</span>}>
      <form onSubmit={add} className="mb-2 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ticker hinzufügen (z. B. AMD)"
          className="h-6 w-56 border border-neutral-700 bg-black px-2 text-[11px] uppercase"
        />
        <button
          type="submit"
          className="h-6 border border-amber-600 px-2 text-[11px] text-amber-300 hover:bg-amber-600 hover:text-black"
        >
          ADD
        </button>
      </form>
      {isLoading && <Loading />}
      {error && <ErrorBox error={error} onRetry={() => refetch()} />}
      {rows.length > 0 && (
        <StockTable
          rows={rows}
          onSelect={open}
          columns={[
            "name",
            "price",
            "change",
            "volume",
            "volRatio",
            "score",
            "category",
            "detected",
            "reason",
          ]}
          rightSlot={(r) => (
            <button
              type="button"
              onClick={() => remove(r.entry.ticker)}
              title="Entfernen"
              className="text-neutral-500 hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        />
      )}
      {outside.length > 0 && (
        <div className="mt-3 text-[11px]">
          <div className="mb-1 text-neutral-500">
            Nicht im Scan-Universum – Einzelanalyse per Klick (nur liquide Titel, keine Penny
            Stocks):
          </div>
          <div className="flex flex-wrap gap-2">
            {outside.map((t) => (
              <span
                key={t}
                className="flex items-center gap-1 border border-neutral-700 px-2 py-0.5"
              >
                <button
                  type="button"
                  className="text-amber-300 hover:underline"
                  onClick={() => open(t)}
                >
                  {t}
                </button>
                <button
                  type="button"
                  onClick={() => remove(t)}
                  className="text-neutral-500 hover:text-red-400"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      {!list.length && <div className="p-3 text-xs text-neutral-500">Watchlist ist leer.</div>}
    </Panel>
  );
}
