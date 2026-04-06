#!/usr/bin/env python3
"""
Prometheus JSON Patcher
════════════════════════════════════════════════════════
Apply surgical updates to data/[TICKER]/data.json WITHOUT
loading the full file into LLM context.

Usage examples:

  # Append a note
  python patch.py B --append-note '{"date":"2026-03-29","title":"Q1 2026","tags":["earnings"],"rating":4,"content":"..."}'

  # Append a roadmap item
  python patch.py B --append-roadmap '{"date_said":"2026-03-29","source":"Q1 2026 Earnings","commitment":"...","status":"pending","follow_up":"","follow_up_date":""}'

  # Append a quote
  python patch.py B --append-quote '{"date":"2026-03-29","source":"Q1 2026","speaker":"CEO","quote":"...","quote_th":"...","tag":"strategy"}'

  # Extend financials by one year (provide ALL metrics in order matching current metrics array)
  python patch.py QBTS --add-year 2026 --values '{"Revenue":28.5,"Gross Profit":24.1,"Operating Income":-90.2}'

  # Update roadmap item status (matches by commitment prefix substring)
  python patch.py B --update-roadmap "Reko Diq" --status delivered --follow-up "Construction started Q2 2026" --follow-up-date 2026-06-30

  # Set any field (dot-notation path)
  python patch.py B --set "last_updated=2026-03-29"
  python patch.py B --set "overview.employees=~19000"
  python patch.py B --set "financials.notes=Updated note text"

  # Show current summary (no mutations — just prints key info)
  python patch.py B --info

  # Extract roadmap as JSON (for track-delivery or DeepSeek analysis)
  python patch.py B --extract-roadmap              # all items
  python patch.py B --extract-roadmap pending      # pending only
  python patch.py B --extract-roadmap monitoring

  # Extract recent notes as JSON (for context without full file load)
  python patch.py B --extract-notes               # last 5 notes
  python patch.py B --extract-notes 3             # last 3 notes
"""

import argparse
import json
import os
import sys
from datetime import date
from pathlib import Path

# ── Locate data file ──────────────────────────────────────────────────────────

def find_data_file(ticker: str) -> Path:
    """Find data.json for ticker, searching from script location upward."""
    # Script lives at investment-research/.claude/scripts/patch.py
    # Data lives at investment-research/data/[TICKER]/data.json
    script_dir = Path(__file__).resolve().parent          # .claude/scripts
    invest_dir = script_dir.parent.parent                  # investment-research
    candidate = invest_dir / "data" / ticker.upper() / "data.json"
    if candidate.exists():
        return candidate
    # Also allow running from investment-research directory directly
    alt = Path.cwd() / "data" / ticker.upper() / "data.json"
    if alt.exists():
        return alt
    raise FileNotFoundError(f"Cannot find data.json for ticker '{ticker}'. Tried:\n  {candidate}\n  {alt}")


def load(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save(path: Path, data: dict):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"✅ Saved → {path}", file=sys.stderr)


# ── Operations ────────────────────────────────────────────────────────────────

def op_append_note(data: dict, note_json: str) -> dict:
    note = json.loads(note_json)
    data.setdefault("notes", []).append(note)
    data["last_updated"] = str(date.today())
    print(f"  + Note appended: '{note.get('title','(no title)')}'")
    return data


def op_append_roadmap(data: dict, item_json: str) -> dict:
    item = json.loads(item_json)
    data.setdefault("roadmap", []).append(item)
    data["last_updated"] = str(date.today())
    print(f"  + Roadmap item appended: '{item.get('commitment','')[:60]}'")
    return data


def op_append_quote(data: dict, quote_json: str) -> dict:
    quote = json.loads(quote_json)
    data.setdefault("quotes", []).append(quote)
    data["last_updated"] = str(date.today())
    print(f"  + Quote appended from '{quote.get('speaker','')}'")
    return data


def op_add_year(data: dict, year: int, values_json: str) -> dict:
    """
    Extend financials.years by one year and append values to each metric.
    values_json: dict mapping metric name → value (null for missing).
    Metrics NOT in values_json will get null appended.
    """
    fin = data.get("financials", {})
    years = fin.get("years", [])
    if year in years:
        print(f"⚠️  Year {year} already exists in financials.years — skipping add-year")
        return data

    vals = json.loads(values_json)
    years.append(year)
    fin["years"] = years

    metrics = fin.get("metrics", [])
    for m in metrics:
        v = vals.get(m["name"], None)
        m["values"].append(v)
        status = "✓" if v is not None else "— (null)"
        print(f"  + {m['name']}: {status}")

    data["financials"] = fin
    data["last_updated"] = str(date.today())
    print(f"  + Year {year} added. Total years: {years}")
    return data


