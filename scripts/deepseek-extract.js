#!/usr/bin/env node
/**
 * scripts/deepseek-extract.js
 *
 * Fetches a financial document, runs 4 DeepSeek agents in parallel, then
 * writes Quotes, Roadmap, and an Analysis Note directly to Notion.
 *
 * Usage:
 *   node scripts/deepseek-extract.js \
 *     --ticker GOOGL \
 *     --url "https://..." \
 *     --doc-type "10-K" \
 *     --year 2024 \
 *     --quarter "Q4 2024"
 *
 * Required env vars:
 *   DEEPSEEK_API_KEY, NOTION_TOKEN,
 *   NOTION_COMPANIES_DB, NOTION_QUOTES_DB, NOTION_ROADMAP_DB,
 *   NOTION_NOTES_DB, NOTION_SOURCES_DB, NOTION_TASKS_DB
 */

'use strict';

const { Client } = require('@notionhq/client');
const fs   = require('fs');
const path = require('path');

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[key] = argv[i + 1];
  }
  return out;
}

const args     = parseArgs(process.argv.slice(2));
const TICKER   = (args.ticker   || '').toUpperCase();
const DOC_URL  = args.url       || '';
const DOC_TYPE = args.docType   || args['doc-type'] || '10-K';
const YEAR     = args.year      || String(new Date().getFullYear());
const QUARTER  = args.quarter   || `Q4 ${YEAR}`;

if (!TICKER || !DOC_URL) {
  console.error(
    'Usage: node scripts/deepseek-extract.js ' +
    '--ticker GOOGL --url "https://..." ' +
    '[--doc-type "10-K"] [--year 2025] [--quarter "Q4 2025"]'
  );
  process.exit(1);
}

// ── Notion ────────────────────────────────────────────────────────────────────

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const DB = {
  companies : process.env.NOTION_COMPANIES_DB,
  quotes    : process.env.NOTION_QUOTES_DB,
  roadmap   : process.env.NOTION_ROADMAP_DB,
  notes     : process.env.NOTION_NOTES_DB,
  sources   : process.env.NOTION_SOURCES_DB,
  tasks     : process.env.NOTION_TASKS_DB,
};

// ── Notion property helpers ───────────────────────────────────────────────────

const VALID_QUARTERS = [
  'Q1 2025','Q2 2025','Q3 2025','Q4 2025',
  'Q1 2026','Q2 2026','Q3 2026','Q4 2026',
  'Q1 2027','Q2 2027','Q3 2027','Q4 2027',
];

function sanitizeQuarter(q) {
  return VALID_QUARTERS.includes(q) ? q : null;
}

const n = {
  title      : (t)    => ({ title:        [{ text: { content: String(t || '').slice(0, 2000) } }] }),
  text       : (t)    => ({ rich_text:    [{ text: { content: String(t || '').slice(0, 2000) } }] }),
  select     : (name) => name ? { select: { name } } : undefined,
  multiSelect: (arr)  => ({ multi_select: (arr || []).map(name => ({ name })) }),
  relation   : (ids)  => ({ relation: (ids || []).filter(Boolean).map(id => ({ id })) }),
  date       : (d)    => d ? { date: { start: d } } : undefined,
  number     : (num)  => ({ number: num }),
  url        : (u)    => u ? { url: u } : undefined,
  checkbox   : (b)    => ({ checkbox: !!b }),
};

