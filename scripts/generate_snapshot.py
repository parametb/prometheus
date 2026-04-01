#!/usr/bin/env python3
"""
generate_snapshot.py — Prometheus Snapshot Generator
สร้าง snapshot.json ขนาดเล็กจาก data/[TICKER]/data.json

snapshot.json ใช้เป็น quick-context สำหรับ Claude / agent
แทนที่จะโหลด full data.json (~8,000 tokens) → โหลด snapshot (~400 tokens) ก่อน
ค่อยโหลด full file เฉพาะเมื่อต้องการรายละเอียด

Usage:
  python scripts/generate_snapshot.py BRBY          # single ticker
  python scripts/generate_snapshot.py --all         # all companies
  python scripts/generate_snapshot.py               # all companies (default)
"""

import argparse, json, os, re, glob, sys
from datetime import datetime

BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")


def _latest_values(metrics: list, years: list) -> dict:
    """Extract most recent non-null value for each metric."""
    result = {}
    for m in metrics:
        vals = m.get("values", [])
        name = m.get("name", "")
        # Walk backwards to find latest non-null
        for i in range(len(vals) - 1, -1, -1):
            if vals[i] is not None:
                result[name] = {"value": vals[i], "year": years[i] if i < len(years) else None}
                break
    return result


def _gross_margin(latest: dict) -> float | None:
    rev = latest.get("Revenue", {}).get("value")
    gp  = latest.get("Gross Profit", {}).get("value")
    if rev and gp and rev > 0:
        return round(gp / rev * 100, 1)
    return None


def _extract_risks(content: str) -> list[str]:
    """Pull first 3 risk items from [Key Risks] section in note content."""
    m = re.search(r'\[Key Risks\]\s*(.*?)(?:\[|$)', content, re.DOTALL)
    if not m:
        return []
    block = m.group(1).strip()
    # Split by sentence or newline, take first 3 meaningful lines
    lines = [l.strip().lstrip('•-').strip() for l in block.split('\n') if l.strip()]
    sentences = []
    for line in lines:
        for s in re.split(r'\.\s+', line):
            s = s.strip().rstrip('.')
            if len(s) > 15:
                sentences.append(s)
    return sentences[:3]


def _extract_tone(content: str) -> str | None:
    m = re.search(r'\[Management Tone\]\s*(.+)', content)
    if m:
        tone_line = m.group(1).strip().lower()
        for t in ("bullish", "cautious", "mixed", "defensive", "confident"):
            if t in tone_line:
                return t
    return None


def _one_liner(content: str, max_chars: int = 180) -> str:
    """Extract a one-liner from [Financial Performance] or first paragraph."""
    for section in ("[Financial Performance]", "[Outlook]", "[Investment Implications]"):
        m = re.search(re.escape(section) + r'\s*(.+?)(?:\n\n|\[|$)', content, re.DOTALL)
        if m:
            text = m.group(1).strip()
            # Take first sentence
            first = re.split(r'(?<=[.!?])\s+', text)[0]
            if len(first) > 20:
                return first[:max_chars]
    # Fallback: first non-empty line
    for line in content.split('\n'):
        if len(line.strip()) > 20:
            return line.strip()[:max_chars]
    return ""


