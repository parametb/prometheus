#!/usr/bin/env python3
"""
audit_prometheus.py — Prometheus frontend health checker + auto-fixer

Usage:
    python audit_prometheus.py           # report only
    python audit_prometheus.py --fix     # normalize roadmap keys in data.json files
"""

import json
import sys
import pathlib
import argparse

# ── Locate project root (grandparent of this script's .claude/skills/fix-ui/scripts/)
SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[3]   # investment-research/
DATA_DIR  = ROOT / "data"
HTML_FILE = ROOT / "company.html"

ROADMAP_TEXT_KEYS = {"commitment", "milestone", "item", "text"}
PREFERRED_KEY = "commitment"

issues = []
fixes_applied = []

# ─────────────────────────────────────────────────────────────
# 1. Scan data/TICKER/data.json files
# ─────────────────────────────────────────────────────────────
def check_data_files(fix: bool):
    if not DATA_DIR.exists():
        print(f"⚠️  data/ directory not found at {DATA_DIR}")
        return

    tickers = sorted(p.name for p in DATA_DIR.iterdir() if p.is_dir() and (p / "data.json").exists())

    for ticker in tickers:
        path = DATA_DIR / ticker / "data.json"
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            issues.append(f"{ticker}: could not read data.json — {e}")
            continue

        roadmap = data.get("roadmap", [])
        changed = False

        # Check for non-commitment text keys
        bad_key_items = [r for r in roadmap if PREFERRED_KEY not in r and any(k in r for k in ROADMAP_TEXT_KEYS - {PREFERRED_KEY})]
        if bad_key_items:
            alt_keys = set()
            for r in bad_key_items:
                for k in ROADMAP_TEXT_KEYS - {PREFERRED_KEY}:
                    if k in r:
                        alt_keys.add(k)
            issues.append(f"{ticker}: {len(bad_key_items)} roadmap item(s) use key(s) {alt_keys} instead of '{PREFERRED_KEY}'")

            if fix:
                for r in roadmap:
                    if PREFERRED_KEY not in r:
                        for k in ("milestone", "item", "text"):
                            if k in r:
                                r[PREFERRED_KEY] = r.pop(k)
                                changed = True
                                break

        # Check for null date_said (informational — not an error, just flagged for Gantt)
        null_dates = sum(1 for r in roadmap if not r.get("date_said"))
        if null_dates and roadmap:
            pct = round(null_dates / len(roadmap) * 100)
            print(f"  ℹ️  {ticker}: {null_dates}/{len(roadmap)} roadmap items have null date_said ({pct}%) — Gantt will skip these")

        # Check for missing overview (informational)
        if "overview" not in data:
            print(f"  ℹ️  {ticker}: no 'overview' field — Overview tab will use fallback layout")

        if changed:
            path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
            fixes_applied.append(f"{ticker}: normalized roadmap key → '{PREFERRED_KEY}'")
            print(f"  🔧 {ticker}: roadmap keys normalized")


# ─────────────────────────────────────────────────────────────
# 2. Check company.html for expected patterns
# ─────────────────────────────────────────────────────────────
def check_html():
    if not HTML_FILE.exists():
        issues.append(f"company.html not found at {HTML_FILE}")
        return

    html = HTML_FILE.read_text(encoding="utf-8")

    checks = [
        ("rmText() helper present",      "function rmText(r)" in html),
        ("Gantt null-date filter present","withDate = roadmap.filter" in html),
        ("Overview fallback present",     "renderOverviewPanel" in html and "finSummary" in html),
        ("Mermaid escape (),[] present",  r"[:#,\[\]" in html or r'[:#,' in html),
    ]

    for name, ok in checks:
        if ok:
            print(f"  ✅ company.html: {name}")
        else:
            issues.append(f"company.html: MISSING — {name}")
            print(f"  ❌ company.html: {name}")


# ─────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Audit Prometheus frontend health")
    parser.add_argument("--fix", action="store_true", help="Auto-fix roadmap key issues in data.json files")
    args = parser.parse_args()

    print(f"\n{'='*60}")
    print(f"  Prometheus UI Audit {'(+ auto-fix mode)' if args.fix else ''}")
    print(f"  Root: {ROOT}")
    print(f"{'='*60}\n")

    print("── data/*.json ──")
    check_data_files(fix=args.fix)

    print("\n── company.html ──")
    check_html()

    print(f"\n{'='*60}")
    if issues:
        print(f"  ❌  {len(issues)} issue(s) found:\n")
        for iss in issues:
            print(f"    • {iss}")
        if not args.fix:
            print("\n  💡 Run with --fix to auto-normalize roadmap keys")
    else:
        print("  ✅  All checks passed — no issues found.")

    if fixes_applied:
        print(f"\n  🔧 {len(fixes_applied)} fix(es) applied:")
        for f in fixes_applied:
            print(f"    • {f}")

    print(f"{'='*60}\n")
    return 1 if issues else 0


if __name__ == "__main__":
    sys.exit(main())
