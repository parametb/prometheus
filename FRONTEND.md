# FRONTEND.md — คู่มือคุยกับ Claude เรื่อง Frontend

**Repo:** https://github.com/parametb/prometheus
**สำหรับ:** แก้ไข HTML + CSS + JS เท่านั้น (ไม่รวม data/)

---

## ลักษณะโปรเจกต์

- **Static Site** ล้วน (deploy ด้วย GitHub Pages)
- ไม่ใช้ framework (React, Vue, Next.js ฯลฯ)
- ใช้ **Vanilla HTML + CSS + JavaScript**
- ข้อมูลทั้งหมดโหลดจาก `data/` ทาง client-side fetch()
- ไม่มี backend / API

---

## ไฟล์ Frontend หลัก

| ไฟล์ | หน้าที่ |
|------|---------|
| `index.html` | หน้าหลัก — รายชื่อบริษัท (โหลดจาก `data/companies.json`) |
| `company.html` | หน้าบริษัทรายตัว — รับ `?ticker=XXXX` จาก URL |
| `overview.html` | Dashboard ภาพรวมทุกบริษัท |

### company.html แสดง sections:
- ข้อมูลพื้นฐาน (ชื่อ, sector, exchange, description)
- Overview Panel (founded, HQ, moat, segments)
- Notes (พร้อม rating stars และ tags)
- Quotes (จาก earnings call)
- Roadmap (commitment + status สี + follow-up)
- Financials (ตาราง + chart)

---

## การโหลดข้อมูล

```javascript
// โหลด companies list
fetch('data/companies.json')

// โหลดข้อมูลบริษัท
const ticker = new URLSearchParams(window.location.search).get('ticker')
fetch(`data/${ticker}/data.json`)
```

ทุกอย่าง render ด้วย Vanilla JS (document.getElementById, innerHTML, createElement)

---

## วิธีขอให้ Claude แก้ Frontend (Token-Efficient)

1. บอกชัดเจนว่า **"แก้ที่ไฟล์ไหน"** (index.html / company.html / overview.html)
2. ระบุ **ส่วนที่ต้องการเปลี่ยน** ให้ชัด
3. Claude จะตอบด้วย **โค้ดส่วนที่แก้ไข** เท่านั้น (ไม่ใช่ไฟล์เต็ม)
4. ถ้าต้องการไฟล์เต็ม → บอกว่า "ให้โค้ดเต็มของ index.html"

### กฎ: อย่าขอให้ Claude อ่าน HTML ทั้งไฟล์ทุกครั้ง
ถ้า Claude รู้โครงสร้างพื้นฐานแล้ว ให้ระบุแค่ "ส่วน roadmap section" หรือ "ฟังก์ชัน renderNotes()"

---

## ตัวอย่าง Prompt ที่ดี

```
แก้ company.html — ส่วน roadmap
เพิ่มการแสดง follow_up ใต้ commitment ถ้า follow_up ไม่ว่าง
```

```
แก้ index.html — เพิ่ม filter dropdown ตาม sector
ตัวเลือก: All, Technology, Mining, Finance, Healthcare
```

```
แก้ company.html — ส่วน financials chart
ใช้ Chart.js แทน table เพื่อแสดง Revenue และ Net Income เป็น bar chart
```

```
ทำให้ index.html responsive สำหรับมือถือ
```

```
เพิ่ม dark mode toggle ใน index.html
```

---

## Roadmap Status Colors (ปัจจุบัน)

| status | สี |
|--------|-----|
| `pending` | สีเทา |
| `monitoring` | สีเหลือง |
| `delivered` | สีเขียว |
| `missed` | สีแดง |

---

## หมายเหตุ

- ไฟล์นี้แยกจาก `CLAUDE_DATA_FLOW.md` เพื่อลด token เวลาคุยเรื่อง frontend
- ถ้าต้องการแก้ทั้ง data + frontend ในครั้งเดียว ให้บอก Claude ก่อนว่า "แก้ทั้งสองส่วน"
- GitHub Pages deploy อัตโนมัติเมื่อ push ไป `main` branch
