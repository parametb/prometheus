#!/usr/bin/env node
/**
 * notion-sync.js — Prometheus v2.1
 * ─────────────────────────────────────────────────────────────────────────────
 * Syncs 7 Notion databases → data/{TICKER}/data.json + data/companies.json
 *
 * Databases:
 *   Companies · Notes · Quotes · Roadmap · Sources · Analytic Reports · Tasks
 *
 * Architecture:
 *   - Fetch all records from each DB upfront (single pass)
 *   - Group by company relation
 *   - Build data.json per ticker (backward-compatible + new v2.1 fields)
 *   - Fetch page body (blocks) for Notes and Analytic Reports
 *
 * Env vars required:
 *   NOTION_TOKEN · NOTION_COMPANIES_DB · NOTION_NOTES_DB · NOTION_QUOTES_DB
 *   NOTION_ROADMAP_DB · NOTION_SOURCES_DB · NOTION_REPORTS_DB · NOTION_TASKS_DB
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { Client } = require('@notionhq/client');
const fs   = require('fs');
const path = require('path');

// ─── Config ──────────────────────────────────────────────────────────────────

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const DB = {
  companies : process.env.NOTION_COMPANIES_DB,
  notes     : process.env.NOTION_NOTES_DB,
  quotes    : process.env.NOTION_QUOTES_DB,
  roadmap   : process.env.NOTION_ROADMAP_DB,
  sources   : process.env.NOTION_SOURCES_DB,
  reports   : process.env.NOTION_REPORTS_DB,
  tasks     : process.env.NOTION_TASKS_DB,
};

const DATA_DIR = path.join(__dirname, 'data');

// Rate-limit: Notion API = 3 req/sec → 350ms gap is safe
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Notion API helpers ───────────────────────────────────────────────────────

/**
 * Fetch ALL pages from a database (handles pagination automatically)
 */
async function fetchAll(databaseId) {
  if (!databaseId) return [];
  const pages = [];
  let cursor;

  do {
    await sleep(350);
    const res = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100,
    });
    pages.push(...res.results);
    cursor = res.next_cursor;
  } while (cursor);

  return pages;
}

/**
 * Extract a property value from a Notion page object.
 * Returns a clean JS value (string, number, boolean, array, null).
 */
function prop(page, name) {
  const p = page.properties?.[name];
  if (!p) return null;

  switch (p.type) {
    case 'title':
      return p.title.map(t => t.plain_text).join('') || null;
    case 'rich_text':
      return p.rich_text.map(t => t.plain_text).join('') || null;
    case 'number':
      return p.number ?? null;
    case 'select':
      return p.select?.name ?? null;
    case 'multi_select':
      return p.multi_select.map(o => o.name);
    case 'date':
      return p.date?.start ?? null;
    case 'checkbox':
      return p.checkbox ?? false;
    case 'url':
      return p.url ?? null;
    case 'email':
      return p.email ?? null;
    case 'relation':
      return p.relation.map(r => r.id);      // array of Notion page UUIDs
    case 'created_time':
      return p.created_time ?? null;
    case 'last_edited_time':
      return p.last_edited_time ?? null;
    case 'formula':
      return p.formula?.string ?? p.formula?.number ?? p.formula?.boolean ?? null;
    default:
      return null;
  }
}

/**
 * Convert Notion page blocks → plain text / markdown string.
 * Used for Notes and Analytic Report body content.
 */
async function getPageContent(pageId) {
  try {
    await sleep(350);
    const res = await notion.blocks.children.list({ block_id: pageId, page_size: 100 });
    const lines = [];

    for (const block of res.results) {
      const text = (block[block.type]?.rich_text ?? [])
        .map(t => t.plain_text).join('');

      switch (block.type) {
        case 'paragraph':            lines.push(text); break;
        case 'heading_1':            lines.push(`# ${text}`); break;
        case 'heading_2':            lines.push(`## ${text}`); break;
        case 'heading_3':            lines.push(`### ${text}`); break;
        case 'bulleted_list_item':   lines.push(`• ${text}`); break;
        case 'numbered_list_item':   lines.push(`- ${text}`); break;
        case 'quote':                lines.push(`> ${text}`); break;
        case 'divider':              lines.push('---'); break;
        case 'code':
          lines.push(`\`\`\`\n${text}\n\`\`\``); break;
        default:
          if (text) lines.push(text);
      }
    }

    return lines.filter(Boolean).join('\n');
  } catch {
    return '';
  }
}

