#!/usr/bin/env python3
"""
apply_patch.py — Prometheus Partial Update System
Apply a single JSON patch file to data/[TICKER]/data.json

Usage:
  python scripts/apply_patch.py QUBT patch.json
  python scripts/apply_patch.py QUBT patch.json --dry-run
  python scripts/apply_patch.py QUBT --info

Patch file format (JSON):
  {
    "description": "คำอธิบายสั้นๆ ว่าทำอะไร",
    "operations": [
      {"op": "append", "path": "notes",  "value": { ... }},
      {"op": "set",    "path": "last_updated", "value": "2026-03-29"},
      {"op": "update", "path": "roadmap", "match": "keyword", "changes": {"status": "delivered"}},
      {"op": "delete", "path": "notes",  "match": "keyword"}
    ]
  }

Operations:
  append  — add an item to an array (notes, quotes, roadmap)
  set     — set any field value (supports dotted paths: "financials.currency")
  update  — find items in array whose text contains 'match', apply 'changes' dict
  delete  — remove items from array whose text contains 'match'
"""

import argparse, json, os, sys, shutil, importlib.util
from datetime import datetime

# Base directory = parent of scripts/
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAX_BACKUPS = 20  # keep this many history snapshots per company


# ── helpers ────────────────────────────────────────────────────────────────────

def data_path(ticker: str) -> str:
    return os.path.join(BASE_DIR, "data", ticker.upper(), "data.json")


def history_dir(ticker: str) -> str:
    return os.path.join(BASE_DIR, "data", ticker.upper(), "history")


def backup(ticker: str) -> str:
    """Copy data.json → data/[TICKER]/history/data_YYYYMMDD_HHMMSS.json"""
    src  = data_path(ticker)
    hdir = history_dir(ticker)
    os.makedirs(hdir, exist_ok=True)
    ts  = datetime.now().strftime("%Y%m%d_%H%M%S")
    dst = os.path.join(hdir, f"data_{ts}.json")
    shutil.copy2(src, dst)
    # Trim old backups (keep newest MAX_BACKUPS)
    snaps = sorted(
        f for f in os.listdir(hdir)
        if f.startswith("data_") and f.endswith(".json")
    )
    for old in snaps[:-MAX_BACKUPS]:
        os.remove(os.path.join(hdir, old))
    return dst


def load_data(ticker: str) -> dict:
    path = data_path(ticker)
    if not os.path.exists(path):
        print(f"❌  ไม่พบ: {path}")
        sys.exit(1)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_data(ticker: str, data: dict):
    path = data_path(ticker)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"✅  บันทึก → {path}")


def _get_nested(obj: dict, dotted_path: str):
    """Walk obj by dotted path, return (parent_dict, last_key)."""
    parts = dotted_path.split(".")
    for part in parts[:-1]:
        if part not in obj:
            obj[part] = {}
        obj = obj[part]
    return obj, parts[-1]


# ── operation engine ───────────────────────────────────────────────────────────

def apply_op(data: dict, op_def: dict) -> tuple[bool, str]:
    """
    Apply one operation to data (in-place).
    Returns (success: bool, message: str).
    """
    op   = op_def.get("op", "").lower()
    path = op_def.get("path", "")

    # ── append ──────────────────────────────────────────────────
    if op == "append":
        parent, key = _get_nested(data, path)
        if key not in parent:
            parent[key] = []
        arr = parent[key]
        if not isinstance(arr, list):
            return False, f"'{path}' ไม่ใช่ array"
        arr.append(op_def["value"])
        label = op_def["value"].get("title") or op_def["value"].get("quote", "")[:40] or "(item)"
        return True, f"append → {path}  \"{label}\""

    # ── set ─────────────────────────────────────────────────────
    elif op == "set":
        parent, key = _get_nested(data, path)
        old = parent.get(key, "<unset>")
        parent[key] = op_def["value"]
        old_str = str(old)[:40]
        new_str = str(op_def["value"])[:40]
        return True, f"set {path}: '{old_str}' → '{new_str}'"

    # ── update ──────────────────────────────────────────────────
    elif op == "update":
        parent, key = _get_nested(data, path)
        arr = parent.get(key, [])
        if not isinstance(arr, list):
            return False, f"'{path}' ไม่ใช่ array"
        match_text = op_def.get("match", "").lower()
        changes    = op_def.get("changes", {})
        found = 0
        for item in arr:
            if match_text in json.dumps(item, ensure_ascii=False).lower():
                item.update(changes)
                found += 1
        if found == 0:
            return False, f"update: ไม่พบ '{match_text}' ใน {path}"
        return True, f"update: แก้ไข {found} รายการใน {path} ที่ match '{match_text}'"

    # ── delete ──────────────────────────────────────────────────
    elif op == "delete":
        parent, key = _get_nested(data, path)
        arr = parent.get(key, [])
        if not isinstance(arr, list):
            return False, f"'{path}' ไม่ใช่ array"
        match_text = op_def.get("match", "").lower()
        before = len(arr)
        parent[key] = [
            item for item in arr
            if match_text not in json.dumps(item, ensure_ascii=False).lower()
        ]
        removed = before - len(parent[key])
        return True, f"delete: ลบ {removed} รายการจาก {path} ที่ match '{match_text}'"

    else:
        return False, f"ไม่รู้จัก op: '{op}'  (รองรับ: append, set, update, delete)"


# ── info display ───────────────────────────────────────────────────────────────

