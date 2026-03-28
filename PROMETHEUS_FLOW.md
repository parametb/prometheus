# Prometheus — Flow สำหรับเพิ่มบริษัทใหม่

คู่มือนี้แสดง prompt ที่พิมพ์ได้ทีละขั้น เรียงตามลำดับที่ควรทำ โดยใช้บริษัท **B (Barrick Mining)** เป็น template อ้างอิง

---

## ภาพรวม Flow ทั้งหมด

```
Step 1  →  เพิ่มบริษัทใหม่ (add-company)
Step 2  →  เพิ่มข้อมูลเชิงลึก (overview, ownership, structure)
Step 3  →  วิเคราะห์ Annual Report / 10-K ย้อนหลัง 5 ปี (analyze-report)
Step 4  →  วิเคราะห์ Earnings Call (analyze-earnings)
Step 5  →  อัปเดต Roadmap เมื่อมีข้อมูลใหม่ (track-delivery)
Step 6  →  บำรุงรักษาข้อมูลรายไตรมาส (maintenance)
```

---

## STEP 1 — เพิ่มบริษัทใหม่เข้าระบบ

**Prompt ที่พิมพ์:**
```
เพิ่มบริษัทใหม่เข้า Prometheus:
- Ticker: [TICKER]
- ชื่อ: [ชื่อเต็มบริษัท]
- Sector: [Technology / Finance / Healthcare / Energy / Consumer / Mining / ...]
- Exchange: [NYSE / NASDAQ / TSX / SET / ...]
- TradingView Symbol: [EXCHANGE:TICKER]  ← ตรวจสอบที่ tradingview.com
- คำอธิบาย: [1-2 ประโยค อธิบายธุรกิจหลัก]
```

**ตัวอย่าง (Barrick):**
```
เพิ่มบริษัทใหม่เข้า Prometheus:
- Ticker: B
- ชื่อ: Barrick Mining Corporation
- Sector: Mining
- Exchange: NYSE
- TradingView Symbol: NYSE:B
- คำอธิบาย: ผู้ผลิตทองคำรายใหญ่อันดับ 2 ของโลก มีเหมืองใน 18 ประเทศ เน้นทองคำและทองแดง
```

> ⚠️ **ข้อควรระวัง TradingView Symbol:** บริษัทอาจมี ticker ต่างกันบน TradingView กับ exchange จริง
> เช่น Barrick เดิมใช้ `NYSE:GOLD` แต่เปลี่ยนเป็น `NYSE:B` ในปี 2025 ให้ตรวจสอบที่ tradingview.com ก่อนเสมอ

**ผลลัพธ์:** สร้างไฟล์ `data/[TICKER]/data.json` และลงทะเบียนใน `data/companies.json`

---

## STEP 2 — เพิ่มข้อมูลเชิงลึก (Overview Panel)

ทำทีละ section หรือทำรวมครั้งเดียวก็ได้

### 2a — ข้อมูลพื้นฐาน + Moat + Thesis

**Prompt:**
```
เพิ่ม overview ให้ [TICKER] ใน Prometheus:

ข้อมูลบริษัท:
- ก่อตั้ง: [ปี]
- สำนักงาน: [เมือง ประเทศ]
- พนักงาน: [จำนวน]
- สิ้นปีบัญชี: December 31 (หรือวันที่จริง) ถ้าตาม US GAAP ให้ใส่รอบบัญชีตามสัปดาห์ภาษีด้วย

รูปแบบธุรกิจ: [อธิบาย 2-3 ประโยค]
ตำแหน่งการแข่งขัน: [อธิบาย 1-2 ประโยค]
หน้ารายงานผู้สอบบัญชีและ Key audit matter

จุดแข็ง (Moat):
- [จุดแข็ง 1]
- [จุดแข็ง 2]
- [จุดแข็ง 3]

Bull Case: [เหตุผลในการถือหุ้น 2-3 ประโยค]
Bear Case: [ความเสี่ยงหลัก 2-3 ประโยค]
```

### 2b — Segments (รายได้แยกกลุ่มธุรกิจ)

