# PROMETHEUS_FLOW.md — v2.1
> อัปเดต: 2026-04-08 | Notion-First · DeepSeek Pipeline · Chunked Processing

---

## 0. หลักการออกแบบหลัก (Design Principles)

> **ทุก decision ใน Prometheus ต้องผ่าน 4 หลักการนี้**

| หลักการ | ความหมาย |
|---------|----------|
| 🏆 **High Quality Data** | ข้อมูลต้องมีที่มา, linked, tagged, searchable ไม่ใช่แค่ข้อความดิบ |
| ⚡ **Token-Efficient** | ไม่โหลดข้อมูลทั้งก้อน — อ่านเฉพาะส่วนที่ต้องการจาก Notion |
| 🧑‍💼 **No-Code Friendly** | ใช้ Cowork Skills ทำงานได้ ไม่ต้องแตะ code |
| 🤖 **Hybrid AI** | DeepSeek = อ่าน/สกัด/แปล | Claude = วางแผน/สังเคราะห์/ตัดสิน |

---

## 1. สถาปัตยกรรมโดยรวม

```
[เอกสาร: PDF / Transcript / Filing]
          │
          ▼
  ┌───────────────────┐
  │   DeepSeek API    │  ← อ่านเอกสาร, สกัดข้อมูล, แปลไทย
  │  (Extraction)     │    ประหยัด token มากกว่า Claude
  └───────┬───────────┘
          │ เขียนทีละ record อย่างต่อเนื่อง
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
          │ ดึงเฉพาะ slice ที่ต้องการ
          ▼
  ┌───────────────────┐
  │    Claude API     │  ← วางแผน, สังเคราะห์, approve report
  │  (Orchestration)  │    อ่านข้อมูลจาก Notion ทีละชิ้น
  └───────┬───────────┘
          │
          ▼
  [GitHub Actions: Notion → JSON → Quartz]
          │
          ▼
  [Website: Dashboard + Company Pages]
```

---

## 2. บทบาท AI แต่ละตัว

### 2.1 DeepSeek — Extraction Engine
ใช้เมื่อ: อ่านเอกสารดิบ, สกัดข้อมูล, แปลภาษา

```
งานที่ DeepSeek ทำ:
- อ่าน Earnings Call transcript ทั้งฉบับ
- สกัด quotes ทีละอัน → เขียน Notion Quotes DB ทันที
- สกัด commitments → เขียน Notion Roadmap DB ทันที
- แปล quote เป็นภาษาไทย (Quote TH field)
- อ่าน Annual Report → สกัด financial metrics
- classify tag/sentiment ของแต่ละ quote

ข้อดี:
- ราคาถูกกว่า Claude มาก สำหรับงาน extraction
- ทนต่อ context ยาว (long document)
- เขียน Notion แบบ streaming ทีละ record ไม่ต้องรอจบ
```

### 2.2 Claude — Orchestration & Synthesis
ใช้เมื่อ: วางแผน, สังเคราะห์ข้อมูล, เขียนรายงาน, ตัดสินใจ

```
งานที่ Claude ทำ:
- ออกแบบ extraction plan ก่อน DeepSeek เริ่มทำงาน
- Query Notion เพื่อดึงข้อมูล slice เล็กๆ ที่ต้องการ
- สังเคราะห์ข้อมูลจาก Notion → เขียน Analytic Report
- อัปเดต status ใน Tasks DB
- ตรวจสอบ quality ของข้อมูลที่ DeepSeek บันทึก
- ตอบคำถาม user โดย query Notion โดยตรง (ไม่ต้องโหลด JSON)
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

### Chunked Processing Pattern

```
แทนที่จะ:  อ่านเอกสาร 50 หน้า → สรุปทุกอย่างในครั้งเดียว

ให้ทำแบบนี้:

  เอกสาร 50 หน้า
       │
       ├── Chunk 1 (หน้า 1-10: CEO Opening Remarks)
       │     └── DeepSeek → เขียน 3-5 Quotes + 2 Roadmap items → Notion
       │
       ├── Chunk 2 (หน้า 11-20: CFO Financial Update)
       │     └── DeepSeek → เขียน Financial Notes + Guidance quotes → Notion
       │
       ├── Chunk 3 (หน้า 21-35: Q&A Session)
       │     └── DeepSeek → เขียน Q&A Quotes + Risk items → Notion
       │
       └── Chunk 4 (หน้า 36-50: Written Submission)
             └── DeepSeek → เขียน Formal commitments → Notion

  จากนั้น Claude:
       └── Query Notion → สังเคราะห์ → เขียน Analytic Report 1 record
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

