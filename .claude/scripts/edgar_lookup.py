#!/usr/bin/env python3
"""
edgar_lookup.py — SEC EDGAR free data fetcher for Prometheus
Uses data.sec.gov APIs (ฟรี, ไม่ต้องใช้ API key)

Endpoints used:
  - https://www.sec.gov/files/company_tickers.json   → CIK lookup by ticker
  - https://data.sec.gov/submissions/CIK{cik}.json   → filing history + URLs
  - https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json → XBRL financial data

Usage:
  python edgar_lookup.py --ticker QBTS --financials
  python edgar_lookup.py --ticker QBTS --financials --years 2020-2025
  python edgar_lookup.py --ticker B    --financials --years 2020-2025
  python edgar_lookup.py --ticker QBTS --filing-url 10-K --year 2024
  python edgar_lookup.py --ticker B    --filing-url 40-F --year 2024
  python edgar_lookup.py --ticker QBTS --cik-only
  python edgar_lookup.py --ticker QBTS --available-concepts    # ดูว่ามี XBRL concept อะไรบ้าง

Rate limit: 10 req/sec (SEC policy) — script ใส่ delay อัตโนมัติ
"""

import argparse
import json
import time
import sys
import urllib.request
from datetime import datetime, timedelta

# ── Constants ─────────────────────────────────────────────────────────────────
BASE_DATA   = "https://data.sec.gov"
BASE_SEC    = "https://www.sec.gov"
USER_AGENT  = "Prometheus Investment Research paramet@me.com"

# Metric concept mappings: (label, us-gaap concept, ifrs-full concept, unit, scale)
# scale=1 → keep raw value, scale=1e6 → divide by 1M
METRIC_DEFS = [
    ("Revenue",          "Revenues",                         "Revenue",                              "USD",        1e6),
    ("Revenue (alt)",    "RevenueFromContractWithCustomerExcludingAssessedTax", None,                "USD",        1e6),
    ("Gross Profit",     "GrossProfit",                      "GrossProfit",                          "USD",        1e6),
    ("Operating Income", "OperatingIncomeLoss",              "OperatingProfit",                      "USD",        1e6),
    ("Net Income",       "NetIncomeLoss",                    "ProfitLoss",                           "USD",        1e6),
    ("Net Income (parent)", "NetIncomeLossAvailableToCommonStockholdersBasic", "ProfitLossAttributableToOwnersOfParent", "USD", 1e6),
    ("EBITDA",           "EarningsBeforeInterestTaxesDepreciationAndAmortization", None,             "USD",        1e6),
    ("R&D Expense",      "ResearchAndDevelopmentExpense",    "ResearchAndDevelopmentExpense",        "USD",        1e6),
    ("EPS (diluted)",    "EarningsPerShareDiluted",          "DilutedEarningsLossPerShareFromContinuingOperations", "USD/shares", 1),
    ("EPS (basic)",      "EarningsPerShareBasic",            "BasicEarningsLossPerShare",            "USD/shares", 1),
    ("Op. Cash Flow",    "NetCashProvidedByUsedInOperatingActivities", "CashFlowsFromUsedInOperatingActivities", "USD", 1e6),
    ("CapEx",            "PaymentsToAcquirePropertyPlantAndEquipment", "PurchaseOfPropertyPlantAndEquipment", "USD", 1e6),
    ("Total Debt",       "LongTermDebtAndCapitalLeaseObligation", "NoncurrentBorrowings",            "USD",        1e6),
    ("Total Debt (alt)", "LongTermDebt",                     None,                                  "USD",        1e6),
    ("Cash & Equiv.",    "CashAndCashEquivalentsAtCarryingValue", "CashAndCashEquivalents",          "USD",        1e6),
    ("Cash (alt)",       "CashCashEquivalentsAndShortTermInvestments", None,                         "USD",        1e6),
    ("Total Assets",     "Assets",                           "Assets",                               "USD",        1e6),
    ("Total Equity",     "StockholdersEquity",               "Equity",                               "USD",        1e6),
]

# Preferred metric display names (deduplicate alt concepts)
PRIMARY_METRICS = {
    "Revenue",
    "Gross Profit",
    "Operating Income",
    "Net Income",
    "EPS (diluted)",
    "EBITDA",
    "R&D Expense",
    "Op. Cash Flow",
    "CapEx",
    "Total Debt",
    "Cash & Equiv.",
    "Total Assets",
    "Total Equity",
}

