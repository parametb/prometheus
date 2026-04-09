# PROMETHEUS_FLOW.md — v2.3
> อัปเดต: 2026-04-10 | Automated DeepSeek Pipeline · GitHub Actions Trigger · PDF Support · Delivery Check · Sector Scan · Thesis Synthesis

---

## 0. หลักการออกแบบหลัก (Design Principles)

> **ทุก decision ใน Prometheus ต้องผ่าน 4 หลักการนี้**

| หลักการ | ความหมาย |
|---------|----------|
| 🏆 **High Quality Data** | ข้อมูลต้องมีที่มา, linked, tagged, searchable ไม่ใช่แค่ข้อความดิบ |
| ⚡ **Token-Efficient** | ไม่โหลดข้อมูลทั้งก้อน — อ่านเฉพาะส่วนที่ต้องการจาก Notion |
| 🧑‍💼 **No-Code Friendly** | ใช้ Cowork Skills + GitHub Actions ทำงานได้ ไม่ต้องแตะ code |
| 🤖 **Hybrid AI** | DeepSeek = อ่าน/สกัด/แปล | Claude = วางแผน/สังเคราะห์/ตัดสิน |

---

## 1. สถาปัตยกรรมโดยรวม

```
[User: ระบุ Ticker + URL เอกสาร]
          │
          ▼
  ┌──────────────────────────┐
  │   GitHub Actions         │  ← deepseek-extract.yml
  │   (Manual Trigger)       │    กรอก ticker / url / doc_type / quarter
  └───────────┬──────────────┘
              │
              ▼
  ┌──────────────────────────┐
  │  scripts/deepseek-       │  ← รัน 4 agents พร้อมกัน
  │  extract.js              │    • phase2_deep_analysis
  │                          │    • phase2_quotes  (+ quote_th)
  │  DeepSeek API            │    • phase2_roadmap
  │  (Extraction Engine)     │    • phase2_risks
  └───────────┬──────────────┘
              │ เขียนตรงเข้า Notion ทันที
              ▼
  ┌───────────────────────────────────────────┐
  │           NOTION (Working Memory)         │
  │                                           │
  │  Sources → Quotes → Roadmap → Notes       │
  │               ↕         ↕       ↕         │
  │           Companies ← Relations           │
  │               ↓                           │
  │         Analytic Reports ← Tasks          │
  └───────────────────┬───────────────────────┘
          │ Claude query เฉพาะ slice ที่ต้องการ
          ▼
  ┌───────────────────┐
  │    Claude         │  ← Cowork Skills: สังเคราะห์, approve report
  │  (Orchestration)  │    ไม่อ่านเอกสารดิบ — อ่านจาก Notion เท่านั้น
  └───────┬───────────┘
          │
          ▼
  ┌────────────────────────────────────┐
  │  GitHub Actions: notion-sync.yml   │  ← ทุก 6 ชั่วโมง (อัตโนมัติ)
  │  Notion → data.json → Quartz       │
  └───────────────┬────────────────────┘
                  │
                  ▼
  [Website: Dashboard + Company Pages]
```

---

## 2. บทบาท AI แต่ละตัว

### 2.1 DeepSeek — Extraction Engine
ทำงานผ่าน `scripts/deepseek-extract.js` ที่ trigger จาก GitHub Actions

```
งานที่ DeepSeek ทำ (4 agents, รันพร้อมกัน):
  Agent A — Deep Analysis:
    → management_tone, strategic_priorities, management_quality
    → competitive_position, outlook_signals, financial_summary

  Agent B — Roadmap:
    → forward-looking commitments → เขียน Notion Roadmap DB
    → fields: Commitment, Category, Confidence, Quarter Said, Target Quarter

  Agent C — Quotes:
    → executive quotes + แปล Quote TH ในตัว
    → fields: Quote, Quote TH, Speaker, Segment, Tag, Sentiment, Sub-tag

  Agent D — Risks:
    → key risks + severity → รวมอยู่ใน Analysis Note

ข้อดี:
  - ราคาถูกกว่า Claude มาก สำหรับงาน extraction
  - รัน parallel ทั้ง 4 agents → เสร็จเร็วกว่า sequential
  - รองรับทั้ง PDF และ HTML (pdf-parse)
  - เขียน Notion โดยตรง ไม่ผ่าน data.json
```

### 2.2 Claude — Orchestration & Synthesis
ทำงานผ่าน Cowork Skills เท่านั้น ไม่อ่านเอกสารดิบ