### Step 1 — Claude: Bootstrap & Plan (ครั้งเดียวต่อบริษัท)
```
INPUT: ชื่อบริษัท + ticker + exchange

Claude ทำ:
  1. สร้าง data/{TICKER}/data.json โครงสร้างพื้นฐาน (50 tokens)
  2. เพิ่มใน companies.json
  3. สร้าง Company record ใน Notion Companies DB
  4. สร้าง Task record: "วิเคราะห์เอกสารแรก" → Status=pending

OUTPUT: JSON skeleton + Notion record พร้อมแล้ว
TOKEN COST: ~300 tokens
```

### Step 2 — Claude: Extraction Plan (ก่อน DeepSeek ทำงาน)
```
INPUT: เอกสาร (URL หรือ PDF path)

Claude วางแผน:
  1. ดูประเภทเอกสาร → กำหนด chunk strategy
  2. สร้าง Source record ใน Notion: Status=pending
  3. ออก extraction prompt template ให้ DeepSeek

  ตัวอย่าง plan สำหรับ Earnings Call:
  ├── Chunk A: Prepared Remarks → extract: quotes + commitments
  ├── Chunk B: CFO Section → extract: guidance + financial notes
  └── Chunk C: Q&A → extract: risk mentions + clarifications

OUTPUT: extraction plan + Source record ใน Notion
TOKEN COST: ~200 tokens
```

### Step 3 — DeepSeek: Extraction → Notion (งานหนัก)
```
INPUT: เอกสาร chunk + extraction template จาก Claude

DeepSeek ทำสำหรับแต่ละ chunk:
  FOR each quote found:
    → เขียน 1 record ใน Quotes DB ทันที
    → fields: Quote, Speaker, Tag, Sentiment, Quarter, Source Doc
    → แปล Quote TH ในตัว
    → ไม่รอให้ครบทุก quote ก่อนค่อยเขียน

  FOR each commitment found:
    → เขียน 1 record ใน Roadmap DB ทันที
    → fields: Commitment, Category, Confidence, Target Quarter
    → link → Origin Quote ที่เพิ่งสร้าง

  FOR each key insight:
    → เขียน 1 record ใน Notes DB
    → fields: Title, Note Type, Tags, body content

  เมื่อ chunk เสร็จ:
    → อัปเดต Source record: progress tracking

OUTPUT: N records ใน Notion (ไม่มี intermediate file)
TOKEN COST (DeepSeek): ต่ำมาก เพราะ output เป็น structured JSON ทีละ record
```

### Step 4 — Claude: Synthesis (เบา)
```
INPUT: query จาก Notion (ไม่ใช่ raw document)

Claude query Notion:
  - "quotes จาก Source นี้ทั้งหมด" → ได้ N records
  - "roadmap items ที่เพิ่งสร้าง" → ได้ M records

Claude สังเคราะห์:
  - เขียน Executive Summary (1 text field ใน Analytic Reports)
  - ประเมิน management tone → อัปเดต Companies DB
  - อัปเดต Task: Status=done
  - สร้าง Analytic Report: Status=draft

OUTPUT: 1 Analytic Report record + Companies update
TOKEN COST: ~500-800 tokens (ไม่ใช่ 5,000+)
```

### Step 5 — User: Review & Approve
```
User เปิด Notion → เห็น Analytic Report Status=draft
  - อ่าน Executive Summary
  - ตรวจสอบ Quotes ที่ DeepSeek สกัด
  - แก้ไขถ้าต้องการ
  - เปลี่ยน Status → approved

GitHub Actions sync อัตโนมัติทุก 6 ชั่วโมง
```

### Step 6 — GitHub Actions: Publish
```
notion-sync.js:
  - ดึง Analytic Reports ที่ Status=published
  - ดึง Quotes, Roadmap, Notes ที่ link กัน
  - เขียน data/{TICKER}/data.json

generate-quartz.js:
  - สร้าง Markdown จาก JSON
  - deploy ไป GitHub Pages
```

---

## 5. Database Schema (7 DBs)

