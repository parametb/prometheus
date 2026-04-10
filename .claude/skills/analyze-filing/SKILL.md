---
name: analyze-filing
description: >
  Parse an SEC filing (10-K or 10-Q) uploaded by the user and write structured
  financial data to the Prometheus Financials DB in Notion OR directly into
  data/[TICKER]/data.json. Use when the user uploads a 10-K or 10-Q PDF/HTML
  and wants financial metrics extracted and stored.
  Trigger phrases: "วิเคราะห์งบการเงิน", "parse 10-K", "parse 10-Q",
  "extract financials from filing", "อัปโหลดงบการเงิน", "analyze SEC filing",
  "update financials from file", "10-K financials", "เพิ่มข้อมูลทางการเงิน".
tools:
  - Read
  - Write
  - Edit
  - Glob
  - Bash
---

# Analyze SEC Financial Filing

This skill parses a 10-K (Annual Report) or 10-Q (Quarterly Report) uploaded by the user and writes structured financial data into the Prometheus data pipeline.

---

## Step 1 — Identify the filing

Ask or confirm:
- **Company ticker** (e.g., AAPL, GOOGL, NVDA)
- **Filing type**: Annual (10-K) or Quarterly (10-Q)
- **Period**: Fiscal year (e.g., FY2024) or quarter (e.g., Q3 2024)
- **Currency** (default: USD)

If the user has uploaded a file, read it to auto-detect. SEC filings begin with company name, CIK, and period-of-report.

Accept filings as:
- Uploaded PDF or HTML file (check `/sessions/loving-intelligent-bardeen/mnt/uploads/`)
- Text pasted directly in the conversation

---

## Step 2 — Extract Financial Metrics

Search the filing for the following consolidated financial statements:
- **Income Statement** (Consolidated Statements of Operations / Income)
- **Cash Flow Statement** (Consolidated Statements of Cash Flows)
- **Balance Sheet** (Consolidated Balance Sheets)

Extract these metrics (in USD millions, round to 1 decimal):

### Income Statement
| Metric | Look for |
|--------|----------|
| `revenue` | Net revenues / Total revenues / Net sales |
| `gross_profit` | Gross profit / Gross margin |
| `operating_income` | Income from operations / Operating income |
| `net_income` | Net income / Net earnings (attributable to common stockholders) |
| `eps_diluted` | Diluted EPS / Diluted net income per share (keep as-is, do NOT divide by 1M) |
| `shares_diluted` | Diluted weighted-average shares (convert to millions if in thousands) |

### Cash Flow Statement
| Metric | Look for |
|--------|----------|
| `operating_cf` | Net cash provided by operating activities |
| `capex` | Purchases of property/equipment / Capital expenditures (store as **negative**) |
| `dna` | Depreciation and amortization (from CF operating section) |

### Balance Sheet
| Metric | Look for |
|--------|----------|
| `cash` | Cash and cash equivalents (+ short-term investments if combined line) |
| `total_assets` | Total assets |
| `total_debt` | Long-term debt (+ short-term borrowings if material) |
| `total_equity` | Total stockholders' equity / Total shareholders' equity |

### Derived (calculate yourself)
```
free_cash_flow = operating_cf + capex   (capex is negative, so this is operating_cf - |capex|)
ebitda         = operating_income + dna
```

**Unit rules:**
- All dollar values in **USD millions** (divide by 1,000,000 if filing reports in dollars, or by 1,000 if in thousands)
- EPS: keep as reported (e.g., 6.43 not 6,430,000)
- Shares: always in millions

---

## Step 3 — Structure the data

### For Annual (10-K) filings:

Build a period object with:
```json
{
  "ticker": "AAPL",
  "period_type": "Annual",
  "fiscal_year": 2024,
  "quarter": null,
  "period_label": "FY2024",
  "period_end": "2024-09-28",
  "currency": "USD",
  "unit": "Million",
  "source": "10-K",
  "revenue": 391035.0,
  "gross_profit": 180683.0,
  "operating_income": 123216.0,
  "net_income": 93736.0,
  "eps_diluted": 6.43,
  "shares_diluted": 15343.8,
  "operating_cf": 118254.0,
  "capex": -9447.0,
  "free_cash_flow": 108807.0,
  "dna": 11445.0,
  "ebitda": 134661.0,
  "cash": 65171.0,
  "total_debt": 95281.0,
  "total_assets": 364980.0,
  "total_equity": 56950.0
}
```

