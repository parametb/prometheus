/**
 * notion-sync.js
 * Syncs Notion databases → data/[TICKER]/data.json
 *
 * OVERWRITES:  name, sector, exchange, tradingview_symbol, description,
 *              ceo, employees, management_tone, notes[], quotes[], roadmap[]
 * PRESERVES:   financials, overview  (Claude-managed — not touched)
 *
 * Required env vars:
 *   NOTION_TOKEN          — Integration secret (keep in GitHub Secrets)
 *   NOTION_COMPANIES_DB   — Companies database ID
 *   NOTION_NOTES_DB       — Notes database ID
 *   NOTION_QUOTES_DB      — Quotes database ID
 *   NOTION_ROADMAP_DB     — Roadmap database ID
 */

const { Client } = require('@notionhq/client');
const fs   = require('fs');
const path = require('path');

// ── Init ──────────────────────────────────────────────────────────────────────

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const DB = {
  companies : process.env.NOTION_COMPANIES_DB,
  notes     : process.env.NOTION_NOTES_DB,
  quotes    : process.env.NOTION_QUOTES_DB,
  roadmap   : process.env.NOTION_ROADMAP_DB,
};

const DATA_DIR = path.join(__dirname, '..', 'data');

// ── Property helpers ──────────────────────────────────────────────────────────

const prop = (page, name) => page.properties?.[name];

function getText(p) {
  if (!p) return '';
  if (p.type === 'title')     return p.title?.map(t => t.plain_text).join('')     || '';
  if (p.type === 'rich_text') return p.rich_text?.map(t => t.plain_text).join('') || '';
  return '';
}

function getDate(p)        { return (p?.type === 'date')         ? (p.date?.start   ?? null) : null; }
function getNumber(p)      { return (p?.type === 'number')       ? (p.number        ?? null) : null; }
function getSelect(p)      { return (p?.type === 'select')       ? (p.select?.name  ?? '')   : '';   }
function getCheckbox(p)    { return (p?.type === 'checkbox')     ? (p.checkbox      ?? true) : true; }
function getMultiSelect(p) { return (p?.type === 'multi_select') ? p.multi_select.map(s => s.name) : []; }
function getRelationIds(p) { return (p?.type === 'relation')     ? p.relation.map(r => r.id) : [];  }

// ── Pagination ────────────────────────────────────────────────────────────────

async function queryAll(dbId) {
  const results = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id : dbId,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    results.push(...res.results);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return results;
}

// ── Page body → plain text (for note content) ─────────────────────────────────