**Prompt:**
```
เพิ่ม segments ให้ [TICKER] จากข้อมูล FY[ปี]:

[ชื่อ Segment 1]: $[X]B คิดเป็น [Y]% ของรายได้รวม, YoY [+/-Z]%
  - สินทรัพย์หลัก: [รายชื่อ]
  - ประเภท: [gold / copper / silver / software / hardware / services / cloud / energy]

[ชื่อ Segment 2]: $[X]B คิดเป็น [Y]% ของรายได้รวม, YoY [+/-Z]%
  ...
```

### 2c — Timeline ประวัติบริษัท

**Prompt:**
```
เพิ่ม timeline ประวัติ [TICKER]:

[ปี] [founding] ก่อตั้งบริษัท โดย [ผู้ก่อตั้ง] ที่ [สถานที่]
[ปี] [merger] เข้าซื้อ [บริษัท]
[ปี] [milestone] [เหตุการณ์สำคัญ]
[ปี] [financial] [IPO / ออก Bond / เปลี่ยน Ticker]
[ปี] [project] เริ่มโครงการ [ชื่อ]
[ปี] [crisis] [วิกฤตหรือเหตุการณ์ลบ]

ประเภท: founding, merger, milestone, project, financial, crisis, product
```

### 2d — ผู้บริหาร

**Prompt:**
```
เพิ่มข้อมูลผู้บริหาร [TICKER]:

[ชื่อ] — [ตำแหน่ง] (ดำรงตำแหน่งตั้งแต่ปี [ปี])
ประวัติ: [1-2 ประโยค]

[ชื่อ] — [ตำแหน่ง] (ดำรงตำแหน่งตั้งแต่ปี [ปี])
ประวัติ: [1-2 ประโยค]
```

### 2e — ความเสี่ยง

**Prompt:**
```
เพิ่ม key risks ให้ [TICKER]:

[ชื่อความเสี่ยง] — ระดับ: [high/medium/low]
  รายละเอียด: [อธิบาย]
  การรับมือ: [วิธีที่บริษัทจัดการ]
```

### 2f — โครงสร้างผู้ถือหุ้น

**Prompt:**
```
เพิ่มข้อมูลผู้ถือหุ้น [TICKER]:

ผู้ถือหุ้นหลัก:
- [ชื่อกองทุน]: [X]% — ประเภท: [institutional/insider/retail]
- [ชื่อกองทุน]: [X]%
- Float: [X]%  ← รวมแล้วต้องได้ 100%

โครงสร้างบริษัทย่อย/Associated/JV:
- [ชื่อบริษัท]: ถือ [X]% — ประเภท: [subsidiary/associated/jv] — partner: [ชื่อคู่ค้า ถ้ามี]
- [ชื่อบริษัท]: ถือ [X]%
```

---

## STEP 3 — วิเคราะห์ Annual Report / 10-K

**Prompt (วิธี 1 — paste ข้อมูลเอง):**
```
วิเคราะห์ annual report ของ [TICKER] FY[ปี]

ข้อมูลทางการเงิน (จาก Income Statement):
Revenue: [FY-2] $X, [FY-1] $X, [FY] $X (หน่วย: Billion USD)
Gross Profit: ...
Operating Income: ...
Net Income: ...
EPS diluted: ...
Free Cash Flow: ...

ลิงก์ 10-K: [URL จาก SEC EDGAR หรือ IR website]
```

**Prompt (วิธี 2 — ส่ง URL หรือ PDF):**
```
วิเคราะห์ 10-K ของ [TICKER] จาก URL นี้: [URL]
```

**Prompt (วิธี 3 — paste ส่วน MD&A):**
```
วิเคราะห์ annual report ของ [TICKER] FY[ปี]
นี่คือส่วน MD&A ที่ copy มา:

[paste เนื้อหา]
```

**ผลลัพธ์ที่ได้:**
- ตาราง financial metrics (ตรวจสอบก่อน confirm)
- Note สรุปการวิเคราะห์ annual report
- Roadmap items จาก forward-looking statements

**ข้อมูลพิเศษที่ต้องเพิ่มเองหลังจากนี้ (ใส่ใน Prompt แยก):**

### เพิ่ม Sankey Diagram (Revenue Breakdown)