### For Quarterly (10-Q) filings:

Same structure but with:
```json
{
  "period_type": "Quarterly",
  "fiscal_year": 2024,
  "quarter": "Q3",
  "period_label": "Q3 2024",
  "period_end": "2024-06-29"
}
```

---

## Step 4 — Show extracted data for review

Display a clean table of all extracted values. Flag any values you're uncertain about with ⚠️. Ask the user to confirm before writing.

Example output format:
```
📊 AAPL FY2024 — Extracted Financials
──────────────────────────────────────
Revenue:          $391,035M  ✓
Gross Profit:     $180,683M  ✓
Operating Income: $123,216M  ✓
Net Income:        $93,736M  ✓
EPS (Diluted):          $6.43  ✓
Shares (Diluted): 15,343.8M  ✓
Operating CF:     $118,254M  ✓
CapEx:             -$9,447M  ✓
Free Cash Flow:   $108,807M  (derived)
D&A:               $11,445M  ✓
EBITDA:           $134,661M  (derived)
Cash:              $65,171M  ✓
Total Debt:        $95,281M  ✓
Total Assets:     $364,980M  ✓
Total Equity:      $56,950M  ✓
```

Ask: "Shall I write these to `data/AAPL/data.json`?"

---

## Step 5 — Write to data.json

Read the existing `data/[TICKER]/data.json`. Find the `financials` section.

### If `financials.annual` exists (EDGAR format):

Upsert the period into `financials.annual`:
1. Check if `period_label` already exists in `financials.annual.periods`
2. If yes: update values at that index
3. If no: append the new period (insert in chronological order)

Update all parallel arrays: `periods`, `period_ends`, and each metric's `values` array.

Then **recalculate** `growth` and `margin` arrays for the full annual dataset:
- `growth[i]` = `null` if i===0, else `round((values[i] - values[i-1]) / abs(values[i-1]) * 100, 1)`
- `margin[i]` = `round(values[i] / revenue[i] * 100, 1)` for gross_profit, operating_income, net_income, ebitda, free_cash_flow (null if revenue is 0)

Also maintain backward-compat `financials.years` (fiscal years array) and `financials.metrics` (array of `{name, key, values}` from annual data).

### If `financials.annual` does NOT exist yet:

Initialize the full enhanced format:
```json
{
  "source": "10-K",
  "currency": "USD",
  "unit": "Million",
  "annual": {
    "periods": ["FY2024"],
    "period_ends": ["2024-09-28"],
    "metrics": [
      {"key": "revenue", "name": "Revenue", "values": [391035.0], "growth": [null], "margin": null},
      ...
    ]
  },
  "quarterly": null,
  "years": [2024],
  "metrics": [{"name": "Revenue", "key": "revenue", "values": [391035.0]}]
}
```

### For quarterly data:

Same pattern but upsert into `financials.quarterly`. Do NOT recalculate annual arrays.

---

## Step 6 — Confirm and update

After writing:
- Update `last_updated` in the company root object to today's date
- Print a success message with what was written

---

## Metric order in the metrics array

Always maintain this order in the `metrics` array:
1. revenue
2. gross_profit
3. operating_income
4. net_income
5. ebitda
6. eps_diluted
7. shares_diluted
8. operating_cf
9. free_cash_flow
10. cash
11. total_debt
12. total_assets
13. total_equity

---

## Quality rules

- Never fabricate numbers — only use what is explicitly in the filing
- If a line item doesn't appear in the filing, set the value to `null`
- For multi-segment companies, use **consolidated** totals only
- EPS: use **diluted** (not basic)
- If the filing reports in thousands (common for smaller companies), divide by 1,000
- Period end date: use the exact fiscal period end date from the filing cover page
- Always ask for confirmation before writing to data.json

---

See `references/data-schema.md` for the full Prometheus JSON schema.
