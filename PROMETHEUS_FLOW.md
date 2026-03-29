# Prometheus — Flow สำหรับเพิ่มบริษัทใหม่

คู่มือนี้แสดง prompt ที่พิมพ์ได้ทีละขั้น เรียงตามลำดับที่ควรทำ โดยใช้บริษัท **B (Barrick Mining)** เป็น template อ้างอิง

---

## API Keys

Keys อยู่ในไฟล์ `.env` (ไม่เก็บใน Git) — โหลดก่อนรัน script ทุกครั้ง:

```bash
source .env
```

สร้าง / แก้ `.env` ได้ที่ไฟล์ `investment-research/.env`
(ดูตัวอย่าง format ในไฟล์นั้นได้เลย — มี `.gitignore` คุ้มกันแล้ว)

**sec-api.io ช่วยอะไรได้:**

| ฟีเจอร์ | US stocks (10-K) | Canadian (40-F) | หมายเหตุ |
|---------|:---:|:---:|---------|
| Auto-find filing URL | ✅ | ✅ | ระบุแค่ ticker + form type |
| Executive compensation | ✅ | ❌ | DEF 14A filers เท่านั้น |
| Subsidiaries (Exhibit 21) | ✅ | ❌ | 10-K filers เท่านั้น |
| Section Extractor | ✅ | ❌ | 10-K/10-Q เท่านั้น |

---

## ⚡ Token-Efficient Save Protocol (อ่านก่อนทุกครั้ง)

> **กฎข้อเดียว: ห้าม Read + Write `data.json` ทั้งไฟล์เพื่อแก้ไขข้อมูล**
> ใช้ scripts ด้านล่างแทนเสมอ

### Partial Update System (ใหม่ — ใช้สำหรับอัปเดตด้วยมือ)

Claude สร้าง JSON patch file → บันทึกใน `data/[TICKER]/patches/` → รัน `merge_patches.py` apply

```bash
# ดูสถานะปัจจุบัน
python scripts/apply_patch.py QUBT --info

# apply patch file เดียว
python scripts/apply_patch.py QUBT data/QUBT/patches/2026-03-29_note.json

# apply ทุก patch ที่รออยู่
python scripts/merge_patches.py QUBT

# preview ก่อน apply
python scripts/merge_patches.py QUBT --dry-run
```

→ ดูตัวอย่าง patch format และ prompt examples เพิ่มเติมได้ที่ **`CLAUDE_DATA_FLOW.md`**

### Automated Pipeline (ใช้กับ DeepSeek)

| งาน | วิธีที่ถูก | วิธีที่ผิด (ห้ามทำ) |
|-----|-----------|-------------------|
| Apply ผล DeepSeek ทั้งหมด | `apply_analysis.py [T] --input file.json` | Read+parse JSON → Read data.json → Write |
| ตรวจสอบสถานะ | `patch.py [T] --info` | Read data.json ทั้งไฟล์ |
| ดู roadmap (track-delivery) | `patch.py [T] --extract-roadmap pending` | Read data.json ทั้งไฟล์ |

**Path ของ scripts:**
```
scripts/apply_patch.py    → investment-research/scripts/apply_patch.py
scripts/merge_patches.py  → investment-research/scripts/merge_patches.py
patch.py                  → **/investment-research/.claude/scripts/patch.py
apply_analysis.py         → **/investment-research/.claude/scripts/apply_analysis.py
fetch_analyze.py          → **/analyze-with-deepseek/scripts/fetch_analyze.py
```

---

## ภาพรวม Flow ทั้งหมด

