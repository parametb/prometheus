#!/usr/bin/env python3
"""
validate_patch.py — Prometheus Self-Healing Patch Validator
Validates a patch against the current data.json before apply_patch.py merges it.

Usage (standalone):
  python scripts/validate_patch.py NEM patch.json
  python scripts/validate_patch.py NEM patch.json --no-heal

Called programmatically:
  from validate_patch import validate_and_heal
  healed_patch, issues = validate_and_heal(patch, data)

Issue levels:
  error   — patch will be blocked (fatal semantic problem)
  warn    — patch proceeds but operator is notified
  healed  — issue was auto-corrected; healed value applied

Checks implemented:
  UNIT_SCALE_ERROR       — metric values look like Millions in a Billion-unit company
  SIGN_CONFLICT_EPS_NI   — EPS and Net Income have opposite signs
  FCF_EXCEEDS_OCF        — Free Cash Flow > Operating Cash Flow (per year)
  YEAR_OUT_OF_RANGE      — financial year < 2000 or > current_year + 1
  DUPLICATE_NOTE         — note title already exists in data.json
  DUPLICATE_QUOTE        — quote text similarity > 85% with existing quote
  DATE_FORMAT_INVALID    — date / date_said field is not ISO YYYY-MM-DD
  URL_MALFORMED          — filing link does not start with https://
  REVENUE_SPIKE_3X       — revenue jumps > 3× YoY without acquisition note
  MISSING_REQUIRED_FIELD — required field absent from appended item
"""

import json, os, re, sys, copy
from datetime import datetime

# ── helpers ────────────────────────────────────────────────────────────────────

def _issue(level: str, code: str, msg: str, op_index: int = -1) -> dict:
    return {"level": level, "code": code, "msg": msg, "op_index": op_index}


def _word_overlap(a: str, b: str) -> float:
    """Jaccard similarity on word sets (case-insensitive)."""
    wa = set(re.findall(r"\w+", a.lower()))
    wb = set(re.findall(r"\w+", b.lower()))
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


def _metric_values(ops: list, name_fragment: str) -> list:
    """Extract values list for a metric whose name contains name_fragment."""
    for op in ops:
        if op.get("op") == "set" and op.get("path") == "financials.metrics":
            for m in op.get("value", []):
                if name_fragment.lower() in m.get("name", "").lower():
                    return m.get("values", [])
    return []


def _years_from_ops(ops: list) -> list:
    for op in ops:
        if op.get("op") == "set" and op.get("path") == "financials.years":
            return op.get("value", [])
    return []


def _existing_notes(data: dict) -> list:
    return data.get("notes", [])


def _existing_quotes(data: dict) -> list:
    return data.get("quotes", [])


def _has_acquisition_note(data: dict) -> bool:
    """True if any existing note mentions 'acquisition' or 'merger'."""
    for n in data.get("notes", []):
        if re.search(r"acqui|merger|takeover", n.get("content", ""), re.I):
            return True
    return False


# ── individual checks ──────────────────────────────────────────────────────────

def check_unit_scale(ops: list, data: dict, heal: bool) -> tuple[list, list]:
    """UNIT_SCALE_ERROR — metric values look like Millions in a Billion-unit company."""
    issues = []
    healed_ops = []

    unit = data.get("financials", {}).get("unit", "Billion")
    if unit != "Billion":
        return issues, ops  # only applies to Billion-unit companies

    for i, op in enumerate(ops):
        if op.get("op") == "set" and op.get("path") == "financials.metrics":
            metrics = copy.deepcopy(op.get("value", []))
            triggered = False
            for m in metrics:
                vals = m.get("values", [])
                # Revenue > 500 in a Billion-unit company is suspicious (e.g. 22,100 vs 22.1)
                if m.get("name", "").lower() in ("revenue", "gross profit") and \
                        any(abs(v) > 500 for v in vals if v is not None):
                    triggered = True
                    if heal:
                        m["values"] = [round(v / 1000, 3) if v is not None else None for v in vals]
                        issues.append(_issue("healed", "UNIT_SCALE_ERROR",
                            f"Metric '{m['name']}' values look like Millions — auto-divided by 1000. "
                            f"Before: {vals} → After: {m['values']}", i))
                    else:
                        issues.append(_issue("error", "UNIT_SCALE_ERROR",
                            f"Metric '{m['name']}' values {vals} look like Millions in a Billion-unit company. "
                            f"Divide by 1000 or change financials.unit.", i))
            if triggered and heal:
                op = copy.deepcopy(op)
                op["value"] = metrics
        healed_ops.append(op)

    return issues, healed_ops


