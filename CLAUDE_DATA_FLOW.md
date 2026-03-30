# CLAUDE_DATA_FLOW.md — คู่มือคุยกับ Claude เรื่อง Data

**Repo:** https://github.com/parametb/prometheus
**สำหรับ:** อัปเดต data/ เท่านั้น (ไม่รวม frontend HTML)

---

## กฎข้อเดียวที่ต้องจำ

> **Claude ตอบด้วย JSON Patch เสมอ — ไม่เขียน data.json ทั้งไฟล์**

| งาน | วิธีที่ถูก |
|-----|-----------|
| เพิ่ม note / quote / roadmap | `append` operation |
| แก้ค่า field | `set` operation |
| อัปเดต roadmap status | `update` operation |
| ลบรายการ | `delete` operation |

---

## โครงสร้าง data.json (schema)

```
ticker, name, sector, exchange, last_updated, description
notes[]        → date, title, tags[], rating(1-5), content
quotes[]       → date, source, speaker, quote, tag
roadmap[]      → date_said, source, commitment, status, follow_up, follow_up_date
overview{}     → founded, headquarters, employees, fiscal_year_end,
                  business_model_summary, competitive_position,
                  moat_factors[], segments[]
financials{}   → currency, unit, years[], metrics[], links[], notes
```

---

## รูปแบบ Patch File

บันทึกเป็น `data/[TICKER]/patches/YYYY-MM-DD_คำอธิบาย.json`

```json
{
  "description": "อธิบายสั้นๆ ว่าทำอะไร",
  "operations": [
    {
      "op": "append",
      "path": "notes",
      "value": {
        "date": "2026-03-29",
        "title": "Q4 2025 Earnings — Summary",
        "tags": ["earnings", "q4fy2025"],
        "rating": 3,
        "content": "..."
      }
    },
    {
      "op": "set",
      "path": "last_updated",
      "value": "2026-03-29"
    }
  ]
}
```

### Operations ที่รองรับ

| op | ใช้เมื่อ | ตัวอย่าง |
|----|---------|---------|
| `append` | เพิ่มรายการใหม่ใน array | เพิ่ม note, quote, roadmap |
| `set` | ตั้งค่า field (รองรับ dotted path) | `"path": "financials.currency"` |
| `update` | แก้รายการที่ match keyword | เปลี่ยน roadmap status |
| `delete` | ลบรายการที่ match keyword | ลบ note เก่า |

---

## วิธีใช้งานสคริปต์

### apply_patch.py — apply ทีละ file
```bash
# ดูสถานะปัจจุบัน
python scripts/apply_patch.py QUBT --info

# preview ก่อน apply จริง
python scripts/apply_patch.py QUBT data/QUBT/patches/2026-03-29_note.json --dry-run

# apply จริง (สร้าง backup อัตโนมัติ)
python scripts/apply_patch.py QUBT data/QUBT/patches/2026-03-29_note.json
```

### merge_patches.py — apply ทุก patch ที่รออยู่
```bash
# ดูว่ามี patch อะไรรออยู่
python scripts/merge_patches.py QUBT --list

# apply ทุก patch ของ QUBT
python scripts/merge_patches.py QUBT

# apply ทุก patch ของทุกบริษัท
python scripts/merge_patches.py --all
```

---

## วิธีคุยกับ Claude (Prompt Examples)

### เพิ่ม note ใหม่
```
เพิ่ม note ให้ QUBT:
- วันที่: 2026-03-29
- title: Q4 2025 Earnings — Summary
- rating: 3
- tags: earnings, q4fy2025
- content: [เนื้อหา...]
```

### อัปเดต roadmap status
```
QUBT — LSI acquisition สำเร็จแล้ว (Feb 2026)
เปลี่ยน status เป็น delivered และเพิ่ม follow_up
```

### เพิ่ม quote
```
เพิ่ม quote ให้ QUBT จาก Q4 2025 Earnings Call:
- speaker: Yuping Huang (CEO)
- quote: "2025 was a transformational year..."
- tag: strategy
```

### แก้ description / overview
```
อัปเดต description ของ QUBT เป็น:
"Quantum Computing Inc. (QCi) develops photonic quantum..."
```

### เพิ่ม financial year
```
เพิ่ม FY2025 financials ให้ QUBT:
- Revenue: 0.53M
- Net Income: -18.7M
- EPS (diluted): -0.11
```


> 📄 **Parse Exhibit 21** (corporate structure) → ดู `EXHIBIT21_SKILL.md`

## ระบบ Backup อัตโนมัติ

ทุกครั้งที่ apply patch สำเร็จ:
- สร้าง snapshot → `data/[TICKER]/history/data_YYYYMMDD_HHMMSS.json`
- เก็บไว้ 20 version ล่าสุด (เก่ากว่านั้นลบอัตโนมัติ)
- patch ที่ apply แล้วย้ายไป `data/[TICKER]/history/applied_patches/`

---

## ไฟล์และ script ที่เกี่ยวข้อง

| ไฟล์ | หน้าที่ |
|------|---------|
| `scripts/apply_patch.py` | apply patch file เดียว + backup |
| `scripts/merge_patches.py` | apply ทุก patch ใน `patches/` folder |
| `.claude/scripts/patch.py` | ใช้โดย automated pipeline (fetch_analyze) |
| `.claude/scripts/apply_analysis.py` | apply ผล DeepSeek pipeline อัตโนมัติ |
| `PROMETHEUS_FLOW.md` | flow เต็มรูปแบบสำหรับเพิ่มบริษัทใหม่ |