```
เพิ่ม Sankey diagram ให้ [TICKER] FY[ปี]:

Segments (ซ้าย):
- [Segment 1]: $X.XXB
- [Segment 2]: $X.XXB
...

Flow:
→ Total Revenue: $XX.XXB
→ Cost of Sales: $XX.XXB
→ Gross Profit: $XX.XXB
→ D&A: $X.XXB
→ G&A: $X.XXB
→ Operating Income: $XX.XXB
→ Tax & Minority Interest: $X.XXB
→ Net Earnings: $XX.XXB
```

---

## STEP 4 — วิเคราะห์ Earnings Call

**Prompt (paste transcript):**
```
วิเคราะห์ earnings call ของ [TICKER] Q[X] FY[ปี] วันที่ [YYYY-MM-DD]

[paste transcript ทั้งหมด หรือส่วนสำคัญ]
```

**Prompt (ส่ง URL):**
```
วิเคราะห์ earnings call ของ [TICKER] Q[X] FY[ปี]:
Transcript: [URL จาก seekingalpha / motleyfool / investor relations]
```

**ผลลัพธ์ที่ได้:**
- Quotes 5-15 รายการ พร้อม Thai translation
- Roadmap commitments ใหม่
- Note สรุป call

> 💡 **Tip:** หลังจาก skill เพิ่ม quotes แล้ว ถ้าอยากเพิ่ม `quote_th` ให้ทุก quote:
> ```
> เพิ่มคำแปลภาษาไทย (quote_th) ให้ทุก quote ที่เพิ่งเพิ่มใน [TICKER]
> ```

---

## STEP 5 — ติดตาม Delivery Rate

**Prompt (ทำหลัง Earnings แต่ละไตรมาส):**
```
วิเคราะห์ management delivery rate ของ [TICKER]
เทียบ roadmap ที่พูดไว้กับสิ่งที่ทำได้จริง
```

**Prompt (อัปเดต status roadmap item เฉพาะ):**
```
อัปเดต roadmap ของ [TICKER]:
Commitment: "[ข้อความ commitment]"
Status: delivered / partial / missed
Follow-up: [สิ่งที่เกิดขึ้นจริง]
Follow-up date: [YYYY-MM-DD]
```

---

## STEP 6 — Maintenance รายไตรมาส

ทุกๆ ไตรมาส ทำตาม checklist นี้:

```
[ ] วิเคราะห์ Earnings Call ล่าสุด → เพิ่ม quotes + roadmap
[ ] อัปเดต roadmap items จากไตรมาสก่อน (delivered/missed?)
[ ] เพิ่ม financial data จาก 10-Q ถ้ามีตัวเลขใหม่
[ ] ลิงก์ 10-Q ล่าสุด ใส่ใน financials.links
[ ] ตรวจสอบ management tone เปลี่ยนไปไหม
```

**Prompt (maintenance รายไตรมาส):**
```
Quarterly update ของ [TICKER] Q[X] FY[ปี]:
1. นี่คือ earnings call transcript: [paste/URL]
2. อัปเดต roadmap items ที่ pending ให้ตามข้อมูลล่าสุด
3. เพิ่มลิงก์ 10-Q: [URL]
```

---

## Schema Reference — Fields ทั้งหมดที่รองรับ

### `tradingview_symbol` *(ระดับ root)*
```json
"tradingview_symbol": "NYSE:B"
```
ใช้สำหรับแสดง TradingView chart และ Fundamentals widget ต้องตรวจสอบบน tradingview.com ว่า exchange:ticker ถูกต้อง

### `quote_th` *(ใน quotes array)*
```json
{
  "quote": "We are targeting production of 3.5 to 4 million ounces in 2025.",
  "quote_th": "เราตั้งเป้าการผลิต 3.5 ถึง 4 ล้านออนซ์ในปี 2568"
}
```