// ─── Property extractors per database ────────────────────────────────────────

function mapCompany(page) {
  return {
    _id        : page.id,
    ticker     : prop(page, 'Ticker'),
    name       : prop(page, 'Name'),
    name_th    : prop(page, 'Name TH'),
    sector     : prop(page, 'Sector'),
    industry   : prop(page, 'Industry'),        // v2.1
    exchange   : prop(page, 'Exchange'),
    country    : prop(page, 'Country'),         // v2.1
    ceo        : prop(page, 'CEO'),
    description: prop(page, 'Description'),
    employees  : prop(page, 'Employees'),
    market_cap_b      : prop(page, 'Market Cap (B)'),   // v2.1
    management_tone   : prop(page, 'Management Tone'),
    conviction_level  : prop(page, 'Conviction Level'),  // v2.1
    investment_thesis : prop(page, 'Investment Thesis'), // v2.1
    last_analyzed     : prop(page, 'Last Analyzed'),     // v2.1
    tradingview_symbol: prop(page, 'TradingView Symbol'),
    website    : prop(page, 'Website'),         // v2.1
    _company_ids: prop(page, 'Company') ?? [],  // relation IDs (self, unused)
  };
}

function mapSource(page) {
  return {
    _id         : page.id,
    _company_ids: prop(page, 'Company') ?? [],
    title       : prop(page, 'Title'),
    source_type : prop(page, 'Source Type'),
    date        : prop(page, 'Date'),
    quarter     : prop(page, 'Quarter'),
    url         : prop(page, 'URL'),
    analyzed_by : prop(page, 'Analyzed By'),
    status      : prop(page, 'Status'),
    tags        : prop(page, 'Tags') ?? [],
  };
}

async function mapNote(page) {
  const content = await getPageContent(page.id);
  return {
    _id          : page.id,
    _company_ids : prop(page, 'Company') ?? [],
    _source_ids  : prop(page, 'Source Doc') ?? [],
    _quote_ids   : prop(page, 'Related Quotes') ?? [],
    _roadmap_ids : prop(page, 'Related Roadmap') ?? [],
    title        : prop(page, 'Title'),
    note_type    : prop(page, 'Note Type'),    // v2.1
    date         : prop(page, 'Date'),
    quarter      : prop(page, 'Quarter'),      // v2.1
    tags         : prop(page, 'Tags') ?? [],
    rating       : prop(page, 'Rating'),
    active       : prop(page, 'Active') ?? false,
    content,
  };
}

function mapQuote(page) {
  return {
    _id          : page.id,
    _company_ids : prop(page, 'Company') ?? [],
    _source_ids  : prop(page, 'Source Doc') ?? [],    // v2.1
    quote        : prop(page, 'Quote'),
    quote_th     : prop(page, 'Quote TH'),
    date         : prop(page, 'Date'),
    quarter      : prop(page, 'Quarter'),
    segment      : prop(page, 'Segment'),
    speaker      : prop(page, 'Speaker'),
    source       : prop(page, 'Source'),              // legacy text field
    tag          : prop(page, 'Tag'),
    sub_tags     : prop(page, 'Sub-tag') ?? [],       // v2.1
    sentiment    : prop(page, 'Sentiment'),
    analyst_note : prop(page, 'Analyst Note'),        // v2.1
  };
}

function mapRoadmap(page) {
  return {
    _id           : page.id,
    _company_ids  : prop(page, 'Company') ?? [],
    _source_ids   : prop(page, 'Source Doc') ?? [],   // v2.1
    _origin_ids   : prop(page, 'Origin Quote') ?? [],
    _evidence_ids : prop(page, 'Evidence') ?? [],     // v2.1
    commitment    : prop(page, 'Commitment'),
    status        : prop(page, 'Status'),
    category      : prop(page, 'Category'),
    confidence    : prop(page, 'Confidence'),
    quarter_said  : prop(page, 'Quarter Said'),
    target_quarter: prop(page, 'Target Quarter'),
    date_said     : prop(page, 'Date Said'),
    follow_up     : prop(page, 'Follow Up'),
    follow_up_date: prop(page, 'Follow Up Date'),
    delivery_note : prop(page, 'Delivery Note'),      // v2.1
    source        : prop(page, 'Source'),             // legacy text field
  };
}

