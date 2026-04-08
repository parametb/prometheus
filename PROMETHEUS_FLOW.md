# PROMETHEUS_FLOW.md — v2.0
> อัปเดต: 2026-04-08 | สถาปัตยกรรมใหม่: Notion-First + Quartz Web Output

---

## 1. ภาพรวมสถาปัตยกรรมใหม่

```
[Input: Document / Transcript / Report]
         │
         ▼
[Claude: วิเคราะห์ → สร้าง JSON โครงบริษัท]
         │
         ▼
[Notion: ศูนย์กลางข้อมูลทั้งหมด]
  ├── Company Hub Page (หน้าหลักแต่ละบริษัท)
  ├── DB: Companies       ← Profile + ข้อมูลพื้นฐาน
  ├── DB: Sources         ← เอกสารต้นฉบับทุกชิ้น (NEW)
  ├── DB: Quotes          ← คำพูดผู้บริหาร → linked to Sources
  ├── DB: Roadmap         ← commitment tracking → linked to Quotes + Sources
  ├── DB: Research Notes  ← analysis notes → linked to Sources
  ├── DB: Analytic Reports← รายงานสรุป → linked to Notes + Quotes + Roadmap (NEW)
  └── DB: Tasks           ← workflow Claude/User (NEW)
         │
         ▼
[GitHub Actions: Notion → JSON → Quartz Markdown]
         │
         ▼
[Website: Dashboard + Company Pages]
  ├── Tab: Overview     ← Companies + Research Notes (thesis)
  ├── Tab: Notes        ← Research Notes + Analytic Reports
  ├── Tab: Quotes       ← Quotes (grouped by quarter/tag)
  ├── Tab: Roadmap      ← Roadmap (grouped by status/category)
  ├── Tab: Financials   ← JSON financial data
  └── Tab: Sources      ← Sources (NEW - document library)
```

---

## 2. Database Schema Design

### 2.1 DB: Companies (ปรับปรุงจากเดิม)

| Field | Type | เดิม | หมายเหตุ |
|-------|------|------|----------|
| Ticker | title | ✅ | Primary key |
| Name | text | ✅ | ชื่อภาษาอังกฤษ |
| Name TH | text | ✅ | ชื่อภาษาไทย |
| Sector | text | ✅ | กลุ่มธุรกิจกว้าง (Technology, Healthcare...) |
| Industry | text | ❌ **NEW** | เฉพาะเจาะจงกว่า (Semiconductors, Biotech...) |
| Exchange | text | ✅ | NYSE, NASDAQ, etc. |
| Country | select | ❌ **NEW** | US, CN, UK... |
| CEO | text | ✅ | ชื่อ CEO |
| Description | text | ✅ | สรุปธุรกิจ |
| Employees | number | ✅ | จำนวนพนักงาน |
| Market Cap (B) | number | ❌ **NEW** | ล้านล้านบาท (update รายไตรมาส) |
| Management Tone | select | ✅ | bullish / cautious / mixed |
| Conviction Level | select | ❌ **NEW** | high / medium / low / watch |
| Investment Thesis | text | ❌ **NEW** | สรุปวิทยาทัศน์การลงทุน |
| Last Analyzed | date | ❌ **NEW** | วันที่วิเคราะห์ล่าสุด |
| TradingView Symbol | text | ✅ | สำหรับ widget |
| Website | url | ❌ **NEW** | เว็บบริษัท |

**Rollup (auto-compute):**
- `Quote Count` ← count จาก Quotes relation
- `Roadmap Delivered %` ← % delivered จาก Roadmap relation
- `Open Tasks` ← count pending/in_progress จาก Tasks relation

---

### 2.2 DB: Sources (ใหม่ทั้งหมด)

> เป็น "ห้องสมุดเอกสาร" — ทุก quote, note, roadmap item ต้องอ้างอิงกลับมาที่นี่

