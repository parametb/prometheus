# 📈 Prometheus — Investment Research

เว็บไซต์ส่วนตัวสำหรับติดตามข้อมูลบริษัทเพื่อการลงทุน รวบรวม Notes, Quotes จาก Earnings Call, Roadmap Tracker, ข้อมูลทางการเงิน และ Deep Dive Analysis

**Repository:** https://github.com/parametb/prometheus

---

## 📁 โครงสร้างไฟล์

```
investment-research/
├── index.html              ← หน้าหลัก (รายชื่อบริษัททั้งหมด)
├── company.html            ← หน้าข้อมูลรายบริษัท (tabs: Overview, Notes, Quotes, Roadmap, Financials)
├── overview.html           ← หน้า Deep Dive (Segments, Geography, Timeline, Management, Thesis, Risks)
├── i18n.js                 ← ระบบ 2 ภาษา ไทย/อังกฤษ (ใหม่)
├── README.md               ← ไฟล์นี้
├── data/
│   ├── companies.json      ← รายชื่อบริษัททั้งหมด (index)
│   └── [TICKER]/
│       ├── data.json       ← ข้อมูลหลักของบริษัท
│       ├── snapshot.json   ← snapshot สำหรับ overview
│       └── history/        ← ประวัติ patch ทั้งหมด
├── scripts/
│   ├── apply_patch.py      ← apply JSON patch เข้า data.json
│   ├── validate_patch.py   ← ตรวจสอบความถูกต้องของ patch
│   └── generate_snapshot.py← สร้าง snapshot.json
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
|--------|--------|--------|-------------|
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

## 🔄 Workflow: GitHub เป็น Source of Truth

**แก้ไขใน GitHub โดยตรง** (Perplexity หรือ browser):
1. ไปที่ https://github.com/parametb/prometheus
2. แก้ไขไฟล์ที่ต้องการ → Commit changes
3. บอก Claude ให้ sync มา → Claude จะ clone และ copy เฉพาะไฟล์ที่ใหม่กว่า

**แก้ไขผ่าน Claude (Cowork)**:
- ใช้ skills เช่น `prometheus:analyze-earnings`, `prometheus:analyze-report`
- Claude แก้ไข data.json ใน local folder โดยตรง
- Push ขึ้น GitHub ทีหลัง (manual หรือขอให้ Claude ทำ)

**หมายเหตุ:** เมื่อแก้ทั้งสองที่พร้อมกัน ให้ดูเวลา commit เป็นหลัก — ไฟล์ที่ commit ล่าสุดคือ version ที่ควรใช้

---

## ✏️ วิธีเพิ่มบริษัทใหม่

ใช้ skill **`prometheus:add-company`** ใน Cowork หรือทำเองดังนี้:

**ขั้นตอนที่ 1:** สร้างโฟลเดอร์ `data/[TICKER]/` และไฟล์ `data.json` ตาม template ด้านล่าง

**ขั้นตอนที่ 2:** เพิ่ม entry ใน `data/companies.json`

### Template: `data/[TICKER]/data.json`

```json
{
  "ticker": "TICKER",
  "name": "Company Name",
  "sector": "Technology",
  "exchange": "NASDAQ",
  "last_updated": "2026-01-01",
  "description": "Short description of the company.",
  "tradingview_symbol": "NASDAQ:TICKER",

  "notes": [
    {
      "date": "2026-01-01",
      "title": "Note title",
      "tags": ["tag1", "tag2"],
      "rating": 4,
      "content": "Note content..."
    }
  ],

  "quotes": [
    {
      "date": "2026-01-30",
      "source": "Q1 FY2026 Earnings Call",
      "speaker": "CEO Name",
      "quote": "Exact quote from management.",
      "quote_th": "คำแปลภาษาไทย (optional)",
      "tag": "growth"
    }
  ],

  "roadmap": [
    {
      "date_said": "2026-01-30",
      "source": "Q1 FY2026 Earnings Call",
      "commitment": "What management committed to do.",
      "status": "pending",
      "follow_up": "Actual outcome (if any)",
      "follow_up_date": ""
    }
  ],

  "financials": {
    "currency": "USD",
    "unit": "Billion",
    "years": [2023, 2024, 2025],
    "metrics": [
      { "name": "Revenue",        "values": [0, 0, 0] },
      { "name": "Net Income",     "values": [0, 0, 0] },
      { "name": "EPS (diluted)",  "values": [0, 0, 0] },
      { "name": "Free Cash Flow", "values": [0, 0, 0] }
    ],
    "notes": "Additional financial notes"
  },

  "overview": {
    "founded": "2000",
    "headquarters": "City, Country",
    "employees": "10,000",
    "fiscal_year_end": "December 31",
    "business_model_summary": "How the company makes money.",
    "competitive_position": "Market position description.",
    "moat_factors": ["Factor 1", "Factor 2"],
    "segments": [],
    "geographies": [],
    "timeline": [],
    "management": [],
    "bull_case": "Reasons to be bullish.",
    "bear_case": "Risks and bear case.",
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

`Technology` · `Finance` · `Healthcare` · `Energy` · `Consumer` · `Mining` · หรือค่าอื่น (จะแสดงสีเทา)

### Timeline event type

`founding` · `merger` · `milestone` · `project` · `financial` · `crisis` · `product`

---

## 🤖 Prometheus Skills (Cowork)

| Skill | ใช้เมื่อ |
|-------|---------|
| `prometheus:add-company` | เพิ่มบริษัทใหม่เข้าระบบ |
| `prometheus:analyze-report` | วิเคราะห์ Annual Report / 10-K → เพิ่ม overview data |
| `prometheus:analyze-earnings` | วิเคราะห์ Earnings Call transcript → เพิ่ม quotes + roadmap |
| `prometheus:track-delivery` | ประเมิน delivery rate ของผู้บริหาร |
| `fix-ui` | แก้ UI bugs เมื่อหน้าว่างหรือแสดงผิด |

---

## 💡 Tips

- **Rating (1-5 ดาว):** ใส่ใน `rating` field ของ notes เพื่อระบุ conviction level
- **quote_th:** เพิ่มคำแปลไทยให้ quotes — จะแสดงใต้ original quote เมื่ออยู่ในโหมดภาษาไทย
- **tradingview_symbol:** ใส่เพื่อแสดง stock chart และ fundamentals จาก TradingView เช่น `"NASDAQ:AAPL"`
- **companies.json counts:** อัปเดต `note_count`, `quote_count`, `roadmap_count` ให้ตรงกับข้อมูลจริงเพื่อให้ dashboard แสดงถูกต้อง
- **last_updated:** อัปเดตทุกครั้งที่เพิ่มข้อมูลใหม่

---

## 🚀 Deploy บน GitHub Pages

1. Push ทุกไฟล์ขึ้น repository `parametb/prometheus`
2. ไปที่ **Settings → Pages** → Source: **Deploy from branch** → branch: **main**
3. เว็บจะพร้อมใช้งานที่ `https://parametb.github.io/prometheus`