```
งานที่ Claude ทำ:
  - Bootstrap บริษัทใหม่ (add-company skill)
  - Query Notion เพื่อดึงข้อมูล slice เล็กๆ
  - สังเคราะห์ข้อมูลจาก Notion → เขียน Analytic Report
  - ตอบคำถาม user โดย query Notion โดยตรง
  - track delivery rate ของ management
  - debug website rendering issues
```

---

## 3. Notion as Working Memory — หลักการประหยัด Token

### แนวคิดหลัก
แทนที่จะโหลด `data.json` ทั้งก้อนทุกครั้ง (5,000–8,000 tokens) ให้ใช้ Notion เป็น "database" ที่ query เฉพาะส่วน:

```
❌ แบบเก่า (Token-Expensive):
   Claude โหลด data.json ทั้งก้อน
   → ประมวลผล → เขียนกลับ data.json ทั้งก้อน
   ≈ 8,000+ tokens ต่อครั้ง

✅ แบบใหม่ (Token-Efficient):
   Claude query Notion: "quotes ของ NVDA ที่ tag=AI ใน Q1 2026"
   → ได้ 5-10 records ที่เกี่ยวข้อง
   ≈ 200-500 tokens ต่อครั้ง
```

### Chunked Processing Pattern (ใน deepseek-extract.js)

```
เอกสาร (PDF/HTML) → fetchDocumentText() → chunkText(maxChars=20000)
     │
     ├── analysisText  = chunks[0..1]  (first ~40k chars: MD&A, Risk Factors)
     │     └── Agent A (Deep Analysis) + Agent B (Roadmap) + Agent D (Risks)
     │
     └── fullSlice     = chunks[0..n]  (all chunks, up to 40k chars)
           └── Agent C (Quotes) — ดึง quotes จากทุกส่วนของเอกสาร
```

### Notion Query Patterns ที่ใช้บ่อย

| ต้องการ | Query Notion แทนที่จะ... |
|--------|--------------------------|
| Quotes ทั้งหมดของ NVDA Q1 2026 | โหลด data.json ทั้งก้อน |
| Commitments ที่ status=pending ของ AAPL | loop ผ่าน array ใน JSON |
| Notes ทั้งหมด tag=risk ใน 6 เดือนล่าสุด | grep ผ่าน markdown files |
| Management tone ของบริษัทล่าสุด | อ่าน overview section ใน JSON |

---

## 4. Workflow รายละเอียด

### Step 1 — Claude: Bootstrap (ครั้งเดียวต่อบริษัท)
```
SKILL: prometheus:add-company
INPUT: ticker

Claude ทำ:
  1. สร้าง data/{TICKER}/data.json โครงสร้างพื้นฐาน
  2. เพิ่มใน companies.json
  3. สร้าง Company record ใน Notion Companies DB
  4. สร้าง Task record: "วิเคราะห์เอกสารแรก" → Status=pending

OUTPUT: JSON skeleton + Notion record พร้อมแล้ว
TOKEN COST: ~300 tokens
```

### Step 2 — User: Trigger Extraction (GitHub Actions)
```
WORKFLOW: .github/workflows/deepseek-extract.yml
TRIGGER: Manual (Actions tab → Run workflow)

User กรอก:
  - ticker:    GOOGL
  - url:       https://... (PDF หรือ HTML)
  - doc_type:  10-K / Earnings Call / Press Release
  - year:      2025
  - quarter:   Q4 2025
  - sync_after: true (รัน notion-sync หลังจบ)

ไม่ต้องเขียน code ใดๆ — กดปุ่มเดียวจบ
```

### Step 3 — DeepSeek: Extraction → Notion (อัตโนมัติ)
```
SCRIPT: scripts/deepseek-extract.js
ใช้เวลา: ~1-3 นาที ต่อเอกสาร

Pipeline:
  1. Fetch document (PDF → pdf-parse / HTML → strip tags)
  2. สร้าง Source record ใน Notion (Status=extracting)
  3. Chunk text → 20,000 chars ต่อ chunk
  4. รัน 4 DeepSeek agents พร้อมกัน (Promise.allSettled)
  5. เขียน Quotes → Notion Quotes DB  (พร้อม quote_th ภาษาไทย)
  6. เขียน Roadmap → Notion Roadmap DB
  7. เขียน Analysis Note → Notion Notes DB
  8. อัปเดต Management Tone ใน Companies DB
  9. อัปเดต Source: Status=analyzed
  10. ปิด pending Task: Status=done

OUTPUT: Quotes + Roadmap + Note ใน Notion
TOKEN COST (DeepSeek): ~$0.01-0.05 ต่อเอกสาร
```