| Field | Type | คำอธิบาย |
|-------|------|----------|
| Title | title | ชื่อเอกสาร เช่น "NVDA Q1 2026 Earnings Call" |
| Company | relation → Companies | บริษัทที่เกี่ยวข้อง |
| Source Type | select | Annual Report / Earnings Call / Press Release / SEC Filing / News / Research |
| Date | date | วันที่เผยแพร่เอกสาร |
| Quarter | select | Q1 2025 / Q2 2025... |
| URL | url | ลิงก์ต้นฉบับ |
| File | files | อัปโหลดไฟล์ PDF (ถ้ามี) |
| Analyzed By | select | Claude / Manual |
| Status | select | pending / analyzed / archived |
| Tags | multi-select | earnings / financials / strategy / guidance / risk |

**Rollup:**
- `Quote Count` ← count จาก Quotes relation
- `Roadmap Count` ← count จาก Roadmap relation

---

### 2.3 DB: Quotes (ปรับปรุงจากเดิม)

| Field | Type | เดิม | หมายเหตุ |
|-------|------|------|----------|
| Quote | title | ✅ | ข้อความต้นฉบับ |
| Quote TH | text | ✅ | แปลไทย |
| Company | relation → Companies | ✅ | |
| Source | relation → Sources | ⚠️ **เปลี่ยน** | เดิมเป็น text → ต้องเป็น relation |
| Date | date | ✅ | |
| Quarter | select | ✅ | |
| Segment | select | ✅ | Prepared Remarks / Q&A / Written Submission |
| Speaker | text | ✅ | CEO, CFO... |
| Tag | select | ✅ | growth / risk / strategy / guidance / product / macro |
| Sub-tag | multi-select | ✅ (ว่าง!) | **ต้องเพิ่ม options** ด้านล่าง |
| Sentiment | select | ✅ | bullish / neutral / cautious / bearish |
| Parent Quote | relation → self | ✅ | สำหรับ quote ที่เกี่ยวข้องกัน |
| Analyst Note | text | ❌ **NEW** | บันทึกความเห็นนักวิเคราะห์ |

**Sub-tag options ที่แนะนำ:**
`revenue-guidance` / `margin` / `capex` / `AI` / `china-risk` / `competition` / `product-launch` / `hiring` / `buyback` / `debt`

---

### 2.4 DB: Roadmap (ปรับปรุงจากเดิม)

| Field | Type | เดิม | หมายเหตุ |
|-------|------|------|----------|
| Commitment | title | ✅ | สิ่งที่ผู้บริหารสัญญา |
| Company | relation → Companies | ✅ | |
| Source | relation → Sources | ⚠️ **เปลี่ยน** | เดิมเป็น text |
| Origin Quote | relation → Quotes | ✅ | quote ต้นกำเนิด |
| Status | select | ✅ | pending / in_progress / monitoring / delivered / missed |
| Category | select | ✅ | Strategic / Financial / Product / Operational / Regulatory |
| Confidence | select | ✅ | low / medium / high |
| Quarter Said | select | ✅ | |
| Target Quarter | select | ✅ | |
| Date Said | date | ✅ | |
| Follow Up Date | date | ✅ | |
| Follow Up | text | ✅ | หมายเหตุ follow up |
| Parent Commitment | relation → self | ✅ | sub-commitment |
| Evidence | relation → Quotes | ❌ **NEW** | หลักฐานที่ confirm/deny delivery |
| Delivery Note | text | ❌ **NEW** | สรุปผลการส่งมอบ |

---

### 2.5 DB: Research Notes (เปลี่ยนชื่อจาก Notes + ปรับปรุง)

| Field | Type | เดิม | หมายเหตุ |
|-------|------|------|----------|
| Title | title | ✅ | |
| Company | relation → Companies | ✅ | |
| Note Type | select | ❌ **NEW** | Analysis / Observation / Risk / Thesis / Update / Question |
| Source | relation → Sources | ❌ **NEW** | อ้างอิงเอกสารต้นทาง |
| Date | date | ✅ | |
| Quarter | select | ❌ **NEW** | เพื่อ filter ตามไตรมาส |
| Tags | multi-select | ✅ | earnings / risk / strategy / growth / macro / valuation / services / china |
| Rating | number | ✅ | 1-5 ความสำคัญ |
| Active | checkbox | ✅ | ยังใช้งานอยู่หรือไม่ |
| Related Quotes | relation → Quotes | ❌ **NEW** | quote ที่เกี่ยวข้อง |
| Related Roadmap | relation → Roadmap | ❌ **NEW** | commitment ที่เกี่ยวข้อง |

