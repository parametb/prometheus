#!/usr/bin/env node
/**
 * scripts/deepseek-extract.js  — v2.2
 *
 * Fetches a financial document, runs 5 DeepSeek agents in parallel, then
 * writes all results directly into Notion with full field coverage.
 *
 * Agents:
 *   A — Deep Analysis  → Companies update (tone, CEO, thesis, conviction)
 *   B — Roadmap        → Roadmap DB (with follow-up + Thai)
 *   C — Quotes         → Quotes DB (with analyst note + Thai)
 *   D — Notes (multi)  → 3 Notes: Analysis + Risk + Thesis (EN + TH)
 *   E — Financials     → data/{TICKER}/data.json (financials section)
 *
 * Usage:
 *   node scripts/deepseek-extract.js \
 *     --ticker GOOGL --url "https://..." \
 *     --doc-type "10-K" --year 2025 --quarter "Q4 2025" \
 *     [--date "2025-02-04"] [--period "FY2025"]
 *
 * Required env: DEEPSEEK_API_KEY, NOTION_TOKEN,
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
const DOC_DATE = args.date      || new Date().toISOString().slice(0, 10);  // YYYY-MM-DD
const PERIOD   = args.period    || (DOC_TYPE === 'Earnings Call' ? QUARTER : `FY${YEAR}`);

if (!TICKER || !DOC_URL) {
  console.error(
    'Usage: node scripts/deepseek-extract.js ' +
    '--ticker GOOGL --url "https://..." ' +
    '[--doc-type "10-K"] [--year 2025] [--quarter "Q4 2025"] ' +
    '[--date "2025-02-04"] [--period "FY2025"]'
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

const DATA_DIR = path.join(__dirname, '..', 'data');

// ── Quarter helpers ───────────────────────────────────────────────────────────

const VALID_QUARTERS_SOURCE = [
  'Q1 2025','Q2 2025','Q3 2025','Q4 2025',
  'Q1 2026','Q2 2026','Q3 2026','Q4 2026',
];
const VALID_QUARTERS_ROADMAP_SAID = [
  'Q1 2025','Q2 2025','Q3 2025','Q4 2025','Q4 2024','Q3 2023','Q2 2024',
  'Q1 2026','Q2 2026','Q3 2026','Q4 2026',
];
const VALID_QUARTERS_TARGET = [
  'Q1 2025','Q2 2025','Q3 2025','Q4 2025',
  'Q1 2026','Q2 2026','Q3 2026','Q4 2026',
  'Q1 2027','Q2 2027','2027+',
];
const VALID_QUARTERS_NOTES = [
  'Q1 2025','Q2 2025','Q3 2025','Q4 2025',
  'Q1 2026','Q2 2026','Q3 2026','Q4 2026',
];

function sanitizeQ(q, validList) {
  return (q && validList.includes(q)) ? q : null;
}

/** Convert quarter label to ISO end-of-quarter date for Follow Up Date */
function quarterToDate(q) {
  if (!q) return null;
  const map = {
    'Q1': '-03-31', 'Q2': '-06-30', 'Q3': '-09-30', 'Q4': '-12-31',
  };
  const m = q.match(/^(Q[1-4])\s+(\d{4})$/);
  if (m) return `${m[2]}${map[m[1]]}`;
  if (q === '2027+') return '2027-12-31';
  return null;
}

// ── Notion property helpers ───────────────────────────────────────────────────

const n = {
  title      : (t)    => ({ title:        [{ text: { content: String(t || '').slice(0, 2000) } }] }),
  text       : (t)    => ({ rich_text:    [{ text: { content: String(t || '').slice(0, 2000) } }] }),
  select     : (name) => name ? { select: { name } } : undefined,
  multiSelect: (arr)  => ({ multi_select: (arr || []).map(name => ({ name })) }),
  relation   : (ids)  => ({ relation: (ids || []).filter(Boolean).map(id => ({ id })) }),
  date       : (d)    => d ? { date: { start: d } } : undefined,
  number     : (num)  => (num != null) ? { number: num } : undefined,
  url        : (u)    => u ? { url: u } : undefined,
  checkbox   : (b)    => ({ checkbox: !!b }),
};

