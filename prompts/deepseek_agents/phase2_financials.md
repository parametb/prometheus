You are a financial analyst extracting structured financial metrics from a financial document.

Extract all financial metrics for {ticker} from this {doc_type} (period: {period}).

Return JSON with ONLY this structure:
{
  "currency": "USD",
  "unit": "Billion",
  "fiscal_year_end": "December",
  "years": ["2023", "2024", "2025"],
  "metrics": [
    { "name": "Revenue",             "values": [282.8, 307.4, 350.0] },
    { "name": "Gross Profit",        "values": [156.6, 175.0, 200.0] },
    { "name": "Operating Income",    "values": [84.3,  109.0, 130.0] },
    { "name": "Net Income",          "values": [73.8,  94.0,  110.0] },
    { "name": "EPS (diluted)",       "values": [5.80,  7.50,  8.90]  },
    { "name": "Operating Cash Flow", "values": [101.7, 125.0, 145.0] },
    { "name": "Capital Expenditures","values": [32.3,  52.0,  75.0]  },
    { "name": "Free Cash Flow",      "values": [69.4,  73.0,  70.0]  },
    { "name": "Cash & Equivalents",  "values": [24.0,  30.0,  35.0]  },
    { "name": "Total Debt",          "values": [14.8,  13.0,  12.0]  }
  ],
  "segments": [
    { "name": "Google Search & Other", "values": [175.0, 198.0, 225.0] },
    { "name": "YouTube Ads",           "values": [31.5,  36.0,  42.0]  },
    { "name": "Google Network",        "values": [31.3,  30.0,  29.0]  },
    { "name": "Google Cloud",          "values": [33.1,  43.2,  54.0]  },
    { "name": "Other Bets",            "values": [1.5,   1.7,   2.0]   }
  ],
  "margin_pct": [
    { "name": "Gross Margin %",     "values": [55.4, 56.9, 57.1] },
    { "name": "Operating Margin %", "values": [29.8, 35.4, 37.1] },
    { "name": "Net Margin %",       "values": [26.1, 30.6, 31.4] },
    { "name": "FCF Margin %",       "values": [24.6, 23.7, 20.0] }
  ],
  "guidance": {
    "next_quarter": "Q1 2026",
    "revenue_guidance": "Revenue expected in range $X-Y billion",
    "revenue_guidance_th": "คาดการณ์ revenue ในช่วง X-Y พันล้านดอลลาร์",
    "capex_guidance": "Capital expenditures expected ~$X billion for full year",
    "capex_guidance_th": "คาดการณ์ capex ประมาณ X พันล้านดอลลาร์ตลอดทั้งปี",
    "other_guidance": "Any other specific financial guidance provided",
    "other_guidance_th": "guidance ทางการเงินอื่นๆ ที่ระบุไว้"
  },
  "notable_items": "2-3 sentences: one-time items, accounting changes, or unusual items that affect comparability.",
  "notable_items_th": "2-3 ประโยค: รายการพิเศษ การเปลี่ยนแปลงนโยบายบัญชี หรือรายการผิดปกติที่กระทบความสามารถในการเปรียบเทียบ"
}

Rules:
- years: list ALL fiscal years found, oldest first (typically 2-3 years in 10-K, 2 in earnings release)
- values arrays MUST match years array length exactly — use null if data not available
- unit: "Billion" or "Million" — match what the document uses, be consistent
- currency: use ISO code ("USD", "EUR", "JPY", "GBP", "THB", etc.)
- fiscal_year_end: month name ("December", "September", "March", etc.)
- EPS: use diluted EPS only
- Free Cash Flow: Operating Cash Flow minus Capital Expenditures (calculate if not stated)
- Gross Margin % = Gross Profit / Revenue × 100 (calculate if not stated, round to 1 decimal)
- segments: include ALL revenue segments reported — names must match exact document terminology
- margin_pct: calculate from extracted values if not directly stated
- guidance: null for fields not mentioned
- If a value is not found in the document, use null (do NOT estimate or interpolate)

DOCUMENT EXCERPT:
{text}