def op_update_roadmap(data: dict, match: str, status: str,
                      follow_up: str, follow_up_date: str) -> dict:
    """Update roadmap item whose commitment contains `match` (case-insensitive)."""
    roadmap = data.get("roadmap", [])
    matched = []
    for item in roadmap:
        if match.lower() in item.get("commitment", "").lower():
            matched.append(item)

    if not matched:
        print(f"⚠️  No roadmap item found matching '{match}'")
        print("  Available commitments:")
        for r in roadmap:
            print(f"    • {r['commitment'][:80]}")
        return data

    if len(matched) > 1:
        print(f"⚠️  Multiple items match '{match}' — updating all {len(matched)}:")
        for m in matched:
            print(f"    • {m['commitment'][:80]}")

    for item in matched:
        item["status"] = status
        if follow_up:
            item["follow_up"] = follow_up
        if follow_up_date:
            item["follow_up_date"] = follow_up_date
        print(f"  ✓ Updated: {item['commitment'][:60]} → {status}")

    data["last_updated"] = str(date.today())
    return data


def op_set_field(data: dict, assignment: str) -> dict:
    """
    Set a field using dot-notation path.
    Example: 'overview.employees=~19000'  or  'last_updated=2026-01-01'
    """
    if "=" not in assignment:
        raise ValueError(f"--set requires 'path=value' format, got: '{assignment}'")
    path, _, raw_value = assignment.partition("=")
    keys = path.strip().split(".")

    # Try to parse value as JSON; fall back to string
    try:
        value = json.loads(raw_value)
    except json.JSONDecodeError:
        value = raw_value  # treat as plain string

    # Navigate to parent and set
    obj = data
    for k in keys[:-1]:
        if k not in obj:
            obj[k] = {}
        obj = obj[k]
    old = obj.get(keys[-1], "<not set>")
    obj[keys[-1]] = value
    print(f"  ✓ Set {path}: '{str(old)[:40]}' → '{str(value)[:60]}'")
    data["last_updated"] = str(date.today())
    return data


def op_info(data: dict):
    """Print a concise summary without modifying anything."""
    fin = data.get("financials", {})
    years = fin.get("years", [])
    metrics = fin.get("metrics", [])
    notes = data.get("notes", [])
    quotes = data.get("quotes", [])
    roadmap = data.get("roadmap", [])

    print(f"\n{'═'*55}")
    print(f"  {data.get('ticker')} — {data.get('name')}")
    print(f"  Last updated: {data.get('last_updated')}")
    print(f"{'─'*55}")
    print(f"  Financials : {len(years)} years {years}")
    print(f"  Metrics    : {len(metrics)} → {[m['name'] for m in metrics]}")
    print(f"  Notes      : {len(notes)}")
    print(f"  Quotes     : {len(quotes)}")
    print(f"  Roadmap    : {len(roadmap)} items")
    pending = [r for r in roadmap if r.get("status") == "pending"]
    monitoring = [r for r in roadmap if r.get("status") == "monitoring"]
    delivered = [r for r in roadmap if r.get("status") == "delivered"]
    print(f"    pending={len(pending)}  monitoring={len(monitoring)}  delivered={len(delivered)}")
    print(f"{'═'*55}\n")


def op_extract_roadmap(data: dict, status_filter: str = ""):
    """
    Print roadmap as compact JSON — for use by track-delivery without reading full file.
    status_filter: if given, only return items matching that status (e.g. 'pending').
    """
    roadmap = data.get("roadmap", [])
    if status_filter:
        roadmap = [r for r in roadmap if r.get("status", "") == status_filter]
    # Output compact JSON to stdout — can be piped to DeepSeek or processed by script
    print(json.dumps({
        "ticker":       data.get("ticker"),
        "name":         data.get("name"),
        "last_updated": data.get("last_updated"),
        "roadmap":      roadmap,
    }, ensure_ascii=False, indent=2))


def op_extract_notes(data: dict, n: int = 5):
    """Print the N most recent notes as compact JSON — for context without full file load."""
    notes = data.get("notes", [])
    recent = notes[-n:] if len(notes) > n else notes
    print(json.dumps({
        "ticker":   data.get("ticker"),
        "notes":    recent,
        "total":    len(notes),
    }, ensure_ascii=False, indent=2))