### DB 1: Companies
| Field | Type | หมายเหตุ |
|-------|------|----------|
| Ticker | title | Primary key |
| Name / Name TH | text | |
| Sector / Industry | text | Industry เฉพาะกว่า Sector |
| Exchange / Country | text/select | |
| CEO / Description | text | |
| Employees / Market Cap (B) | number | |
| Management Tone | select | bullish / cautious / mixed |
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
| Analyzed By | select | Claude / DeepSeek / Manual |
| Status | select | pending / extracting / analyzed / archived |
| Tags | multi-select | earnings / financials / strategy / guidance / risk |

### DB 3: Quotes
| Field | Type | หมายเหตุ |
|-------|------|----------|
| Quote | title | ข้อความต้นฉบับ |
| Quote TH | text | DeepSeek แปล |
| Company / Source Doc | relation | |
| Date / Quarter | date/select | |
| Segment | select | Prepared Remarks / Q&A / Written Submission |
| Speaker | text | CEO, CFO... |
| Tag | select | growth / risk / strategy / guidance / product / macro |
| Sub-tag | multi-select | revenue-guidance / margin / capex / AI / china-risk / competition / product-launch / hiring / buyback / debt |
| Sentiment | select | bullish / neutral / cautious / bearish |
| Analyst Note | text | Claude เพิ่มภายหลัง |
| Parent Quote | relation → self | quotes ที่เกี่ยวกัน |

### DB 4: Roadmap
| Field | Type | หมายเหตุ |
|-------|------|----------|
| Commitment | title | |
| Company / Source Doc | relation | |
| Origin Quote | relation → Quotes | |
| Evidence | relation → Quotes | หลักฐาน delivery |
| Status | select | pending / in_progress / monitoring / delivered / missed |
| Category | select | Strategic / Financial / Product / Operational / Regulatory |
| Confidence | select | low / medium / high |
| Quarter Said / Target Quarter | select | |
| Delivery Note | text | สรุปผลการส่งมอบ |
| Parent Commitment | relation → self | |

### DB 5: Notes (Research Notes)
| Field | Type | หมายเหตุ |
|-------|------|----------|
| Title | title | |
| Company / Source Doc | relation | |
| Note Type | select | Analysis / Observation / Risk / Thesis / Update / Question |
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
| Status | select | pending / in_progress / done / blocked |
| Priority / Assigned To | select | |
| Related Report / Due Quarter | relation/select | |

---

## 6. Relation Map

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

## 7. Web Interface Mapping

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

## 8. Token Cost Comparison

| Operation | แบบเก่า | แบบใหม่ | ประหยัด |
|-----------|---------|---------|---------|
| วิเคราะห์ Earnings Call | ~8,000 tokens (Claude) | ~500 tokens (DeepSeek extract) + 800 tokens (Claude synth) | ~85% |
| อัปเดต roadmap 1 item | ~5,000 tokens (โหลด JSON) | ~100 tokens (Notion API call) | ~98% |
| ตอบคำถาม "management tone ล่าสุด" | ~3,000 tokens (โหลด JSON) | ~200 tokens (Notion query) | ~93% |
| เขียน Analytic Report | ~6,000 tokens | ~800 tokens (Claude + Notion data) | ~87% |

---

## 9. Cowork Skills

| Skill | AI ที่ใช้ | ทำอะไร |
|-------|----------|--------|
| `prometheus:add-company` | Claude | Step 1-2: Bootstrap JSON + Notion + Sources |
| `prometheus:analyze-earnings` | DeepSeek + Claude | Step 3-4: Extract → Notion → Synthesize |
| `prometheus:analyze-report` | DeepSeek + Claude | Step 3-4: สำหรับ Annual Report / 10-K |
| `prometheus:track-delivery` | Claude | Query Notion Roadmap → ประเมิน delivery rate |
| `fix-ui` | Claude | debug website rendering issues |

---

## 10. การเปลี่ยนแปลงจาก v1 → v2.1

| สิ่งที่เปลี่ยน | v1 | v2.1 |
|----------------|-----|------|
| Primary storage | data.json | Notion (JSON เป็น output เท่านั้น) |
| Analysis engine | Claude ทำทุกอย่าง | DeepSeek extract, Claude synthesize |
| Data loading | โหลดทั้งก้อน | Notion query เฉพาะส่วน |
| Source tracking | text field | Sources DB (relation graph) |
| Task visibility | ไม่มี | Tasks DB (User เห็นความคืบหน้า) |
| Report pipeline | ไม่มี | Draft → Review → Published |
| DB count | 4 | 7 |
| Token cost | สูงมาก | ลดลง 85-98% ต่อ operation |
