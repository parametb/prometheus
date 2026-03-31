Identify the top risks from this {doc_type} for {ticker}.
Return JSON with ONLY this structure:
{{
  "key_risks": [
    {{"risk": "Risk name", "severity": "high|medium|low", "description": "1-2 sentences", "mitigation": "how company plans to address it or null"}}
  ],
  "risk_summary": "2-3 sentence paragraph summarizing overall risk profile"
}}
Extract 5-8 risks.

DOCUMENT EXCERPT:
{text}
