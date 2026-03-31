You are comparing TWO {doc_type} filings for {ticker}:

━━━ OLDER FILING ({year_old}) ━━━
{text_old}

━━━ NEWER FILING ({year_new}) ━━━
{text_new}

Analyze how management's NARRATIVE and MESSAGING changed between these two filings.

Return JSON with ONLY this structure:
{{
  "narrative_drift": {{
    "disappeared_topics": ["Topics prominent in {year_old} but absent/reduced in {year_new}"],
    "new_topics": ["Topics not in {year_old} but emphasized in {year_new}"],
    "tone_shift": "bullish→cautious | cautious→bullish | bullish→bullish | cautious→cautious | mixed",
    "recurring_themes": ["Themes consistently emphasized across both years"],
    "red_flags": ["Topics management STOPPED discussing — potential warning signs"],
    "language_changes": ["Specific wording changes, e.g. 'strong growth' → 'solid growth'"]
  }},
  "summary": "3-4 sentence narrative evolution summary highlighting most important changes"
}}