### Step 4 — Claude: Synthesis (เบา, ผ่าน Cowork)
```
SKILL: prometheus:analyze-report หรือ prometheus:analyze-earnings

Claude query Notion:
  - quotes จาก Source นี้ → ได้ N records
  - roadmap items ที่เพิ่งสร้าง → ได้ M records

Claude สังเคราะห์:
  - เขียน Executive Summary → Analytic Reports DB
  - ประเมิน investment thesis
  - สร้าง Analytic Report: Status=draft

OUTPUT: 1 Analytic Report record
TOKEN COST (Claude): ~500-800 tokens
```

### Step 5 — User: Review & Approve
```
User เปิด Notion:
  - ตรวจสอบ Quotes ที่ DeepSeek สกัด
  - แก้ไข/เพิ่ม Analyst Note ถ้าต้องการ
  - เปลี่ยน Report Status → approved → published

GitHub Actions sync อัตโนมัติทุก 6 ชั่วโมง
```

### Step 6 — GitHub Actions: Publish (อัตโนมัติ)
```
WORKFLOW: .github/workflows/notion-sync.yml
SCHEDULE: ทุก 6 ชั่วโมง (00:00, 06:00, 12:00, 18:00 UTC)

notion-sync.js:
  - ดึง Companies, Notes, Quotes, Roadmap จาก Notion
  - เขียน data/{TICKER}/data.json

generate-quartz.js:
  - สร้าง Markdown จาก JSON
  - deploy ไป GitHub Pages
```

---

## 5. GitHub Actions Workflows

| Workflow | Trigger | ใช้เมื่อ | Script |
|----------|---------|---------|--------|
| `deepseek-extract.yml` | Manual | มีเอกสารใหม่ — 10-K, Earnings Call, Press Release | `deepseek-extract.js` |
| `deepseek-delivery-check.yml` | Manual + **Quarterly** (Jan/Apr/Jul/Oct 5) | ตรวจสอบว่า management ส่งมอบตาม roadmap หรือไม่ | `deepseek-delivery-check.js` |
| `deepseek-sector-scan.yml` | Manual + **Weekly** (จ. 07:00 UTC) | สรุปข่าวรายสัปดาห์ต่อ sector → สร้าง Note ใน Notion | `deepseek-sector-scan.js` |
| `deepseek-thesis.yml` | Manual | สังเคราะห์ Investment Thesis จากข้อมูลทั้งหมดใน Notion | `deepseek-thesis.js` |
| `notion-sync.yml` | Schedule (ทุก 6 ชม.) + Manual | sync Notion → data.json → deploy website | `notion-sync.js` |

### deepseek-extract.yml — inputs

| Input | ตัวอย่าง | หมายเหตุ |
|-------|---------|---------|
| ticker | GOOGL | uppercase |
| url | https://...pdf | PDF หรือ HTML |
| doc_type | 10-K | ดู options ใน workflow |
| year | 2025 | fiscal year |
| quarter | Q4 2025 | format "Q# YYYY" |
| sync_after | true | รัน notion-sync หลังจบ extraction |

### Secrets ที่ต้องตั้งใน GitHub

```
DEEPSEEK_API_KEY       = sk-...
NOTION_TOKEN           = secret_...
NOTION_COMPANIES_DB    = 1846ceaeee3842cdb00c351d5f735c4d
NOTION_NOTES_DB        = 00002ee5d11f443692fd6a9a5b9c640e
NOTION_QUOTES_DB       = 78027774aa664acea7488c81176ac3a0
NOTION_ROADMAP_DB      = 37dfa0c7ab724d17b09076be033f90cf
NOTION_SOURCES_DB      = 17d7966d29a54ced80cd9cb3236f51cc
NOTION_REPORTS_DB      = 0b5706ab4758488ab8c57d280c9c4754
NOTION_TASKS_DB        = 1d7fedba7e6f45a1801e05193ac7af7d
NEWS_API_KEY           = (optional) newsapi.org key สำหรับ sector-scan
```

### deepseek-delivery-check.yml — logic