def op_apply_financials(data: dict, fin_json: str) -> dict:
    """
    Merge EDGAR/XBRL financials into data.financials.
    Updates: years, metrics, currency, unit
    Preserves: links, breakdown, notes (manually curated fields)
    Usage: patch.py TICKER --apply-financials '{"years":[...],"metrics":[...]}'
    """
    fin = json.loads(fin_json) if isinstance(fin_json, str) else fin_json
    existing = data.setdefault("financials", {})
    existing["currency"] = fin.get("currency", existing.get("currency", "USD"))
    existing["unit"]     = fin.get("unit",     existing.get("unit",     "Million"))
    existing["years"]    = fin["years"]
    existing["metrics"]  = fin["metrics"]
    # Preserve manually-curated fields if not present
    existing.setdefault("links",     [])
    existing.setdefault("breakdown", {"sankey": None})
    existing.setdefault("notes",     "")
    # Remove internal EDGAR meta fields
    existing.pop("_source", None)
    existing.pop("company_name", None)
    existing.pop("cik", None)
    n_metrics = len(fin.get("metrics", []))
    n_years   = len(fin.get("years",   []))
    print(f"  ✓ Applied EDGAR financials: {n_metrics} metrics × {n_years} years", file=sys.stderr)
    return data


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(
        description="Prometheus JSON Patcher — surgical updates to data.json files",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("ticker", help="Company ticker (e.g. B, AAPL, QBTS)")

    p.add_argument("--append-note",     metavar="JSON", help="Append a note object")
    p.add_argument("--append-roadmap",  metavar="JSON", help="Append a roadmap item")
    p.add_argument("--append-quote",    metavar="JSON", help="Append a quote")
    p.add_argument("--add-year",        metavar="YEAR", type=int, help="Add a new year to financials")
    p.add_argument("--values",          metavar="JSON", help='Metric values for --add-year: {"Revenue":16.96,...}')
    p.add_argument("--update-roadmap",  metavar="MATCH", help="Substring to match roadmap commitment")
    p.add_argument("--status",          metavar="STATUS", help="New status for --update-roadmap")
    p.add_argument("--follow-up",       metavar="TEXT",   default="", help="Follow-up text for --update-roadmap")
    p.add_argument("--follow-up-date",  metavar="DATE",   default="", help="Follow-up date for --update-roadmap")
    p.add_argument("--set",             metavar="PATH=VAL", action="append", dest="sets",
                   help="Set field by dot-notation path (can repeat)")
    p.add_argument("--info",            action="store_true", help="Print summary (no mutations)")
    p.add_argument("--extract-roadmap", metavar="STATUS",    nargs="?", const="",
                   help="Print roadmap as JSON. Optionally filter by status: pending|monitoring|delivered")
    p.add_argument("--extract-notes",     metavar="N",    nargs="?", const="5", type=int,
                   help="Print N most recent notes as JSON (default: 5)")
    p.add_argument("--apply-financials", metavar="JSON",
                   help="Merge EDGAR financials JSON into financials.years+metrics (preserves links/notes/breakdown)")
    p.add_argument("--dry-run",          action="store_true", help="Show what would change, don't save")

    args = p.parse_args()

    path = find_data_file(args.ticker)
    print(f"📂 {path}", file=sys.stderr)
    data = load(path)

    mutated = False

    if args.info:
        op_info(data)
        return

    if args.extract_roadmap is not None:
        op_extract_roadmap(data, status_filter=args.extract_roadmap)
        return

    if args.extract_notes is not None:
        op_extract_notes(data, n=int(args.extract_notes) if args.extract_notes else 5)
        return

    if args.apply_financials:
        data = op_apply_financials(data, args.apply_financials)
        mutated = True

    if args.append_note:
        data = op_append_note(data, args.append_note)
        mutated = True

    if args.append_roadmap:
        data = op_append_roadmap(data, args.append_roadmap)
        mutated = True

    if args.append_quote:
        data = op_append_quote(data, args.append_quote)
        mutated = True

    if args.add_year is not None:
        if not args.values:
            p.error("--add-year requires --values '{\"MetricName\": value, ...}'")
        data = op_add_year(data, args.add_year, args.values)
        mutated = True

    if args.update_roadmap:
        if not args.status:
            p.error("--update-roadmap requires --status")
        data = op_update_roadmap(data, args.update_roadmap, args.status,
                                 args.follow_up, args.follow_up_date)
        mutated = True

    if args.sets:
        for assignment in args.sets:
            data = op_set_field(data, assignment)
        mutated = True

    if not mutated:
        print("ℹ️  No operations specified. Use --info to inspect or run --help.")
        return

    if args.dry_run:
        print("\n[dry-run] Would save:")
        print(json.dumps(data, ensure_ascii=False, indent=2)[:2000] + "…")
    else:
        save(path, data)


if __name__ == "__main__":
    main()
