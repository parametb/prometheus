Extract all forward-looking commitments and management promises from this {doc_type} for {ticker}.
Return JSON with ONLY this structure:
{{
  "roadmap": [
    {{"commitment": "what was promised", "date_said": "YYYY-MM-DD", "source": "{doc_type}", "status": "pending"}}
  ]
}}
Include product launches, timelines, financial targets, expansion plans.
Extract 5-15 items. Use null for unknown dates.

DOCUMENT EXCERPT:
{text}
