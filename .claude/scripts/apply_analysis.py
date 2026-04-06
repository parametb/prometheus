#!/usr/bin/env python3
"""
Prometheus Analysis Auto-Applier
════════════════════════════════════════════════════════════
Reads JSON output from fetch_analyze.py (stdin or --input file)
and applies results to data/[TICKER]/data.json using patch.py —
WITHOUT loading the full data file into LLM context.

Applies automatically:
  ✓ Qualitative note       (patch.py --append-note)
  ✓ Roadmap items          (patch.py --append-roadmap)
  ✓ Quotes                 (patch.py --append-quote)
  ✓ Evolution note (3b)    (patch.py --append-note)

Skips (print summary only — manual curation via patch.py):
  - Financial metrics (custom metrics vary per company)

Token cost to Claude: ~50 tokens (just the shell command to call this)
Compare with: ~5,000-8,000 tokens if Claude reads and applies manually.

Usage:
  # Pipe directly
  python fetch_analyze.py --ticker B ... | python apply_analysis.py B

  # From saved JSON file
  python apply_analysis.py B --input /tmp/analysis.json

  # Preview without writing
  python apply_analysis.py B --input /tmp/analysis.json --dry-run

  # Skip roadmap or quotes if not needed
  python apply_analysis.py B --input /tmp/analysis.json --skip-roadmap --skip-quotes
"""

import argparse, json, subprocess, sys
from pathlib import Path
from datetime import date as today_date

SCRIPT_DIR = Path(__file__).resolve().parent
PATCH_PY   = SCRIPT_DIR / "patch.py"


# ── Utilities ─────────────────────────────────────────────────────────────────

def log(msg: str):
    print(msg, file=sys.stderr, flush=True)


def run_patch(ticker: str, extra_args: list[str], dry_run: bool) -> bool:
    """Call patch.py with given args. Returns True on success."""
    cmd = [sys.executable, str(PATCH_PY), ticker] + extra_args
    if dry_run:
        # Show first 80 chars of the arg
        short = " ".join(extra_args)[:80]
        print(f"    [dry-run] patch.py {ticker} {short}...")
        return True
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.stderr:
        print(result.stderr.strip())
    if result.returncode != 0:
        print(f"    ✗ patch error: {result.stdout.strip()[:100]}")
        return False
    return True


def today() -> str:
    return str(today_date.today())


# ── Appliers ──────────────────────────────────────────────────────────────────

def apply_note(ticker: str, note: dict, fallback_date: str, fallback_source: str, dry_run: bool):
    """Append a note via patch.py."""
    full_note = {
        "date":    note.get("date", fallback_date),
        "title":   note.get("title", f"{fallback_source} Analysis"),
        "tags":    note.get("tags", [fallback_source.lower().replace(" ", "-"), ticker.lower()]),
        "rating":  note.get("rating", 3),
        "content": note.get("content", ""),
    }
    if not full_note["content"].strip():
        print("    ⚠  Note has empty content — skipping")
        return
    run_patch(ticker, ["--append-note", json.dumps(full_note, ensure_ascii=False)], dry_run)


def apply_roadmap(ticker: str, items: list[dict], fallback_date: str, source: str, dry_run: bool):
    """Append roadmap items via patch.py, one by one."""
    added = 0
    for item in items:
        commitment = item.get("commitment", "").strip()
        if not commitment:
            continue
        entry = {
            "date_said":      item.get("date_said") or fallback_date,
            "source":         item.get("source", source),
            "commitment":     commitment,
            "status":         item.get("status", "pending"),
            "follow_up":      item.get("follow_up", ""),
            "follow_up_date": item.get("follow_up_date", ""),
        }
        if run_patch(ticker, ["--append-roadmap", json.dumps(entry, ensure_ascii=False)], dry_run):
            added += 1
    return added


def apply_quotes(ticker: str, quotes: list[dict], fallback_date: str, source: str, dry_run: bool):
    """Append quotes via patch.py, one by one."""
    added = 0
    for q in quotes:
        quote_text = q.get("quote", "").strip()
        if not quote_text:
            continue
        entry = {
            "date":     q.get("date", fallback_date),
            "source":   q.get("source", source),
            "speaker":  q.get("speaker", "Management"),
            "quote":    quote_text,
            "quote_th": q.get("quote_th", ""),
            "tag":      q.get("tag", "strategy"),
        }
        if run_patch(ticker, ["--append-quote", json.dumps(entry, ensure_ascii=False)], dry_run):
            added += 1
    return added


def apply_edgar_financials(ticker: str, fin: dict, dry_run: bool):
    """Auto-apply EDGAR XBRL financials to data.json via patch.py --apply-financials."""
    years   = fin.get("years", [])
    metrics = fin.get("metrics", [])
    source  = fin.get("_source", "EDGAR XBRL")
    n_metrics = len(metrics)

    print(f"\n══ Phase 1: Financials ({source}) ══")
    print(f"  Years: {years}   Metrics: {n_metrics}")

    # Strip internal meta fields before passing to patch.py
    fin_clean = {k: v for k, v in fin.items() if k not in ("_source", "company_name", "cik")}

    if run_patch(ticker, ["--apply-financials", json.dumps(fin_clean, ensure_ascii=False)], dry_run):
        print(f"  ✅ EDGAR financials applied: {n_metrics} metrics × {len(years)} years")
    else:
        print(f"  ⚠  --apply-financials failed — run manually:")
        print(f"     python patch.py {ticker} --apply-financials '<json>'")


