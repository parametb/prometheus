# Parse Exhibit 21 — Corporate Structure

**ใช้เมื่อ**: ต้องการเพิ่มข้อมูลบริษัทย่อย / JV หลังเพิ่มบริษัทใหม่หรืออัปเดต 10-K ประจำปี
**โมเดลแนะนำ**: DeepSeek V3 (ถูก + เก่งเรื่อง parse)

---

## Prompt สำหรับ DeepSeek (คัดลอกทั้งก้อน)

```
คุณคือผู้เชี่ยวชาญด้านการ parse เอกสาร SEC Exhibit 21
งานของคุณ: แปลงรายชื่อบริษัทย่อย, บริษัทร่วมทุน และบริษัทในเครือจาก Exhibit 21 เป็น JSON structured data

โครงสร้าง output (ตอบด้วย JSON เท่านั้น):
{
  "structure": {
    "subsidiaries": [
      { "name": "ชื่อบริษัทย่อยเต็ม", "jurisdiction": "รัฐหรือประเทศ", "ownership": "100%", "significant": true }
    ],
    "joint_ventures": [
      { "name": "ชื่อ JV", "ownership": "50%", "partner": "ชื่อพันธมิตร", "description": "คำอธิบายสั้น" }
    ],
    "affiliates": [],
    "last_updated": "YYYY-MM-DD",
    "source": "Exhibit 21 from Form 10-K for fiscal year ended ...",
    "total_subsidiaries": 0,
    "omitted": "จำนวนที่ถูก omit ถ้ามี"
  }
}

กฎการ parse:
- รวมเฉพาะที่ระบุใน Exhibit 21
- Jurisdiction ใช้ชื่อรัฐหรือประเทศ
- Ownership ไม่ระบุ = "100%"
- ถ้าไม่มี JV หรือ Affiliates ให้ใส่ array ว่าง []
- อย่าใส่ข้อมูลที่ไม่มีในเอกสาร

ข้อความ Exhibit 21:
[วางข้อความ Exhibit 21 ทั้งหมดที่นี่]
```

---

## Apply ผลลัพธ์เข้า Prometheus

```bash
python scripts/apply_patch.py [TICKER] patch.json
```

```json
{
  "description": "TICKER — corporate structure from Exhibit 21 FY[YEAR]",
  "operations": [
    {
      "op": "set",
      "path": "overview.ownership.corporate_structure",
      "value": [ ...output จาก DeepSeek... ]
    }
  ]
}
```
