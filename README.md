# 📈 Prometheus — Investment Research

เว็บไซต์ส่วนตัวสำหรับติดตามข้อมูลบริษัทเพื่อการลงทุน รวบรวม Notes, Quotes จาก Earnings Call, Roadmap Tracker, ข้อมูลทางการเงิน และ Deep Dive Analysis

**Repository:** https://github.com/parametb/prometheus  
**Live Site:** https://parametb.github.io/prometheus  
**Knowledge Base:** https://parametb.github.io/prometheus/research/

---

## 🔄 ภาพรวมระบบ (How It Works)

ข้อมูลทุกอย่างไหลจาก **Notion → GitHub → เว็บไซต์** โดยอัตโนมัติ ไม่ต้องแตะโค้ด:

```
Notion (เขียนข้อมูลที่นี่)
    ↓  GitHub Actions รันทุก 6 ชั่วโมง
notion-sync.js
    ↓
data/{TICKER}/data.json
    ↓                        ↓
generate-quartz.js      Dashboard HTML
    ↓                        ↓
quartz/content/*.md     index.html / company.html
    ↓
Quartz Build → /research/companies/{TICKER}
```

**Notion databases ที่ sync:**
- **Companies** — ข้อมูลหลักบริษัท (ticker, sector, exchange, description)
- **Notes** — บันทึกการวิเคราะห์
- **Quotes** — คำพูดผู้บริหารจาก Earnings Call / Annual Report
- **Roadmap** — commitments และ delivery tracking

---

## 📁 โครงสร้างไฟล์

```
prometheus/
├── index.html              ← หน้าหลัก (รายชื่อบริษัททั้งหมด)
├── company.html            ← หน้าข้อมูลรายบริษัท (tabs: Overview, Notes, Quotes, Roadmap, Financials)
├── overview.html           ← หน้า Deep Dive (Segments, Geography, Timeline, Management, Thesis, Risks)
├── i18n.js                 ← ระบบ 2 ภาษา ไทย/อังกฤษ
├── data/
│   ├── companies.json      ← รายชื่อบริษัททั้งหมด (index)
│   └── {TICKER}/
│       └── data.json       ← ข้อมูลหลักของบริษัท (sync จาก Notion)
├── scripts/
│   ├── notion-sync.js      ← Notion → data.json (รันโดย GitHub Actions)
│   ├── generate-quartz.js  ← data.json → quartz/content/*.md
│   ├── apply_patch.py      ← apply JSON patch เข้า data.json (manual)
│   └── validate_patch.py   ← ตรวจสอบความถูกต้องของ patch
├── quartz/
│   └── content/
│       ├── companies/      ← {TICKER}.md (auto-generated)
│       └── sectors/        ← sector pages (auto-generated)
├── .github/
│   └── workflows/
│       └── notion-sync.yml ← GitHub Actions pipeline
└── .claude/
    └── skills/             ← Prometheus skills สำหรับ Cowork/Claude
```

---

## 🌐 ระบบ 2 ภาษา (i18n)

ทุกหน้ารองรับการสลับภาษาไทย ↔ อังกฤษ ผ่านปุ่ม 🇹🇭 / 🇺🇸 ในแถบ nav

**หลักการทำงาน:**
- `i18n.js` เก็บ translation dictionary ทั้ง `th` และ `en`
- `t('key')` คืน string ตาม `currentLang` ปัจจุบัน
- `setLang('en')` สลับภาษา → save ใน localStorage → re-render ทุก label ทันที
- ข้อมูลจาก data.json (quotes, notes, roadmap) แสดงเป็นภาษาต้นฉบับเสมอ — เฉพาะ UI label เท่านั้นที่แปล

**เพิ่ม key ใหม่:** แก้ไข `i18n.js` section `th` และ `en` แล้วใช้ `t('key')` ในโค้ด

---

## 🗂️ บริษัทที่ติดตามอยู่ (13 บริษัท)

| Ticker | บริษัท | Sector | อัพเดทล่าสุด |
|--------|--------|--------|---------------|
| AAPL | Apple Inc. | Technology | 2026-03-29 |
| MSFT | Microsoft Corporation | Technology | 2026-03-29 |
| NVDA | NVIDIA Corporation | Semiconductors | 2026-03-30 |
| TSLA | Tesla, Inc. | Consumer | 2026-04-03 |
| IONQ | IonQ, Inc. | Technology | 2026-04-03 |
| RGTI | Rigetti Computing | Technology | 2026-03-30 |
| QUBT | Quantum Computing Inc. | Technology | 2026-03-29 |
| QBTS | D-Wave Quantum | Technology | 2026-03-29 |
| KEYS | Keysight Technologies | Technology | 2026-04-04 |
| CRSP | CRISPR Therapeutics | Healthcare | 2026-04-04 |
| B | Barrick Mining | Mining | 2026-04-04 |
| NEM | Newmont Corporation | Mining | 2026-04-02 |
| BRBY | Burberry Group | Consumer | 2026-03-31 |

---

## ✏️ วิธีเพิ่มข้อมูล (วิธีที่แนะนำ)

### เพิ่มผ่าน Notion (แนะนำ)

1. เปิด Notion workspace
2. เพิ่มข้อมูลใน database ที่ต้องการ (Notes / Quotes / Roadmap / Companies)
3. รอ GitHub Actions sync อัตโนมัติ (ทุก 6 ชั่วโมง)
4. หรือกด **Actions → notion-sync → Run workflow** เพื่อ sync ทันที