async function mapReport(page) {
  const body = await getPageContent(page.id);
  return {
    _id          : page.id,
    _company_ids : prop(page, 'Company') ?? [],
    _source_ids  : prop(page, 'Source') ?? [],
    title        : prop(page, 'Title'),
    report_type  : prop(page, 'Report Type'),
    quarter      : prop(page, 'Quarter'),
    status       : prop(page, 'Status'),
    author       : prop(page, 'Author'),
    executive_summary: prop(page, 'Executive Summary'),
    body,
    created      : prop(page, 'Created'),
    last_edited  : prop(page, 'Last Edited'),
  };
}

function mapTask(page) {
  return {
    _id          : page.id,
    _company_ids : prop(page, 'Company') ?? [],
    task         : prop(page, 'Task'),
    task_type    : prop(page, 'Task Type'),
    status       : prop(page, 'Status'),
    priority     : prop(page, 'Priority'),
    assigned_to  : prop(page, 'Assigned To'),
    due_quarter  : prop(page, 'Due Quarter'),
    notes        : prop(page, 'Notes'),
    completed    : prop(page, 'Completed'),
  };
}

// ─── Group records by company ─────────────────────────────────────────────────

/**
 * Build a lookup map: notionPageId → ticker
 * Used to group records by company.
 */
function buildCompanyIndex(companies) {
  const idx = {};
  for (const c of companies) {
    idx[c._id] = c.ticker;
  }
  return idx;
}

/**
 * Group an array of records by their company relation.
 * Returns: { [ticker]: [record, ...] }
 */
function groupByCompany(records, companyIndex) {
  const grouped = {};
  for (const rec of records) {
    for (const cid of (rec._company_ids ?? [])) {
      const ticker = companyIndex[cid];
      if (!ticker) continue;
      if (!grouped[ticker]) grouped[ticker] = [];
      grouped[ticker].push(rec);
    }
  }
  return grouped;
}

// ─── Build source lookup (id → title/url) ────────────────────────────────────

function buildSourceIndex(sources) {
  const idx = {};
  for (const s of sources) {
    idx[s._id] = { title: s.title, url: s.url, source_type: s.source_type, quarter: s.quarter };
  }
  return idx;
}

/**
 * Resolve source relation IDs → { id, title, url, source_type, quarter }[]
 */
function resolveSource(ids, sourceIndex) {
  return ids
    .map(id => sourceIndex[id])
    .filter(Boolean);
}

// ─── Snapshot builder ─────────────────────────────────────────────────────────

function buildSnapshot(company, quotes, roadmap, notes, sources, reports) {
  const delivered = roadmap.filter(r => r.status === 'delivered').length;
  const total     = roadmap.length;
  return {
    ticker          : company.ticker,
    name            : company.name,
    name_th         : company.name_th,
    sector          : company.sector,
    exchange        : company.exchange,
    conviction_level: company.conviction_level,
    management_tone : company.management_tone,
    last_analyzed   : company.last_analyzed,
    counts: {
      quotes        : quotes.length,
      roadmap_total : total,
      roadmap_delivered: delivered,
      notes         : notes.length,
      sources       : sources.length,
      reports       : reports.length,
    },
    delivery_rate: total > 0 ? Math.round((delivered / total) * 100) : null,
  };
}

// ─── Assemble data.json for one company ──────────────────────────────────────

