#!/usr/bin/env python3
"""
Prometheus SEC Lookup — powered by sec-api.io
════════════════════════════════════════════════════════
Automatically finds filing URLs, management data, and subsidiaries
from sec-api.io — no manual EDGAR navigation needed.

Usage:

  # Find the main filing URL for a 10-K (US stocks)
  python sec_lookup.py --ticker QBTS --form 10-K

  # Find the MD&A URL in a 40-F (Canadian companies like Barrick)
  python sec_lookup.py --ticker B --form 40-F

  # Specify a year
  python sec_lookup.py --ticker AAPL --form 10-K --year 2023

  # Get executive compensation data (US stocks, DEF 14A filers)
  python sec_lookup.py --ticker QBTS --compensation

  # Get subsidiaries (US stocks with Exhibit 21)
  python sec_lookup.py --ticker AAPL --subsidiaries

  # Get all exhibits for a filing (for debugging)
  python sec_lookup.py --ticker B --form 40-F --list-exhibits

API key via env var:
  export SEC_API_KEY="your_key_here"
Or via --api-key flag.
"""

import argparse, json, os, re, sys, urllib.request, urllib.error
from datetime import datetime

SEC_API_BASE = "https://api.sec-api.io"


# ── Helpers ───────────────────────────────────────────────────────────────────

def log(msg: str):
    print(msg, file=sys.stderr, flush=True)


def api_post(endpoint: str, payload: dict, api_key: str) -> dict:
    url = f"{SEC_API_BASE}{endpoint}?token={api_key}"
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json", "Accept-Encoding": "gzip"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = r.read()
        # Handle gzip
        if r.info().get("Content-Encoding") == "gzip":
            import gzip
            raw = gzip.decompress(raw)
        return json.loads(raw)


