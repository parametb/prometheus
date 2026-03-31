# DeepSeek Agent Prompts

Prompt files สำหรับ 8 agents ใน `fetch_analyze.py`
แก้ไขไฟล์นี้โดยตรง — ไม่ต้องแตะ Python

## Phase 2 — Single Document Analysis

| ไฟล์ | Agent | งาน |
|------|-------|-----|
| `phase2_deep_analysis.md` | A — Qualitative | tone, drivers, priorities, moat, outlook |
| `phase2_roadmap.md`       | B — Roadmap     | forward-looking commitments |
| `phase2_quotes.md`        | C — Quotes      | executive quotes |
| `phase2_risks.md`         | D — Risks       | risk factors + summary |

## Phase 3 — Cross-Year Comparison

| ไฟล์ | Agent | งาน |
|------|-------|-----|
| `phase3_narrative.md`    | E — Narrative Drift    | tone/topic shift ข้ามปี |
| `phase3_business.md`     | F — Business Evolution | segment/KPI changes |
| `phase3_accounting.md`   | G — Accounting Watch   | policy changes, optical improvements |
| `phase3_risk_evolution.md` | H — Risk Evolution   | risks appeared/disappeared/escalated |

## Variables ที่ใช้ใน prompts

| Variable | ความหมาย |
|----------|---------|
| `{ticker}` | เช่น NVDA, QUBT |
| `{doc_type}` | เช่น 10-K, Earnings Call |
| `{text}` | เนื้อหาเอกสาร (Phase 2) |
| `{text_old}` | เนื้อหาปีเก่า (Phase 3) |
| `{text_new}` | เนื้อหาปีใหม่ (Phase 3) |
| `{year_old}` | เช่น 2023 (Phase 3) |
| `{year_new}` | เช่น 2025 (Phase 3) |