def check_sign_conflict(ops: list, data: dict, heal: bool) -> tuple[list, list]:
    """SIGN_CONFLICT_EPS_NI — EPS and Net Income have opposite signs."""
    issues = []
    healed_ops = copy.deepcopy(ops)

    ni_vals  = _metric_values(ops, "net income")
    eps_vals = _metric_values(ops, "eps")

    if not ni_vals or not eps_vals:
        return issues, healed_ops

    conflicts = []
    for idx, (ni, eps) in enumerate(zip(ni_vals, eps_vals)):
        if ni is None or eps is None:
            continue
        if (ni > 0) != (eps > 0) and ni != 0 and eps != 0:
            conflicts.append(idx)

    if not conflicts:
        return issues, healed_ops

    years = _years_from_ops(ops) or list(range(len(ni_vals)))

    for idx in conflicts:
        yr = years[idx] if idx < len(years) else f"index {idx}"
        if heal:
            # Trust NI sign; flip EPS sign
            for op in healed_ops:
                if op.get("op") == "set" and op.get("path") == "financials.metrics":
                    for m in op["value"]:
                        if "eps" in m.get("name", "").lower() and idx < len(m.get("values", [])):
                            old = m["values"][idx]
                            m["values"][idx] = -old
                            issues.append(_issue("healed", "SIGN_CONFLICT_EPS_NI",
                                f"Year {yr}: NI={ni_vals[idx]} and EPS={eps_vals[idx]} had opposite signs. "
                                f"EPS auto-flipped: {old} → {m['values'][idx]}", -1))
        else:
            issues.append(_issue("error", "SIGN_CONFLICT_EPS_NI",
                f"Year {yr}: Net Income={ni_vals[idx]} and EPS={eps_vals[idx]} have opposite signs.", -1))

    return issues, healed_ops


def check_fcf_vs_ocf(ops: list, data: dict, heal: bool) -> tuple[list, list]:
    """FCF_EXCEEDS_OCF — Free Cash Flow > Operating Cash Flow (warn only)."""
    issues = []

    fcf_vals = _metric_values(ops, "free cash flow")
    ocf_vals = _metric_values(ops, "operating")
    years    = _years_from_ops(ops)

    if not fcf_vals or not ocf_vals:
        return issues, ops

    for idx, (fcf, ocf) in enumerate(zip(fcf_vals, ocf_vals)):
        if fcf is None or ocf is None:
            continue
        if fcf > ocf and ocf > 0:
            yr = years[idx] if idx < len(years) else f"index {idx}"
            issues.append(_issue("warn", "FCF_EXCEEDS_OCF",
                f"Year {yr}: FCF={fcf} > OCF={ocf}. "
                f"Only valid if divestiture proceeds are included in OCF.", idx))

    return issues, ops


def check_year_range(ops: list, data: dict, heal: bool) -> tuple[list, list]:
    """YEAR_OUT_OF_RANGE — financial year outside [2000, current_year + 1]."""
    issues = []
    current_year = datetime.now().year

    for i, op in enumerate(ops):
        if op.get("op") == "set" and op.get("path") == "financials.years":
            for yr in op.get("value", []):
                if not isinstance(yr, int):
                    issues.append(_issue("error", "YEAR_OUT_OF_RANGE",
                        f"Year value '{yr}' is not an integer.", i))
                elif yr < 2000:
                    issues.append(_issue("error", "YEAR_OUT_OF_RANGE",
                        f"Year {yr} is before 2000 — likely a data error.", i))
                elif yr > current_year + 1:
                    issues.append(_issue("warn", "YEAR_OUT_OF_RANGE",
                        f"Year {yr} is beyond {current_year + 1} — future forecast? "
                        f"Mark as estimate if intentional.", i))

    return issues, ops


def check_duplicate_note(ops: list, data: dict, heal: bool) -> tuple[list, list]:
    """DUPLICATE_NOTE — note title already exists in data.json."""
    issues = []
    existing_titles = {n.get("title", "").strip().lower() for n in _existing_notes(data)}

    for i, op in enumerate(ops):
        if op.get("op") == "append" and op.get("path") == "notes":
            title = op.get("value", {}).get("title", "").strip().lower()
            if title and title in existing_titles:
                issues.append(_issue("warn", "DUPLICATE_NOTE",
                    f"Note with title '{op['value']['title']}' already exists in data.json. "
                    f"Use --force to append anyway.", i))

    return issues, ops


