You are comparing TWO {doc_type} filings for {ticker}:

━━━ OLDER FILING ({year_old}) ━━━
{text_old}

━━━ NEWER FILING ({year_new}) ━━━
{text_new}

Analyze how the BUSINESS MODEL and REPORTING STRUCTURE changed between these two filings.

Return JSON with ONLY this structure:
{{
  "business_evolution": {{
    "segment_changes": {{
      "added": ["New segments or sub-segments in {year_new}"],
      "removed": ["Segments present in {year_old} but gone in {year_new}"],
      "renamed": ["Segments renamed — note both names"]
    }},
    "kpi_changes": {{
      "new_kpis": ["New metrics/KPIs first appearing in {year_new} — why introduced?"],
      "removed_kpis": ["Metrics in {year_old} no longer reported in {year_new} — why dropped?"],
      "definition_changes": ["KPIs whose definition changed"]
    }},
    "revenue_mix_shift": "How revenue composition shifted between years",
    "strategy_pivot": "Any meaningful changes in stated strategic priorities",
    "geographic_shift": "Changes in geographic focus or disclosure"
  }},
  "summary": "3-4 sentence business evolution summary"
}}