# ── HTTP helper ────────────────────────────────────────────────────────────────
_last_request_time = 0.0

def api_get(url, retries=3, rate_limit=True):
    """GET request with User-Agent, rate limiting, and retry."""
    global _last_request_time
    if rate_limit:
        elapsed = time.time() - _last_request_time
        if elapsed < 0.15:  # ~7 req/sec, under the 10 req/sec limit
            time.sleep(0.15 - elapsed)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(retries):
        try:
            _last_request_time = time.time()
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if attempt < retries - 1:
                wait = 2 ** attempt
                print(f"  Retry {attempt+1}/{retries} in {wait}s... ({e})", file=sys.stderr)
                time.sleep(wait)
            else:
                raise RuntimeError(f"Failed to fetch {url}: {e}") from e

# ── CIK lookup ─────────────────────────────────────────────────────────────────
_tickers_cache = None

def get_cik(ticker):
    """Look up CIK and company name from SEC's ticker list."""
    global _tickers_cache
    if _tickers_cache is None:
        print("Fetching SEC ticker list...", file=sys.stderr)
        _tickers_cache = api_get(f"{BASE_SEC}/files/company_tickers.json")
    ticker_upper = ticker.upper()
    for entry in _tickers_cache.values():
        if entry["ticker"].upper() == ticker_upper:
            return str(entry["cik_str"]).zfill(10), entry["title"]
    raise ValueError(f"Ticker '{ticker}' not found in SEC EDGAR. "
                     f"Note: Canadian 40-F filers use their US listing ticker (e.g. GOLD for Barrick).")

# ── XBRL data extraction ───────────────────────────────────────────────────────
def get_companyfacts(cik):
    """Fetch all XBRL company facts (large JSON ~2-10MB)."""
    return api_get(f"{BASE_DATA}/api/xbrl/companyfacts/CIK{cik}.json")

def extract_annual(concept_data_list, years):
    """
    Extract annual (FY) values for given fiscal years.
    Returns dict: {year: value_or_None}
    Prefers fp=="FY", falls back to period-length heuristic.
    """
    year_values = {}
    # Pass 1: fp == "FY" (most reliable)
    for item in concept_data_list:
        if item.get("fp") != "FY":
            continue
        fy = item.get("fy")
        if fy not in years:
            continue
        filed = item.get("filed", "")
        if fy not in year_values or filed > year_values[fy]["filed"]:
            year_values[fy] = item
    # Pass 2: fallback — period > 300 days (for filers without fp field)
    if not year_values:
        for item in concept_data_list:
            start = item.get("start", "")
            end   = item.get("end", "")
            if not start or not end:
                continue
            try:
                days = (datetime.strptime(end, "%Y-%m-%d") -
                        datetime.strptime(start, "%Y-%m-%d")).days
            except ValueError:
                continue
            if days < 300:
                continue
            fy = int(end[:4])
            if fy not in years:
                continue
            filed = item.get("filed", "")
            if fy not in year_values or filed > year_values[fy]["filed"]:
                year_values[fy] = item
    return year_values

def get_concept_values(facts, taxonomy, concept, years, unit, scale):
    """Extract annual values for one concept. Returns {year: rounded_val_or_None}."""
    try:
        concept_units = facts[taxonomy][concept]["units"][unit]
    except (KeyError, TypeError):
        return None
    year_values = extract_annual(concept_units, years)
    if not year_values:
        return None
    result = {}
    for y in years:
        if y in year_values:
            raw = year_values[y]["val"]
            result[y] = round(raw / scale, 2) if scale != 1 else round(raw, 2)
        else:
            result[y] = None
    return result

# ── FCF calculation ────────────────────────────────────────────────────────────
def calc_fcf(facts, taxonomy, years, scale=1e6):
    """Calculate Free Cash Flow = Operating CF - CapEx."""
    ocf_concept  = "NetCashProvidedByUsedInOperatingActivities"
    capex_concept = "PaymentsToAcquirePropertyPlantAndEquipment"
    if taxonomy == "ifrs-full":
        ocf_concept  = "CashFlowsFromUsedInOperatingActivities"
        capex_concept = "PurchaseOfPropertyPlantAndEquipment"
    ocf   = get_concept_values(facts, taxonomy, ocf_concept, years, "USD", scale)
    capex = get_concept_values(facts, taxonomy, capex_concept, years, "USD", scale)
    if not ocf:
        return None
    result = {}
    for y in years:
        o = ocf.get(y)
        c = capex.get(y) if capex else None
        if o is None:
            result[y] = None
        elif c is None:
            result[y] = o  # only OCF if CapEx unavailable
        else:
            result[y] = round(o - c, 2)
    return result

