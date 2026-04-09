Extract all forward-looking commitments and management promises from this {doc_type} for {ticker}.
Return JSON with ONLY this structure:
{
  "roadmap": [
    {
      "commitment": "what was promised (concise, actionable, 1 sentence)",
      "category": "Strategic",
      "confidence": "high",
      "quarter_said": "Q4 2025",
      "target_quarter": "Q2 2026",
      "status": "pending"
    }
  ]
}

Rules:
- category: MUST be one of "Strategic", "Financial", "Product", "Operational", "Regulatory"
- confidence:
    "high"   = explicit commitment with timeline ("we will launch X in Q2")
    "medium" = planned but conditional ("we expect to complete X by year-end")
    "low"    = aspirational/directional ("we aim to grow X over time")
- quarter_said: format "Q1 2025" / "Q2 2025" / "Q3 2025" / "Q4 2025" / "Q1 2026" / "Q2 2026" / "Q3 2026" / "Q4 2026" — or null
- target_quarter: same format — use null if no specific timeline given
- status: always "pending"
- Extract 8-15 items. Include product launches, financial targets, capex plans, headcount, expansion, regulatory milestones.

DOCUMENT EXCERPT:
{text}