```
Step 1   →  เพิ่มบริษัทใหม่ (add-company)
Step 2   →  เพิ่มข้อมูลเชิงลึก (overview, ownership, structure)
Step 3   →  วิเคราะห์ Annual Report / 10-K ย้อนหลัง 5 ปี (DeepSeek pipeline)
Step 3b  →  เปรียบเทียบ Annual Report ข้ามปี — Narrative & Accounting Evolution
Step 4   →  วิเคราะห์ Earnings Call (DeepSeek pipeline)
Step 4b  →  ติดตาม Tone Drift ข้าม Earnings Call หลายไตรมาส
Step 5   →  อัปเดต Roadmap เมื่อมีข้อมูลใหม่ (track-delivery)
Step 6   →  บำรุงรักษาข้อมูลรายไตรมาส (maintenance)
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
หน้ารายงานผู้สอบบัญชีล่าสุด: ความเห็นของผู้สอบบัญชี และ Key audit matter

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

## STEP 3 — วิเคราะห์ Annual Report / 10-K (Automated Pipeline)

### วิธีหลัก — Zero-Token Pipeline: DeepSeek → apply_analysis.py (แนะนำ)

**Prompt:**
```
ส่งให้ DeepSeek วิเคราะห์ 10-K ของ [TICKER]:
URL: [URL ของ .htm filing จาก SEC EDGAR หรือ IR website]
```

> **หา URL ได้ที่:** SEC EDGAR → ค้นหา ticker → เลือก 10-K → คลิกไฟล์ `.htm` (ไม่ใช่ PDF)

ระบบรัน **Parallel Agents + Auto-Apply** ใน 3 ขั้นตอน:

```
fetch_analyze.py             →  บันทึกผลลง /tmp/  →  apply_analysis.py
(DeepSeek 4 agents ขนาน)                          (patch.py ทีละรายการ)
~20-40 วินาที                                      ~1 วินาที, ~50 tokens
```

**Command ที่ระบบรัน (มี SEC_API_KEY — ไม่ต้องหา URL เอง):**
```bash
# ง่ายที่สุด — ระบุแค่ ticker + doc-type
python3 fetch_analyze.py \
  --ticker [TICKER] \
  --sec-key $SEC_API_KEY \
  --ds-key $DEEPSEEK_API_KEY \
  --doc-type "10-K" \
  > /tmp/prometheus_analysis.json

python3 apply_analysis.py [TICKER] --input /tmp/prometheus_analysis.json
```

**หรือถ้าไม่มี SEC_API_KEY:**
```bash
python3 fetch_analyze.py --ticker [TICKER] --ds-key $DEEPSEEK_API_KEY \
  --url "[URL]" --doc-type "10-K" \
  > /tmp/prometheus_analysis.json
```

**4 DeepSeek agents ขนาน:**
| Agent | งาน | DeepSeek tokens |
|-------|-----|----------------|
| A — Financials | Revenue, margin, cash commentary | ~2,500 |
| B — Roadmap | Forward-looking commitments | ~2,000 |
| C — Quotes | Executive quotes 5-10 รายการ | ~2,000 |
| D — Risks | Risk factors + mitigation | ~2,000 |

**Alpha Vantage** (3 calls ขนาน): financial metrics structured — เฉพาะ US stocks (10-K filers)

> ⚠️ **บริษัทต่างชาติที่ file 40-F/20-F** (เช่น Barrick) ไม่มีใน AV — ระบบข้าม Phase 1 อัตโนมัติ
> ตัวเลขการเงินต้องใส่เองด้วย `patch.py [T] --add-year [Y] --values '{...}'`

**ถ้า URL ถูก block (403):** หา URL จาก IR website หรือ stockanalysis.com

---

### วิธีสำรอง — Manual (กรณี URL ไม่ work หรือต้องการควบคุมมากขึ้น)

**Prompt (paste ข้อมูลเอง):**
```
วิเคราะห์ annual report ของ [TICKER] FY[ปี] ถึง FY[ปี]

ข้อมูลทางการเงิน (จาก Income Statement):
Revenue: [FY-2] $X, [FY-1] $X, [FY] $X (หน่วย: Billion USD)
Gross Profit: ...
Operating Income: ...
Net Income: ...
EPS diluted: ...
Free Cash Flow: ...

ลิงก์ 10-K: [URL จาก SEC EDGAR หรือ IR website]
```

**Prompt (paste ส่วน MD&A):**
```
วิเคราะห์ annual report ของ [TICKER] FY[ปี]
นี่คือส่วน MD&A ที่ copy มา:

