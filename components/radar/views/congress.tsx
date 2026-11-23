"use client";

import type { CongressPayload } from "@/lib/radar/congress";
import { useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { fmtTime } from "../lib/format";
import { ErrorBox, Loading, Panel } from "../ui";

/** Beobachtete Abgeordnete (nur im Browser gespeichert). */
const membersAtom = atomWithStorage<string[]>("radar.congress.members", ["Pelosi"]);

function useCongress(year: number) {
  return useQuery({
    queryKey: ["radar", "congress", year],
    queryFn: async () => {
      const res = await fetch(`/api/radar/congress?year=${year}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      return body as CongressPayload;
    },
    staleTime: 30 * 60_000,
    refetchInterval: 60 * 60_000,
    retry: 0,
  });
}

function matches(f: { first: string; last: string }, member: string) {
  const q = member.trim().toLowerCase();
  if (!q) return true;
  const [last, first = ""] = q.includes(",")
    ? q.split(",", 2).map((x) => x.trim())
    : [q.split(/\s+/).pop() ?? "", q.split(/\s+/).slice(0, -1).join(" ")];
  return f.last.toLowerCase() === last && (!first || f.first.toLowerCase().startsWith(first));
}

const daysAgo = (iso: string | null) =>
  iso ? Math.floor((Date.now() - new Date(`${iso}T12:00:00Z`).getTime()) / 86_400_000) : null;

export function CongressView() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [members, setMembers] = useAtom(membersAtom);
  const [input, setInput] = useState("");
  const [filter, setFilter] = useState("");
  const [onlyWatched, setOnlyWatched] = useState(false);
  const { data, isLoading, error, refetch } = useCongress(year);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);

  const all = data?.filings ?? [];
  const watched = (f: { first: string; last: string }) => members.some((m) => matches(f, m));
  const q = filter.trim().toLowerCase();
  const rows = all.filter(
    (f) =>
      (!onlyWatched || watched(f)) &&
      (!q ||
        f.name.toLowerCase().includes(q) ||
        f.district.toLowerCase().includes(q) ||
        f.docId.includes(q))
  );
  const recentWatched = all.filter((f) => watched(f) && (daysAgo(f.filed) ?? 999) <= 45);

  return (
    <div className="grid gap-2 xl:grid-cols-[1fr_340px]">
      <Panel
        title={`Congress Trades · Periodic Transaction Reports ${year}`}
        right={
          <span className="flex items-center gap-2">
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="h-5 border border-neutral-700 bg-black px-1 text-amber-200"
            >
              {[0, 1, 2].map((d) => (
                <option key={d} value={thisYear - d}>
                  {thisYear - d}
                </option>
              ))}
            </select>
            {data && <span>Stand {fmtTime(data.generatedAt)}</span>}
          </span>
        }
      >
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Name, Wahlkreis (z. B. CA11) oder DocID filtern…"
            className="h-6 w-72 border border-neutral-700 bg-black px-2 text-amber-200 outline-none placeholder:text-neutral-600 focus:border-amber-500"
          />
          <label className="flex items-center gap-1 text-neutral-300">
            <input
              type="checkbox"
              checked={onlyWatched}
              onChange={(e) => setOnlyWatched(e.target.checked)}
              className="accent-amber-500"
            />
            nur beobachtete
          </label>
          {data && (
            <span className="text-neutral-500">
              {rows.length} von {data.total} PTRs
            </span>
          )}
        </div>
        {isLoading && <Loading label="Lade Index des House Clerk…" />}
        {error && <ErrorBox error={error} onRetry={() => refetch()} />}
        {data && (
          <div className="max-h-[640px] overflow-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-[10px] uppercase text-neutral-500">
                  <th className="px-1 font-normal">Eingereicht</th>
                  <th className="px-1 font-normal">Abgeordnete/r</th>
                  <th className="px-1 font-normal">Wahlkreis</th>
                  <th className="px-1 font-normal">DocID</th>
                  <th className="px-1 font-normal">Bericht</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 500).map((f) => {
                  const w = watched(f);
                  const age = now ? daysAgo(f.filed) : null;
                  return (
                    <tr key={f.docId} className="border-t border-neutral-900 hover:bg-neutral-900">
                      <td className="px-1 py-1 tabular-nums">
                        {f.filed ?? "–"}
                        {age != null && age <= 7 && (
                          <span className="ml-1 text-[9px] font-bold text-amber-400">NEU</span>
                        )}
                      </td>
                      <td className={w ? "px-1 font-bold text-amber-300" : "px-1 text-neutral-200"}>
                        {f.name}
                      </td>
                      <td className="px-1 text-neutral-400">{f.district}</td>
                      <td className="px-1 tabular-nums text-neutral-500">{f.docId}</td>
                      <td className="px-1">
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 text-sky-400 hover:underline"
                        >
                          PDF <ExternalLink className="h-3 w-3" />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length > 500 && (
              <div className="p-2 text-[10px] text-neutral-500">
                Erste 500 von {rows.length} – Filter eingrenzen.
              </div>
            )}
          </div>
        )}
      </Panel>

      <div className="space-y-2">
        <Panel title="Beobachtete Abgeordnete">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const v = input.trim();
              if (v && !members.some((m) => m.toLowerCase() === v.toLowerCase()))
                setMembers([...members, v]);
              setInput("");
            }}
            className="mb-2 flex gap-1"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="z. B. Pelosi oder „Khanna, Ro“"
              className="h-6 flex-1 border border-neutral-700 bg-black px-2 text-[11px] text-amber-200 outline-none placeholder:text-neutral-600 focus:border-amber-500"
            />
            <button
              type="submit"
              className="border border-neutral-700 px-2 text-[11px] hover:border-amber-500"
            >
              +
            </button>
          </form>
          <ul className="space-y-0.5 text-[11px]">
            {members.map((m) => {
              const n = all.filter((f) => matches(f, m)).length;
              return (
                <li key={m} className="flex items-center justify-between">
                  <span className="text-amber-300">{m}</span>
                  <span className="flex items-center gap-2 text-neutral-500">
                    {data ? `${n} PTRs ${year}` : ""}
                    <button
                      type="button"
                      onClick={() => setMembers(members.filter((x) => x !== m))}
                      className="text-neutral-500 hover:text-red-400"
                      aria-label={`${m} entfernen`}
                    >
                      ✕
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          {data && (
            <div className="mt-2 border-t border-neutral-800 pt-1 text-[11px]">
              {recentWatched.length ? (
                <span className="text-amber-200">
                  {recentWatched.length} neue Meldung(en) beobachteter Abgeordneter in den letzten
                  45 Tagen.
                </span>
              ) : (
                <span className="text-neutral-500">
                  Keine Meldungen beobachteter Abgeordneter in den letzten 45 Tagen.
                </span>
              )}
            </div>
          )}
        </Panel>
        <Panel title="Was ein PTR ist – und was nicht">
          <ul className="list-disc space-y-1 pl-4 text-[10px] text-neutral-400">
            <li>
              Öffentliche Pflichtmeldung nach dem STOCK Act, wenn Abgeordnete, ihre Ehepartner oder
              Kinder Wertpapiere handeln.
            </li>
            <li>
              Fällig spätestens 45 Tage nach dem Trade – die Meldung kommt also Tage bis Wochen zu
              spät für einen Day-Trade. Beträge sind Spannen, keine Kurse.
            </li>
            <li>Schnelles Lesen ist keine Insider-Information. Es gibt hier keine.</li>
            <li>
              Nur Repräsentantenhaus. Senats-Meldungen liegen auf efdsearch.senate.gov hinter einer
              Nutzungsvereinbarung.
            </li>
            <li>
              Quelle: Index des House Clerk ({year}FD.zip), stündlich aktualisiert. Die einzelnen
              Transaktionen stehen im verlinkten PDF.
            </li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