```
INPUT:  ticker (หรือ "all") + dry_run
QUERY:  Roadmap DB → status=pending + target_quarter ผ่านมา > 30 วัน
FOR EACH overdue item:
  - ดึง recent Quotes + Notes ของ ticker นั้น
  - ถาม DeepSeek: "ส่งมอบหรือยัง? หลักฐานคืออะไร?"
  - อัปเดต status: delivered / partial / missed / monitoring
  - เขียน Delivery Note (EN + TH) กลับ Notion
SUMMARY: สร้าง Task record สรุปผล
```

### deepseek-sector-scan.yml — logic

```
INPUT:  sector (Technology / Healthcare / Finance / etc.)
        note_type (Observation / Analysis / Risk)
FETCH:  watchlist companies ของ sector จาก Notion Companies DB
        + ข่าวล่าสุด 7 วัน จาก newsapi.org (หรือ GNews fallback)
DEEPSEEK: เขียน digest note (4-6 paragraphs, EN + TH)
          sections: Key Developments / Watchlist Highlights / Macro Themes / Risks
OUTPUT: สร้าง Note + Source record ใน Notion
SCHEDULE: ทุกวันจันทร์ 07:00 UTC = 14:00 Bangkok time
```

### deepseek-thesis.yml — logic

```
INPUT:  ticker + force_update
FETCH (parallel):
  - Company info จาก Notion Companies DB
  - Quotes ทั้งหมด (50 ล่าสุด)
  - Roadmap items ทั้งหมด (แยก pending/delivered/missed)
  - Notes ทั้งหมด (20 ล่าสุด)
  - Financials จาก data/{TICKER}/data.json
DEEPSEEK: สังเคราะห์ Thesis Update report (8,192 tokens)
          sections: Executive Summary / Core Thesis / Financial Quality /
                    Management Credibility / Bull Case / Bear Case /
                    Key Risks / Watchlist / Thesis Change
OUTPUT:
  1. สร้าง Analytic Report (Type=Thesis) ใน Notion Reports DB
  2. อัปเดต Companies DB: Investment Thesis + Conviction Level + Last Analyzed
```

---

## 6. Database Schema (7 DBs)

### DB 1: Companies
| Field | Type | หมายเหตุ |
|-------|------|----------|
| Ticker | title | Primary key |
| Name / Name TH | text | |
| Sector / Industry | text | Industry เฉพาะกว่า Sector |
| Exchange / Country | text/select | |
| CEO / Description | text | |
| Employees / Market Cap (B) | number | |
| Management Tone | select | bullish / cautious / mixed — auto-set จาก deepseek-extract |
| Conviction Level | select | high / medium / low / watch |
| Investment Thesis | text | สรุปวิทยาทัศน์ |
| Last Analyzed | date | auto-update จาก workflow |
| TradingView Symbol / Website | text/url | |

### DB 2: Sources
| Field | Type | หมายเหตุ |
|-------|------|----------|
| Title | title | "NVDA Q1 2026 Earnings Call" |
| Company | relation → Companies | |
| Source Type | select | Annual Report / Earnings Call / Press Release / SEC Filing / News |
| Date / Quarter | date/select | |
| URL / File | url/files | |
| Analyzed By | select | Claude / **DeepSeek** / Manual |
| Status | select | pending / **extracting** / analyzed / archived |
| Tags | multi-select | earnings / financials / strategy / guidance / risk |

### DB 3: Quotes
| Field | Type | หมายเหตุ |
|-------|------|----------|
| Quote | title | ข้อความต้นฉบับ |
| Quote TH | text | **DeepSeek แปลอัตโนมัติ** |
| Company / Source Doc | relation | |
| Date / Quarter | date/select | |
| Segment | select | **Prepared Remarks / Q&A / Written Submission** |
| Speaker | text | CEO, CFO... |
| Tag | select | growth / risk / strategy / guidance / product / macro |
| Sub-tag | multi-select | revenue-guidance / margin / capex / AI / china-risk / competition / product-launch / hiring / buyback / debt |
| Sentiment | select | **bullish / neutral / cautious / bearish** — DeepSeek classify |
| Analyst Note | text | Claude เพิ่มภายหลัง |
| Parent Quote | relation → self | quotes ที่เกี่ยวกัน |

### DB 4: Roadmap
| Field | Type | หมายเหตุ |
|-------|------|----------|
| Commitment | title | |
| Company / Source Doc | relation | |
| Origin Quote | relation → Quotes | |
| Evidence | relation → Quotes | หลักฐาน delivery |
| Status | select | **pending** (default) / in_progress / monitoring / delivered / missed |
| Category | select | **Strategic / Financial / Product / Operational / Regulatory** |
| Confidence | select | **low / medium / high** — DeepSeek assess |
| Quarter Said / Target Quarter | select | |
| Delivery Note | text | สรุปผลการส่งมอบ |
| Parent Commitment | relation → self | |