[paste เนื้อหา]
```

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

## STEP 3b — เปรียบเทียบ Annual Report ข้ามปี (Evolution Analysis)

> **แนวคิด:** การอ่าน Annual Report แต่ละปีแบบ standalone มักพลาด "สิ่งที่เปลี่ยนไป" เพราะภาษาผู้บริหารวิวัฒน์อย่างช้าๆ ทีละน้อย Step นี้ใช้ AI เปรียบเทียบ 2 รายงานข้ามปีโดยตรง เพื่อจับ narrative drift, การเปลี่ยน accounting policy, และ risk ที่ถูกเพิ่ม/ลบออก — สิ่งที่นักวิเคราะห์มักมองข้าม

### Trigger Prompt

```
เปรียบเทียบ evolution ของ [TICKER]:
URL ปัจจุบัน: [URL ของ Annual Report / 10-K ปีล่าสุด] ปี [YEAR_NEW]
URL เก่า: [URL ของ Annual Report / 10-K ปีก่อนหน้า] ปี [YEAR_OLD]
doc-type: Annual Report
```

**ตัวอย่าง (Apple):**
```
เปรียบเทียบ evolution ของ AAPL:
URL ปัจจุบัน: https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm ปี 2024
URL เก่า: https://www.sec.gov/Archives/edgar/data/320193/000032019322000108/aapl-20220924.htm ปี 2022
doc-type: Annual Report
```

> 💡 **แนะนำ:** เปรียบเทียบห่างกัน 2-3 ปี เพื่อให้เห็น shift ที่ชัดเจน (เช่น 2024 vs 2022 หรือ 2024 vs 2021)

### สิ่งที่ระบบทำโดยอัตโนมัติ

ระบบดึง 2 URLs ขนาน แล้วรัน **4 Comparison Agents ขนาน**:

| Agent | โฟกัส | สิ่งที่วิเคราะห์ |
|-------|--------|-----------------|
| E — Narrative Drift | MD&A ทั้ง 2 ปี | ภาษา/tone/ความมั่นใจเปลี่ยนไปอย่างไร? คำที่หายไป/เพิ่มขึ้น? |
| F — Business Evolution | Business Overview ทั้ง 2 ปี | กลยุทธ์เปลี่ยนทิศไหม? segment ใหม่/ยุบไป? ลำดับความสำคัญเปลี่ยน? |
| G — Accounting Watch | Critical Accounting ทั้ง 2 ปี | policy เปลี่ยน? revenue recognition เปลี่ยน? goodwill impairment? |
| H — Risk Evolution | Risk Factors ทั้ง 2 ปี | risk ใหม่ที่เพิ่มมา? risk ที่หายไป? ภาษาที่ escalate/de-escalate? |

### ผลลัพธ์ที่ได้

บันทึกเป็น **Note** ใน Prometheus พร้อม tags:
```json
{
  "tags": ["narrative-evolution", "accounting-watch", "multi-year", "[TICKER]"],
  "title": "Evolution Analysis: FY[YEAR_OLD] → FY[YEAR_NEW]",
  "sections": {
    "narrative_drift":    "...",
    "business_evolution": "...",
    "accounting_watch":   "...",
    "risk_evolution":     "..."
  }
}
```

### เมื่อไรควรรัน Step 3b

- หลังจากทำ Step 3 ครั้งแรก (มีข้อมูล 2 ปีขึ้นไปแล้ว)
- ทุกปีหลังจากออก Annual Report ใหม่ — เปรียบเทียบกับรายงาน 2 ปีก่อน
- เมื่อสงสัยว่าผู้บริหาร "เปลี่ยนเรื่องเล่า" หลังเกิดเหตุการณ์สำคัญ

### ข้อจำกัด

- ต้องการ URL ที่เข้าถึงได้ (ไม่ใช่ PDF กั้น) ทั้ง 2 รายงาน
- บริษัทที่ file 20-F (ต่างชาติ เช่น Barrick) ให้ใช้ URL จาก IR website หรือ SEC EDGAR โดยตรง
- Token ต่อ call ~6,000-8,000 tokens (รัน 4 agents ขนาน รวมเวลา ~40-60 วินาที)

---

## STEP 4 — วิเคราะห์ Earnings Call

**Prompt (ส่ง URL — แนะนำ):**
```
ส่งให้ DeepSeek วิเคราะห์ earnings call ของ [TICKER] Q[X] FY[ปี]:
URL: [URL ของ transcript จาก seekingalpha / motleyfool / IR website]
doc-type: Earnings Call
```

**Prompt (paste transcript):**
```
วิเคราะห์ earnings call ของ [TICKER] Q[X] FY[ปี] วันที่ [YYYY-MM-DD]

[paste transcript ทั้งหมด หรือส่วนสำคัญ]
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

## STEP 4b — Earnings Call Tone Tracker (ข้าม Quarter)

> **แนวคิด:** ฟัง Earnings Call ทีละ quarter อาจพลาด "tone shift" ที่สะสมมาหลายไตรมาส เช่น CEO เริ่มพูดน้อยลงเรื่อง margin expansion, CFO เริ่มย้ายโฟกัสจาก growth ไป cost discipline — สัญญาณเหล่านี้มักปรากฏก่อน guidance cut หลายไตรมาส