# ── Build Prometheus financials ────────────────────────────────────────────────
def build_financials(cik, years):
    """Build Prometheus-compatible financials dict from XBRL data."""
    print("Fetching XBRL company facts...", file=sys.stderr)
    data = get_companyfacts(cik)
    facts = data.get("facts", {})

    us_gaap = facts.get("us-gaap", {})
    ifrs    = facts.get("ifrs-full", {})

    # Determine taxonomy
    taxonomy = "ifrs-full" if len(ifrs) > len(us_gaap) else "us-gaap"
    print(f"  Taxonomy: {taxonomy} ({len(us_gaap)} US-GAAP | {len(ifrs)} IFRS concepts)", file=sys.stderr)

    metrics = []
    found_names = set()

    # Try each metric definition
    for label, gaap_concept, ifrs_concept, unit, scale in METRIC_DEFS:
        # Skip alt concepts if primary already found
        base_label = label.replace(" (alt)", "").replace(" (parent)", "")
        if label not in PRIMARY_METRICS and base_label in found_names:
            continue

        concept = gaap_concept if taxonomy == "us-gaap" else ifrs_concept
        if concept is None:
            continue
        if concept not in facts.get(taxonomy, {}):
            # Try the other taxonomy as fallback
            other = "ifrs-full" if taxonomy == "us-gaap" else "us-gaap"
            alt   = ifrs_concept if taxonomy == "us-gaap" else gaap_concept
            if alt and alt in facts.get(other, {}):
                concept  = alt
                tax_used = other
            else:
                continue
        else:
            tax_used = taxonomy

        vals = get_concept_values(facts, tax_used, concept, years, unit, scale)
        if vals is None or all(v is None for v in vals.values()):
            continue

        # Use canonical label (strip alt/parent suffixes)
        display = base_label
        if display in found_names:
            continue

        metrics.append({"name": display, "values": [vals.get(y) for y in years]})
        found_names.add(display)

    # Free Cash Flow (calculated)
    if "Free Cash Flow" not in found_names:
        fcf = calc_fcf(facts, taxonomy, years)
        if fcf and not all(v is None for v in fcf.values()):
            metrics.append({"name": "Free Cash Flow", "values": [fcf.get(y) for y in years]})

    # Sort in Prometheus display order
    order = ["Revenue", "Gross Profit", "Operating Income", "Net Income",
             "EBITDA", "EPS (diluted)", "EPS (basic)",
             "R&D Expense", "Op. Cash Flow", "Free Cash Flow", "CapEx",
             "Total Debt", "Cash & Equiv.", "Total Assets", "Total Equity"]
    metrics.sort(key=lambda m: order.index(m["name"]) if m["name"] in order else 999)

    print(f"  Found {len(metrics)} metrics: {[m['name'] for m in metrics]}", file=sys.stderr)

    return {
        "currency": "USD",
        "unit":     "Million",
        "years":    list(years),
        "metrics":  metrics,
        "breakdown": {"sankey": None},
        "_source":  f"SEC EDGAR XBRL ({taxonomy}) — data.sec.gov",
    }