def show_info(ticker: str):
    data = load_data(ticker)
    fin  = data.get("financials", {})
    roadmap = data.get("roadmap", [])
    statuses = {}
    for r in roadmap:
        s = r.get("status", "pending")
        statuses[s] = statuses.get(s, 0) + 1
    status_str = "  ".join(f"{k}={v}" for k, v in statuses.items()) or "—"

    print(f"\n{'═'*57}")
    print(f"  {ticker.upper()} — {data.get('name', '?')}")
    print(f"  Last updated: {data.get('last_updated', '?')}")
    print(f"{'─'*57}")
    print(f"  Financials : {len(fin.get('years', []))} years {fin.get('years', [])}")
    print(f"  Metrics    : {len(fin.get('metrics', []))}")
    print(f"  Notes      : {len(data.get('notes', []))}")
    print(f"  Quotes     : {len(data.get('quotes', []))}")
    print(f"  Roadmap    : {len(roadmap)} items  ({status_str})")

    # Show pending patches
    patches_path = os.path.join(BASE_DIR, "data", ticker.upper(), "patches")
    if os.path.exists(patches_path):
        pending = [f for f in os.listdir(patches_path) if f.endswith(".json")]
        if pending:
            print(f"  Patches    : {len(pending)} pending  → run merge_patches.py {ticker.upper()}")
    print(f"{'═'*57}")


# ── main ───────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(
        description="Prometheus — Apply JSON Patch to data.json",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("ticker",     help="Ticker symbol (เช่น QUBT)")
    p.add_argument("patch_file", nargs="?", help="Path ของ patch JSON file")
    p.add_argument("--dry-run",  action="store_true", help="Preview — ไม่บันทึกจริง")
    p.add_argument("--info",     action="store_true", help="แสดงสถานะปัจจุบันของ ticker")
    p.add_argument("--no-heal",  action="store_true", help="ปิด auto-healing (report errors only)")
    p.add_argument("--force",    action="store_true", help="ข้าม validation errors (อันตราย)")
    args = p.parse_args()

    ticker = args.ticker.upper()

    if args.info:
        show_info(ticker)
        return

    if not args.patch_file:
        p.print_help()
        sys.exit(1)

    if not os.path.exists(args.patch_file):
        print(f"❌  ไม่พบ patch file: {args.patch_file}")
        sys.exit(1)

    with open(args.patch_file, encoding="utf-8") as f:
        patch = json.load(f)

    data = load_data(ticker)

    # ── Pre-flight: Self-Healing Validation ─────────────────────────────────
    _validator_path = os.path.join(os.path.dirname(__file__), "validate_patch.py")
    if os.path.exists(_validator_path):
        _spec = importlib.util.spec_from_file_location("validate_patch", _validator_path)
        _vmod = importlib.util.module_from_spec(_spec)
        _spec.loader.exec_module(_vmod)

        healed_patch, issues = _vmod.validate_and_heal(patch, data, heal=not args.no_heal)

        _errors  = [i for i in issues if i["level"] == "error"]
        _warns   = [i for i in issues if i["level"] == "warn"]
        _healed  = [i for i in issues if i["level"] == "healed"]

        if issues:
            print(f"\n  🔍  Validation:  "
                  f"{len(_errors)} error(s)  {len(_warns)} warning(s)  {len(_healed)} healed")
            for iss in issues:
                icon = {"error": "  ❌ ", "warn": "  ⚠️  ", "healed": "  🔧 "}[iss["level"]]
                print(f"{icon} [{iss['code']}] {iss['msg']}")
            print()

        if _errors and not args.force:
            print(f"  ❌  Patch blocked by {len(_errors)} validation error(s). Use --force to override.")
            sys.exit(2)

        if _errors and args.force:
            print(f"  ⚠️   --force: skipping {len(_errors)} validation error(s)")

        patch = healed_patch  # use healed version going forward
    # ────────────────────────────────────────────────────────────────────────

    operations  = patch.get("operations", [])
    description = patch.get("description", os.path.basename(args.patch_file))

    print(f"\n📋  {description}")
    print(f"    Ticker: {ticker}  |  {len(operations)} operations")
    if args.dry_run:
        print("    [DRY RUN — ไม่มีการบันทึก]\n")
    ok      = 0
    for i, op_def in enumerate(operations, 1):
        success, msg = apply_op(data, op_def)
        icon = "  ✅" if success else "  ⚠️ "
        print(f"{icon} [{i}/{len(operations)}] {msg}")
        if success:
            ok += 1

    print(f"\n  {ok}/{len(operations)} operations สำเร็จ")

    if not args.dry_run and ok > 0:
        bak = backup(ticker)
        print(f"  💾  Backup: history/{os.path.basename(bak)}")
        save_data(ticker, data)
        # Auto-regenerate snapshot after every successful patch
        try:
            snap_path = os.path.join(os.path.dirname(__file__), "generate_snapshot.py")
            spec = importlib.util.spec_from_file_location("generate_snapshot", snap_path)
            mod  = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            snap = mod.generate_snapshot(ticker)
            mod.save_snapshot(ticker, snap)
            print(f"  📸  Snapshot updated → data/{ticker}/snapshot.json")
        except Exception as e:
            print(f"  ⚠️   Snapshot generation skipped: {e}")
    elif args.dry_run:
        print("  [ไม่มีการเปลี่ยนแปลง — dry run]")


if __name__ == "__main__":
    main()
