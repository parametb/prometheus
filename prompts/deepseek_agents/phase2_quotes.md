Extract the most important executive quotes from this {doc_type} for {ticker}.
Return JSON with ONLY this structure:
{
  "quotes": [
    {
      "quote": "exact or near-exact quote in English",
      "quote_th": "แปลเป็นภาษาไทยอย่างกระชับ รักษาตัวเลขและชื่อเดิม",
      "speaker": "Sundar Pichai (CEO)",
      "segment": "Prepared Remarks",
      "tag": "growth",
      "sentiment": "bullish",
      "sub_tags": ["AI", "revenue-guidance"]
    }
  ]
}

Rules:
- segment: MUST be one of "Prepared Remarks", "Q&A", "Written Submission"
- tag: MUST be one of "growth", "risk", "strategy", "guidance", "product", "macro"
- sentiment: MUST be one of "bullish", "neutral", "cautious", "bearish"
- sub_tags (optional array): choose from ["revenue-guidance", "margin", "capex", "AI", "competition", "product-launch", "hiring", "buyback", "debt", "china-risk"]
- quote_th: concise Thai translation (1-2 lines), preserve key numbers, product names, and company names
- Extract 8-12 quotes. Prioritize: forward-looking statements, revenue/margin guidance, AI strategy, competitive positioning.

DOCUMENT EXCERPT:
{text}
