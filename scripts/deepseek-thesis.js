#!/usr/bin/env node
/**
 * deepseek-thesis.js — Prometheus v2.2
 *
 * Synthesizes a comprehensive Investment Thesis Update report for a company.
 * Reads all existing Notion data (Quotes, Notes, Roadmap) for the ticker,
 * passes to DeepSeek for synthesis, then creates an entry in Analytic Reports DB.
 * Also updates the Investment Thesis field in the Companies DB.
 *
 * Usage:
 *   node scripts/deepseek-thesis.js --ticker GOOGL
 *   node scripts/deepseek-thesis.js --ticker AAPL --force true
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

const TICKER      = (getArg('--ticker') || process.env.TICKER || '').toUpperCase();
const FORCE_UPDATE = (getArg('--force') || process.env.FORCE_UPDATE || 'false') === 'true';

if (!TICKER) {
  console.error('ERROR: --ticker is required');
  process.exit(1);
}

// ─── Env ──────────────────────────────────────────────────────────────────────
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const NOTION_TOKEN     = process.env.NOTION_TOKEN;
const COMPANIES_DB     = process.env.NOTION_COMPANIES_DB;
const QUOTES_DB        = process.env.NOTION_QUOTES_DB;
const ROADMAP_DB       = process.env.NOTION_ROADMAP_DB;
const NOTES_DB         = process.env.NOTION_NOTES_DB;
const REPORTS_DB       = process.env.NOTION_REPORTS_DB;
const SOURCES_DB       = process.env.NOTION_SOURCES_DB;

if (!DEEPSEEK_API_KEY || !NOTION_TOKEN || !REPORTS_DB) {
  console.error('ERROR: Missing DEEPSEEK_API_KEY, NOTION_TOKEN, or NOTION_REPORTS_DB');
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function notionRequest(method, apiPath, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.notion.com',
      path: apiPath,
      method,
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse: ${data.substring(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function deepseekChat(messages, maxTokens = 8192) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify({
      model: 'deepseek-chat',
      messages,
      max_tokens: maxTokens,
      temperature: 0.4,
      response_format: { type: 'json_object' },
    });
    const options = {
      hostname: 'api.deepseek.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          resolve(parsed.choices[0].message.content);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ─── Notion data fetchers ─────────────────────────────────────────────────────
async function getCompanyInfo() {
  if (!COMPANIES_DB) return null;
  const filter = { property: 'Ticker', rich_text: { equals: TICKER } };
  const resp = await notionRequest('POST', `/v1/databases/${COMPANIES_DB}/query`, { filter, page_size: 1 });
  if (!resp.results?.length) return null;
  const item = resp.results[0];
  return {
    pageId: item.id,
    name: item.properties['Name']?.title?.[0]?.plain_text || TICKER,
    sector: item.properties['Sector']?.select?.name || '',
    industry: item.properties['Industry']?.rich_text?.[0]?.plain_text || '',
    description: item.properties['Description']?.rich_text?.[0]?.plain_text || '',
    conviction: item.properties['Conviction Level']?.select?.name || '',
    thesis: item.properties['Investment Thesis']?.rich_text?.[0]?.plain_text || '',
  };
}

async function getAllQuotes(limit = 50) {
  if (!QUOTES_DB) return [];
  const body = {
    filter: { property: 'Ticker', rich_text: { equals: TICKER } },
    sorts: [{ property: 'Date', direction: 'descending' }],
    page_size: limit,
  };
  const resp = await notionRequest('POST', `/v1/databases/${QUOTES_DB}/query`, body);
  if (resp.object === 'error') return [];

  return resp.results.map(item => ({
    quote: item.properties['Quote']?.rich_text?.[0]?.plain_text || '',
    speaker: item.properties['Speaker']?.rich_text?.[0]?.plain_text || '',
    date: item.properties['Date']?.date?.start || '',
    source: item.properties['Source']?.rich_text?.[0]?.plain_text || '',
    tag: item.properties['Tag']?.multi_select?.map(t => t.name).join(', ') || '',
    sentiment: item.properties['Sentiment']?.select?.name || '',
    analystNote: item.properties['Analyst Note']?.rich_text?.[0]?.plain_text || '',
  })).filter(q => q.quote.length > 10);
}

async function getAllRoadmapItems() {
  if (!ROADMAP_DB) return [];
  const body = {
    filter: { property: 'Ticker', rich_text: { equals: TICKER } },
    sorts: [{ property: 'Target Quarter', direction: 'descending' }],
    page_size: 50,
  };
  const resp = await notionRequest('POST', `/v1/databases/${ROADMAP_DB}/query`, body);
  if (resp.object === 'error') return [];

  return resp.results.map(item => ({
    commitment: item.properties['Commitment']?.title?.[0]?.plain_text || '',
    category: item.properties['Category']?.select?.name || '',
    targetQuarter: item.properties['Target Quarter']?.select?.name || '',
    quarterSaid: item.properties['Quarter Said']?.select?.name || '',
    status: item.properties['Status']?.status?.name || 'pending',
    confidence: item.properties['Confidence']?.select?.name || '',
    followUp: item.properties['Follow Up']?.rich_text?.[0]?.plain_text || '',
    deliveryNote: item.properties['Delivery Note']?.rich_text?.[0]?.plain_text || '',
  })).filter(r => r.commitment.length > 5);
}

async function getAllNotes(limit = 20) {
  if (!NOTES_DB) return [];
  const body = {
    filter: { property: 'Ticker', rich_text: { equals: TICKER } },
    sorts: [{ property: 'Date', direction: 'descending' }],
    page_size: limit,
  };
  const resp = await notionRequest('POST', `/v1/databases/${NOTES_DB}/query`, body);
  if (resp.object === 'error') return [];

  return resp.results.map(item => ({
    title: item.properties['Title']?.title?.[0]?.plain_text || '',
    type: item.properties['Note Type']?.select?.name || '',
    rating: item.properties['Rating']?.number || 3,
    body: item.properties['Body']?.rich_text?.[0]?.plain_text || '',
    date: item.properties['Date']?.date?.start || '',
  })).filter(n => n.title.length > 0);
}

async function getFinancialsFromFile() {
  try {
    const dataPath = path.join(__dirname, '..', 'data', TICKER, 'data.json');
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    return data.financials || null;
  } catch { return null; }
}

// ─── Build context for DeepSeek ───────────────────────────────────────────────
function buildContext(company, quotes, roadmap, notes, financials) {
  const sections = [];

  // Company overview
  if (company) {
    sections.push(`## COMPANY: ${company.name} (${TICKER})
Sector: ${company.sector} | Industry: ${company.industry}
Description: ${company.description?.substring(0, 300) || 'N/A'}
Current Conviction: ${company.conviction || 'unset'}
Previous Thesis: ${company.thesis?.substring(0, 500) || 'none'}`);
  }

  // Key financials summary
  if (financials && financials.years?.length > 0) {
    const recentYear = financials.years[financials.years.length - 1];
    const recentIdx = financials.years.length - 1;
    const revenue = financials.metrics?.find(m => m.name === 'Revenue')?.values[recentIdx];
    const netIncome = financials.metrics?.find(m => m.name === 'Net Income')?.values[recentIdx];
    const fcf = financials.metrics?.find(m => m.name === 'Free Cash Flow')?.values[recentIdx];
    const opMargin = financials.margin_pct?.find(m => m.name === 'Operating Margin %')?.values[recentIdx];

    sections.push(`## FINANCIALS (${recentYear})
Revenue: ${revenue ? `${revenue}B ${financials.currency}` : 'N/A'}
Net Income: ${netIncome ? `${netIncome}B ${financials.currency}` : 'N/A'}
Free Cash Flow: ${fcf ? `${fcf}B ${financials.currency}` : 'N/A'}
Operating Margin: ${opMargin ? `${opMargin}%` : 'N/A'}`);

    if (financials.guidance?.revenue_guidance) {
      sections.push(`Guidance: ${financials.guidance.revenue_guidance}`);
    }
  }

  // Management quotes (most recent, highest signal)
  if (quotes.length > 0) {
    const topQuotes = quotes
      .filter(q => ['bullish', 'strategic'].includes(q.sentiment?.toLowerCase()) || q.analystNote)
      .slice(0, 20);
    const displayQuotes = topQuotes.length > 0 ? topQuotes : quotes.slice(0, 20);

    sections.push(`## KEY MANAGEMENT QUOTES (${displayQuotes.length} of ${quotes.length} total)
${displayQuotes.map(q =>
  `[${q.date}] ${q.speaker} (${q.tag}): "${q.quote.substring(0, 200)}"${q.analystNote ? `\n  → Analyst note: ${q.analystNote.substring(0, 100)}` : ''}`
).join('\n\n')}`);
  }

  // Roadmap — split by status
  if (roadmap.length > 0) {
    const pending   = roadmap.filter(r => r.status === 'pending');
    const delivered = roadmap.filter(r => r.status === 'delivered');
    const missed    = roadmap.filter(r => r.status === 'missed');
    const partial   = roadmap.filter(r => r.status === 'partial');

    sections.push(`## MANAGEMENT COMMITMENTS (${roadmap.length} total)

PENDING (${pending.length}):
${pending.slice(0, 10).map(r => `  [${r.targetQuarter}] [${r.confidence}] ${r.commitment}`).join('\n') || '  none'}

DELIVERED (${delivered.length}):
${delivered.slice(0, 8).map(r => `  [${r.targetQuarter}] ${r.commitment}`).join('\n') || '  none'}

MISSED (${missed.length}):
${missed.map(r => `  [${r.targetQuarter}] ${r.commitment}${r.deliveryNote ? ` — ${r.deliveryNote.substring(0, 100)}` : ''}`).join('\n') || '  none'}

PARTIAL (${partial.length}):
${partial.map(r => `  [${r.targetQuarter}] ${r.commitment}`).join('\n') || '  none'}`);
  }

  // Prior analyst notes
  if (notes.length > 0) {
    sections.push(`## PRIOR RESEARCH NOTES (${notes.length} notes)
${notes.slice(0, 10).map(n =>
  `[${n.date}] [${n.type}] ★${n.rating} ${n.title}\n  ${n.body?.substring(0, 200) || ''}`
).join('\n\n')}`);
  }

  return sections.join('\n\n');
}

// ─── DeepSeek synthesis ────────────────────────────────────────────────────────
async function synthesizeThesis(context, companyName, today) {
  const quarter = (() => {
    const d = new Date();
    return `Q${Math.ceil((d.getMonth() + 1) / 3)} ${d.getFullYear()}`;
  })();

  const prompt = `You are a senior investment analyst writing a comprehensive Investment Thesis Update.

COMPANY: ${companyName} (${TICKER})
DATE: ${today} | QUARTER: ${quarter}

ALL AVAILABLE RESEARCH DATA:
${context}

Write a comprehensive, long-form Investment Thesis Update synthesizing ALL of the above data.
This is a standalone report that should stand alone without reference to raw data.

Return JSON ONLY:
{
  "title_en": "${TICKER} — Investment Thesis Update (${quarter})",
  "title_th": "${TICKER} — อัปเดต Investment Thesis (${quarter})",
  "tags": ["strategy", "growth", "valuation"],
  "rating": 4,
  "conviction": "medium",

  "executive_summary_en": "3-4 sentences: current conviction level and core reasoning. This is the TL;DR.",
  "executive_summary_th": "3-4 ประโยค: ระดับ conviction ปัจจุบันและเหตุผลหลัก",

  "core_thesis_en": "3-5 sentences: the fundamental reason to own this stock. What is the durable competitive advantage? What is the primary value creation mechanism?",
  "core_thesis_th": "3-5 ประโยค: เหตุผลพื้นฐานในการถือหุ้นนี้ ความได้เปรียบที่ยั่งยืนคืออะไร?",

  "financial_quality_en": "3-4 sentences: assessment of financial health, earnings quality, and capital allocation. Reference specific metrics.",
  "financial_quality_th": "3-4 ประโยค: การประเมินสุขภาพทางการเงิน คุณภาพกำไร และการจัดสรรทุน อ้างตัวชี้วัดที่เฉพาะเจาะจง",

  "management_credibility_en": "2-3 sentences: evidence from roadmap delivery rates. Are they executing on what they promised? Cite specific delivered vs missed commitments.",
  "management_credibility_th": "2-3 ประโยค: หลักฐานจากอัตราการส่งมอบ roadmap ผู้บริหารทำตามที่พูดไว้หรือไม่?",

  "bull_case_en": "3-4 sentences: best case scenario. Specific catalysts, timeline, and upside magnitude.",
  "bull_case_th": "3-4 ประโยค: กรณีที่ดีที่สุด ปัจจัยเร่งเฉพาะ ช่วงเวลา และขนาด upside",

  "bear_case_en": "3-4 sentences: what would make this thesis wrong? Specific triggers, early warning signals, and when to exit.",
  "bear_case_th": "3-4 ประโยค: อะไรจะทำให้ thesis นี้ผิด? สัญญาณเตือนล่วงหน้าที่เฉพาะเจาะจง และเมื่อไหรควรขาย",

  "key_risks_en": "2-3 sentences: top 3 risks ranked by severity. Include both fundamental and macro risks.",
  "key_risks_th": "2-3 ประโยค: ความเสี่ยง 3 อันดับสูงสุดจัดตามระดับความรุนแรง รวมทั้งความเสี่ยง fundamental และ macro",

  "watchlist_en": "3-5 bullet points as a single string: specific metrics, events, or dates to monitor over the next 12 months that will confirm or refute the thesis.",
  "watchlist_th": "3-5 ข้อเป็นข้อความเดียว: ตัวชี้วัด เหตุการณ์ หรือวันที่เฉพาะที่ต้องติดตามใน 12 เดือนข้างหน้า",

  "thesis_change_en": "1-2 sentences: how has the thesis changed vs prior period? Stronger, weaker, or unchanged? What specific evidence caused the change?",
  "thesis_change_th": "1-2 ประโยค: thesis เปลี่ยนแปลงอย่างไรเมื่อเทียบกับงวดก่อน? แข็งแกร่งขึ้น อ่อนแอลง หรือไม่เปลี่ยน?",

  "conviction": "high" | "medium" | "low" | "watch"
}

Quality standards:
- Every section must cite specific data from the research context (quotes, metrics, roadmap items)
- bull_case and bear_case must each have at least 1 specific catalyst with a timeline
- management_credibility must reference actual delivered/missed commitments from the data
- All _th fields: full Thai translation, not a summary
- conviction must match the weight of evidence presented`;

  const raw = await deepseekChat([
    { role: 'system', content: 'You are a senior investment analyst. Respond with JSON only.' },
    { role: 'user', content: prompt },
  ], 8192);

  return JSON.parse(raw);
}

// ─── Create Analytic Report in Notion ─────────────────────────────────────────
async function createAnalyticReport(thesis, today, companyPageId) {
  // Build full body: EN + TH sections
  const bodyParts = [
    `## Executive Summary\n${thesis.executive_summary_en}`,
    `\n[TH] ${thesis.executive_summary_th}`,
    `\n## Core Thesis\n${thesis.core_thesis_en}`,
    `\n[TH] ${thesis.core_thesis_th}`,
    `\n## Financial Quality\n${thesis.financial_quality_en}`,
    `\n## Management Credibility\n${thesis.management_credibility_en}`,
    `\n## Bull Case\n${thesis.bull_case_en}`,
    `\n## Bear Case\n${thesis.bear_case_en}`,
    `\n## Key Risks\n${thesis.key_risks_en}`,
    `\n## Watchlist\n${thesis.watchlist_en}`,
    `\n## Thesis Change vs Prior\n${thesis.thesis_change_en}`,
  ];
  const fullBody = bodyParts.join('\n').substring(0, 2000);

  const properties = {
    'Title': { title: [{ type: 'text', text: { content: thesis.title_en.substring(0, 200) } }] },
    'Ticker': { rich_text: [{ type: 'text', text: { content: TICKER } }] },
    'Type': { select: { name: 'Thesis' } },
    'Date': { date: { start: today } },
    'Tags': { multi_select: (thesis.tags || []).map(t => ({ name: t })) },
    'Rating': { number: thesis.rating || 4 },
    'Summary': { rich_text: [{ type: 'text', text: { content: thesis.executive_summary_en?.substring(0, 500) || '' } }] },
    'Body': { rich_text: [{ type: 'text', text: { content: fullBody } }] },
    'Conviction': { select: { name: thesis.conviction || 'medium' } },
  };

  if (companyPageId) {
    properties['Company'] = { relation: [{ id: companyPageId }] };
  }

  const resp = await notionRequest('POST', '/v1/pages', {
    parent: { database_id: REPORTS_DB },
    properties,
  });

  return resp.id;
}

// ─── Update Companies DB ───────────────────────────────────────────────────────
async function updateCompanyThesis(companyPageId, thesis) {
  if (!companyPageId || !COMPANIES_DB) return;

  const properties = {
    'Investment Thesis': {
      rich_text: [{ type: 'text', text: { content: thesis.core_thesis_en?.substring(0, 2000) || '' } }],
    },
    'Conviction Level': { select: { name: thesis.conviction || 'medium' } },
    'Last Analyzed': { date: { start: new Date().toISOString().split('T')[0] } },
  };

  await notionRequest('PATCH', `/v1/pages/${companyPageId}`, { properties });
  console.log('  ✅ Updated Company record (Investment Thesis + Conviction)');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Prometheus Thesis Update ===');
  console.log(`Ticker: ${TICKER} | Force: ${FORCE_UPDATE}`);

  const today = new Date().toISOString().split('T')[0];

  // 1. Fetch all data in parallel
  console.log('\n1. Fetching all Notion data...');
  const [company, quotes, roadmap, notes, financials] = await Promise.all([
    getCompanyInfo(),
    getAllQuotes(50),
    getAllRoadmapItems(),
    getAllNotes(20),
    getFinancialsFromFile(),
  ]);

  console.log(`   Company: ${company?.name || 'not found'}`);
  console.log(`   Quotes: ${quotes.length} | Roadmap: ${roadmap.length} | Notes: ${notes.length}`);
  console.log(`   Financials: ${financials ? `${financials.years?.join(', ')}` : 'none'}`);

  if (!company && quotes.length === 0 && roadmap.length === 0) {
    console.error('ERROR: No data found for this ticker. Run deepseek-extract.js first.');
    process.exit(1);
  }

  // 2. Build context
  console.log('\n2. Building research context...');
  const context = buildContext(company, quotes, roadmap, notes, financials);
  console.log(`   Context length: ${context.length} chars`);

  // 3. Synthesize with DeepSeek
  console.log('\n3. Synthesizing thesis with DeepSeek...');
  const thesis = await synthesizeThesis(context, company?.name || TICKER, today);
  console.log(`   Title: ${thesis.title_en}`);
  console.log(`   Conviction: ${thesis.conviction}`);

  // 4. Create Analytic Report
  console.log('\n4. Creating Analytic Report in Notion...');
  const reportId = await createAnalyticReport(thesis, today, company?.pageId);
  console.log(`   Report created: ${reportId}`);

  // 5. Update Company record
  console.log('\n5. Updating Company record...');
  await updateCompanyThesis(company?.pageId, thesis);

  console.log('\n✅ Thesis update complete!');
  console.log(`   Report: https://www.notion.so/${reportId?.replace(/-/g, '')}`);
  console.log(`\nConviction: ${thesis.conviction?.toUpperCase()}`);
  console.log(`Bull: ${thesis.bull_case_en?.substring(0, 120)}...`);
  console.log(`Bear: ${thesis.bear_case_en?.substring(0, 120)}...`);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