function buildDataJson(company, allQuotes, allRoadmap, allNotes, allSources, allReports, allTasks, sourceIndex) {
  // Clean records: strip internal _* fields from output
  const clean = (obj, omit = []) => {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('_') || omit.includes(k)) continue;
      out[k] = v;
    }
    return out;
  };

  // Enrich quotes with source info
  const quotes = allQuotes.map(q => {
    const src = resolveSource(q._source_ids, sourceIndex)[0];
    return {
      ...clean(q),
      source_doc: src ? { id: q._source_ids[0], title: src.title, url: src.url } : null,
    };
  });

  // Enrich roadmap with source info
  const roadmap = allRoadmap.map(r => {
    const src = resolveSource(r._source_ids, sourceIndex)[0];
    return {
      ...clean(r),
      source_doc: src ? { id: r._source_ids[0], title: src.title, url: src.url } : null,
    };
  });

  // Enrich notes with source info
  const notes = allNotes.map(n => {
    const src = resolveSource(n._source_ids, sourceIndex)[0];
    return {
      ...clean(n),
      source_doc: src ? { id: n._source_ids[0], title: src.title, url: src.url } : null,
    };
  });

  // Sources: filter + clean
  const sources = allSources.map(s => clean(s));

  // Reports: only published (or all if you want drafts too)
  const reports = allReports
    .filter(r => ['approved', 'published'].includes(r.status))
    .map(r => clean(r));

  // Tasks: exclude done/archived
  const tasks = allTasks
    .filter(t => t.status !== 'done')
    .map(t => clean(t));

  return {
    ticker            : company.ticker,
    name              : company.name,
    name_th           : company.name_th,
    sector            : company.sector,
    industry          : company.industry,          // v2.1
    exchange          : company.exchange,
    country           : company.country,           // v2.1
    tradingview_symbol: company.tradingview_symbol,
    last_updated      : new Date().toISOString().split('T')[0],
    description       : company.description,
    ceo               : company.ceo,
    employees         : company.employees,
    market_cap_b      : company.market_cap_b,      // v2.1
    management_tone   : company.management_tone,
    conviction_level  : company.conviction_level,  // v2.1
    investment_thesis : company.investment_thesis, // v2.1
    last_analyzed     : company.last_analyzed,     // v2.1
    website           : company.website,           // v2.1
    notes,
    quotes,
    roadmap,
    sources,           // v2.1 — NEW section
    analytic_reports   : reports,  // v2.1 — NEW section
    open_tasks         : tasks,    // v2.1 — NEW section (non-done tasks only)
    financials        : loadExistingFinancials(company.ticker),  // preserved from JSON
    overview          : loadExistingOverview(company.ticker),    // preserved from JSON
  };
}

// ─── Preserve existing financials & overview (not in Notion yet) ─────────────

function loadExistingFinancials(ticker) {
  try {
    const p = path.join(DATA_DIR, ticker, 'data.json');
    if (!fs.existsSync(p)) return { currency: 'USD', unit: 'Million', years: [], metrics: [], notes: '' };
    return JSON.parse(fs.readFileSync(p, 'utf8')).financials ?? {};
  } catch {
    return {};
  }
}

function loadExistingOverview(ticker) {
  try {
    const p = path.join(DATA_DIR, ticker, 'data.json');
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, 'utf8')).overview ?? {};
  } catch {
    return {};
  }
}