def check_duplicate_quote(ops: list, data: dict, heal: bool) -> tuple[list, list]:
    """DUPLICATE_QUOTE — quote text similarity > 85% with an existing quote."""
    issues = []
    existing_quotes = [q.get("quote", "") for q in _existing_quotes(data)]

    for i, op in enumerate(ops):
        if op.get("op") == "append" and op.get("path") == "quotes":
            new_q = op.get("value", {}).get("quote", "")
            if not new_q:
                continue
            for eq in existing_quotes:
                sim = _word_overlap(new_q, eq)
                if sim > 0.85:
                    issues.append(_issue("warn", "DUPLICATE_QUOTE",
                        f"New quote has {sim:.0%} similarity with existing quote: "
                        f'"{eq[:80]}..."', i))
                    break  # one warning per new quote is enough

    return issues, ops


def check_date_format(ops: list, data: dict, heal: bool) -> tuple[list, list]:
    """DATE_FORMAT_INVALID — date / date_said is not ISO YYYY-MM-DD."""
    issues = []
    healed_ops = copy.deepcopy(ops)
    ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
    DATE_FMTS = ["%B %Y", "%b %Y", "%Y/%m/%d", "%d/%m/%Y", "%m/%d/%Y",
                 "%B %d, %Y", "%b %d, %Y", "%Y%m%d"]

    def try_heal(raw: str) -> str | None:
        for fmt in DATE_FMTS:
            try:
                return datetime.strptime(raw.strip(), fmt).strftime("%Y-%m-%d")
            except ValueError:
                pass
        # Try year-only
        m = re.search(r"\b(20\d{2})\b", raw)
        if m:
            return f"{m.group(1)}-01-01"
        return None

    for i, op in enumerate(healed_ops):
        val = op.get("value")
        if not isinstance(val, dict):
            continue
        for field in ("date", "date_said"):
            raw = val.get(field)
            if raw is None or raw == "":
                continue
            if not ISO_RE.match(str(raw)):
                fixed = try_heal(str(raw)) if heal else None
                if fixed:
                    op["value"][field] = fixed
                    issues.append(_issue("healed", "DATE_FORMAT_INVALID",
                        f"op[{i}] field '{field}': '{raw}' → '{fixed}'", i))
                else:
                    issues.append(_issue("warn", "DATE_FORMAT_INVALID",
                        f"op[{i}] field '{field}': '{raw}' is not YYYY-MM-DD and could not be auto-parsed.", i))

    return issues, healed_ops


def check_url_format(ops: list, data: dict, heal: bool) -> tuple[list, list]:
    """URL_MALFORMED — filing link does not start with https://."""
    issues = []

    for i, op in enumerate(ops):
        # Check financials.links array
        if op.get("op") == "set" and op.get("path") == "financials.links":
            for link in op.get("value", []):
                url = link.get("url", "")
                if url and not url.startswith("https://"):
                    issues.append(_issue("warn", "URL_MALFORMED",
                        f"Filing link '{link.get('label', url)}' does not start with https://", i))
        # Check individual append with url field
        if op.get("op") == "append":
            url = op.get("value", {}).get("url", "")
            if url and not url.startswith("https://"):
                issues.append(_issue("warn", "URL_MALFORMED",
                    f"URL '{url}' does not start with https://", i))

    return issues, ops


def check_revenue_spike(ops: list, data: dict, heal: bool) -> tuple[list, list]:
    """REVENUE_SPIKE_3X — revenue jumps > 3× YoY without acquisition note."""
    issues = []

    rev_vals = _metric_values(ops, "revenue")
    years    = _years_from_ops(ops)

    if len(rev_vals) < 2:
        return issues, ops

    # Also pull existing revenue to check cross-patch continuity
    existing_rev = []
    existing_years = data.get("financials", {}).get("years", [])
    for m in data.get("financials", {}).get("metrics", []):
        if "revenue" in m.get("name", "").lower():
            existing_rev = m.get("values", [])
            break

    has_acquisition = _has_acquisition_note(data)

    all_years = existing_years + (years or list(range(len(rev_vals))))
    all_revs  = existing_rev + rev_vals

    for idx in range(1, len(all_revs)):
        prev = all_revs[idx - 1]
        curr = all_revs[idx]
        if prev is None or curr is None or prev == 0:
            continue
        ratio = abs(curr / prev)
        if ratio > 3.0 and not has_acquisition:
            yr = all_years[idx] if idx < len(all_years) else f"index {idx}"
            issues.append(_issue("warn", "REVENUE_SPIKE_3X",
                f"Year {yr}: Revenue jumped {ratio:.1f}× YoY ({prev}B → {curr}B). "
                f"If this reflects an acquisition, add a note with 'acquisition' in the content.", idx))

    return issues, ops