def generate_snapshot(ticker: str) -> dict:
    """Build snapshot dict from data.json for one ticker."""
    path = os.path.join(BASE, ticker, "data.json")
    if not os.path.exists(path):
        raise FileNotFoundError(f"data/{ticker}/data.json not found")

    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    fin    = data.get("financials", {})
    years  = fin.get("years", [])
    latest = _latest_values(fin.get("metrics", []), years)

    # ── Latest year ──────────────────────────────────────────────────────────
    latest_year = max(years) if years else None

    # ── Financial snapshot ───────────────────────────────────────────────────
    unit     = fin.get("unit", "Billion")   # "Billion" or "Million"
    currency = fin.get("currency", "USD")
    # Normalise everything to Billions for display (so snapshots are comparable)
    to_B     = 1.0 if unit == "Billion" else 0.001

    fin_snap = {"unit": "Billion", "currency": currency}
    for key, metric_name in [
        ("revenue_B",     "Revenue"),
        ("net_income_B",  "Net Income"),
        ("fcf_B",         "Free Cash Flow"),
        ("op_income_B",   "Operating Income"),
        ("eps",           "EPS (diluted)"),
        ("cash_B",        "Cash"),
        ("total_debt_B",  "Total Debt"),
    ]:
        v = latest.get(metric_name, {})
        if v:
            raw = v["value"]
            # EPS stays as-is (per-share, not aggregate)
            if key == "eps":
                fin_snap[key] = raw
            else:
                fin_snap[key] = round(raw * to_B, 3)

    gm = _gross_margin(latest)
    if gm is not None:
        fin_snap["gross_margin_pct"] = gm

    # ── Roadmap counts ───────────────────────────────────────────────────────
    roadmap = data.get("roadmap", [])
    rm_pending   = sum(1 for r in roadmap if r.get("status") == "pending")
    rm_progress  = sum(1 for r in roadmap if r.get("status") == "in_progress")
    rm_delivered = sum(1 for r in roadmap if r.get("status") == "delivered")

    # ── Latest note ──────────────────────────────────────────────────────────
    notes = data.get("notes", [])
    latest_note = {}
    if notes:
        n = sorted(notes, key=lambda x: x.get("date", ""), reverse=True)[0]
        content = n.get("content", "")
        latest_note = {
            "date":     n.get("date"),
            "title":    n.get("title"),
            "title_th": n.get("title_th", ""),
            "rating":   n.get("rating"),
            "summary":  content[:200].replace('\n', ' ').strip() + ("…" if len(content) > 200 else ""),
        }

    # ── Risks + tone from latest note ────────────────────────────────────────
    top_risks    = []
    mgmt_tone    = None
    one_liner_str = ""
    if notes:
        latest_content = sorted(notes, key=lambda x: x.get("date", ""), reverse=True)[0].get("content", "")
        top_risks     = _extract_risks(latest_content)
        mgmt_tone     = _extract_tone(latest_content)
        one_liner_str = _one_liner(latest_content)

    # ── Assemble ─────────────────────────────────────────────────────────────
    snapshot = {
        "ticker":       data.get("ticker"),
        "name":         data.get("name"),
        "name_th":      data.get("name_th", ""),
        "sector":       data.get("sector"),
        "exchange":     data.get("exchange"),
        "currency":     fin.get("currency", "USD"),
        "last_updated": data.get("last_updated"),
        "generated_at": datetime.now().strftime("%Y-%m-%d"),

        "latest_year":  latest_year,
        "financials":   fin_snap,

        "counts": {
            "notes":             len(notes),
            "quotes":            len(data.get("quotes", [])),
            "roadmap_total":     len(roadmap),
            "roadmap_pending":   rm_pending,
            "roadmap_progress":  rm_progress,
            "roadmap_delivered": rm_delivered,
        },

        "latest_note":    latest_note,
        "top_risks":      top_risks,
        "management_tone": mgmt_tone,
        "one_liner":      one_liner_str,
    }

    return snapshot


def save_snapshot(ticker: str, snapshot: dict):
    out = os.path.join(BASE, ticker, "snapshot.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, indent=2, ensure_ascii=False)
    return out


def main():
    p = argparse.ArgumentParser(description="Generate Prometheus snapshot.json files")
    p.add_argument("ticker", nargs="?", help="Ticker symbol (omit for --all)")
    p.add_argument("--all", action="store_true", help="Generate for all companies")
    args = p.parse_args()

    if args.ticker and not args.all:
        tickers = [args.ticker.upper()]
    else:
        # All companies
        folders = glob.glob(os.path.join(BASE, "*/data.json"))
        tickers = sorted(os.path.basename(os.path.dirname(p)) for p in folders)

    ok = 0
    for ticker in tickers:
        try:
            snap = generate_snapshot(ticker)
            path = save_snapshot(ticker, snap)
            rev  = snap["financials"].get("revenue_B")
            ni   = snap["financials"].get("net_income_B")
            rev_str = f"Rev={rev}B" if rev is not None else "Rev=—"
            ni_str  = f"NI={ni}B"  if ni  is not None else "NI=—"
            size = os.path.getsize(path)
            print(f"  ✅ {ticker:<6} {rev_str:<12} {ni_str:<14} → snapshot.json ({size:,} bytes)")
            ok += 1
        except Exception as e:
            print(f"  ❌ {ticker}: {e}")

    print(f"\n  {ok}/{len(tickers)} snapshots generated in data/*/snapshot.json")


if __name__ == "__main__":
    main()