### `overview.ownership`
```json
"ownership": {
  "major_shareholders": [
    { "name": "Vanguard", "pct": 7.8, "type": "institutional" },
    { "name": "BlackRock", "pct": 6.5, "type": "institutional" },
    { "name": "Float", "pct": 74.6, "type": "retail" }
  ],
  "corporate_structure": [
    {
      "name": "Parent Company Name",
      "children": [
        { "name": "Subsidiary A", "ownership_pct": 100, "type": "subsidiary", "partner": null },
        { "name": "JV Project B",  "ownership_pct": 61.5, "type": "jv", "partner": "Partner Corp" }
      ]
    }
  ]
}
```
ประเภทใน `type`: `subsidiary` หรือ `association` หรือ `jv`

### `financials.breakdown.sankey`
```json
"breakdown": {
  "sankey": {
    "year": 2024,
    "nodes": [
      { "id": 0, "label": "Segment A", "color": "#d29922" },
      { "id": 5, "label": "Total Revenue $12.9B", "color": "#58a6ff" },
      { "id": 6, "label": "Cost of Sales", "color": "#f85149" },
      { "id": 7, "label": "Gross Profit", "color": "#3fb950" }
    ],
    "links": [
      { "source": 0, "target": 5, "value": 4.2 },
      { "source": 5, "target": 6, "value": 8.5 },
      { "source": 5, "target": 7, "value": 4.4 }
    ]
  }
}
```
`source` และ `target` ใช้ `id` ของ nodes — ค่า value เป็นหน่วยเดียวกับ `financials.unit`

---

## Template ไฟล์ data.json แบบ Full

นี่คือ template เต็มที่รวมทุก field ที่รองรับ:

```json
{
  "ticker": "[TICKER]",
  "name": "[Company Full Name]",
  "sector": "[Sector]",
  "exchange": "[Exchange]",
  "tradingview_symbol": "[EXCHANGE:TICKER]",
  "last_updated": "YYYY-MM-DD",
  "description": "[1-2 sentences]",

  "notes": [],
  "quotes": [],
  "roadmap": [],

  "overview": {
    "founded": "[Year]",
    "headquarters": "[City, Country]",
    "employees": "[Number or range]",
    "fiscal_year_end": "[e.g. December 31]",
    "business_model_summary": "",
    "competitive_position": "",
    "moat_factors": [],
    "segments": [],
    "geographies": [],
    "timeline": [],
    "management": [],
    "bull_case": "",
    "bear_case": "",
    "key_risks": [],
    "ownership": {
      "major_shareholders": [],
      "corporate_structure": []
    }
  },

  "financials": {
    "currency": "USD",
    "unit": "Billion",
    "links": [],
    "years": [],
    "metrics": [
      { "name": "Revenue",        "values": [] },
      { "name": "Gross Profit",   "values": [] },
      { "name": "Operating Income","values": [] },
      { "name": "Net Income",     "values": [] },
      { "name": "EPS (diluted)",  "values": [] },
      { "name": "Free Cash Flow", "values": [] },
      { "name": "Total Debt",     "values": [] },
      { "name": "Cash & Equiv.",  "values": [] }
    ],
    "breakdown": {
      "sankey": null
    },
    "notes": ""
  }
}
```

---

## Quick Reference — Prompts สั้นสำหรับใช้งานประจำ

| งาน | Prompt |
|-----|--------|
| เพิ่มบริษัทใหม่ | `เพิ่มบริษัทใหม่เข้า Prometheus: [TICKER] - [ชื่อ] - [Sector] - [Exchange]` |
| วิเคราะห์ 10-K | `วิเคราะห์ 10-K ของ [TICKER] FY[ปี]: [URL หรือ paste]` |
| วิเคราะห์ Earnings | `วิเคราะห์ earnings call ของ [TICKER] Q[X] FY[ปี]: [paste transcript]` |
| แปล quotes เป็นไทย | `เพิ่มคำแปลภาษาไทย (quote_th) ให้ทุก quote ใน [TICKER]` |
| ติดตาม roadmap | `วิเคราะห์ management delivery rate ของ [TICKER]` |
| อัปเดต roadmap item | `อัปเดต roadmap [TICKER]: "[commitment]" → status: delivered, follow-up: [สิ่งที่เกิดขึ้น]` |
| เปิดดูบริษัท | เปิด `index.html` → กดชื่อบริษัท (URL: `company.html?ticker=[TICKER]`) |