# ── Filing URL lookup ──────────────────────────────────────────────────────────
def get_filing_url(cik, form_type, year):
    """Find filing URL from submissions API."""
    print(f"Fetching submissions for CIK {cik}...", file=sys.stderr)
    subs = api_get(f"{BASE_DATA}/submissions/CIK{cik}.json")

    recent = subs.get("filings", {}).get("recent", {})
    forms      = recent.get("form",          [])
    dates      = recent.get("filingDate",    [])
    accessions = recent.get("accessionNumber", [])
    docs       = recent.get("primaryDocument", [])

    cik_int = int(cik)
    candidates = []

    for i, form in enumerate(forms):
        if form.upper() != form_type.upper():
            continue
        filing_year = int(dates[i][:4])
        # 10-K for FY2024 is filed in early 2025
        if filing_year in (year, year + 1):
            accn = accessions[i]
            accn_nodash = accn.replace("-", "")
            primary_doc = docs[i] if docs else ""
            base_url = f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{accn_nodash}"
            candidates.append({
                "url":          f"{base_url}/{primary_doc}" if primary_doc else f"{base_url}/{accn}-index.htm",
                "index_url":    f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{accn_nodash}/{accn}-index.htm",
                "accession":    accn,
                "filed":        dates[i],
                "primary_doc":  primary_doc,
            })

    if not candidates:
        # Try older filings (if submissions > 40 may be in separate files)
        files_data = subs.get("filings", {}).get("files", [])
        if files_data:
            print("  Checking older filings...", file=sys.stderr)
            for f in files_data[:3]:
                older = api_get(f"{BASE_DATA}/submissions/{f['name']}")
                for i, form in enumerate(older.get("form", [])):
                    if form.upper() != form_type.upper():
                        continue
                    filing_year = int(older["filingDate"][i][:4])
                    if filing_year in (year, year + 1):
                        accn = older["accessionNumber"][i]
                        accn_nodash = accn.replace("-", "")
                        primary_doc = older.get("primaryDocument", [""])[i]
                        base_url = f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{accn_nodash}"
                        candidates.append({
                            "url":       f"{base_url}/{primary_doc}" if primary_doc else f"{base_url}/{accn}-index.htm",
                            "index_url": f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{accn_nodash}/{accn}-index.htm",
                            "accession": accn,
                            "filed":     older["filingDate"][i],
                        })

    return candidates[0] if candidates else None

# ── List available concepts ────────────────────────────────────────────────────
def list_available_concepts(cik):
    """Print all XBRL concepts available for this company."""
    data = get_companyfacts(cik)
    facts = data.get("facts", {})
    for taxonomy, concepts in facts.items():
        print(f"\n── {taxonomy} ({len(concepts)} concepts) ──")
        for concept in sorted(concepts.keys()):
            units = list(facts[taxonomy][concept].get("units", {}).keys())
            print(f"  {concept}: {units}")

# ── CLI ────────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="SEC EDGAR free data fetcher for Prometheus (data.sec.gov)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--ticker",    required=True, help="Stock ticker (e.g. QBTS, B, AAPL)")
    parser.add_argument("--years",     default="2020-2025",
                        help="Year range: '2020-2025' or comma-list '2021,2022,2023'")
    parser.add_argument("--financials", action="store_true",
                        help="Output Prometheus-compatible financials JSON")
    parser.add_argument("--filing-url", metavar="FORM",
                        help="Find URL for filing type (10-K, 40-F, 20-F)")
    parser.add_argument("--year",      type=int,
                        help="Fiscal year for --filing-url (default: current year - 1)")
    parser.add_argument("--cik-only",  action="store_true",
                        help="Print CIK and exit")
    parser.add_argument("--available-concepts", action="store_true",
                        help="List all XBRL concepts available for this ticker")
    args = parser.parse_args()

    # Parse year range
    ystr = args.years.strip()
    if "-" in ystr and "," not in ystr:
        parts = ystr.split("-")
        years = list(range(int(parts[0]), int(parts[1]) + 1))
    else:
        years = [int(y.strip()) for y in ystr.split(",")]

    # CIK lookup
    print(f"Looking up {args.ticker.upper()} in SEC EDGAR...", file=sys.stderr)
    cik, company_name = get_cik(args.ticker)
    print(f"  ✓ CIK: {cik}  Name: {company_name}", file=sys.stderr)

    if args.cik_only:
        print(cik)
        return

    if args.available_concepts:
        list_available_concepts(cik)
        return

    if args.financials:
        fin = build_financials(cik, years)
        print(json.dumps(fin, indent=2, ensure_ascii=False))

    if args.filing_url:
        fy = args.year or (datetime.now().year - 1)
        result = get_filing_url(cik, args.filing_url, fy)
        if result:
            print(f"\n{'─'*60}", file=sys.stderr)
            print(f"  Form:    {args.filing_url}", file=sys.stderr)
            print(f"  FY:      {fy}", file=sys.stderr)
            print(f"  Filed:   {result['filed']}", file=sys.stderr)
            print(f"  URL:     {result['url']}", file=sys.stderr)
            print(json.dumps(result, indent=2, ensure_ascii=False))
        else:
            print(f"✗ No {args.filing_url} found for FY{fy}", file=sys.stderr)
            sys.exit(1)

if __name__ == "__main__":
    main()
