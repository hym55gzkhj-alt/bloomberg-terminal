import { inflateRawSync } from "node:zlib";
import { cached } from "./cache";
import { ProviderError } from "./providers/http";

/**
 * Congress-Tracker (aus dem Day-Trader-Skill `trader-pelosi`).
 *
 * Liest den öffentlichen Index des House Clerk (<YEAR>FD.zip mit <YEAR>FD.xml) und listet die
 * Periodic Transaction Reports (PTRs), die Abgeordnete einreichen, wenn sie, ihr Ehepartner
 * oder ein Kind Aktien kaufen oder verkaufen. Jeder PTR verlinkt auf das Original-PDF.
 *
 * Ein PTR ist eine öffentliche Pflichtmeldung (STOCK Act), fällig spätestens 45 Tage nach
 * dem Trade. Er kommt also Tage bis Wochen später, und Beträge sind Spannen, keine Kurse.
 * Das ist keine Insider-Information.
 */

const INDEX_URL = (year: number) =>
  `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${year}FD.zip`;
const PTR_URL = (year: number, doc: string) =>
  `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${year}/${doc}.pdf`;
const FD_URL = (year: number, doc: string) =>
  `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${year}/${doc}.pdf`;

export const FILING_TYPES: Record<string, string> = {
  P: "Periodic Transaction Report",
  O: "Jahresbericht",
  A: "Änderung",
  C: "Kandidatenbericht",
  X: "Fristverlängerung",
  T: "Abschlussbericht",
  W: "Verzicht",
  D: "Erstmeldung",
  H: "Neuer Melder",
};

export interface Filing {
  docId: string;
  type: string;
  typeName: string;
  first: string;
  last: string;
  name: string;
  /** Bundesstaat + Wahlkreis, z. B. CA11 */
  district: string;
  year: number;
  /** YYYY-MM-DD */
  filed: string | null;
  url: string;
}

/** '8/21/2026' -> '2026-08-21' */
export function isoDate(mdy: string): string | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*$/.exec(mdy ?? "");
  if (!m) return null;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** Erste .xml-Datei aus einem ZIP (Deflate oder unkomprimiert), ohne Zusatzbibliothek. */
export function unzipFirstXml(buf: Buffer): Buffer {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) return buf; // schon XML
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP ohne Inhaltsverzeichnis");
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let e = 0; e < entries; e++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("ZIP-Inhaltsverzeichnis beschädigt");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    names.push(name);
    if (name.toLowerCase().endsWith(".xml")) {
      const lNameLen = buf.readUInt16LE(local + 26);
      const lExtraLen = buf.readUInt16LE(local + 28);
      const start = local + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + compSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new Error(`ZIP-Kompression ${method} nicht unterstützt`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`Keine XML-Datei im ZIP (Dateien: ${names.join(", ")})`);
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

/** Alle Meldungen aus <YEAR>FD.xml, neueste zuerst. */
export function parseIndex(xml: string, year: number): Filing[] {
  const out: Filing[] = [];
  const memberRe = /<Member>([\s\S]*?)<\/Member>/g;
  for (let m = memberRe.exec(xml); m; m = memberRe.exec(xml)) {
    const f: Record<string, string> = {};
    const fieldRe = /<(\w+)\s*(?:\/>|>([\s\S]*?)<\/\1>)/g;
    for (let g = fieldRe.exec(m[1]); g; g = fieldRe.exec(m[1])) f[g[1]] = decodeXml(g[2] ?? "");
    const doc = f.DocID ?? "";
    const type = f.FilingType ?? "";
    const y = Number(f.Year) || year;
    out.push({
      docId: doc,
      type,
      typeName: FILING_TYPES[type] ?? type,
      first: f.First ?? "",
      last: f.Last ?? "",
      name: [f.Prefix, f.First, f.Last, f.Suffix].filter(Boolean).join(" "),
      district: f.StateDst ?? "",
      year: y,
      filed: isoDate(f.FilingDate ?? ""),
      url: type === "P" ? PTR_URL(y, doc) : FD_URL(y, doc),
    });
  }
  out.sort((a, b) =>
    (b.filed ?? "") === (a.filed ?? "")
      ? b.docId.localeCompare(a.docId)
      : (b.filed ?? "").localeCompare(a.filed ?? "")
  );
  return out;
}

/** 'pelosi', 'Nancy Pelosi' oder 'Pelosi, Nancy' gegen eine Meldung. */
export function memberMatch(f: Pick<Filing, "first" | "last">, member: string): boolean {
  const q = member.trim().toLowerCase();
  if (!q) return true;
  let last: string;
  let first: string;
  if (q.includes(",")) {
    [last, first] = q.split(",", 2).map((x) => x.trim());
  } else {
    const parts = q.split(/\s+/);
    last = parts[parts.length - 1];
    first = parts.slice(0, -1).join(" ");
  }
  if (f.last.toLowerCase() !== last) return false;
  return !first || f.first.toLowerCase().startsWith(first);
}

export interface CongressPayload {
  year: number;
  filings: Filing[];
  total: number;
  source: string;
  generatedAt: number;
}

async function downloadIndex(year: number): Promise<Filing[]> {
  const url = INDEX_URL(year);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "ai-stock-radar/1.0", Accept: "application/zip" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new ProviderError("House Clerk", `nicht erreichbar (${(err as Error).message})`);
  }
  if (!res.ok) throw new ProviderError("House Clerk", `HTTP ${res.status} für ${url}`, res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  return parseIndex(unzipFirstXml(buf).toString("utf8"), year);
}

/** Nur PTRs (Aktien-Transaktionen), optional nach Abgeordneten gefiltert. */
export async function congressTrades(year: number, member = ""): Promise<CongressPayload> {
  const res = await cached(`congress:ptr:${year}:v1`, 3600, async () =>
    (await downloadIndex(year)).filter((f) => f.type === "P")
  );
  const all = res.data;
  const filings = member ? all.filter((f) => memberMatch(f, member)) : all;
  return {
    year,
    filings,
    total: all.length,
    source: INDEX_URL(year),
    generatedAt: res.fetchedAt,
  };
}