### เพิ่มบริษัทใหม่ผ่าน Cowork

ใช้ skill **`prometheus:add-company`** ใน Cowork:

```
เพิ่ม [TICKER] เข้า Prometheus
```

Skill จะสร้าง `data/{TICKER}/data.json` และลงทะเบียนใน `data/companies.json` ให้อัตโนมัติ

### วิธีสำรอง — สร้างไฟล์เอง

**ขั้นตอนที่ 1:** สร้างโฟลเดอร์ `data/{TICKER}/` และไฟล์ `data.json` ตาม template ด้านล่าง  
**ขั้นตอนที่ 2:** เพิ่ม entry ใน `data/companies.json`

#### Template: `data/{TICKER}/data.json`

```json
{
  "ticker": "TICKER",
  "name": "Company Name",
  "sector": "Technology",
  "exchange": "NASDAQ",
  "last_updated": "2026-01-01",
  "description": "Short description of the company.",
  "tradingview_symbol": "NASDAQ:TICKER",
  "notes": [],
  "quotes": [],
  "roadmap": [],
  "financials": {
    "currency": "USD",
    "unit": "Billion",
    "years": [],
    "metrics": []
  },
  "overview": {
    "founded": "",
    "headquarters": "",
    "employees": "",
    "fiscal_year_end": "December 31",
    "business_model_summary": "",
    "competitive_position": "",
    "moat_factors": [],
    "segments": [],
    "geographies": [],
    "timeline": [],
    "management": [],
    "bull_case": "",
    "bear_case": "",
    "key_risks": []
  }
}
```

---

## 📊 ค่าที่รองรับ

### Roadmap status

| status | ความหมาย |
|--------|----------|
| `delivered` | ✅ ทำตามที่พูดไว้ครบถ้วน |
| `partial` | ⚠️ ทำได้บางส่วน |
| `pending` | ⏳ ยังรอดูผล |
| `missed` | ❌ ไม่ได้ทำตามที่พูดไว้ |
| `monitoring` | 👀 กำลังติดตาม |

### Sector

`Technology` · `Finance` · `Healthcare` · `Energy` · `Consumer` · `Mining` · `Semiconductors` · หรือค่าอื่น (จะแสดงสีเทา)

### Timeline event type

`founding` · `merger` · `milestone` · `project` · `financial` · `crisis` · `product`

---

## 🤖 Prometheus Skills (Cowork)

| Skill | ใช้เมื่อ |
|-------|----------|
| `prometheus:add-company` | เพิ่มบริษัทใหม่เข้าระบบ |
| `prometheus:analyze-report` | วิเคราะห์ Annual Report / 10-K → เพิ่ม overview data |
| `prometheus:analyze-earnings` | วิเคราะห์ Earnings Call transcript → เพิ่ม quotes + roadmap |
| `prometheus:track-delivery` | ประเมิน delivery rate ของผู้บริหาร |
| `fix-ui` | แก้ UI bugs เมื่อหน้าว่างหรือแสดงผิด |

---

## ⚙️ GitHub Actions Pipeline

ไฟล์: `.github/workflows/notion-sync.yml`  
รันอัตโนมัติ: ทุก 6 ชั่วโมง (00:00, 06:00, 12:00, 18:00 UTC)

**Job 1 — Notion Sync + Generate:**
1. `notion-sync.js` — ดึงข้อมูลจาก Notion → `data/{TICKER}/data.json`
2. `generate-quartz.js` — แปลง `data.json` → `quartz/content/companies/{TICKER}.md`
3. commit + push การเปลี่ยนแปลงกลับ repo

**Job 2 — Build + Deploy:**
1. `npx quartz build` — build knowledge base จาก Markdown
2. merge กับ dashboard HTML → `_site/`
3. deploy ขึ้น GitHub Pages

**รัน manual ได้ที่:** Actions → "Notion → Prometheus Sync + Quartz Build" → Run workflow

> **Option เพิ่มเติม:** เปิด `skip_notion: true` เพื่อ build Quartz เฉพาะ (ไม่ดึง Notion)

---

## 💡 Tips

- **Rating (1-5 ดาว):** ใส่ใน `rating` field ของ notes เพื่อระบุ conviction level
- **quote_th:** เพิ่มคำแปลไทยให้ quotes — จะแสดงใต้ original quote เมื่ออยู่ในโหมดภาษาไทย
- **tradingview_symbol:** ใส่เพื่อแสดง stock chart และ fundamentals จาก TradingView เช่น `"NASDAQ:AAPL"`
- **last_updated:** อัปเดตทุกครั้งที่เพิ่มข้อมูลใหม่
- **Knowledge Base:** ดูข้อมูล research เชิงลึกได้ที่ `/research/companies/{TICKER}` — generate อัตโนมัติจาก `data.json`

---

## 🚀 Deploy บน GitHub Pages

ระบบ deploy อัตโนมัติผ่าน GitHub Actions ทุกครั้งที่มีการ sync

**URL หลัก:**
- Dashboard: `https://parametb.github.io/prometheus`
- Knowledge Base: `https://parametb.github.io/prometheus/research/`
- บริษัทเฉพาะ: `https://parametb.github.io/prometheus/research/companies/{TICKER}`
