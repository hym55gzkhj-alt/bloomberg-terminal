#!/usr/bin/env python3
"""
Builds lib/radar/data/universe-large.json from the CURRENT index member lists on
Wikipedia (S&P 500, Nasdaq-100, DAX 40, Euro Stoxx 50) and verifies every symbol
against live Yahoo Finance price data. Nothing is typed in by hand.

Usage:  python3 scripts/build_universe.py [--cache DIR]
  --cache DIR  reuse previously downloaded raw wikitext / html (DIR/<page>.wiki)

Refresh this file every few months (index changes are announced quarterly).
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser

UA_WIKI = "AIStockRadarUniverseBuilder/1.0 (open-source research tool)"
UA_YAHOO = "Mozilla/5.0 (compatible; AIStockRadar/1.0)"
MEDIUM_PER_SECTOR = 4
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "lib", "radar", "data", "universe-large.json")

PAGES = {
    "sp500": "List_of_S%26P_500_companies",
    "ndx": "List_of_NASDAQ-100_companies",
    "dax": "DAX",
    "sx5e": "EURO_STOXX_50",
}

# Sector ETF (SPDR) used as sector-trend proxy. GICS / ICB / Prime-Standard names.
SECTOR_ETF = [
    (r"information technology|^technology|software|semiconductor|telecommunication equipment", "XLK", "Technology"),
    (r"communication|telecommunications|media|internet", "XLC", "Communication Services"),
    (r"consumer discretionary|apparel|automotive|retail|travel|leisure|luxury", "XLY", "Consumer Discretionary"),
    (r"consumer staples|consumer goods|food|beverage|household|personal care", "XLP", "Consumer Staples"),
    (r"energy|oil|gas", "XLE", "Energy"),
    (r"financ|bank|insurance", "XLF", "Financials"),
    (r"health|pharma|medical|biotech", "XLV", "Health Care"),
    (r"industrial|aerospace|defen|transport|logistics|construction|machinery|distribution", "XLI", "Industrials"),
    (r"material|chemical|metal|mining|steel", "XLB", "Materials"),
    (r"real estate", "XLRE", "Real Estate"),
    (r"utilit", "XLU", "Utilities"),
]

SUFFIX = {
    "DE": ("DE", "^GDAXI"),
    "PA": ("FR", "^STOXX50E"),
    "AS": ("NL", "^AEX"),
    "MI": ("IT", "^STOXX50E"),
    "MC": ("ES", "^STOXX50E"),
    "BR": ("BE", "^STOXX50E"),
    "HE": ("FI", "^STOXX50E"),
    "IR": ("IE", "^STOXX50E"),
    "LS": ("PT", "^STOXX50E"),
    "CO": ("DK", "^OMXC25"),
}


def sector_map(text):
    t = (text or "").lower()
    for pat, etf, label in SECTOR_ETF:
        if re.search(pat, t):
            return etf, label
    return "SPY", text or "Unbekannt"


def fetch(url, ua):
    req = urllib.request.Request(url, headers={"User-Agent": ua})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8")


def wiki_raw(page, cache):
    path = os.path.join(cache, f"{page}.wiki") if cache else None
    if path and os.path.exists(path) and os.path.getsize(path) > 5000:
        return open(path, encoding="utf-8").read()
    for attempt in range(6):
        try:
            text = fetch(f"https://en.wikipedia.org/w/index.php?title={page}&action=raw", UA_WIKI)
            if len(text) > 5000:
                if path:
                    open(path, "w", encoding="utf-8").write(text)
                return text
        except Exception as e:  # rate limits etc.
            print(f"  {page}: {e}", file=sys.stderr)
        time.sleep(15 * (attempt + 1))
    raise SystemExit(f"could not download {page}")


def strip_links(s):
    s = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"<ref[^>]*/>|<ref[^>]*>.*?</ref>", "", s)
    s = re.sub(r"\{\{0\}\}", "", s)
    return s.strip()


def wikitable_rows(text, table_id="constituents"):
    i = text.find(f'id="{table_id}"')
    if i < 0:
        raise SystemExit(f"table {table_id} not found")
    body = text[i: text.find("\n|}", i)]
    rows = []
    for chunk in body.split("\n|-")[1:]:
        lines = [l for l in chunk.strip().split("\n") if l.strip()]
        if not lines or lines[0].startswith("!"):
            continue
        cells = []
        for l in lines:
            if l.startswith("|"):
                cells += [c.strip() for c in l.lstrip("|").split("||")]
        rows.append([c for c in cells])
    return rows


def parse_sp500(text):
    out = []
    for r in wikitable_rows(text):
        cells = [c for c in r if c != ""]
        m = re.search(r"\{\{(?:Nyse|Nasdaq|Cboe|Bats)Symbol\|([A-Z.\-]+)", cells[0], re.I)
        if not m:
            continue
        out.append({"ticker": m.group(1).upper(), "name": strip_links(cells[1]), "sector": strip_links(cells[2])})
    return out


def parse_ndx(text):
    out = []
    for r in wikitable_rows(text):
        if len(r) < 4:
            continue
        isin = re.search(r"([A-Z]{2}[A-Z0-9]{9}[0-9])", r[2])
        out.append({
            "ticker": r[0].strip().upper(),
            "name": strip_links(r[1]),
            "isin": isin.group(1) if isin else None,
            "sector": strip_links(r[3]),
        })
    return out


def parse_dax(text):
    out = []
    for r in wikitable_rows(text):
        m = re.search(r"\{\{FWB link\|([A-Z0-9.]+)\}\}", r[0])
        if not m:
            continue
        out.append({"yahoo": m.group(1).upper(), "name": strip_links(r[2]), "sector": strip_links(r[3])})
    return out


class _Tables(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.cell, self.row, self.inside, self.skip = [], None, None, False, 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table" and a.get("id") == "constituents":
            self.inside = True
        elif self.inside and tag == "tr":
            self.row = []
        elif self.inside and tag in ("td", "th"):
            self.cell = ""
        elif tag in ("sup", "style"):
            self.skip += 1

    def handle_endtag(self, tag):
        if tag in ("sup", "style") and self.skip:
            self.skip -= 1
        elif self.inside and tag in ("td", "th") and self.cell is not None:
            self.row.append(" ".join(self.cell.split()))
            self.cell = None
        elif self.inside and tag == "tr" and self.row:
            self.rows.append(self.row)
            self.row = None
        elif tag == "table" and self.inside:
            self.inside = False

    def handle_data(self, d):
        if self.cell is not None and not self.skip:
            self.cell += d


def parse_sx5e_html(html):
    p = _Tables()
    p.feed(html)
    out = []
    for r in p.rows[1:]:
        if len(r) >= 6 and re.match(r"^[A-Z0-9.\-]+\.[A-Z]{2}$", r[0]):
            out.append({"yahoo": r[0], "name": r[2], "sector": r[5]})
    return out


def sx5e(cache):
    path = os.path.join(cache, "EURO_STOXX_50.json") if cache else None
    if path and os.path.exists(path):
        return parse_sx5e_html(json.load(open(path))["parse"]["text"])
    for attempt in range(6):
        try:
            data = json.loads(fetch(
                "https://en.wikipedia.org/w/api.php?action=parse&page=EURO_STOXX_50&prop=text&format=json&formatversion=2",
                UA_WIKI,
            ))
            return parse_sx5e_html(data["parse"]["text"])
        except Exception as e:
            print(f"  EURO_STOXX_50: {e}", file=sys.stderr)
            time.sleep(15 * (attempt + 1))
    raise SystemExit("could not download EURO_STOXX_50")


def isin_ok(isin):
    if not isin or not re.match(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$", isin):
        return False
    digits = "".join(str(int(c, 36)) for c in isin[:-1])
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 0:
            d *= 2
            d = d - 9 if d > 9 else d
        total += d
    return (10 - total % 10) % 10 == int(isin[-1])


def yahoo_check(symbol):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}?range=3mo&interval=1d"
    for attempt in range(3):
        try:
            data = json.loads(fetch(url, UA_YAHOO))
            res = (data.get("chart") or {}).get("result")
            if not res:
                return None
            m = res[0]["meta"]
            if m.get("instrumentType") not in ("EQUITY", None):
                return None
            q = res[0]["indicators"]["quote"][0]
            pairs = [(c, v) for c, v in zip(q.get("close") or [], q.get("volume") or []) if c and v]
            adv = sum(c * v for c, v in pairs) / len(pairs) if pairs else 0
            return {
                "currency": m.get("currency"),
                "exchange": m.get("fullExchangeName") or m.get("exchangeName"),
                "adv": adv,
            }
        except Exception:
            time.sleep(2 * (attempt + 1))
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache")
    args = ap.parse_args()

    sp = parse_sp500(wiki_raw(PAGES["sp500"], args.cache))
    ndx = parse_ndx(wiki_raw(PAGES["ndx"], args.cache))
    dax = parse_dax(wiki_raw(PAGES["dax"], args.cache))
    sx = sx5e(args.cache)
    print(f"parsed: S&P 500 {len(sp)}, Nasdaq-100 {len(ndx)}, DAX {len(dax)}, Euro Stoxx 50 {len(sx)}")

    entries = {}

    def add(key, e, index):
        if key in entries:
            entries[key]["indices"].append(index)
            if not entries[key].get("isin") and e.get("isin"):
                entries[key]["isin"] = e["isin"]
            return
        e["indices"] = [index]
        entries[key] = e

    sp_sector = {x["ticker"]: x["sector"] for x in sp}
    for x in sp:
        etf, label = sector_map(x["sector"])
        add(x["ticker"], {
            "ticker": x["ticker"], "name": x["name"], "yahoo": x["ticker"].replace(".", "-"),
            "finnhub": x["ticker"], "sector": label, "region": "US", "benchmark": "SPY", "sectorEtf": etf,
        }, "S&P 500")
    for x in ndx:
        etf, label = sector_map(sp_sector.get(x["ticker"], x["sector"]))
        add(x["ticker"], {
            "ticker": x["ticker"], "name": x["name"], "yahoo": x["ticker"].replace(".", "-"),
            "finnhub": x["ticker"], "sector": label, "region": "US", "benchmark": "SPY", "sectorEtf": etf,
            "isin": x["isin"] if isin_ok(x["isin"]) else None,
        }, "Nasdaq-100")
    for idx, rows in (("DAX", dax), ("Euro Stoxx 50", sx)):
        for x in rows:
            sym = x["yahoo"]
            suf = sym.rsplit(".", 1)[-1]
            region, bench = SUFFIX.get(suf, ("EU", "^STOXX50E"))
            etf, label = sector_map(x["sector"])
            add(sym, {
                "ticker": sym, "name": x["name"], "yahoo": sym, "finnhub": None,
                "sector": label, "region": region, "benchmark": bench, "sectorEtf": etf,
            }, idx)

    # one share class per company (e.g. GOOGL/GOOG, FOXA/FOX, NWSA/NWS)
    seen_names, unique = set(), []
    for e in entries.values():
        n = re.sub(r"\(class [a-z]\)|class [a-z]|[^a-z0-9]", "", e["name"].lower())
        if n in seen_names:
            continue
        seen_names.add(n)
        unique.append(e)

    print(f"verifying {len(unique)} symbols against Yahoo Finance …")
    with ThreadPoolExecutor(max_workers=4) as ex:
        checks = list(ex.map(lambda e: yahoo_check(e["yahoo"]), unique))
    out, dropped = [], []
    for e, c in zip(unique, checks):
        if not c:
            dropped.append(e["yahoo"])
            continue
        e["currency"] = c["currency"]
        e["exchange"] = c["exchange"]
        e["adv"] = round(c["adv"])
        out.append(e)

    # "medium" universe: all European index members + the 4 most traded US stocks
    # (average daily traded value, last 3 months) of every sector
    per_sector = {}
    for e in out:
        if e["region"] != "US":
            e["medium"] = True
        else:
            per_sector.setdefault(e["sectorEtf"], []).append(e)
    for etf, rows in per_sector.items():
        for e in sorted(rows, key=lambda x: -x["adv"])[:MEDIUM_PER_SECTOR]:
            e["medium"] = True
    out.sort(key=lambda e: e["ticker"])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({
            "generatedAt": time.strftime("%Y-%m-%d"),
            "source": "Wikipedia (S&P 500, Nasdaq-100, DAX, Euro Stoxx 50) – verified against Yahoo Finance",
            "mediumRule": f"all DAX / Euro Stoxx 50 members + the {MEDIUM_PER_SECTOR} most traded US stocks per sector (avg daily traded value, 3 months)",
            "entries": out,
        }, f, ensure_ascii=False, indent=1)
    print(f"wrote {len(out)} entries to {OUT}; dropped (no Yahoo data): {dropped}")


if __name__ == "__main__":
    main()
