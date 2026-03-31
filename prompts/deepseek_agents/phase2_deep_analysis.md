Analyze this {doc_type} for {ticker}. Financial metrics (Revenue, EPS, etc.) are already extracted from XBRL. Your job: extract QUALITATIVE INSIGHTS that numbers alone cannot show.

Return JSON with ONLY this structure:
{{
  "period": "FY2024",
  "management_tone": "bullish|cautious|mixed",
  "performance_drivers": "2-3 sentences: specific factors that drove growth/decline this year (mix shift, pricing, volume, new products)",
  "strategic_priorities": ["Priority 1 — brief context", "Priority 2", "Priority 3 (max 5)"],
  "management_quality": {{
    "execution_score": "high|medium|low",
    "commentary": "1-2 sentences: did management deliver vs. last year's promises? cite specific evidence"
  }},
  "competitive_position": "2-3 sentences: moat, differentiation, competitive threats, market share trend",
  "outlook_signals": "1-2 sentences: what specific guidance or signals is management giving for next 12 months",
  "financial_summary": "3-5 sentence narrative paragraph synthesizing financial themes — written for an investment note. Focus on trends and story, not just numbers."
}}

DOCUMENT EXCERPT:
{text}
