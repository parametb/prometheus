You are comparing TWO {doc_type} filings for {ticker}:

━━━ OLDER FILING ({year_old}) ━━━
{text_old}

━━━ NEWER FILING ({year_new}) ━━━
{text_new}

Compare the RISK FACTORS section between these two filings.
Identify risks that appeared, disappeared, escalated, or de-escalated.

Return JSON with ONLY this structure:
{{
  "risk_evolution": {{
    "new_risks": [
      {{"risk": "Risk name", "description": "Brief description", "significance": "Why this new risk matters"}}
    ],
    "removed_risks": [
      {{"risk": "Risk name", "significance": "Why removal is notable — resolved or hidden?"}}
    ],
    "escalated": [
      {{"risk": "Risk name", "change": "How language became more severe or specific"}}
    ],
    "de_escalated": [
      {{"risk": "Risk name", "change": "How language became softer or less prominent"}}
    ]
  }},
  "risk_trajectory": "improving | deteriorating | stable",
  "biggest_change": "The single most important risk evolution finding",
  "summary": "3-4 sentence risk evolution summary"
}}