### Trigger Prompt

```
เปรียบเทียบ tone ของ earnings call [TICKER]:
URL ล่าสุด: [URL Q[X] FY[ปี]] ปี [YEAR_NEW] Q[X]
URL เก่า: [URL Q[X] FY[ปี]] ปี [YEAR_OLD] Q[X]
doc-type: Earnings Call
```

**ตัวอย่าง (Microsoft Q2 FY2025 vs Q2 FY2024):**
```
เปรียบเทียบ tone ของ earnings call MSFT:
URL ล่าสุด: https://seekingalpha.com/article/msft-q2-fy2025-earnings ปี 2025 Q2
URL เก่า: https://seekingalpha.com/article/msft-q2-fy2024-earnings ปี 2024 Q2
doc-type: Earnings Call
```

> 💡 **แนะนำ:** เปรียบเทียบ quarter เดียวกัน (Q2 vs Q2) เพื่อตัด seasonality — หรือเปรียบเทียบ Q ต่อเนื่อง 3-4 ไตรมาสถ้าต้องการดู trend

### สิ่งที่ระบบวิเคราะห์

ใช้ Agent เดียวกับ Step 3b (E–H) แต่โฟกัสไปที่ Earnings Call dynamics:

| มิติ | สัญญาณที่จับ |
|------|------------|
| **Narrative Drift** | คำที่หายไป/เพิ่ม, metric ที่ถูก highlight เปลี่ยน |
| **Confidence Shift** | ภาษา hedging เพิ่มขึ้น? ("we expect" → "we hope"?) |
| **Topic Priority** | หัวข้อที่ใช้เวลาพูดมากขึ้น/น้อยลง |
| **Analyst Questions** | นักวิเคราะห์ถามเรื่องอะไรมากขึ้น? (มักสะท้อน concern) |

### ผลลัพธ์

บันทึกเป็น Note พร้อม tags `["tone-tracker", "earnings-evolution", "multi-quarter", "[TICKER]"]`

### เมื่อไรควรรัน Step 4b

- ทุก 2 ไตรมาส เป็น routine — เปรียบเทียบ YoY (Q2 ปีนี้ vs Q2 ปีก่อน)
- ทันทีเมื่อสังเกตว่า stock ขยับผิดปกติหลัง Earnings แต่ตัวเลขดูปกติ
- ก่อนตัดสินใจเพิ่ม/ลด position — ใช้ยืนยัน thesis

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

### วิธีที่ถูกต้องสำหรับ Track-Delivery (Token-Efficient)

**อ่าน roadmap:** ใช้ `--extract-roadmap` แทน Read ทั้งไฟล์

```bash
# ดู roadmap ทั้งหมด (compact JSON — ไม่โหลด data.json เข้า context)
python3 patch.py [TICKER] --extract-roadmap

# เฉพาะ pending items (ที่ยังต้องตรวจสอบ)
python3 patch.py [TICKER] --extract-roadmap pending
```

**อัปเดต status หลังตรวจสอบ:**
```bash
python3 patch.py [TICKER] \
  --update-roadmap "[substring ของ commitment]" \
  --status delivered \
  --follow-up "[สิ่งที่เกิดขึ้นจริง]" \
  --follow-up-date YYYY-MM-DD
```

**บันทึก delivery analysis เป็น Note:**
```bash
python3 patch.py [TICKER] --append-note '{
  "date": "YYYY-MM-DD",
  "title": "Management Delivery Assessment Q[X] FY[YEAR]",
  "tags": ["management", "delivery-analysis", "[ticker_lower]"],
  "rating": [1-5],
  "content": "Delivery Rate: X% ([Y] delivered / [Z] concluded)..."
}'
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

## patch.py — อัปเดต data.json แบบ Zero-Context-Cost

> **ทำไมต้องใช้:** การแก้ไข data.json แบบปกติต้องโหลดไฟล์ทั้งหมดเข้า LLM context ก่อน (~3,000 tokens สำหรับ B/data.json) `patch.py` แก้ไข JSON โดยตรงโดยไม่ต้องโหลดไฟล์ — ลด token cost เกือบ 100%

**ไฟล์อยู่ที่:** `investment-research/.claude/scripts/patch.py`

### Commands ที่ใช้บ่อย

```bash
# ดูสรุปข้อมูลปัจจุบัน (ไม่แก้ไข)
python .claude/scripts/patch.py [TICKER] --info