---

### 2.6 DB: Analytic Reports (ใหม่ทั้งหมด)

> Claude เขียน draft รายงานที่นี่ → User review → Publish → Sync ไปเว็บ

| Field | Type | คำอธิบาย |
|-------|------|----------|
| Title | title | เช่น "NVDA Q1 2026 — Post-Earnings Analysis" |
| Company | relation → Companies | |
| Report Type | select | Earnings Analysis / Annual Review / Thesis Update / Risk Review / Sector Analysis |
| Quarter | select | ไตรมาสที่วิเคราะห์ |
| Status | select | draft / review / approved / published |
| Author | select | Claude / User / Both |
| Executive Summary | text | สรุปย่อ (แสดงบนเว็บ) |
| Related Notes | relation → Research Notes | note ที่ใช้ประกอบ |
| Related Quotes | relation → Quotes | quote ที่อ้างอิงในรายงาน |
| Related Roadmap | relation → Roadmap | commitment ที่พูดถึง |
| Source | relation → Sources | เอกสารที่วิเคราะห์ |
| Created | created_time | auto |
| Last Edited | last_edited_time | auto |

---

### 2.7 DB: Tasks (ใหม่ทั้งหมด)

> Claude ใช้ DB นี้ track งานของตัวเอง — User เห็นความคืบหน้า

| Field | Type | คำอธิบาย |
|-------|------|----------|
| Task | title | ชื่องาน เช่น "Analyze NVDA Q1 2026 10-K" |
| Company | relation → Companies | |
| Task Type | select | Add Data / Analyze Document / Write Report / Update Roadmap / Fix UI |
| Status | select | pending / in_progress / done / blocked |
| Priority | select | high / medium / low |
| Assigned To | select | Claude / User |
| Related Report | relation → Analytic Reports | |
| Related Source | relation → Sources | เอกสารที่ต้องทำ |
| Due Quarter | select | |
| Notes | text | รายละเอียดหรือ blocker |
| Completed | date | วันที่เสร็จ |

---

## 3. Relation Map (Obsidian-style)

```
Companies ←──────────────────────────────────────────┐
    │                                                  │
    ├──→ Sources ──→ Quotes ──→ Roadmap               │
    │        │           │          │                  │
    │        └──→ Research Notes ←─┘                  │
    │                    │                             │
    │                    └──→ Analytic Reports ────────┘
    │
    └──→ Tasks ──→ Analytic Reports
```

**Key chains (ตามแบบ Obsidian):**
- `Source → Quote → Roadmap` (เอกสาร → คำพูด → commitment)
- `Quote → Research Note → Analytic Report` (evidence chain)
- `Roadmap → Evidence Quote → Delivery Note` (delivery tracking)
- `Company → all DBs` (hub-and-spoke)

---

## 4. Web Interface Mapping

| Website Tab | Notion Source | Fields แสดง |
|-------------|---------------|-------------|
| **Overview** | Companies DB | Ticker, Name, Sector, CEO, Description, Conviction Level, Management Tone, Investment Thesis |
| | Research Notes (Type=Thesis) | Latest active thesis note |
| **Notes** | Research Notes | Title, Note Type, Date, Tags, Rating + body content |
| | Analytic Reports (Status=published) | Title, Report Type, Quarter, Executive Summary |
| **Quotes** | Quotes | Quote, Speaker, Quarter, Segment, Tag, Sentiment |
| | *(grouped by Tag → Quarter)* | |
| **Roadmap** | Roadmap | Commitment, Status, Category, Quarter Said, Target Quarter, Confidence |
| | *(grouped by Status)* | |
| **Financials** | JSON (data.json) | ยังคงเป็น JSON ไปก่อน |
| **Sources** *(NEW tab)* | Sources | Title, Source Type, Date, Quarter, Status |

---

## 5. Claude Workflow — เพิ่มบริษัทใหม่

