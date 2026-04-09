#!/usr/bin/env node
/**
 * deepseek-sector-scan.js — Prometheus v2.2
 *
 * Fetches recent news for a sector (or all watchlist companies),
 * asks DeepSeek to write an investment-focused digest note,
 * then creates it in the Notion Notes DB.
 *
 * Requires NEWS_API_KEY (newsapi.org free tier: 100 req/day)
 * Fallback: uses GNews API if NEWS_API_KEY not set (gnews.io free tier)
 *
 * Usage:
 *   node scripts/deepseek-sector-scan.js --sector Technology
 *   node scripts/deepseek-sector-scan.js --sector "All Watchlist" --note-type Analysis
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

const SECTOR    = getArg('--sector') || process.env.SECTOR || 'Technology';
const NOTE_TYPE = getArg('--note-type') || process.env.NOTE_TYPE || 'Observation';

// ─── Env ──────────────────────────────────────────────────────────────────────
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const NOTION_TOKEN     = process.env.NOTION_TOKEN;
const NOTES_DB         = process.env.NOTION_NOTES_DB;
const SOURCES_DB       = process.env.NOTION_SOURCES_DB;
const COMPANIES_DB     = process.env.NOTION_COMPANIES_DB;
const NEWS_API_KEY     = process.env.NEWS_API_KEY;  // newsapi.org

if (!DEEPSEEK_API_KEY || !NOTION_TOKEN || !NOTES_DB) {
  console.error('ERROR: Missing DEEPSEEK_API_KEY, NOTION_TOKEN, or NOTION_NOTES_DB');
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse: ${data.substring(0, 100)}`)); }
      });
    }).on('error', reject);
  });
}

function notionRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.notion.com',
      path,
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

function deepseekChat(messages, maxTokens = 6000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
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
        'Content-Length': Buffer.byteLength(body),
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
    req.write(body);
    req.end();
  });
}

// ─── Get watchlist companies from Notion ──────────────────────────────────────
async function getWatchlistCompanies(sectorFilter) {
  if (!COMPANIES_DB) {
    // Fallback: read from data/companies.json
    try {
      const companiesPath = path.join(__dirname, '..', 'data', 'companies.json');
      const data = JSON.parse(fs.readFileSync(companiesPath, 'utf8'));
      return data.companies || [];
    } catch { return []; }
  }

  const filter = sectorFilter !== 'All Watchlist'
    ? { property: 'Sector', select: { equals: sectorFilter } }
    : undefined;

  const body = { page_size: 50 };
  if (filter) body.filter = filter;

  const resp = await notionRequest('POST', `/v1/databases/${COMPANIES_DB}/query`, body);
  if (resp.object === 'error') return [];

  return resp.results.map(item => ({
    ticker: item.properties['Ticker']?.rich_text?.[0]?.plain_text || '',
    name: item.properties['Name']?.title?.[0]?.plain_text || '',
    sector: item.properties['Sector']?.select?.name || '',
  })).filter(c => c.ticker);
}

// ─── Fetch news ────────────────────────────────────────────────────────────────
async function fetchNewsForCompanies(companies) {
  const articles = [];
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fromDate = weekAgo.toISOString().split('T')[0];

  if (NEWS_API_KEY) {
    // newsapi.org — query by company names
    for (const company of companies.slice(0, 5)) {  // limit to 5 to stay in free tier
      try {
        const query = encodeURIComponent(`"${company.name}" OR "${company.ticker}"`);
        const url = `https://newsapi.org/v2/everything?q=${query}&from=${fromDate}&sortBy=relevancy&pageSize=5&language=en&apiKey=${NEWS_API_KEY}`;
        const result = await httpGet(url);

        if (result.articles) {
          articles.push(...result.articles.map(a => ({
            ticker: company.ticker,
            title: a.title,
            description: a.description || '',
            source: a.source?.name || '',
            publishedAt: a.publishedAt,
            url: a.url,
          })));
        }
      } catch (e) {
        console.warn(`  News fetch failed for ${company.ticker}: ${e.message}`);
      }
    }
  } else {
    // Fallback: use GNews free tier (no key needed for basic)
    for (const company of companies.slice(0, 3)) {
      try {
        const query = encodeURIComponent(`${company.name} stock`);
        const url = `https://gnews.io/api/v4/search?q=${query}&lang=en&max=5&from=${fromDate}T00:00:00Z`;
        const result = await httpGet(url);

        if (result.articles) {
          articles.push(...result.articles.map(a => ({
            ticker: company.ticker,
            title: a.title,
            description: a.description || '',
            source: a.source?.name || '',
            publishedAt: a.publishedAt,
            url: a.url,
          })));
        }
      } catch (e) {
        console.warn(`  GNews fetch failed for ${company.ticker}: ${e.message}`);
      }
    }
  }

  return articles;
}

// ─── DeepSeek sector digest ────────────────────────────────────────────────────
async function generateSectorDigest(sector, companies, articles, noteType) {
  const companiesList = companies.map(c => `${c.ticker} (${c.name})`).join(', ');

  const articleText = articles.slice(0, 25).map(a =>
    `[${a.ticker}] ${a.publishedAt?.split('T')[0] || ''} — ${a.title}\n  ${a.description?.substring(0, 150) || ''}`
  ).join('\n\n');

  const today = new Date().toISOString().split('T')[0];
  const weekLabel = `Week of ${today}`;

  const prompt = `You are a senior investment analyst writing a weekly sector digest for a personal investment research system.

SECTOR: ${sector}
DATE: ${today}
WATCHLIST COMPANIES: ${companiesList}

RECENT NEWS (last 7 days):
${articleText || '(No news articles retrieved — write based on general sector knowledge for this week)'}

Write a structured investment digest note for this sector.

Return JSON ONLY:
{
  "title_en": "${sector} Weekly Digest — ${weekLabel}",
  "title_th": "สรุปรายสัปดาห์ ${sector} — ${weekLabel}",
  "tags": ["macro", "strategy"],
  "rating": 3,
  "note_type": "${noteType}",
  "content_en": "Full digest in English (4-6 paragraphs):\\n\\n[Key Developments]\\n[Watchlist Highlights]\\n[Macro Themes]\\n[Risks to Watch]\\n[Investment Implications]",
  "content_th": "สรุปฉบับสมบูรณ์เป็นภาษาไทย (4-6 ย่อหน้า):\\n\\n[พัฒนาการสำคัญ]\\n[ไฮไลท์หุ้นใน Watchlist]\\n[ธีม Macro]\\n[ความเสี่ยงที่ต้องจับตา]\\n[ผลกระทบต่อการลงทุน]",
  "tickers_mentioned": ["AAPL", "MSFT"]
}

Rules:
- Each section: minimum 3 substantive sentences
- content_th: full Thai translation, preserve company names, tickers, and numbers
- tags: 2-4 from ["earnings", "risk", "strategy", "growth", "macro", "valuation", "services", "financials", "china"]
- tickers_mentioned: only tickers from the watchlist that appear in your note
- rating: 3=standard update, 4=significant week, 5=exceptional market-moving week`;

  const raw = await deepseekChat([
    { role: 'system', content: 'You are a senior investment analyst. Respond with JSON only.' },
    { role: 'user', content: prompt },
  ], 6000);

  return JSON.parse(raw);
}

// ─── Create Notion source entry ────────────────────────────────────────────────
async function createSourceEntry(sector, today) {
  if (!SOURCES_DB) return null;

  const body = {
    parent: { database_id: SOURCES_DB },
    properties: {
      'Name': { title: [{ type: 'text', text: { content: `${sector} Sector Scan — ${today}` } }] },
      'Type': { select: { name: 'Sector Scan' } },
      'Date': { date: { start: today } },
      'URL': { url: `https://newsapi.org` },
    },
  };

  const resp = await notionRequest('POST', '/v1/pages', body);
  return resp.id || null;
}

// ─── Create Notion note ────────────────────────────────────────────────────────
async function createNotionNote(digest, sector, sourceId, today) {
  const body_en_th = `${digest.content_en}\n\n---\n\n${digest.content_th}`;

  const properties = {
    'Title': { title: [{ type: 'text', text: { content: digest.title_en.substring(0, 200) } }] },
    'Title (TH)': { rich_text: [{ type: 'text', text: { content: digest.title_th.substring(0, 200) } }] },
    'Note Type': { select: { name: digest.note_type || 'Observation' } },
    'Tags': { multi_select: (digest.tags || []).map(t => ({ name: t })) },
    'Rating': { number: digest.rating || 3 },
    'Body': { rich_text: [{ type: 'text', text: { content: body_en_th.substring(0, 2000) } }] },
    'Date': { date: { start: today } },
  };

  // Link tickers as relation if needed — skip for now (sector notes aren't company-specific)

  // Link source
  if (sourceId) {
    properties['Source Doc'] = { relation: [{ id: sourceId }] };
  }

  const resp = await notionRequest('POST', '/v1/pages', {
    parent: { database_id: NOTES_DB },
    properties,
  });

  return resp.id;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Prometheus Sector Scan ===');
  console.log(`Sector: ${SECTOR} | Note Type: ${NOTE_TYPE}`);

  const today = new Date().toISOString().split('T')[0];

  // 1. Get watchlist companies
  console.log('\n1. Loading watchlist companies...');
  const companies = await getWatchlistCompanies(SECTOR);
  console.log(`   Found ${companies.length} companies: ${companies.map(c => c.ticker).join(', ')}`);

  // 2. Fetch news
  console.log('\n2. Fetching recent news...');
  const articles = await fetchNewsForCompanies(companies);
  console.log(`   Fetched ${articles.length} articles`);

  // 3. Generate digest with DeepSeek
  console.log('\n3. Generating sector digest with DeepSeek...');
  const digest = await generateSectorDigest(SECTOR, companies, articles, NOTE_TYPE);
  console.log(`   Title: ${digest.title_en}`);
  console.log(`   Tags: ${(digest.tags || []).join(', ')} | Rating: ${digest.rating}`);
  console.log(`   Tickers mentioned: ${(digest.tickers_mentioned || []).join(', ')}`);

  // 4. Create source entry
  console.log('\n4. Creating source entry...');
  const sourceId = await createSourceEntry(SECTOR, today);
  console.log(`   Source ID: ${sourceId || 'skipped (no SOURCES_DB)'}`);

  // 5. Create note in Notion
  console.log('\n5. Creating note in Notion...');
  const noteId = await createNotionNote(digest, SECTOR, sourceId, today);
  console.log(`   Note created: ${noteId}`);

  console.log('\n✅ Sector scan complete!');
  console.log(`   View in Notion: https://www.notion.so/${noteId?.replace(/-/g, '')}`);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