# เพิ่ม Note ใหม่
python .claude/scripts/patch.py [TICKER] --append-note '{
  "date": "YYYY-MM-DD",
  "title": "...",
  "tags": ["earnings", "q12026"],
  "rating": 4,
  "content": "..."
}'

# เพิ่ม Roadmap item ใหม่
python .claude/scripts/patch.py [TICKER] --append-roadmap '{
  "date_said": "YYYY-MM-DD",
  "source": "Q1 2026 Earnings",
  "commitment": "...",
  "status": "pending",
  "follow_up": "",
  "follow_up_date": ""
}'

# เพิ่ม Quote ใหม่
python .claude/scripts/patch.py [TICKER] --append-quote '{
  "date": "YYYY-MM-DD",
  "source": "Q1 2026 Earnings Call",
  "speaker": "CEO Name",
  "quote": "...",
  "quote_th": "...",
  "tag": "strategy"
}'

# เพิ่มปีใหม่ในตาราง financials (ต้องระบุทุก metric ที่มี)
python .claude/scripts/patch.py [TICKER] --add-year 2026 --values '{
  "Revenue": 18.5,
  "Net Earnings (attributable)": 3.2,
  "Operating Cash Flow": 5.1,
  "Free Cash Flow": 2.4,
  "Gold Production (Moz)": 3.8,
  "AISC ($/oz)": 1690
}'

# อัปเดต status ของ roadmap item (match by substring)
python .claude/scripts/patch.py [TICKER] --update-roadmap "Reko Diq Phase 1" \
  --status delivered \
  --follow-up "Construction started, first gold target 2028" \
  --follow-up-date 2026-06-30

# Set ค่า field ใดก็ได้ (dot notation)
python .claude/scripts/patch.py [TICKER] --set "last_updated=2026-03-29"
python .claude/scripts/patch.py [TICKER] --set "overview.employees=~19000"

# Extract roadmap เป็น JSON (สำหรับ track-delivery หรือส่งให้ DeepSeek — ไม่ต้องโหลดไฟล์ทั้งหมด)
python .claude/scripts/patch.py [TICKER] --extract-roadmap            # ทุก item
python .claude/scripts/patch.py [TICKER] --extract-roadmap pending    # เฉพาะ pending

# Extract notes ล่าสุดเป็น JSON (สำหรับดู context ก่อน update)
python .claude/scripts/patch.py [TICKER] --extract-notes              # 5 notes ล่าสุด
python .claude/scripts/patch.py [TICKER] --extract-notes 3           # 3 notes ล่าสุด

# Preview ก่อน save จริง
python .claude/scripts/patch.py [TICKER] --dry-run --append-note '...'
```

### Token Savings เทียบกับวิธีเดิม

| วิธี | Token ที่ใช้ (B/data.json) | เวลา |
|------|---------------------------|------|
| Read + Edit (เดิม) | ~3,000–5,000 tokens | ~2-3 ขั้นตอน |
| patch.py append-note | ~200 tokens (JSON ของ note เท่านั้น) | 1 Bash call |
| patch.py add-year | ~300 tokens (values dict เท่านั้น) | 1 Bash call |
| patch.py extract-roadmap | ~300 tokens (roadmap JSON เท่านั้น) | 1 Bash call |

> 💡 **Prompt ที่ใช้ trigger:** "เพิ่ม note ให้ [TICKER]" หรือ "อัปเดต roadmap [TICKER]" — ให้ใช้ patch.py แทนการ Read+Edit ทุกครั้ง

---

## apply_analysis.py — Zero-Token Pipeline จาก DeepSeek ถึง data.json

> **ปัญหาที่แก้:** หลังจาก `fetch_analyze.py` รันเสร็จ Claude ต้องอ่าน JSON output ทั้งก้อน (~2,000-4,000 tokens) แล้วตัดสินใจว่าจะ patch อะไร — `apply_analysis.py` ทำส่วนนี้อัตโนมัติ โดย Claude ไม่ต้องอ่านอะไรเลย

**ไฟล์อยู่ที่:** `investment-research/.claude/scripts/apply_analysis.py`

### วิธีใช้ (Zero-Token Flow)

```bash
# Pipeline ครบวงจร — DeepSeek วิเคราะห์ แล้ว auto-apply เข้า data.json ทันที
python .claude/scripts/fetch_analyze.py \
  --ticker B \
  --ds-key sk-... \
  --url https://... \
  --doc-type "Annual Report" \
  | python .claude/scripts/apply_analysis.py B