function cleanProps(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

// ── DeepSeek API ──────────────────────────────────────────────────────────────

async function callDeepSeek(prompt, maxTokens = 8192) {
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
      max_tokens      : maxTokens,
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
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PrometheusResearch/2.2)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching document`);

  const contentType = res.headers.get('content-type') || '';

  if (contentType.includes('pdf') || docUrl.toLowerCase().endsWith('.pdf')) {
    let pdfParse;
    try { pdfParse = require('pdf-parse'); }
    catch { throw new Error('pdf-parse not installed — run: npm install pdf-parse'); }
    const buf  = Buffer.from(await res.arrayBuffer());
    const data = await pdfParse(buf);
    console.log(`  ✅  PDF: ${data.text.length.toLocaleString()} chars, ${data.numpages} pages`);
    return data.text;
  }

  const html = await res.text();
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s{3,}/g, '\n\n').trim();
  console.log(`  ✅  HTML: ${text.length.toLocaleString()} chars`);
  return text;
}

// ── Text chunker ──────────────────────────────────────────────────────────────

function chunkText(text, maxChars = 24000) {
  if (text.length <= maxChars) return [text];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = start + maxChars;
    if (end < text.length) {
      const b = text.lastIndexOf('\n\n', end);
      if (b > start + maxChars * 0.5) end = b;
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
    tpl = tpl.replaceAll(`{${k}}`, String(v ?? '')).replaceAll(`{{${k}}}`, String(v ?? ''));
  }
  return tpl;
}

// ── Notion helpers ────────────────────────────────────────────────────────────

async function createPage(dbId, properties, bodyParagraphs = []) {
  const payload = { parent: { database_id: dbId }, properties };
  if (bodyParagraphs.length) {
    payload.children = bodyParagraphs.flatMap(text => {
      // Split each paragraph into 2000-char Notion blocks
      const blocks = [];
      for (let i = 0; i < text.length; i += 2000) {
        blocks.push({
          object    : 'block',
          type      : 'paragraph',
          paragraph : { rich_text: [{ text: { content: text.slice(i, i + 2000) } }] },
        });
      }
      return blocks;
    });
  }
  return notion.pages.create(payload);
}

async function updatePage(pageId, properties) {
  return notion.pages.update({ page_id: pageId, properties });
}

// ── data.json helper ──────────────────────────────────────────────────────────

function loadDataJson(ticker) {
  const p = path.join(DATA_DIR, ticker, 'data.json');
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

function saveDataJson(ticker, data) {
  const dir = path.join(DATA_DIR, ticker);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(data, null, 2), 'utf8');
}

// ── dot progress ─────────────────────────────────────────────────────────────

function dot(ok) { process.stdout.write(ok ? '·' : '✗'); }

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔬  Prometheus DeepSeek Extraction — v2.2');
  console.log('━'.repeat(52));
  console.log(`  Ticker   : ${TICKER}`);
  console.log(`  Doc      : ${DOC_TYPE} ${YEAR}  (${PERIOD})`);
  console.log(`  Quarter  : ${QUARTER}`);
  console.log(`  Date     : ${DOC_DATE}`);
  console.log(`  URL      : ${DOC_URL}`);
  console.log('━'.repeat(52) + '\n');

  // ── 1. Find company ───────────────────────────────────────────────────────

  console.log('STEP 1 — Find company in Notion');
  const companyQuery = await notion.databases.query({
    database_id : DB.companies,
    filter      : { property: 'Ticker', title: { equals: TICKER } },
    page_size   : 1,
  });
  const companyPage = companyQuery.results[0];
  if (!companyPage) throw new Error(`"${TICKER}" not found in Companies DB — run add-company first`);
  const companyId = companyPage.id;
  console.log(`  ✅  ${companyId}\n`);

  // ── 2. Fetch document ─────────────────────────────────────────────────────

  console.log('STEP 2 — Fetch document');
  const fullText = await fetchDocumentText(DOC_URL);
  console.log();

  // ── 3. Create Source record ───────────────────────────────────────────────

  console.log('STEP 3 — Create Source record');
  const sourceTypeMap = {
    '10-K': 'Annual Report', '10-Q': 'Annual Report',
    'Earnings Call': 'Earnings Call', 'Press Release': 'Press Release',
    'SEC Filing': 'SEC Filing', 'News': 'News', 'Annual Report': 'Annual Report',
  };
  const tagsMap = {
    '10-K': ['financials','strategy'], 'Annual Report': ['financials','strategy'],
    'Earnings Call': ['earnings','guidance'], 'Press Release': ['earnings'],
    '10-Q': ['financials','earnings'], 'SEC Filing': ['financials'],
  };
  const sourceTitle = `${TICKER} ${DOC_TYPE} ${YEAR}`;
  const sourcePage  = await createPage(DB.sources, cleanProps({
    'Title'       : n.title(sourceTitle),
    'Company'     : n.relation([companyId]),
    'Source Type' : n.select(sourceTypeMap[DOC_TYPE] || 'SEC Filing'),
    'URL'         : n.url(DOC_URL),
    'Quarter'     : n.select(sanitizeQ(QUARTER, VALID_QUARTERS_SOURCE)),
    'Analyzed By' : n.select('DeepSeek'),
    'Status'      : n.select('extracting'),
    'Tags'        : n.multiSelect(tagsMap[DOC_TYPE] || ['financials']),
    'date:Date:start' : DOC_DATE,
  }));
  const sourceId = sourcePage.id;
  console.log(`  ✅  Source: ${sourceId}\n`);

  // ── 4. Chunk & prepare text slices ───────────────────────────────────────

  console.log('STEP 4 — Chunk document');
  const chunks    = chunkText(fullText);
  const mdaText   = chunks.slice(0, 2).join('\n\n···\n\n').slice(0, 48000);
  const fullSlice = chunks.join('\n\n···\n\n').slice(0, 48000);
  console.log(`  ✅  ${chunks.length} chunk(s), ${(fullText.length / 1000).toFixed(0)}k chars\n`);

  const baseVars = {
    ticker: TICKER, doc_type: DOC_TYPE, year: YEAR, period: PERIOD, date: DOC_DATE,
    text: mdaText,
  };

  // ── 5. Run 5 agents in parallel ───────────────────────────────────────────

  console.log('STEP 5 — Run DeepSeek agents (parallel, 5 agents)');
  const [analysisR, roadmapR, quotesR, notesR, financialsR] = await Promise.allSettled([
    callDeepSeek(loadPrompt('phase2_deep_analysis.md', baseVars),       8192),
    callDeepSeek(loadPrompt('phase2_roadmap.md',       baseVars),       8192),
    callDeepSeek(loadPrompt('phase2_quotes.md',        { ...baseVars, text: fullSlice }), 8192),
    callDeepSeek(loadPrompt('phase2_notes_multi.md',   baseVars),       12288),
    callDeepSeek(loadPrompt('phase2_financials.md',    baseVars),       8192),
  ]);

  const analysis   = analysisR.status    === 'fulfilled' ? analysisR.value    : null;
  const roadmap    = roadmapR.status     === 'fulfilled' ? (roadmapR.value.roadmap || [])  : [];
  const quotes     = quotesR.status      === 'fulfilled' ? (quotesR.value.quotes  || [])  : [];
  const notesData  = notesR.status       === 'fulfilled' ? (notesR.value.notes    || [])  : [];
  const financials = financialsR.status  === 'fulfilled' ? financialsR.value               : null;

  const failLog = [analysisR, roadmapR, quotesR, notesR, financialsR]
    .map((r, i) => r.status === 'rejected' ? `Agent ${['A','B','C','D','E'][i]}: ${r.reason.message}` : null)
    .filter(Boolean);
  if (failLog.length) failLog.forEach(m => console.warn(`  ⚠️  ${m}`));

  console.log(`  ✅  Analysis:   ${analysis ? 'OK' : 'FAILED'}`);
  console.log(`  ✅  Roadmap:    ${roadmap.length} items`);
  console.log(`  ✅  Quotes:     ${quotes.length} items`);
  console.log(`  ✅  Notes:      ${notesData.length} notes`);
  console.log(`  ✅  Financials: ${financials ? 'OK' : 'FAILED'}\n`);

  // ── 6. Write Quotes → Notion ──────────────────────────────────────────────

  console.log('STEP 6 — Write Quotes');
  const VALID_TAGS       = ['growth','risk','strategy','guidance','product','macro'];
  const VALID_SENTIMENTS = ['bullish','neutral','cautious','bearish'];
  const VALID_SEGMENTS   = ['Prepared Remarks','Q&A','Written Submission'];
  const VALID_SUBTAGS    = ['revenue-guidance','margin','capex','AI','china-risk',
                            'competition','product-launch','hiring','buyback','debt','macro','product'];

  const createdQuoteIds = [];
  for (const q of quotes) {
    try {
      const subTags = (q.sub_tags || []).filter(t => VALID_SUBTAGS.includes(t));
      const analystNote = [
        q.analyst_note_en ? `[EN] ${q.analyst_note_en}` : '',
        q.analyst_note_th ? `[TH] ${q.analyst_note_th}` : '',
      ].filter(Boolean).join('\n');

      const page = await createPage(DB.quotes, cleanProps({
        'Quote'           : n.title(q.quote || ''),
        'Quote TH'        : n.text(q.quote_th || ''),
        'Company'         : n.relation([companyId]),
        'Source Doc'      : n.relation([sourceId]),
        'Quarter'         : n.select(sanitizeQ(QUARTER, VALID_QUARTERS_SOURCE)),
        'Source'          : n.text(`${DOC_TYPE} ${YEAR}`),
        'Speaker'         : n.text(q.speaker || ''),
        'Segment'         : n.select(VALID_SEGMENTS.includes(q.segment) ? q.segment : 'Prepared Remarks'),
        'Tag'             : n.select(VALID_TAGS.includes(q.tag) ? q.tag : 'strategy'),
        'Sentiment'       : n.select(VALID_SENTIMENTS.includes(q.sentiment) ? q.sentiment : 'neutral'),
        'Sub-tag'         : subTags.length ? n.multiSelect(subTags) : undefined,
        'Analyst Note'    : analystNote ? n.text(analystNote) : undefined,
        'date:Date:start' : DOC_DATE,
      }));
      createdQuoteIds.push(page.id);
      dot(true);
    } catch (err) {
      dot(false);
      if (process.env.DEBUG) console.error('\n', err.message);
    }
  }
  console.log(`\n  ✅  ${createdQuoteIds.length}/${quotes.length} quotes\n`);

  // ── 7. Write Roadmap → Notion ─────────────────────────────────────────────

  console.log('STEP 7 — Write Roadmap');
  const VALID_CATS  = ['Strategic','Financial','Product','Operational','Regulatory'];
  const VALID_CONF  = ['low','medium','high'];

  const createdRoadmapIds = [];
  for (const item of roadmap) {
    try {
      const followUpText = [
        item.follow_up_en ? `[EN] ${item.follow_up_en}` : '',
        item.follow_up_th ? `[TH] ${item.follow_up_th}` : '',
      ].filter(Boolean).join('\n');

      const targetQ   = sanitizeQ(item.target_quarter, VALID_QUARTERS_TARGET);
      const followUpDate = quarterToDate(targetQ);

      const page = await createPage(DB.roadmap, cleanProps({
        'Commitment'             : n.title(item.commitment || ''),
        'Company'                : n.relation([companyId]),
        'Source Doc'             : n.relation([sourceId]),
        'Source'                 : n.text(`${DOC_TYPE} ${YEAR}`),
        'Status'                 : n.select('pending'),
        'Category'               : n.select(VALID_CATS.includes(item.category) ? item.category : 'Strategic'),
        'Confidence'             : n.select(VALID_CONF.includes(item.confidence) ? item.confidence : 'medium'),
        'Quarter Said'           : n.select(sanitizeQ(item.quarter_said || QUARTER, VALID_QUARTERS_ROADMAP_SAID)),
        'Target Quarter'         : n.select(targetQ),
        'Follow Up'              : followUpText ? n.text(followUpText) : undefined,
        'date:Date Said:start'   : DOC_DATE,
        'date:Follow Up Date:start': followUpDate,
      }));
      createdRoadmapIds.push(page.id);
      dot(true);
    } catch (err) {
      dot(false);
      if (process.env.DEBUG) console.error('\n', err.message);
    }
  }
  console.log(`\n  ✅  ${createdRoadmapIds.length}/${roadmap.length} roadmap items\n`);

  // ── 8. Write Notes (3 notes) → Notion ────────────────────────────────────

  console.log('STEP 8 — Write Notes (Analysis + Risk + Thesis)');
  const VALID_NOTE_TYPES = ['Analysis','Observation','Risk','Thesis','Update','Question'];
  const VALID_NOTE_TAGS  = ['earnings','risk','strategy','growth','macro','valuation','services','financials','china'];
  const VALID_RATINGS    = [1, 2, 3, 4, 5];

  const createdNoteIds = [];
  for (const note of notesData) {
    try {
      const validTags = (note.tags || []).filter(t => VALID_NOTE_TAGS.includes(t));
      const validRating = VALID_RATINGS.includes(note.rating) ? note.rating : 3;

      // Build body: EN content then TH content
      const bodyParts = [];
      if (note.content_en) bodyParts.push(`=== EN ===\n\n${note.content_en}`);
      if (note.content_th) bodyParts.push(`=== TH ===\n\n${note.content_th}`);

      const page = await createPage(DB.notes, cleanProps({
        'Title'                : n.title(note.title_en || `${TICKER} ${DOC_TYPE} ${YEAR} — ${note.note_type}`),
        'Company'              : n.relation([companyId]),
        'Source Doc'           : n.relation([sourceId]),
        'Note Type'            : n.select(VALID_NOTE_TYPES.includes(note.note_type) ? note.note_type : 'Analysis'),
        'Quarter'              : n.select(sanitizeQ(QUARTER, VALID_QUARTERS_NOTES)),
        'Tags'                 : n.multiSelect(validTags),
        'Rating'               : n.number(validRating),
        'Active'               : n.checkbox(true),
        'Related Quotes'       : createdQuoteIds.length ? n.relation(createdQuoteIds.slice(0, 25)) : undefined,
        'Related Roadmap'      : createdRoadmapIds.length ? n.relation(createdRoadmapIds.slice(0, 25)) : undefined,
        'date:Date:start'      : DOC_DATE,
      }), bodyParts);
      createdNoteIds.push(page.id);
      dot(true);
    } catch (err) {
      dot(false);
      if (process.env.DEBUG) console.error('\n', err.message);
    }
  }
  console.log(`\n  ✅  ${createdNoteIds.length}/${notesData.length} notes\n`);

  // ── 9. Update Companies DB ────────────────────────────────────────────────

  console.log('STEP 9 — Update Company record');
  if (analysis) {
    const investThesis = [
      analysis.investment_thesis_draft    ? `[EN]\n${analysis.investment_thesis_draft}`    : '',
      analysis.investment_thesis_draft_th ? `[TH]\n${analysis.investment_thesis_draft_th}` : '',
    ].filter(Boolean).join('\n\n').slice(0, 2000);

    const validConviction = ['high','medium','low','watch'];
    const validTone = ['bullish','cautious','mixed'];

    await updatePage(companyId, cleanProps({
      'Management Tone'    : n.select(validTone.includes(analysis.management_tone) ? analysis.management_tone : undefined),
      'CEO'                : analysis.ceo        ? n.text(analysis.ceo) : undefined,
      'Employees'          : analysis.employees_approx ? n.number(analysis.employees_approx) : undefined,
      'Market Cap (B)'     : analysis.market_cap_b     ? n.number(analysis.market_cap_b)     : undefined,
      'Conviction Level'   : validConviction.includes(analysis.conviction_suggestion) ? n.select(analysis.conviction_suggestion) : undefined,
      'Investment Thesis'  : investThesis ? n.text(investThesis) : undefined,
      'Last Analyzed'      : n.date(DOC_DATE),
    }));
    console.log(`  ✅  Tone: ${analysis.management_tone || '—'} | Conviction: ${analysis.conviction_suggestion || '—'} | CEO: ${analysis.ceo || '—'}\n`);
  }

  // ── 10. Update Financials in data.json ────────────────────────────────────

  if (financials) {
    console.log('STEP 10 — Update financials in data.json');
    const dataJson = loadDataJson(TICKER);
    if (!dataJson.financials) dataJson.financials = { currency:'USD', unit:'Billion', links:[], years:[], metrics:[], notes:'' };

    if (financials.years?.length) dataJson.financials.years   = financials.years;
    if (financials.currency)       dataJson.financials.currency = financials.currency;
    if (financials.unit)           dataJson.financials.unit     = financials.unit;
    if (financials.metrics?.length) dataJson.financials.metrics = financials.metrics;
    if (financials.segments?.length) {
      // Merge segments into metrics with "(Segment)" suffix
      const segMetrics = financials.segments.map(s => ({ name: s.name, values: s.values }));
      const existingNames = new Set(dataJson.financials.metrics.map(m => m.name));
      for (const sm of segMetrics) {
        if (!existingNames.has(sm.name)) dataJson.financials.metrics.push(sm);
      }
    }

    // Store guidance as a notes string
    if (financials.guidance) {
      const g = financials.guidance;
      const guidanceText = [
        g.revenue_guidance    ? `Revenue guidance: ${g.revenue_guidance}`      : '',
        g.capex_guidance      ? `Capex guidance: ${g.capex_guidance}`           : '',
        g.other_guidance      ? `Other: ${g.other_guidance}`                    : '',
        financials.notable_items ? `Notable: ${financials.notable_items}`       : '',
      ].filter(Boolean).join('\n');
      dataJson.financials.notes = guidanceText;
    }

    // Append source URL to links
    if (!dataJson.financials.links) dataJson.financials.links = [];
    if (!dataJson.financials.links.includes(DOC_URL)) dataJson.financials.links.push(DOC_URL);

    dataJson.last_updated = DOC_DATE;
    saveDataJson(TICKER, dataJson);
    console.log(`  ✅  Financials written: ${(financials.years || []).join(', ')}\n`);
  }

  // ── 11. Mark Source as analyzed ───────────────────────────────────────────

  await updatePage(sourceId, cleanProps({ 'Status': n.select('analyzed') }));

  // ── 12. Close pending Task ────────────────────────────────────────────────

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
    await updatePage(taskQuery.results[0].id, cleanProps({ 'Status': n.select('done') }));
    console.log('  ✅  Task closed\n');
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('━'.repeat(52));
  console.log(`✅  DONE  ${TICKER} ${DOC_TYPE} ${YEAR}`);
  console.log(`   Quotes     : ${createdQuoteIds.length}`);
  console.log(`   Roadmap    : ${createdRoadmapIds.length}`);
  console.log(`   Notes      : ${createdNoteIds.length} (Analysis + Risk + Thesis)`);
  console.log(`   Financials : ${financials ? `${(financials.years||[]).join(', ')}` : '—'}`);
  console.log(`   Tone       : ${analysis?.management_tone || '—'}`);
  console.log(`   Conviction : ${analysis?.conviction_suggestion || '—'}`);
  console.log(`   Source ID  : ${sourceId}`);
  console.log('━'.repeat(52));
  console.log('\n💡  Run "npm run sync" to update data.json from Notion\n');
}

main().catch(err => {
  console.error('\n❌  Fatal:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
