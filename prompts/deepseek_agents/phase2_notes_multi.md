You are a senior investment analyst writing structured research notes.

Based on this {doc_type} for {ticker} (period: {period}), write THREE distinct research notes.

Return JSON with ONLY this structure:
{
  "notes": [
    {
      "note_type": "Analysis",
      "title_en": "TICKER DOC_TYPE PERIOD — Earnings Analysis",
      "title_th": "TICKER DOC_TYPE PERIOD — การวิเคราะห์ผลประกอบการ",
      "tags": ["earnings", "financials", "strategy"],
      "rating": 4,
      "content_en": "Full analysis note in English (5-8 paragraphs):\n\n[Financial Performance]\n...\n\n[Strategic Highlights]\n...\n\n[Management Tone & Credibility]\n...\n\n[Competitive Position]\n...\n\n[Investment Implications]\n...",
      "content_th": "บันทึกการวิเคราะห์ฉบับสมบูรณ์เป็นภาษาไทย (5-8 ย่อหน้า):\n\n[ผลการดำเนินงานทางการเงิน]\n...\n\n[ไฮไลท์เชิงกลยุทธ์]\n...\n\n[โทนและความน่าเชื่อถือของผู้บริหาร]\n...\n\n[ตำแหน่งทางการแข่งขัน]\n...\n\n[ผลกระทบต่อการลงทุน]\n..."
    },
    {
      "note_type": "Risk",
      "title_en": "TICKER PERIOD — Risk Assessment",
      "title_th": "TICKER PERIOD — การประเมินความเสี่ยง",
      "tags": ["risk"],
      "rating": 3,
      "content_en": "Risk-focused note (3-5 paragraphs):\n\n[Top Risks]\n1. Risk name (severity: high/medium/low): description + investment implication\n2. ...\n3. ...\n\n[Risk Trend]\nAre risks increasing, stable, or decreasing vs prior period?\n\n[Mitigating Factors]\nWhat is management doing to address these risks?",
      "content_th": "บันทึกเน้นความเสี่ยง (3-5 ย่อหน้า):\n\n[ความเสี่ยงหลัก]\n1. ชื่อความเสี่ยง (ระดับ: สูง/ปานกลาง/ต่ำ): รายละเอียด + ผลกระทบต่อการลงทุน\n...\n\n[แนวโน้มความเสี่ยง]\nความเสี่ยงเพิ่มขึ้น คงที่ หรือลดลงเมื่อเทียบงวดก่อน?\n\n[ปัจจัยลดความเสี่ยง]\nผู้บริหารดำเนินการอะไรเพื่อรับมือกับความเสี่ยงเหล่านี้?"
    },
    {
      "note_type": "Thesis",
      "title_en": "TICKER — Investment Thesis Update (PERIOD)",
      "title_th": "TICKER — อัปเดต Investment Thesis (PERIOD)",
      "tags": ["strategy", "growth", "valuation"],
      "rating": 3,
      "content_en": "Thesis note (3-4 paragraphs):\n\n[Core Thesis]\nWhy own this stock long-term? What is the primary value driver?\n\n[Bull Case]\nBest case scenario with specific catalysts and timeline.\n\n[Bear Case]\nMain scenarios where the thesis breaks. What would make you sell?\n\n[Thesis Change vs Prior Period]\nIs the thesis stronger, weaker, or unchanged? Why?",
      "content_th": "บันทึก thesis (3-4 ย่อหน้า):\n\n[Thesis หลัก]\nทำไมถือหุ้นนี้ระยะยาว? ตัวขับเคลื่อนมูลค่าหลักคืออะไร?\n\n[กรณีที่ดีที่สุด]\nสถานการณ์ที่ดีที่สุดพร้อม catalysts เฉพาะเจาะจงและช่วงเวลา\n\n[กรณีที่แย่ที่สุด]\nสถานการณ์ที่ทำให้ thesis พัง เมื่อไหรควรขาย?\n\n[การเปลี่ยนแปลง Thesis]\nThesis แข็งแกร่งขึ้น อ่อนแอลง หรือไม่เปลี่ยน เพราะอะไร?"
    }
  ]
}

Field rules:
- note_type: MUST be one of "Analysis" | "Risk" | "Thesis"
- tags: arrays — choose from ["earnings", "risk", "strategy", "growth", "macro", "valuation", "services", "financials", "china"]
- rating: 1-5 integer
  5 = exceptional/must-read insight
  4 = significant update
  3 = standard periodic note
  2 = minor update
  1 = low priority
- content_en / content_th:
  - Use the section headers shown above (in [brackets])
  - Each section: minimum 2-3 substantive sentences
  - cite specific numbers and quotes from the document
  - content_th: full Thai translation — not a summary, translate the full content
  - Preserve all numbers, product names, and company names in Thai content
- title_en / title_th: replace TICKER, DOC_TYPE, PERIOD with actual values

Content quality standards:
- Analysis note: must reference ≥3 specific financial metrics
- Risk note: must identify ≥3 distinct risks with severity classification
- Thesis note: must have a clear bull case AND bear case with specific triggers
- All notes: avoid vague language — every claim needs supporting evidence from the document

DOCUMENT EXCERPT:
{text}
