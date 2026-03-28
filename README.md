# 📈 Investment Research Website

เว็บไซต์ส่วนตัวสำหรับติดตามข้อมูลบริษัทเพื่อการลงทุน รวบรวม Notes, Quotes จาก Earnings Call, Roadmap Tracker และตัวเลขทางการเงิน

---

## 📁 โครงสร้างไฟล์

```
investment-research/
├── index.html              ← หน้าหลัก (รายชื่อบริษัททั้งหมด)
├── company.html            ← หน้าข้อมูลรายบริษัท
├── README.md               ← ไฟล์นี้
└── data/
    ├── companies.json      ← รายชื่อบริษัททั้งหมด (index)
    ├── AAPL/
    │   └── data.json       ← ข้อมูล Apple
    ├── MSFT/
    │   └── data.json       ← ข้อมูล Microsoft
    └── [TICKER]/
        └── data.json       ← เพิ่มบริษัทใหม่ตามรูปแบบนี้
```

---

## 🚀 วิธี Deploy บน GitHub Pages (ใช้งานออนไลน์ได้ทุกที่)

### ขั้นตอนที่ 1: สร้าง GitHub Account
1. ไปที่ https://github.com → คลิก Sign up
2. สร้าง account ฟรี

### ขั้นตอนที่ 2: สร้าง Repository ใหม่
1. คลิกปุ่ม **+** มุมขวาบน → **New repository**
2. ตั้งชื่อ: `investment-research` (หรือชื่อที่ชอบ)
3. เลือก **Public** (จำเป็นสำหรับ GitHub Pages ฟรี)
4. คลิก **Create repository**

### ขั้นตอนที่ 3: อัปโหลดไฟล์
1. ในหน้า repository → คลิก **uploading an existing file**
2. ลากโฟลเดอร์ทั้งหมดใส่ หรือเลือกทีละไฟล์
3. คลิก **Commit changes**

### ขั้นตอนที่ 4: เปิด GitHub Pages
1. ไปที่ **Settings** → **Pages** (เมนูซ้าย)
2. Source: เลือก **Deploy from a branch**
3. Branch: เลือก **main** → **/ (root)**
4. คลิก **Save**
5. รอ 2-3 นาที → เว็บจะพร้อมใช้งานที่ `https://[username].github.io/investment-research`

---

## ✏️ วิธีเพิ่มและแก้ไขข้อมูล

### เพิ่มบริษัทใหม่

**ขั้นตอนที่ 1:** สร้างโฟลเดอร์ใน `data/` โดยใช้ชื่อ Ticker เป็นชื่อโฟลเดอร์ เช่น `data/NVDA/`

**ขั้นตอนที่ 2:** สร้างไฟล์ `data.json` ในโฟลเดอร์นั้น โดยใช้ template ด้านล่าง

**ขั้นตอนที่ 3:** เพิ่มบริษัทเข้าไปใน `data/companies.json`

### Template สำหรับบริษัทใหม่ (data/[TICKER]/data.json)

```json
{
  "ticker": "TICKER",
  "name": "ชื่อบริษัท",
  "sector": "Technology",
  "exchange": "NASDAQ",
  "last_updated": "2025-01-01",
  "description": "คำอธิบายสั้นๆ เกี่ยวกับบริษัท",

  "notes": [
    {
      "date": "2025-01-01",
      "title": "หัวข้อบันทึก",
      "tags": ["tag1", "tag2"],
      "rating": 4,
      "content": "เนื้อหาบันทึกของเรา..."
    }
  ],

  "quotes": [
    {
      "date": "2025-01-30",
      "source": "Q1 FY2025 Earnings Call",
      "speaker": "CEO Name",
      "quote": "คำพูดที่น่าสนใจจากผู้บริหาร",
      "tag": "growth"
    }
  ],

  "roadmap": [
    {
      "date_said": "2024-06-01",
      "source": "ที่มา เช่น Earnings Call, Investor Day",
      "commitment": "สิ่งที่ผู้บริหารสัญญาหรือบอกว่าจะทำ",
      "status": "pending",
      "follow_up": "ผลลัพธ์ที่เกิดขึ้นจริง (ถ้ามี)",
      "follow_up_date": ""
    }
  ],

  "financials": {
    "currency": "USD",
    "unit": "Billion",
    "years": [2022, 2023, 2024],
    "metrics": [
      { "name": "Revenue",       "values": [0, 0, 0] },
      { "name": "Net Income",    "values": [0, 0, 0] },
      { "name": "EPS (diluted)", "values": [0, 0, 0] },
      { "name": "Free Cash Flow","values": [0, 0, 0] }
    ],
    "notes": "หมายเหตุเพิ่มเติมเกี่ยวกับตัวเลข"
  }
}
```

### ค่า status สำหรับ Roadmap

| status | ความหมาย |
|--------|----------|
| `delivered` | ✅ ทำตามที่พูดไว้ครบถ้วน |
| `partial` | ⚠️ ทำได้บางส่วน |
| `pending` | ⏳ ยังรอดูผล |
| `missed` | ❌ ไม่ได้ทำตามที่พูดไว้ |
| `monitoring` | 👀 กำลังติดตาม |

### ค่า sector ที่รองรับ

- `Technology`
- `Finance`
- `Healthcare`
- `Energy`
- `Consumer`
- หรือใส่ค่าอื่นได้เลย (จะแสดงสีเทา)

---

## 🔄 วิธีอัปเดตข้อมูลหลัง Deploy

1. ไปที่ GitHub repository → ไปที่ไฟล์ที่ต้องการแก้ (เช่น `data/AAPL/data.json`)
2. คลิกไอคอน ✏️ (Edit) มุมขวาบน
3. แก้ไขข้อมูลตรงๆ ใน browser
4. คลิก **Commit changes** → เว็บจะอัปเดตอัตโนมัติภายใน 1-2 นาที

---

## 💡 Tips

- **Rating** (1-5 ดาว): ใส่ตัวเลข 1-5 ใน `rating` field ของ notes เพื่อระบุ conviction level
- **Tags**: ใส่ tag ได้หลายอัน ใช้สำหรับค้นหา/จัดหมวดหมู่ในอนาคต
- **note_count / quote_count / roadmap_count** ใน `companies.json`: อัปเดตด้วยตนเองเพื่อให้หน้า dashboard แสดงจำนวนที่ถูกต้อง
- **last_updated**: อัปเดตทุกครั้งที่เพิ่มข้อมูลใหม่