### DB 5: Notes (Research Notes)
| Field | Type | หมายเหตุ |
|-------|------|----------|
| Title | title | |
| Company / Source Doc | relation | |
| Note Type | select | **Analysis** / Observation / Risk / Thesis / Update / Question |
| Date / Quarter | date/select | |
| Tags | multi-select | earnings / risk / strategy / growth / macro / valuation / services / china |
| Rating | number | 1-5 ความสำคัญ |
| Active | checkbox | |
| Related Quotes / Related Roadmap | relation | |

### DB 6: Analytic Reports
| Field | Type | หมายเหตุ |
|-------|------|----------|
| Title | title | "NVDA Q1 2026 — Post-Earnings Analysis" |
| Company / Source | relation | |
| Report Type | select | Earnings Analysis / Annual Review / Thesis Update / Risk Review |
| Quarter / Status | select | draft → review → approved → published |
| Author | select | Claude / User / Both |
| Executive Summary | text | แสดงบนเว็บ |
| Related Notes / Quotes / Roadmap | relation | |

### DB 7: Tasks
| Field | Type | หมายเหตุ |
|-------|------|----------|
| Task | title | ชื่องาน |
| Company / Related Source | relation | |
| Task Type | select | Add Data / Analyze Document / Write Report / Update Roadmap / Fix UI |
| Status | select | pending / in_progress / **done** (auto-close จาก deepseek-extract) / blocked |
| Priority / Assigned To | select | |
| Related Report / Due Quarter | relation/select | |

---

## 7. Relation Map

```
Companies ←────────────────────────────────┐
    │                                       │
    ├──→ Sources                            │
    │       │                               │
    │       ├──→ Quotes ──→ Roadmap         │
    │       │       │          │            │
    │       └──→ Notes ←───────┘            │
    │               │                       │
    │               └──→ Analytic Reports ──┘
    │
    └──→ Tasks ──→ Analytic Reports

Key chains:
  Source → Quote → Roadmap    (เอกสาร → คำพูด → commitment)
  Quote  → Note  → Report     (evidence → analysis → output)
  Roadmap → Evidence Quote    (delivery verification)
```

---

## 8. Web Interface Mapping

| Website Tab | Notion Source | Fields แสดง |
|-------------|---------------|-------------|
| Overview | Companies DB | Profile + Conviction + Investment Thesis |
| | Notes (Type=Thesis, Active=true) | Latest thesis |
| Notes | Notes | Title, Note Type, Date, Tags, Rating |
| | Analytic Reports (Status=published) | Report + Executive Summary |
| Quotes | Quotes | Quote, Speaker, Quarter, Tag, Sentiment |
| Roadmap | Roadmap | Commitment, Status, Category, Quarters, Confidence |
| Financials | JSON data.json | financial metrics (ยังคง JSON) |
| Sources | Sources | Title, Type, Date, Status |

---

## 9. Token Cost Comparison

| Operation | แบบเก่า | แบบใหม่ | ประหยัด |
|-----------|---------|---------|---------|
| วิเคราะห์ Earnings Call | ~8,000 tokens (Claude) | ~$0.02 (DeepSeek) + 800 tokens (Claude synth) | ~90% cost |
| อัปเดต roadmap 1 item | ~5,000 tokens (โหลด JSON) | ~100 tokens (Notion API call) | ~98% |
| ตอบคำถาม "management tone ล่าสุด" | ~3,000 tokens (โหลด JSON) | ~200 tokens (Notion query) | ~93% |
| เขียน Analytic Report | ~6,000 tokens | ~800 tokens (Claude + Notion data) | ~87% |
| Trigger extraction ใหม่ | manual copy-paste prompt | กด Run workflow ใน GitHub | 100% automated |

---

## 10. Cowork Skills

| Skill | AI ที่ใช้ | ทำอะไร |
|-------|----------|--------|
| `prometheus:add-company` | Claude | Step 1: Bootstrap JSON + Notion + Task |
| `prometheus:analyze-earnings` | Claude (post-extraction) | Step 4: สังเคราะห์หลัง DeepSeek เสร็จ |
| `prometheus:analyze-report` | Claude (post-extraction) | Step 4: สำหรับ Annual Report / 10-K |
| `prometheus:track-delivery` | Claude | Query Notion Roadmap → ประเมิน delivery rate |
| `fix-ui` | Claude | debug website rendering issues |