def check_missing_required_fields(ops: list, data: dict, heal: bool) -> tuple[list, list]:
    """MISSING_REQUIRED_FIELD — required fields absent from appended items."""
    issues = []

    REQUIRED = {
        "notes":   ["title", "content", "rating"],
        "quotes":  ["speaker", "quote"],
        "roadmap": ["commitment", "status"],
    }

    for i, op in enumerate(ops):
        if op.get("op") != "append":
            continue
        path = op.get("path", "")
        reqs = REQUIRED.get(path)
        if not reqs:
            continue
        val = op.get("value", {})
        missing = [f for f in reqs if not val.get(f)]
        if missing:
            issues.append(_issue("warn", "MISSING_REQUIRED_FIELD",
                f"Appending to '{path}' — missing required fields: {missing}", i))

    return issues, ops


# ── orchestrator ───────────────────────────────────────────────────────────────

CHECKS = [
    check_unit_scale,
    check_sign_conflict,
    check_fcf_vs_ocf,
    check_year_range,
    check_duplicate_note,
    check_duplicate_quote,
    check_date_format,
    check_url_format,
    check_revenue_spike,
    check_missing_required_fields,
]


def validate_and_heal(patch: dict, data: dict, heal: bool = True) -> tuple[dict, list]:
    """
    Run all checks on `patch` against current `data`.
    Returns (healed_patch, issues).
    healed_patch == patch if no healing occurred.
    """
    ops = copy.deepcopy(patch.get("operations", []))
    all_issues = []

    for check_fn in CHECKS:
        new_issues, ops = check_fn(ops, data, heal)
        all_issues.extend(new_issues)

    healed_patch = copy.deepcopy(patch)
    healed_patch["operations"] = ops
    return healed_patch, all_issues


# ── CLI ────────────────────────────────────────────────────────────────────────

def _base_dir() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_data(ticker: str) -> dict:
    path = os.path.join(_base_dir(), "data", ticker.upper(), "data.json")
    if not os.path.exists(path):
        print(f"❌  ไม่พบ: {path}")
        sys.exit(1)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main():
    import argparse
    p = argparse.ArgumentParser(description="Prometheus Self-Healing Patch Validator")
    p.add_argument("ticker",     help="Ticker symbol")
    p.add_argument("patch_file", help="Path to patch JSON")
    p.add_argument("--no-heal",  action="store_true", help="Disable auto-healing (report errors only)")
    args = p.parse_args()

    with open(args.patch_file, encoding="utf-8") as f:
        patch = json.load(f)

    data = _load_data(args.ticker)
    healed_patch, issues = validate_and_heal(patch, data, heal=not args.no_heal)

    errors  = [i for i in issues if i["level"] == "error"]
    warns   = [i for i in issues if i["level"] == "warn"]
    healed  = [i for i in issues if i["level"] == "healed"]

    print(f"\n🔍  Validating patch for {args.ticker.upper()}")
    print(f"    {len(patch.get('operations', []))} operations  |  "
          f"{len(errors)} errors  {len(warns)} warnings  {len(healed)} healed\n")

    for iss in issues:
        icon = {"error": "❌ ", "warn": "⚠️  ", "healed": "🔧 "}[iss["level"]]
        op_tag = f"op[{iss['op_index']}] " if iss["op_index"] >= 0 else ""
        print(f"  {icon} [{iss['code']}] {op_tag}{iss['msg']}")

    if not issues:
        print("  ✅  All checks passed — patch is clean")

    if errors:
        print(f"\n  ❌  Patch blocked ({len(errors)} error(s)). Fix the issues above before applying.")
        sys.exit(2)

    if healed:
        out_path = args.patch_file.replace(".json", "_healed.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(healed_patch, f, indent=2, ensure_ascii=False)
        print(f"\n  🔧  Healed patch written → {out_path}")
        print(f"      Apply with: python scripts/apply_patch.py {args.ticker.upper()} {out_path}")
    elif not errors:
        print(f"\n  ✅  Patch is valid — safe to apply.")


if __name__ == "__main__":
    main()