# หรือบันทึก JSON ก่อน แล้วค่อย apply
python .claude/scripts/fetch_analyze.py --ticker B ... > /tmp/analysis.json
python .claude/scripts/apply_analysis.py B --input /tmp/analysis.json

# Preview โดยไม่ save จริง
python .claude/scripts/apply_analysis.py B --input /tmp/analysis.json --dry-run

# Skip บางส่วน (เช่น roadmap ถ้าต้องการ QC ก่อน)
python .claude/scripts/apply_analysis.py B --input /tmp/analysis.json --skip-roadmap
```

### สิ่งที่ apply_analysis.py ทำอัตโนมัติ

| ข้อมูล | วิธีที่ใช้ | หมายเหตุ |
|--------|-----------|---------|
| Note สรุป | `patch.py --append-note` | ✓ auto |
| Roadmap items | `patch.py --append-roadmap` (ทีละ item) | ✓ auto |
| Quotes | `patch.py --append-quote` (ทีละ item) | ✓ auto |
| Evolution Note (3b) | `patch.py --append-note` | ✓ auto |
| Financial metrics (AV) | **ข้าม** — พิมพ์ตัวเลขออกมาให้ดู | ต้องใช้ `--add-year` เอง (metric ต่างกันแต่ละบริษัท) |

### เปรียบเทียบ Token Cost

| วิธี | Claude token cost ต่อ session | หมายเหตุ |
|------|------------------------------|---------|
| **เดิม**: Claude อ่าน+แก้ data.json เอง | ~5,000–8,000 tokens | อ่าน JSON output + อ่าน data.json + เขียน |
| **กลาง**: patch.py (session ก่อน) | ~2,000–3,000 tokens | อ่าน JSON output เพื่อรู้ว่าจะ patch อะไร |
| **ใหม่**: apply_analysis.py | **~50 tokens** | แค่ command บรรทัดเดียว — script ทำทุกอย่าง |

> 💡 **สำหรับ Step 3b (Evolution):** ใช้ `--phase compare` กับ `fetch_analyze.py` แล้วไปต่อที่ `apply_analysis.py` — evolution note จะถูก append อัตโนมัติ

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
| วิเคราะห์ 10-K (อัตโนมัติ) | `ส่งให้ DeepSeek วิเคราะห์ 10-K ของ [TICKER]: URL: [URL .htm]` |
| วิเคราะห์ Earnings (อัตโนมัติ) | `ส่งให้ DeepSeek วิเคราะห์ earnings call ของ [TICKER] Q[X]: URL: [URL] doc-type: Earnings Call` |
| **เปรียบเทียบ Annual Report ข้ามปี** | `เปรียบเทียบ evolution ของ [TICKER]: URL ปัจจุบัน: [URL] ปี [YEAR_NEW] / URL เก่า: [URL] ปี [YEAR_OLD]` |
| **เปรียบเทียบ Earnings Call ข้าม Quarter** | `เปรียบเทียบ tone ของ earnings call [TICKER]: URL ล่าสุด: [URL] ปี [Y] Q[X] / URL เก่า: [URL] ปี [Y] Q[X]` |
| วิเคราะห์ 10-K (manual paste) | `วิเคราะห์ 10-K ของ [TICKER] FY[ปี]: [paste]` |
| แปล quotes เป็นไทย | `เพิ่มคำแปลภาษาไทย (quote_th) ให้ทุก quote ใน [TICKER]` |
| ติดตาม roadmap | `วิเคราะห์ management delivery rate ของ [TICKER]` |
| อัปเดต roadmap item | `อัปเดต roadmap [TICKER]: "[commitment]" → status: delivered, follow-up: [สิ่งที่เกิดขึ้น]` |
| ดูสรุปข้อมูลปัจจุบัน | `python patch.py [TICKER] --info` |
| ดู roadmap pending | `python patch.py [TICKER] --extract-roadmap pending` |
| Apply ผล DeepSeek ลง data | `python apply_analysis.py [TICKER] --input /tmp/prometheus_analysis.json` |
| เปิดดูบริษัท | เปิด `index.html` → กดชื่อบริษัท (URL: `company.html?ticker=[TICKER]`) |
