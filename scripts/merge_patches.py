#!/usr/bin/env python3
"""
merge_patches.py — Prometheus Batch Patch Processor
Apply all pending JSON patch files from data/[TICKER]/patches/ → data.json

Usage:
  python scripts/merge_patches.py QUBT              # apply all pending patches
  python scripts/merge_patches.py QUBT --dry-run    # preview without saving
  python scripts/merge_patches.py QUBT --list       # list pending patches
  python scripts/merge_patches.py --all             # process every company

Patch files:
  • วางไว้ที่ data/[TICKER]/patches/*.json
  • ตั้งชื่อด้วย date prefix เพื่อให้ apply ตามลำดับ
    เช่น: 2026-03-29_note_q4.json, 2026-03-30_roadmap_update.json
  • หลัง apply แล้วจะย้ายไป data/[TICKER]/history/applied_patches/ อัตโนมัติ
"""

import argparse, json, os, sys, shutil
from datetime import datetime

# Reuse apply_op + helpers from apply_patch.py (same scripts/ folder)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply_patch import apply_op, load_data, save_data, backup, BASE_DIR


# ── helpers ────────────────────────────────────────────────────────────────────

def patches_dir(ticker: str) -> str:
    return os.path.join(BASE_DIR, "data", ticker.upper(), "patches")


def applied_dir(ticker: str) -> str:
    return os.path.join(BASE_DIR, "data", ticker.upper(), "history", "applied_patches")


def get_pending(ticker: str) -> list[str]:
    pdir = patches_dir(ticker)
    if not os.path.exists(pdir):
        return []
    files = sorted(
        f for f in os.listdir(pdir)
        if f.endswith(".json") and not f.startswith("_")
    )
    return [os.path.join(pdir, f) for f in files]


def all_tickers() -> list[str]:
    data_dir = os.path.join(BASE_DIR, "data")
    return sorted(
        d for d in os.listdir(data_dir)
        if os.path.isdir(os.path.join(data_dir, d))
        and not d.startswith(".")
        and os.path.exists(os.path.join(data_dir, d, "data.json"))
    )


# ── process one ticker ─────────────────────────────────────────────────────────

def process_ticker(ticker: str, dry_run: bool = False, list_only: bool = False) -> int:
    """
    Apply all pending patches for one ticker.
    Returns number of successful operations.
    """
    ticker   = ticker.upper()
    patches  = get_pending(ticker)

    if not patches:
        print(f"  {ticker}: ไม่มี patch รอ apply")
        return 0

    print(f"\n{'═'*57}")
    print(f"  {ticker} — {len(patches)} patch file(s) รอ apply")
    print(f"{'─'*57}")

    # ── list only ──────────────────────────────────────────────
    if list_only:
        for pf in patches:
            try:
                with open(pf, encoding="utf-8") as f:
                    meta = json.load(f)
                desc  = meta.get("description", "—")
                n_ops = len(meta.get("operations", []))
                print(f"  📄  {os.path.basename(pf)}  ({n_ops} ops)  {desc}")
            except Exception as e:
                print(f"  📄  {os.path.basename(pf)}  [parse error: {e}]")
        return 0

    # ── apply ──────────────────────────────────────────────────
    data      = load_data(ticker)
    total_ok  = 0
    total_ops = 0
    applied   = []   # patch files successfully processed

    for pf in patches:
        try:
            with open(pf, encoding="utf-8") as f:
                patch = json.load(f)
        except Exception as e:
            print(f"\n  ⚠️   ข้าม {os.path.basename(pf)}: parse error — {e}")
            continue

        ops  = patch.get("operations", [])
        desc = patch.get("description", os.path.basename(pf))
        print(f"\n  📄  {os.path.basename(pf)}")
        print(f"      {desc}")

        ok = 0
        for op_def in ops:
            success, msg = apply_op(data, op_def)
            icon = "  ✅" if success else "  ⚠️ "
            print(f"    {icon}  {msg}")
            if success:
                ok += 1

        total_ok  += ok
        total_ops += len(ops)
        print(f"      {ok}/{len(ops)} ops สำเร็จ")
        if ok > 0:
            applied.append(pf)

    # ── summary + save ─────────────────────────────────────────
    print(f"\n{'─'*57}")
    print(f"  รวม: {total_ok}/{total_ops} operations สำเร็จ  |  {len(applied)}/{len(patches)} files processed")

    if dry_run:
        print("  [DRY RUN — ไม่มีการบันทึก]")
        return total_ok

    if total_ok > 0:
        # Backup → save → archive applied patches
        bak = backup(ticker)
        print(f"  💾  Backup: history/{os.path.basename(bak)}")
        save_data(ticker, data)

        adir = applied_dir(ticker)
        os.makedirs(adir, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        for pf in applied:
            dst = os.path.join(adir, f"{ts}_{os.path.basename(pf)}")
            shutil.move(pf, dst)
        print(f"  🗂   Archive → history/applied_patches/  ({len(applied)} file(s))")

    return total_ok


# ── main ───────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(
        description="Prometheus — Batch Patch Processor",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("ticker",   nargs="?", help="Ticker symbol (เช่น QUBT)  หรือละไว้ถ้าใช้ --all")
    p.add_argument("--all",    action="store_true", help="Process ทุกบริษัทใน data/")
    p.add_argument("--dry-run",action="store_true", help="Preview — ไม่บันทึกจริง")
    p.add_argument("--list",   action="store_true", help="แสดง patch files ที่รออยู่")
    args = p.parse_args()

    if args.all:
        tickers = all_tickers()
        print(f"🔍  พบ {len(tickers)} บริษัท: {', '.join(tickers)}")
        for t in tickers:
            process_ticker(t, dry_run=args.dry_run, list_only=args.list)
        print("\n✅  เสร็จสิ้น")

    elif args.ticker:
        process_ticker(args.ticker, dry_run=args.dry_run, list_only=args.list)
        print()

    else:
        p.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