def summarize_financials(fin: dict):
    """Print a human-readable summary of AV/legacy financials (manual curation path)."""
    if not fin:
        return
    if fin.get("error"):
        print(f"\n  ── Financials skipped: {fin['error'][:80]} ──")
        return

    # If this came from EDGAR, it's already been auto-applied by apply_edgar_financials()
    # This function is the fallback for Alpha Vantage / legacy sources
    years   = fin.get("years", [])
    metrics = fin.get("metrics", [])
    ovw     = fin.get("overview", {})

    print(f"\n  ── Financials (Alpha Vantage) — NOT auto-applied ──")
    print(f"  Years:   {years}")
    print(f"  Metrics: {[m['name'] for m in metrics]}")
    if ovw.get("market_cap_m"):
        print(f"  Market cap: ${ovw['market_cap_m']:,.0f}M   PE: {ovw.get('pe_ratio','—')}")
    print(f"")
    print(f"  ⤷ To add a new year, run:")
    if years:
        last_year = years[-1]
        sample_vals = {m["name"]: (m["values"][-1] if m["values"] else None) for m in metrics[:4]}
        print(f'    python patch.py {fin.get("ticker","TICKER")} --add-year {last_year} \\')
        print(f"      --values '{json.dumps(sample_vals)}'")
    print(f"  ⤷ To inspect current state:")
    print(f'    python patch.py {fin.get("ticker","TICKER")} --info')


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(
        description="Auto-apply fetch_analyze.py output to Prometheus data.json via patch.py",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("ticker",          help="Company ticker (e.g. B, AAPL, QBTS)")
    p.add_argument("--input", "-i",   default="-",  help="JSON input file path, or '-' for stdin (default)")
    p.add_argument("--dry-run",       action="store_true", help="Preview without writing")
    p.add_argument("--date",          default="",   help="Override date for all items (YYYY-MM-DD)")
    p.add_argument("--skip-note",     action="store_true", help="Skip appending the summary note")
    p.add_argument("--skip-roadmap",  action="store_true", help="Skip appending roadmap items")
    p.add_argument("--skip-quotes",   action="store_true", help="Skip appending quotes")
    args = p.parse_args()

    ticker = args.ticker.upper()

    # ── Read input ─────────────────────────────────────────────────────────────
    if args.input == "-":
        log("Reading JSON from stdin...")
        raw = sys.stdin.read()
    else:
        path = Path(args.input)
        if not path.exists():
            print(f"Error: input file not found: {path}", file=sys.stderr)
            sys.exit(1)
        raw = path.read_text(encoding="utf-8")

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"Error: invalid JSON input: {e}", file=sys.stderr)
        sys.exit(1)

    fallback_date = args.date or data.get("generated_at", today())
    total_applied = 0

    if args.dry_run:
        print(f"[dry-run mode] Would apply to: {ticker}")

    # ── Phase 2: Qualitative Analysis (10-K / Earnings Call) ──────────────────
    qual = data.get("qualitative", {})
    if qual and not qual.get("error"):
        doc_type = data.get("doc_type", "Annual Report")
        print(f"\n══ Phase 2: Qualitative ({doc_type}) ══")

        # Note
        note = qual.get("note")
        if note and not args.skip_note:
            print("  Appending note...")
            apply_note(ticker, note, fallback_date, doc_type, args.dry_run)
            total_applied += 1

        # Roadmap
        roadmap = qual.get("roadmap", [])
        if roadmap and not args.skip_roadmap:
            print(f"  Appending {len(roadmap)} roadmap items...")
            n = apply_roadmap(ticker, roadmap, fallback_date, doc_type, args.dry_run)
            total_applied += n

        # Quotes
        quotes = qual.get("quotes", [])
        if quotes and not args.skip_quotes:
            print(f"  Appending {len(quotes)} quotes...")
            n = apply_quotes(ticker, quotes, fallback_date, doc_type, args.dry_run)
            total_applied += n

    elif qual.get("error"):
        print(f"\n  Phase 2 error: {qual['error']}")

    # ── Phase 1: Financials ────────────────────────────────────────────────────
    fin = data.get("financials", {})
    if fin and not fin.get("error"):
        source = fin.get("_source", "")
        if source and "EDGAR" in source:
            # EDGAR XBRL → auto-apply directly via patch.py --apply-financials
            apply_edgar_financials(ticker, fin, args.dry_run)
            total_applied += 1
        else:
            # Alpha Vantage or unknown source → print summary for manual curation
            summarize_financials(fin)
    elif fin.get("error"):
        print(f"\n  Phase 1 error: {fin['error']}")

    # ── Phase 3: Evolution Analysis (Step 3b) ─────────────────────────────────
    evol = data.get("evolution", {})
    if evol and not evol.get("error"):
        year_old = evol.get("year_old", "?")
        year_new = evol.get("year_new", "?")
        print(f"\n══ Phase 3: Evolution Analysis ({year_old} → {year_new}) ══")

        note = evol.get("note")
        if note and not args.skip_note:
            print("  Appending evolution note...")
            apply_note(ticker, note, fallback_date,
                       f"Evolution {year_old}→{year_new}", args.dry_run)
            total_applied += 1

    elif evol.get("error"):
        print(f"\n  Phase 3 error: {evol['error']}")

    # ── Summary ────────────────────────────────────────────────────────────────
    mode = "[dry-run] Would have applied" if args.dry_run else "Applied"
    print(f"\n✅ {mode} {total_applied} item(s) to {ticker}/data.json")
    if not args.dry_run and total_applied > 0:
        print(f"   Verify with: python patch.py {ticker} --info")


if __name__ == "__main__":
    main()