/** Remove undefined values from a properties object */
function cleanProps(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

// ── DeepSeek API ──────────────────────────────────────────────────────────────

async function callDeepSeek(prompt) {
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method  : 'POST',
    headers : {
      'Authorization' : `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      'Content-Type'  : 'application/json',
    },
    body: JSON.stringify({
      model           : 'deepseek-chat',
      messages        : [{ role: 'user', content: prompt }],
      response_format : { type: 'json_object' },
      temperature     : 0.1,
      max_tokens      : 4096,
    }),
  });

  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`);

  const data    = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from DeepSeek');
  return JSON.parse(content);
}

// ── Document fetcher ──────────────────────────────────────────────────────────

async function fetchDocumentText(docUrl) {
  console.log(`  📄  Fetching: ${docUrl}`);
  const res = await fetch(docUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PrometheusResearch/1.0)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching document`);

  const contentType = res.headers.get('content-type') || '';

  if (contentType.includes('pdf') || docUrl.toLowerCase().endsWith('.pdf')) {
    let pdfParse;
    try { pdfParse = require('pdf-parse'); }
    catch { throw new Error('pdf-parse not installed. Run: npm install pdf-parse'); }
    const buf  = Buffer.from(await res.arrayBuffer());
    const data = await pdfParse(buf);
    console.log(`  ✅  PDF extracted: ${data.text.length.toLocaleString()} chars, ${data.numpages} pages`);
    return data.text;
  }

  // HTML
  const html = await res.text();
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s{3,}/g, '\n\n')
    .trim();
  console.log(`  ✅  HTML extracted: ${text.length.toLocaleString()} chars`);
  return text;
}

// ── Chunker ───────────────────────────────────────────────────────────────────

function chunkText(text, maxChars = 20000) {
  if (text.length <= maxChars) return [text];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = start + maxChars;
    if (end < text.length) {
      const boundary = text.lastIndexOf('\n\n', end);
      if (boundary > start + maxChars * 0.5) end = boundary;
    }
    chunks.push(text.slice(start, Math.min(end, text.length)));
    start = end;
  }
  return chunks;
}

// ── Prompt loader ─────────────────────────────────────────────────────────────

function loadPrompt(filename, vars) {
  const filePath = path.join(__dirname, '..', 'prompts', 'deepseek_agents', filename);
  let tpl = fs.readFileSync(filePath, 'utf8');
  for (const [k, v] of Object.entries(vars)) {
    tpl = tpl.replaceAll(`{${k}}`, v).replaceAll(`{{${k}}}`, v);
  }
  return tpl;
}

// ── Notion page creator ───────────────────────────────────────────────────────

async function createPage(dbId, properties, bodyText = '') {
  const payload = { parent: { database_id: dbId }, properties };
  if (bodyText.trim()) {
    // Split body into 2000-char chunks (Notion block limit)
    const chunks = [];
    for (let i = 0; i < bodyText.length; i += 2000) {
      chunks.push(bodyText.slice(i, i + 2000));
    }
    payload.children = chunks.map(chunk => ({
      object    : 'block',
      type      : 'paragraph',
      paragraph : { rich_text: [{ text: { content: chunk } }] },
    }));
  }
  return notion.pages.create(payload);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔬  Prometheus DeepSeek Extraction Pipeline');
  console.log('━'.repeat(50));
  console.log(`  Ticker:   ${TICKER}`);
  console.log(`  Doc:      ${DOC_TYPE} ${YEAR} (${QUARTER})`);
  console.log(`  URL:      ${DOC_URL}`);
  console.log('━'.repeat(50) + '\n');

  // ── 1. Find company page in Notion ────────────────────────────────────────

  console.log('STEP 1 — Locate company in Notion');
  const companyQuery = await notion.databases.query({
    database_id : DB.companies,
    filter      : { property: 'Ticker', title: { equals: TICKER } },
    page_size   : 1,
  });
  const companyPage = companyQuery.results[0];
  if (!companyPage) throw new Error(`Company "${TICKER}" not found in Notion Companies DB. Add it first.`);
  const companyId = companyPage.id;
  console.log(`  ✅  Found: ${companyId}\n`);

  // ── 2. Fetch & extract document text ─────────────────────────────────────

  console.log('STEP 2 — Fetch document');
  const fullText = await fetchDocumentText(DOC_URL);
  console.log();

  // ── 3. Create Source record (status=extracting) ───────────────────────────

  console.log('STEP 3 — Create Source record');
  const sourceTypeMap = {
    '10-K': 'Annual Report', '10-Q': 'Annual Report',
    'Earnings Call': 'Earnings Call', 'Press Release': 'Press Release',
    'SEC Filing': 'SEC Filing', 'News': 'News',
  };
  const sourceTitle = `${TICKER} ${DOC_TYPE} ${YEAR}`;
  const sourcePage  = await createPage(DB.sources, cleanProps({
    'Title'       : n.title(sourceTitle),
    'Company'     : n.relation([companyId]),
    'Source Type' : n.select(sourceTypeMap[DOC_TYPE] || 'SEC Filing'),
    'URL'         : n.url(DOC_URL),
    'Quarter'     : n.select(sanitizeQuarter(QUARTER)),
    'Analyzed By' : n.select('DeepSeek'),
    'Status'      : n.select('extracting'),
    'Tags'        : n.multiSelect(['financials', 'strategy']),
  }));
  const sourceId = sourcePage.id;
  console.log(`  ✅  Source: ${sourceId}\n`);

  // ── 4. Prepare text slices for each agent ─────────────────────────────────

  console.log('STEP 4 — Chunk document');
  const chunks      = chunkText(fullText);
  const mdaText     = chunks.slice(0, 2).join('\n\n...\n\n').slice(0, 40000);  // first ~2 chunks
  const fullSlice   = chunks.join('\n\n...\n\n').slice(0, 40000);              // all chunks
  console.log(`  ✅  ${chunks.length} chunk(s), ${(fullText.length / 1000).toFixed(0)}k chars total\n`);

  // ── 5. Run 4 DeepSeek agents in parallel ─────────────────────────────────

  console.log('STEP 5 — Run DeepSeek agents (parallel)');
  const baseVars   = { ticker: TICKER, doc_type: DOC_TYPE, text: mdaText };
  const quotesVars = { ticker: TICKER, doc_type: DOC_TYPE, text: fullSlice };

  const [analysisR, roadmapR, quotesR, risksR] = await Promise.allSettled([
    callDeepSeek(loadPrompt('phase2_deep_analysis.md', baseVars)),
    callDeepSeek(loadPrompt('phase2_roadmap.md',       baseVars)),
    callDeepSeek(loadPrompt('phase2_quotes.md',        quotesVars)),
    callDeepSeek(loadPrompt('phase2_risks.md',         baseVars)),
  ]);

  const analysis  = analysisR.status  === 'fulfilled' ? analysisR.value  : null;
  const roadmap   = roadmapR.status   === 'fulfilled' ? (roadmapR.value.roadmap   || []) : [];
  const quotes    = quotesR.status    === 'fulfilled' ? (quotesR.value.quotes     || []) : [];
  const risks     = risksR.status     === 'fulfilled' ? (risksR.value.key_risks   || []) : [];

  if (analysisR.status === 'rejected') console.warn('  ⚠️  Analysis agent failed:', analysisR.reason.message);
  if (roadmapR.status  === 'rejected') console.warn('  ⚠️  Roadmap agent failed:',  roadmapR.reason.message);
  if (quotesR.status   === 'rejected') console.warn('  ⚠️  Quotes agent failed:',   quotesR.reason.message);
  if (risksR.status    === 'rejected') console.warn('  ⚠️  Risks agent failed:',    risksR.reason.message);

  console.log(`  ✅  Analysis: ${analysis ? 'OK' : 'FAILED'}`);
  console.log(`  ✅  Roadmap:  ${roadmap.length} items`);
  console.log(`  ✅  Quotes:   ${quotes.length} items`);
  console.log(`  ✅  Risks:    ${risks.length} items\n`);

  // ── 6. Write Quotes → Notion ──────────────────────────────────────────────

  console.log('STEP 6 — Write Quotes to Notion');
  const VALID_TAGS       = ['growth','risk','strategy','guidance','product','macro'];
  const VALID_SENTIMENTS = ['bullish','neutral','cautious','bearish'];
  const VALID_SEGMENTS   = ['Prepared Remarks','Q&A','Written Submission'];

  let quotesOk = 0;
  for (const q of quotes) {
    try {
      await createPage(DB.quotes, cleanProps({
        'Quote'     : n.title(q.quote || ''),
        'Quote TH'  : n.text(q.quote_th || ''),
        'Company'   : n.relation([companyId]),
        'Source Doc': n.relation([sourceId]),
        'Quarter'   : n.select(sanitizeQuarter(QUARTER)),
        'Speaker'   : n.text(q.speaker || ''),
        'Segment'   : n.select(VALID_SEGMENTS.includes(q.segment)   ? q.segment   : 'Prepared Remarks'),
        'Tag'       : n.select(VALID_TAGS.includes(q.tag)           ? q.tag       : 'strategy'),
        'Sentiment' : n.select(VALID_SENTIMENTS.includes(q.sentiment) ? q.sentiment : 'neutral'),
        ...(Array.isArray(q.sub_tags) && q.sub_tags.length
          ? { 'Sub-tag': n.multiSelect(q.sub_tags) } : {}),
      }));
      quotesOk++;
      process.stdout.write('·');
    } catch (err) {
      process.stdout.write('✗');
      if (process.env.DEBUG) console.error('\n', err.message);
    }
  }
  console.log(`\n  ✅  ${quotesOk}/${quotes.length} quotes written\n`);

  // ── 7. Write Roadmap → Notion ─────────────────────────────────────────────

  console.log('STEP 7 — Write Roadmap to Notion');
  const VALID_CATEGORIES  = ['Strategic','Financial','Product','Operational','Regulatory'];
  const VALID_CONFIDENCES = ['low','medium','high'];

  let roadmapOk = 0;
  for (const item of roadmap) {
    try {
      await createPage(DB.roadmap, cleanProps({
        'Commitment'    : n.title(item.commitment || ''),
        'Company'       : n.relation([companyId]),
        'Source Doc'    : n.relation([sourceId]),
        'Status'        : n.select('pending'),
        'Category'      : n.select(VALID_CATEGORIES.includes(item.category)   ? item.category   : 'Strategic'),
        'Confidence'    : n.select(VALID_CONFIDENCES.includes(item.confidence) ? item.confidence : 'medium'),
        'Quarter Said'  : n.select(sanitizeQuarter(item.quarter_said  || QUARTER)),
        'Target Quarter': n.select(sanitizeQuarter(item.target_quarter || null)),
      }));
      roadmapOk++;
      process.stdout.write('·');
    } catch (err) {
      process.stdout.write('✗');
      if (process.env.DEBUG) console.error('\n', err.message);
    }
  }
  console.log(`\n  ✅  ${roadmapOk}/${roadmap.length} roadmap items written\n`);

  // ── 8. Write Analysis Note → Notion ──────────────────────────────────────

  console.log('STEP 8 — Write Analysis Note');
  if (analysis) {
    const priorities = (analysis.strategic_priorities || [])
      .map((p, i) => `${i + 1}. ${p}`).join('\n');
    const risksList  = risks
      .map(r => `• [${r.severity?.toUpperCase()}] ${r.risk}: ${r.description}`).join('\n');

    const noteBody = [
      `[FINANCIAL PERFORMANCE]\n${analysis.financial_summary || '—'}`,
      `[STRATEGIC PRIORITIES]\n${priorities || '—'}`,
      `[MANAGEMENT QUALITY]\nExecution: ${analysis.management_quality?.execution_score || '—'}\n${analysis.management_quality?.commentary || ''}`,
      `[COMPETITIVE POSITION]\n${analysis.competitive_position || '—'}`,
      `[OUTLOOK]\n${analysis.outlook_signals || '—'}`,
      `[KEY RISKS]\n${risksList || '—'}`,
      `[RISK SUMMARY]\n${risks[0] ? risksR.value?.risk_summary || '' : '—'}`,
    ].join('\n\n');

    await createPage(DB.notes, cleanProps({
      'Title'     : n.title(`${TICKER} ${DOC_TYPE} ${YEAR} — Analysis`),
      'Company'   : n.relation([companyId]),
      'Source Doc': n.relation([sourceId]),
      'Note Type' : n.select('Analysis'),
      'Quarter'   : n.select(sanitizeQuarter(QUARTER)),
      'Tags'      : n.multiSelect(['earnings', 'strategy', 'financials']),
      'Rating'    : n.number(3),
      'Active'    : n.checkbox(true),
    }), noteBody);
    console.log('  ✅  Analysis note written\n');
  }

  // ── 9. Update Company: management tone ───────────────────────────────────

  if (analysis?.management_tone) {
    console.log('STEP 9 — Update company management tone');
    const validTones = ['bullish', 'cautious', 'mixed'];
    if (validTones.includes(analysis.management_tone)) {
      await notion.pages.update({
        page_id    : companyId,
        properties : cleanProps({ 'Management Tone': n.select(analysis.management_tone) }),
      });
      console.log(`  ✅  Tone set to: ${analysis.management_tone}\n`);
    }
  }

  // ── 10. Mark Source as analyzed ───────────────────────────────────────────

  await notion.pages.update({
    page_id    : sourceId,
    properties : cleanProps({ 'Status': n.select('analyzed') }),
  });

  // ── 11. Close pending task for this company ───────────────────────────────

  const taskQuery = await notion.databases.query({
    database_id : DB.tasks,
    filter      : {
      and: [
        { property: 'Company', relation: { contains: companyId } },
        { property: 'Status',  select:   { equals: 'pending'   } },
      ],
    },
    page_size: 1,
  });
  if (taskQuery.results[0]) {
    await notion.pages.update({
      page_id    : taskQuery.results[0].id,
      properties : cleanProps({ 'Status': n.select('done') }),
    });
    console.log('  ✅  Pending task marked done\n');
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('━'.repeat(50));
  console.log(`✅  DONE  ${TICKER} ${DOC_TYPE} ${YEAR}`);
  console.log(`   Quotes    : ${quotesOk}`);
  console.log(`   Roadmap   : ${roadmapOk}`);
  console.log(`   Note      : 1 (Analysis)`);
  console.log(`   Tone      : ${analysis?.management_tone || 'not detected'}`);
  console.log(`   Source ID : ${sourceId}`);
  console.log('━'.repeat(50));
  console.log('\n💡  Run "npm run sync" to update data.json from Notion\n');
}

main().catch(err => {
  console.error('\n❌  Fatal:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