// ─── File I/O ─────────────────────────────────────────────────────────────────

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`  ✅ Written: ${path.relative(process.cwd(), filePath)}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔥 Prometheus Notion Sync v2.1');
  console.log('─────────────────────────────────\n');

  // Validate env
  const missing = Object.entries(DB)
    .filter(([, v]) => !v)
    .map(([k]) => `NOTION_${k.toUpperCase()}_DB`);
  if (!process.env.NOTION_TOKEN) missing.push('NOTION_TOKEN');
  if (missing.length) {
    console.error('❌ Missing env vars:\n  ' + missing.join('\n  '));
    process.exit(1);
  }

  // ── Step 1: Fetch all databases ──────────────────────────────────────────
  console.log('📥 Fetching Notion databases...\n');

  console.log('  → Companies');
  const companyPages = await fetchAll(DB.companies);
  const companies = companyPages.map(mapCompany).filter(c => c.ticker);

  console.log('  → Sources');
  const sourcePages = await fetchAll(DB.sources);
  const sources = sourcePages.map(mapSource);
  const sourceIndex = buildSourceIndex(sources);

  console.log('  → Quotes');
  const quotePages = await fetchAll(DB.quotes);
  const quotes = quotePages.map(mapQuote);

  console.log('  → Roadmap');
  const roadmapPages = await fetchAll(DB.roadmap);
  const roadmapItems = roadmapPages.map(mapRoadmap);

  console.log('  → Notes (fetching page content...)');
  const notePages = await fetchAll(DB.notes);
  const notes = [];
  for (const p of notePages) {
    notes.push(await mapNote(p));
  }

  console.log('  → Analytic Reports (fetching page content...)');
  const reportPages = await fetchAll(DB.reports);
  const reports = [];
  for (const p of reportPages) {
    reports.push(await mapReport(p));
  }

  console.log('  → Tasks');
  const taskPages = await fetchAll(DB.tasks);
  const tasks = taskPages.map(mapTask);

  console.log(`\n  📊 Fetched: ${companies.length} companies · ${quotes.length} quotes · ${roadmapItems.length} roadmap · ${notes.length} notes · ${sources.length} sources · ${reports.length} reports · ${tasks.length} tasks\n`);

  // ── Step 2: Build company index + group records ───────────────────────────
  const companyIndex = buildCompanyIndex(companies);

  const quotesByTicker   = groupByCompany(quotes, companyIndex);
  const roadmapByTicker  = groupByCompany(roadmapItems, companyIndex);
  const notesByTicker    = groupByCompany(notes, companyIndex);
  const sourcesByTicker  = groupByCompany(sources, companyIndex);
  const reportsByTicker  = groupByCompany(reports, companyIndex);
  const tasksByTicker    = groupByCompany(tasks, companyIndex);

  // ── Step 3: Write data.json per company ──────────────────────────────────
  console.log('📝 Writing company data files...\n');

  const companiesList = [];

  for (const company of companies) {
    const ticker = company.ticker;
    console.log(`  🏢 ${ticker} — ${company.name}`);

    const cQuotes  = quotesByTicker[ticker]  ?? [];
    const cRoadmap = roadmapByTicker[ticker] ?? [];
    const cNotes   = notesByTicker[ticker]   ?? [];
    const cSources = sourcesByTicker[ticker] ?? [];
    const cReports = reportsByTicker[ticker] ?? [];
    const cTasks   = tasksByTicker[ticker]   ?? [];

    const dataJson = buildDataJson(
      company, cQuotes, cRoadmap, cNotes, cSources, cReports, cTasks, sourceIndex
    );

    const snapshot = buildSnapshot(company, cQuotes, cRoadmap, cNotes, cSources, cReports);

    writeJson(path.join(DATA_DIR, ticker, 'data.json'), dataJson);
    writeJson(path.join(DATA_DIR, ticker, 'snapshot.json'), snapshot);

    companiesList.push({
      ticker            : company.ticker,
      name              : company.name,
      name_th           : company.name_th,
      sector            : company.sector,
      industry          : company.industry,
      exchange          : company.exchange,
      country           : company.country,
      conviction_level  : company.conviction_level,
      management_tone   : company.management_tone,
      tradingview_symbol: company.tradingview_symbol,
      notes_count       : cNotes.length,
      quotes_count      : cQuotes.length,
      roadmap_count     : cRoadmap.length,
      sources_count     : cSources.length,
      last_analyzed     : company.last_analyzed,
      last_updated      : dataJson.last_updated,
    });
  }

  // ── Step 4: Write companies.json ─────────────────────────────────────────
  writeJson(path.join(DATA_DIR, 'companies.json'), companiesList);

  // ── Step 5: Write sources index (cross-company) ───────────────────────────
  // Useful for a global document library page on the website
  const sourcesIndex = sources.map(s => {
    const tickers = (s._company_ids ?? [])
      .map(id => companyIndex[id])
      .filter(Boolean);
    const { _id, _company_ids, ...rest } = s;
    return { ...rest, tickers, notion_id: _id };
  });
  writeJson(path.join(DATA_DIR, 'sources.json'), sourcesIndex);

  console.log('\n✅ Sync complete!\n');
  console.log(`   Companies : ${companies.length}`);
  console.log(`   Quotes    : ${quotes.length}`);
  console.log(`   Roadmap   : ${roadmapItems.length}`);
  console.log(`   Notes     : ${notes.length}`);
  console.log(`   Sources   : ${sources.length}`);
  console.log(`   Reports   : ${reports.length}`);
  console.log(`   Tasks     : ${tasks.length}`);
  console.log('');
}

main().catch(err => {
  console.error('\n❌ Sync failed:', err.message);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