def api_get(path: str, api_key: str) -> dict | list:
    url = f"{SEC_API_BASE}{path}?token={api_key}"
    req = urllib.request.Request(
        url, headers={"Accept-Encoding": "gzip"}
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = r.read()
        if r.info().get("Content-Encoding") == "gzip":
            import gzip
            raw = gzip.decompress(raw)
        return json.loads(raw)


def clean_url(url: str) -> str:
    """Strip SEC inline viewer wrapper: ix?doc=/Archives/... → /Archives/..."""
    m = re.search(r"ix\?doc=(.+)", url)
    if m:
        path = m.group(1)
        return f"https://www.sec.gov{path}" if path.startswith("/") else path
    return url


# ── Filing URL Lookup ─────────────────────────────────────────────────────────

def find_filing(ticker: str, form_type: str, year: str, api_key: str) -> dict:
    """
    Find the most relevant filing for a ticker + form type + optional year.
    Returns: {url, period, filed_at, exhibits}
    """
    query = f'ticker:{ticker} AND formType:"{form_type}"'
    if year:
        start = f"{year}-01-01"
        end   = f"{int(year)+1}-03-31"  # allow Q1 of following year for annual filings
        query += f" AND filedAt:[{start} TO {end}]"

    log(f"[SEC] Searching: {query}")
    result = api_post("", {"query": query, "from": "0", "size": "3",
                           "sort": [{"filedAt": {"order": "desc"}}]}, api_key)

    filings = result.get("filings", [])
    if not filings:
        return {"error": f"No {form_type} filing found for {ticker} (year={year or 'latest'})"}

    filing = filings[0]
    period  = filing.get("periodOfReport", "")
    filed   = filing.get("filedAt", "")[:10]
    docs    = filing.get("documentFormatFiles", [])

    log(f"[SEC] Found: {form_type} period={period} filed={filed}  ({len(docs)} docs)")

    # Build exhibit map: type → url
    exhibits = {}
    for doc in docs:
        t   = doc.get("type", "").strip()
        url = doc.get("documentUrl", "")
        if t and url:
            exhibits[t] = clean_url(url)

    # Determine primary URL based on form type
    primary_url = _pick_primary_url(form_type, exhibits, filing)

    return {
        "ticker":    ticker.upper(),
        "form_type": form_type,
        "period":    period,
        "filed_at":  filed,
        "url":       primary_url,
        "exhibits":  exhibits,
    }


def _pick_primary_url(form_type: str, exhibits: dict, filing: dict) -> str:
    """Choose the most useful URL for DeepSeek analysis."""

    if form_type in ("10-K", "10-K/A", "10-Q"):
        # Main 10-K document
        for t in (form_type, "10-K", "10-Q"):
            if t in exhibits:
                return exhibits[t]
        # Fallback to linkToFilingDetails from filing dict
        return clean_url(filing.get("linkToFilingDetails", ""))

    if form_type == "40-F":
        # Canadian companies: EX-99.4 = MD&A in most recent filings
        # Try EX-99.4 first, then EX-99.3, EX-99.2
        for ex in ("EX-99.4", "EX-99.3", "EX-99.2", "EX-99.5"):
            if ex in exhibits and exhibits[ex].endswith(".htm"):
                return exhibits[ex]
        # Fallback to main 40-F document
        if "40-F" in exhibits:
            return clean_url(exhibits["40-F"])
        return clean_url(filing.get("linkToFilingDetails", ""))

    if form_type in ("20-F",):
        # Foreign private issuers
        if "20-F" in exhibits:
            return exhibits["20-F"]
        return clean_url(filing.get("linkToFilingDetails", ""))

    # Generic fallback
    return clean_url(filing.get("linkToFilingDetails", ""))


# ── Management / Compensation ─────────────────────────────────────────────────

def get_compensation(ticker: str, api_key: str) -> list[dict]:
    """
    Pull executive compensation from DEF 14A filings.
    Returns list of {name, position, year, salary, total, ...}
    Only works for US companies that file DEF 14A (not for 40-F filers).
    """
    log(f"[SEC] Fetching compensation for {ticker}...")
    data = api_get(f"/compensation/{ticker}", api_key)
    if isinstance(data, dict) and data.get("error"):
        return [{"error": data["error"]}]
    if not isinstance(data, list):
        return [{"error": f"Unexpected response type: {type(data).__name__}"}]
    return data


def format_compensation_for_prometheus(records: list[dict]) -> list[dict]:
    """Convert compensation records to Prometheus management schema."""
    if not records or records[0].get("error"):
        return []

    # Group by name, take most recent
    by_person: dict[str, dict] = {}
    for r in records:
        name = r.get("name", "").strip()
        year = r.get("year", 0)
        if not name:
            continue
        if name not in by_person or (year or 0) > (by_person[name].get("year") or 0):
            by_person[name] = r

    result = []
    for name, r in sorted(by_person.items(), key=lambda x: x[1].get("total") or 0, reverse=True):
        result.append({
            "name":         name,
            "title":        r.get("position", ""),
            "since":        "",           # not in comp data — fill manually
            "bio":          "",           # fill manually
            "compensation": {
                "year":          r.get("year"),
                "salary":        r.get("salary"),
                "bonus":         r.get("bonus"),
                "stock_awards":  r.get("stockAwards"),
                "option_awards": r.get("optionAwards"),
                "total":         r.get("total"),
            },
        })
    return result


# ── Subsidiaries ──────────────────────────────────────────────────────────────

def get_subsidiaries(ticker: str, api_key: str) -> list[dict]:
    """
    Pull subsidiary list from latest Exhibit 21.
    Returns list of {name, jurisdiction}
    Only works for US companies that file Exhibit 21 (not for 40-F filers).
    """
    log(f"[SEC] Fetching subsidiaries for {ticker}...")
    result = api_post("/subsidiaries", {
        "query": f"ticker:{ticker}",
        "from": 0, "size": 1,
        "sort": [{"filedAt": {"order": "desc"}}]
    }, api_key)

    data = result.get("data", [])
    if not data:
        return [{"error": f"No subsidiary data found for {ticker} (requires Exhibit 21 — US companies only)"}]

    rec  = data[0]
    subs = rec.get("subsidiaries", [])
    log(f"[SEC] Found {len(subs)} subsidiaries (filed {rec.get('filedAt','')[:10]})")
    return subs


def format_subsidiaries_for_prometheus(subs: list[dict]) -> list[dict]:
    """Convert to Prometheus corporate_structure children format."""
    if not subs or subs[0].get("error"):
        return []
    return [
        {
            "name":          s.get("name", ""),
            "ownership_pct": 100,          # Exhibit 21 doesn't include %; assume 100
            "type":          "subsidiary",
            "partner":       None,
            "jurisdiction":  s.get("jurisdiction", ""),
        }
        for s in subs if s.get("name")
    ]


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(
        description="SEC filing URL and data lookup via sec-api.io",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--ticker",       required=True, help="Company ticker (e.g. QBTS, B, AAPL)")
    p.add_argument("--form",         default="10-K", help="Form type: 10-K, 40-F, 10-Q, 20-F (default: 10-K)")
    p.add_argument("--year",         default="",    help="Fiscal year (e.g. 2024). Omit for latest.")
    p.add_argument("--api-key",      default=os.environ.get("SEC_API_KEY", ""),
                   help="sec-api.io API key (or set SEC_API_KEY env var)")
    p.add_argument("--compensation", action="store_true",
                   help="Fetch executive compensation (US DEF 14A filers only)")
    p.add_argument("--subsidiaries", action="store_true",
                   help="Fetch subsidiaries from Exhibit 21 (US 10-K filers only)")
    p.add_argument("--list-exhibits",action="store_true",
                   help="List all exhibits in the filing")
    p.add_argument("--url-only",     action="store_true",
                   help="Output only the filing URL (for use in scripts)")
    p.add_argument("--prometheus-json", action="store_true",
                   help="Output in Prometheus-ready JSON (for patch.py integration)")
    args = p.parse_args()

    if not args.api_key:
        print("Error: SEC_API_KEY not set. Use --api-key or export SEC_API_KEY=...", file=sys.stderr)
        sys.exit(1)

    ticker = args.ticker.upper()

    # ── Compensation ────────────────────────────────────────────────────────────
    if args.compensation:
        records = get_compensation(ticker, args.api_key)
        if args.prometheus_json:
            mgmt = format_compensation_for_prometheus(records)
            print(json.dumps(mgmt, indent=2, ensure_ascii=False))
        else:
            if records and records[0].get("error"):
                print(f"Error: {records[0]['error']}")
                sys.exit(1)
            years = sorted(set(str(r.get("year","")) for r in records), reverse=True)
            print(f"{ticker} Executive Compensation — Years: {years[:3]}")
            print(f"{'Name':<35} {'Position':<40} {'Year'} {'Total':>12}")
            print("─" * 100)
            for r in sorted(records, key=lambda x: (x.get("year",0) or 0, x.get("total",0) or 0), reverse=True)[:15]:
                print(f"{(r.get('name') or ''):<35} {(r.get('position') or ''):<40} "
                      f"{r.get('year','')} ${(r.get('total') or 0):>11,.0f}")
        return

    # ── Subsidiaries ────────────────────────────────────────────────────────────
    if args.subsidiaries:
        subs = get_subsidiaries(ticker, args.api_key)
        if args.prometheus_json:
            children = format_subsidiaries_for_prometheus(subs)
            print(json.dumps({
                "corporate_structure": [{"name": ticker, "children": children}]
            }, indent=2, ensure_ascii=False))
        else:
            if subs and subs[0].get("error"):
                print(f"Error: {subs[0]['error']}")
                sys.exit(1)
            print(f"{ticker} Subsidiaries ({len(subs)} total):")
            from collections import Counter
            countries = Counter(s.get("jurisdiction","?") for s in subs)
            print("Top jurisdictions:", dict(countries.most_common(5)))
            print()
            for s in subs[:30]:
                print(f"  {s.get('name',''):<60} [{s.get('jurisdiction','')}]")
            if len(subs) > 30:
                print(f"  ... and {len(subs)-30} more")
        return

    # ── Filing URL Lookup ───────────────────────────────────────────────────────
    result = find_filing(ticker, args.form, args.year, args.api_key)

    if result.get("error"):
        print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(1)

    if args.url_only:
        print(result["url"])
        return

    if args.list_exhibits:
        print(f"\n{ticker} {args.form} | period={result['period']} filed={result['filed_at']}")
        print("─" * 80)
        for t, url in sorted(result["exhibits"].items()):
            print(f"  [{t:<12}] {url}")
        return

    if args.prometheus_json:
        print(json.dumps({
            "ticker":    result["ticker"],
            "form_type": result["form_type"],
            "period":    result["period"],
            "filed_at":  result["filed_at"],
            "url":       result["url"],
        }, indent=2))
        return

    # Default: human-readable
    print(f"\n{'═'*65}")
    print(f"  {ticker} — {args.form} | period: {result['period']} | filed: {result['filed_at']}")
    print(f"{'─'*65}")
    print(f"  URL: {result['url']}")
    print(f"\n  Use this URL with fetch_analyze.py:")
    print(f"  python fetch_analyze.py --ticker {ticker} --url \"{result['url']}\" \\")
    print(f"    --doc-type \"{args.form}\" --ds-key $DEEPSEEK_API_KEY")
    print(f"{'═'*65}\n")


if __name__ == "__main__":
    main()
