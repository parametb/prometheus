You are comparing TWO {doc_type} filings for {ticker}:

━━━ OLDER FILING ({year_old}) ━━━
{text_old}

━━━ NEWER FILING ({year_new}) ━━━
{text_new}

Identify ACCOUNTING POLICY CHANGES and REPORTING ADJUSTMENTS between these two filings.
Look for "optical improvements" — changes that make numbers look better without real improvement.

Return JSON with ONLY this structure:
{{
  "accounting_changes": [
    {{
      "type": "useful_life_extension | segment_redefinition | new_adjusted_metric | expense_reclassification | revenue_recognition | other",
      "description": "What changed and how",
      "financial_impact": "Estimated impact on reported earnings, margins, or assets",
      "severity": "high | medium | low",
      "red_flag": true
    }}
  ],
  "optical_improvements": ["Changes that improve reported numbers without genuine business improvement"],
  "comparability_issues": ["Reasons why {year_old} and {year_new} numbers may not be directly comparable"],
  "auditor_changes": "Any changes in auditor, audit opinion, or key audit matters",
  "summary": "3-4 sentence accounting watch summary — is reporting quality improving or deteriorating?"
}}