```
Step 1: สร้าง JSON โครงสร้าง
─────────────────────────────
Claude สร้าง data/{TICKER}/data.json พื้นฐาน:
  - ticker, name, sector, exchange
  - เพิ่มใน companies.json
  - สร้าง Company page ใน Notion (Companies DB)

Step 2: เพิ่ม Sources
─────────────────────────────
Claude สร้าง record ใน Sources DB สำหรับเอกสารแรก:
  - ชื่อ, type, date, URL
  - Status = "pending"

Step 3: วิเคราะห์เอกสาร
─────────────────────────────
Claude อ่านเอกสาร → สร้าง:
  a) Quotes ใน Quotes DB (linked to Source)
  b) Roadmap items ใน Roadmap DB (linked to Quote + Source)  
  c) Research Notes ใน Research Notes DB
  Update Source status = "analyzed"

Step 4: เขียน Analytic Report
─────────────────────────────
Claude เขียน draft ใน Analytic Reports DB:
  - Status = "draft"
  - Link ไปยัง Notes, Quotes, Roadmap ที่เกี่ยวข้อง
  - User review → Status = "approved"

Step 5: Sync ไปเว็บ
─────────────────────────────
GitHub Actions (every 6h):
  - notion-sync.js ดึงข้อมูลจากทุก DB
  - generate-quartz.js สร้าง Markdown
  - Website อัปเดตอัตโนมัติ
```

---

## 6. การเปลี่ยนแปลงจาก v1 → v2

| สิ่งที่เปลี่ยน | v1 (เก่า) | v2 (ใหม่) |
|----------------|-----------|-----------|
| Source tracking | plain text field | Sources DB (relation) |
| Analysis output | Notes (generic) | Research Notes + Analytic Reports |
| Task management | ไม่มี | Tasks DB |
| Tag system | กระจัดกระจาย | Sub-tags + Note Type เพิ่มเติม |
| Company profile | 9 fields | 17 fields (เพิ่ม Conviction, Thesis, Industry ฯลฯ) |
| Workflow | JSON-first → Notion | JSON bootstrap → Notion-first |
| Cross-links | minimal | full relational graph |
| Web tabs | 5 tabs | 6 tabs (+Sources) |

---

## 7. Fields ที่ต้องเพิ่มใน Notion (Action Items)

### Companies DB — เพิ่ม 8 fields:
- [ ] `Industry` (text)
- [ ] `Country` (select: US / CN / EU / Other)
- [ ] `Market Cap (B)` (number)
- [ ] `Conviction Level` (select: high / medium / low / watch)
- [ ] `Investment Thesis` (text)
- [ ] `Last Analyzed` (date)
- [ ] `Website` (url)
- [ ] Rollup: `Roadmap Delivered %`

### Quotes DB — เพิ่ม 2 fields:
- [ ] เปลี่ยน `Source` จาก text → relation ไปยัง Sources DB
- [ ] เพิ่ม `Analyst Note` (text)
- [ ] เพิ่ม Sub-tag options: `revenue-guidance`, `margin`, `capex`, `AI`, `china-risk`, `competition`, `product-launch`, `hiring`, `buyback`, `debt`

### Roadmap DB — เพิ่ม 3 fields:
- [ ] เปลี่ยน `Source` จาก text → relation ไปยัง Sources DB
- [ ] เพิ่ม `Evidence` (relation → Quotes)
- [ ] เพิ่ม `Delivery Note` (text)

### Research Notes DB — เพิ่ม 5 fields:
- [ ] เพิ่ม `Note Type` (select)
- [ ] เพิ่ม `Source` (relation → Sources DB)
- [ ] เพิ่ม `Quarter` (select)
- [ ] เพิ่ม `Related Quotes` (relation → Quotes)
- [ ] เพิ่ม `Related Roadmap` (relation → Roadmap)

### สร้าง DB ใหม่ 3 ตัว:
- [ ] **Sources DB** (ตามสเปค 2.2)
- [ ] **Analytic Reports DB** (ตามสเปค 2.6)
- [ ] **Tasks DB** (ตามสเปค 2.7)