> **หมายเหตุ:** Step 3 (Extraction) ไม่ผ่าน Cowork Skills แล้ว — ทำงานผ่าน GitHub Actions `deepseek-extract.yml` อัตโนมัติ

---

## 11. DeepSeek Prompt Files

### Phase 2 — Extraction agents (รันใน deepseek-extract.js)

| ไฟล์ | Agent | Output fields | max_tokens |
|------|-------|---------------|-----------|
| `phase2_deep_analysis.md` | A — Qualitative | management_tone, strategic_priorities, management_quality, competitive_position, outlook_signals, financial_summary (EN+TH), conviction, investment_thesis, ceo, employees, market_cap | 8192 |
| `phase2_roadmap.md` | B — Roadmap | commitment, **commitment_th**, category, confidence, quarter_said, target_quarter, **follow_up_en**, **follow_up_th**, status | 8192 |
| `phase2_quotes.md` | C — Quotes | quote, **quote_th**, speaker, segment, tag, sentiment, sub_tags, **analyst_note_en**, **analyst_note_th** | 8192 |
| `phase2_financials.md` | D — Financials | currency, unit, years[], metrics[], segments[], margin_pct[], guidance (EN+TH), notable_items (EN+TH) | 8192 |
| `phase2_notes_multi.md` | E — Notes (3x) | note_type, title_en, **title_th**, tags, rating, **content_en** (5-8 paragraphs), **content_th** (full Thai) | 12288 |

> **굵은 fields** = เพิ่มใหม่ใน v2.2 เพื่อ fill Notion fields ที่ว่างเปล่า

### Phase 3+ — Scheduled automation agents

| Script | ใช้ prompt? | AI calls |
|--------|------------|---------|
| `deepseek-delivery-check.js` | Inline prompt | 1 call ต่อ roadmap item ที่ overdue |
| `deepseek-sector-scan.js` | Inline prompt | 1 call ต่อ sector scan |
| `deepseek-thesis.js` | Inline prompt | 1 call ต่อ ticker (8,192 tokens) |

---

## 12. การเปลี่ยนแปลง

### v1 → v2.1
| สิ่งที่เปลี่ยน | v1 | v2.1 |
|----------------|-----|------|
| Primary storage | data.json | Notion (JSON เป็น output เท่านั้น) |
| Analysis engine | Claude ทำทุกอย่าง | DeepSeek extract, Claude synthesize |
| Data loading | โหลดทั้งก้อน | Notion query เฉพาะส่วน |
| Source tracking | text field | Sources DB (relation graph) |
| Task visibility | ไม่มี | Tasks DB (User เห็นความคืบหน้า) |
| Report pipeline | ไม่มี | Draft → Review → Published |
| DB count | 4 | 7 |

### v2.1 → v2.2
| สิ่งที่เปลี่ยน | v2.1 | v2.2 |
|----------------|------|------|
| DeepSeek trigger | manual (copy prompt) | **GitHub Actions — กดปุ่มเดียว** |
| Extraction script | ไม่มี | `scripts/deepseek-extract.js` |
| Agent execution | sequential | **parallel (Promise.allSettled)** |
| PDF support | ไม่มี | **pdf-parse** |
| Quote fields | quote, speaker, tag | + **quote_th, segment, sentiment, sub_tags, analyst_note EN+TH** |
| Roadmap fields | commitment, date_said | + **commitment_th, category, confidence, follow_up EN+TH** |
| Notes | 1 note | **3 notes: Analysis + Risk + Thesis (EN+TH)** |
| Financials | ไม่มี | **phase2_financials.md → data.json (segments, margins, guidance)** |
| Task auto-close | manual | **auto-close เมื่อ extraction เสร็จ** |
| Source status | manual | **auto: extracting → analyzed** |

### v2.2 → v2.3
| สิ่งที่เปลี่ยน | v2.2 | v2.3 |
|----------------|------|------|
| Delivery tracking | Claude skill เท่านั้น | **GitHub Action quarterly auto-scan** |
| Sector monitoring | manual | **Weekly GitHub Action + newsapi.org** |
| Thesis synthesis | ไม่มี workflow | **GitHub Action: query all Notion → DeepSeek → Report** |
| GitHub workflows | 2 | **5** |
| Automation coverage | extraction only | **extract + delivery check + scan + thesis** |