async function getPageBody(pageId) {
  const blocks = [];
  let cursor;
  do {
    const res = await notion.blocks.children.list({
      block_id: pageId,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    blocks.push(...res.results);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);

  return blocks.map(block => {
    const type     = block.type;
    const richText = block[type]?.rich_text || [];
    const text     = richText.map(t => t.plain_text).join('');
    switch (type) {
      case 'heading_1':           return `[${text.toUpperCase()}]`;
      case 'heading_2':           return `[${text}]`;
      case 'heading_3':           return `### ${text}`;
      case 'bulleted_list_item':  return `• ${text}`;
      case 'numbered_list_item':  return `${text}`;
      case 'paragraph':           return text;
      default:                    return text;
    }
  }).filter(t => t.trim()).join('\n');
}

// ── data.json helpers ──────────────────────────────────────────────────────────

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

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔄  Notion → Prometheus sync starting…\n');

  // ── 1. Fetch all 4 databases in parallel ──────────────────────────────────
  const [companyPages, notesPages, quotesPages, roadmapPages] = await Promise.all([
    queryAll(DB.companies),
    queryAll(DB.notes),
    queryAll(DB.quotes),
    queryAll(DB.roadmap),
  ]);

  console.log(`📋  Companies: ${companyPages.length}`);
  console.log(`📝  Notes:     ${notesPages.length}`);
  console.log(`💬  Quotes:    ${quotesPages.length}`);
  console.log(`🗺️   Roadmap:   ${roadmapPages.length}\n`);

  // ── 2. Build lookup: Notion page ID → ticker ───────────────────────────────
  const pageIdToTicker = {};
  const companyMap     = {};   // ticker → company page

  for (const page of companyPages) {
    const ticker = getText(prop(page, 'Ticker')).trim().toUpperCase();
    if (!ticker) continue;
    pageIdToTicker[page.id] = ticker;
    companyMap[ticker]       = page;
  }

  // ── 3. Group notes/quotes/roadmap by ticker ────────────────────────────────
  function groupByTicker(pages, relField) {
    const map = {};
    for (const page of pages) {
      for (const relId of getRelationIds(prop(page, relField))) {
        const ticker = pageIdToTicker[relId];
        if (!ticker) continue;
        (map[ticker] = map[ticker] || []).push(page);
      }
    }
    return map;
  }

  const notesByTicker   = groupByTicker(notesPages,   'Company');
  const quotesByTicker  = groupByTicker(quotesPages,  'Company');
  const roadmapByTicker = groupByTicker(roadmapPages, 'Company');

  // ── 4. Process each company ────────────────────────────────────────────────
  const companiesMeta = [];

  for (const [ticker, cPage] of Object.entries(companyMap)) {
    process.stdout.write(`  ⟳  ${ticker.padEnd(6)} `);

    const existing = loadDataJson(ticker);

    // Notes — fetch page body for content
    const notes = [];
    for (const page of (notesByTicker[ticker] || [])) {
      if (getCheckbox(prop(page, 'Active')) === false) continue;
      const content = await getPageBody(page.id);
      notes.push({
        date    : getDate(prop(page, 'Date'))        || '',
        title   : getText(prop(page, 'Title')),
        tags    : getMultiSelect(prop(page, 'Tags')),
        rating  : getNumber(prop(page, 'Rating')),
        content,
      });
    }
    notes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    // Quotes
    const quotes = (quotesByTicker[ticker] || []).map(page => ({
      date     : getDate(prop(page, 'Date'))        || '',
      source   : getText(prop(page, 'Source')),
      speaker  : getText(prop(page, 'Speaker')),
      quote    : getText(prop(page, 'Quote')),
      quote_th : getText(prop(page, 'Quote TH')),
      tag      : getSelect(prop(page, 'Tag')),
    })).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    // Roadmap
    const roadmap = (roadmapByTicker[ticker] || []).map(page => ({
      date_said      : getDate(prop(page, 'Date Said'))        || null,
      source         : getText(prop(page, 'Source')),
      status         : getSelect(prop(page, 'Status'))         || 'pending',
      commitment     : getText(prop(page, 'Commitment')),
      follow_up      : getText(prop(page, 'Follow Up')),
      follow_up_date : getDate(prop(page, 'Follow Up Date'))   || '',
            category       : getSelect(prop(page, 'Category'))      || '',
      confidence     : getSelect(prop(page, 'Confidence'))     || '',
      target_quarter : getText(prop(page, 'Target Quarter'))   || '',
      quarter_said   : getText(prop(page, 'Quarter Said'))     || '',
    })).sort((a, b) => (b.date_said || '').localeCompare(a.date_said || ''));

    // Merge — overwrite human-editable, preserve Claude-managed
    const updated = {
      ticker,
      name              : getText(prop(cPage, 'Name'))               || existing.name              || ticker,
      name_th           : getText(prop(cPage, 'Name TH'))            || existing.name_th           || '',
      sector            : getText(prop(cPage, 'Sector'))             || existing.sector            || '',
      exchange          : getText(prop(cPage, 'Exchange'))           || existing.exchange          || '',
      tradingview_symbol: getText(prop(cPage, 'TradingView Symbol')) || existing.tradingview_symbol|| '',
      last_updated      : new Date().toISOString().split('T')[0],
      description       : getText(prop(cPage, 'Description'))        || existing.description       || '',
      ceo               : getText(prop(cPage, 'CEO'))                || existing.ceo               || '',
      employees         : getNumber(prop(cPage, 'Employees'))        ?? existing.employees         ?? null,
      management_tone   : getSelect(prop(cPage, 'Management Tone'))  || existing.management_tone   || '',
      notes,
      quotes,
      roadmap,
      // ← Claude-managed: preserved exactly as-is
      ...(existing.financials ? { financials: existing.financials } : {}),
      ...(existing.overview   ? { overview:   existing.overview   } : {}),
    };

    saveDataJson(ticker, updated);
    companiesMeta.push({
      ticker,
      name          : updated.name,
      sector        : updated.sector,
      exchange      : updated.exchange,
      last_updated  : updated.last_updated,
      note_count    : notes.length,
      quote_count   : quotes.length,
      roadmap_count : roadmap.length,
    });

    console.log(`✓  (${notes.length}n ${quotes.length}q ${roadmap.length}r)`);
  }

  // ── 5. Update companies.json ────────────────────────────────────────────────
  companiesMeta.sort((a, b) => a.ticker.localeCompare(b.ticker));
  fs.writeFileSync(
    path.join(DATA_DIR, 'companies.json'),
    JSON.stringify(companiesMeta, null, 2),
    'utf8'
  );

  console.log(`\n✅  Sync complete — ${companiesMeta.length} companies updated`);
}

main().catch(err => { console.error('\n❌  Sync failed:', err.message); process.exit(1); });
