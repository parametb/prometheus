---
name: fix-ui
description: >
  Debug and fix Prometheus investment research frontend issues. Use this skill whenever
  the user reports that a company page is blank, not displaying, showing "undefined" text,
  a Mermaid/Gantt chart syntax error, an overview tab that looks empty, or roadmap items
  with missing text. Also trigger for general "UI ไม่แสดงผล", "หน้าขาว", "แสดงผลผิด",
  "syntax error", "Mermaid error" complaints related to Prometheus.
  Trigger phrases: "ไม่แสดงผล", "overview ว่าง", "roadmap ว่าง", "mermaid error",
  "gantt error", "syntax error", "fix ui", "debug prometheus", "หน้าขาว", "แสดงผลผิด".
allowed-tools:
  - Read
  - Edit
  - Write
  - Bash
  - Glob
---

# Prometheus Frontend Debugger

This skill fixes the three most common classes of bugs in the Prometheus UI:

1. **Roadmap text is blank / "undefined"** — `data.json` uses `milestone` or `item` as the key; `company.html` only reads `commitment`
2. **Mermaid Gantt syntax error** — roadmap items with `date_said: null` generate the literal string `"null"` as a date, which Mermaid 10.x cannot parse
3. **Overview tab shows nothing** — company has no `overview` object in `data.json`, so the tab renders an empty placeholder instead of available data (description, financials, notes)

---

## Step 1 — Run the audit script

Always start by running the audit to get a precise picture before touching any files:

```bash
cd "<investment-research-root>"
python .claude/skills/fix-ui/scripts/audit_prometheus.py
```

The script scans every `data/TICKER/data.json` and `company.html` and reports:
- Which companies have non-`commitment` roadmap keys
- Which companies have roadmap items with `date_said: null`
- Whether `company.html` has the `rmText()` helper and null-date Gantt guard
- Which companies are missing an `overview` field

Read the output carefully — only fix what the audit flags. Don't touch files that are already healthy.

---

## Step 2 — Fix company.html (HTML/JS layer)

These fixes belong in `company.html`. Apply only what's missing according to the audit.

### Fix A: `rmText()` helper — resolves blank roadmap text

Add this function near `renderRoadmapItems`:

```javascript
function rmText(r) { return r.commitment || r.milestone || r.item || r.text || '—'; }
```

Then replace every `r.commitment` reference in `renderRoadmapItems` and `buildGanttSyntax` with `rmText(r)`.

Also guard the sort in `renderRoadmapItems` against null dates:

```javascript
return [...filtered].sort((a,b)=>{
  const da = a.date_said ? new Date(a.date_said) : new Date(0);
  const db = b.date_said ? new Date(b.date_said) : new Date(0);
  return db - da;
})
```

And conditionally show the date label:
```javascript
<div class="rm-source">${r.date_said ? `📅 พูดเมื่อ ${formatDate(r.date_said)} · ` : ''}${r.source||''}</div>
```

### Fix B: Mermaid Gantt null-date guard — resolves syntax error

In `buildGanttSyntax`, filter out items without a valid date **before** building syntax:

```javascript
const withDate = roadmap.filter(r => r.date_said && r.date_said !== 'null');
if (!withDate.length) return null;   // renderGanttChart already handles null gracefully
const sorted = [...withDate].sort(...);
```

Also tighten the escape regex for task labels in Mermaid 10.x (more characters need escaping):
```javascript
const shortText = text.split(' ').slice(0,5).join(' ')
  .replace(/[:#,\[\]"'\\()/]/g,'').trim() || 'Item';
```

### Fix C: Overview fallback — resolves blank overview tab

Replace the one-liner `if (!ov) return '<div class="empty">...'` with a richer fallback that renders:
- `c.description` (company description paragraph)
- Latest financials snapshot (Revenue, Net Income, CEO, Employees) from `c.financials`
- Latest note excerpt (first 800 chars of `content`)
- A subtle notice that full Deep Dive data can be added via `analyze-report`

See `company.html` for the reference implementation already in place.

---

## Step 3 — Normalize data.json files

For every company flagged by the audit as using a non-`commitment` roadmap key (e.g., `milestone`), run the normalizer:

```bash
python .claude/skills/fix-ui/scripts/audit_prometheus.py --fix
```

This renames the text field to `commitment` in-place for every affected `data/TICKER/data.json`. It is safe to re-run — it only touches files that need it.

Alternatively, apply manually with a one-liner:
```python
import json, pathlib
p = pathlib.Path('data/TICKER/data.json')
d = json.loads(p.read_text())
for r in d.get('roadmap', []):
    if 'milestone' in r and 'commitment' not in r:
        r['commitment'] = r.pop('milestone')
p.write_text(json.dumps(d, indent=2, ensure_ascii=False))
```

---

## Step 4 — Verify

After applying fixes, re-run the audit to confirm zero issues remain:

```bash
python .claude/skills/fix-ui/scripts/audit_prometheus.py
```

Expected output: `✅ All checks passed — no issues found.`

Also do a quick sanity check on the specific company the user reported:

```bash
python scripts/apply_patch.py TICKER --info
```

---

## Quality notes

- **Don't over-fix.** If a company already has `commitment` keys and valid dates, don't touch it.
- **Preserve the Mermaid fallback message.** When `buildGanttSyntax` returns `null` (all items have null dates), `renderGanttChart` shows "ไม่มีข้อมูล timeline" — this is the correct behavior, not a bug.
- **Overview fallback ≠ full overview.** The fallback renders what's available; it still prompts the user to run `prometheus:analyze-report` for a complete deep dive.
- **date_said: null is valid.** 10-K filings don't attach a specific date to each commitment. Null dates are expected for 10-K sourced roadmap items — only filter them from the Gantt chart, not from the roadmap list itself.
