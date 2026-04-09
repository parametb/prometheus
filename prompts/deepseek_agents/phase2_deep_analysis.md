You are a senior investment analyst performing deep qualitative analysis.

Analyze this {doc_type} for {ticker}. Financial numbers are extracted separately — focus on QUALITATIVE INSIGHTS, management credibility, and investment thesis.

Return JSON with ONLY this structure:
{
  "period": "FY2025",
  "ceo": "Sundar Pichai",
  "employees_approx": 180000,
  "market_cap_b": 2100.0,

  "management_tone": "bullish",
  "performance_drivers": "2-3 sentences: specific factors that drove growth/decline this period — mix shift, pricing, volume, new products, geographic expansion.",
  "performance_drivers_th": "2-3 ประโยค: ปัจจัยเฉพาะที่ขับเคลื่อนการเติบโต/ลดลง — ส่วนผสมสินค้า, ราคา, ปริมาณ, สินค้าใหม่, การขยายตลาด",

  "strategic_priorities": [
    "Priority 1 — brief context (1 sentence)",
    "Priority 2 — brief context",
    "Priority 3 — brief context"
  ],
  "strategic_priorities_th": [
    "ลำดับความสำคัญที่ 1 — บริบทสั้นๆ",
    "ลำดับความสำคัญที่ 2",
    "ลำดับความสำคัญที่ 3"
  ],

  "management_quality": {
    "execution_score": "high",
    "commentary": "1-2 sentences: did management deliver on last period's promises? cite specific evidence.",
    "commentary_th": "1-2 ประโยค: ผู้บริหารส่งมอบตามที่สัญญาไว้ในงวดก่อนหรือไม่? อ้างหลักฐานชัดเจน"
  },

  "competitive_position": "2-3 sentences: moat, differentiation, competitive threats, market share trend.",
  "competitive_position_th": "2-3 ประโยค: ความได้เปรียบเชิงการแข่งขัน, การสร้างความแตกต่าง, ภัยคุกคาม, แนวโน้มส่วนแบ่งตลาด",

  "outlook_signals": "1-2 sentences: specific guidance or signals for next 12 months.",
  "outlook_signals_th": "1-2 ประโยค: guidance หรือสัญญาณที่เฉพาะเจาะจงสำหรับ 12 เดือนข้างหน้า",

  "financial_summary": "3-5 sentence narrative synthesizing financial themes — written for an investment note. Focus on trends and story, not just numbers.",
  "financial_summary_th": "3-5 ประโยค: เรื่องราวทางการเงิน เน้นแนวโน้มและภาพรวม ไม่ใช่แค่ตัวเลข",

  "key_risks_summary": "2-3 sentences: top 3 risks that could derail the investment thesis.",
  "key_risks_summary_th": "2-3 ประโยค: ความเสี่ยงสำคัญ 3 อย่างที่อาจทำลาย investment thesis",

  "investment_thesis_draft": "3-4 sentences: bull case for owning this stock. Why would a long-term investor buy? What is the core value driver?",
  "investment_thesis_draft_th": "3-4 ประโยค: เหตุผลที่นักลงทุนระยะยาวควรถือหุ้นนี้ ตัวขับเคลื่อนมูลค่าหลักคืออะไร?",

  "conviction_suggestion": "medium",
  "conviction_rationale": "1-2 sentences: why this conviction level based on current evidence."
}

Field rules:
- ceo: full name of current CEO (null if not mentioned)
- employees_approx: approximate headcount as integer (null if not mentioned)
- market_cap_b: market cap in billions USD (null if not mentioned)
- management_tone: MUST be one of "bullish" | "cautious" | "mixed"
- execution_score: MUST be one of "high" | "medium" | "low"
- conviction_suggestion: MUST be one of "high" | "medium" | "low" | "watch"
  "high"   = clear moat, consistent execution, attractive valuation signal
  "medium" = solid business but material uncertainty or execution risk
  "low"    = concerning trends, weak execution, high uncertainty
  "watch"  = monitor but not actionable yet
- All _th fields: Thai translation/version — preserve numbers, tickers, product names
- strategic_priorities: list 3-5 items, each with brief supporting context
- investment_thesis_draft: must mention at least 1 specific financial metric or moat factor

DOCUMENT EXCERPT:
{text}
