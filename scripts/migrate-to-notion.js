/**
 * migrate-to-notion.js
 * One-time migration: reads all data/[TICKER]/data.json files
 * and creates corresponding pages in Notion databases.
 *
 * Creates:
 *   Companies DB  — one page per ticker
 *   Notes DB      — one page per note (linked to company)
 *   Quotes DB     — one page per quote (linked to company)
 *   Roadmap DB    — one page per roadmap item (linked to company)
 *
 * Required env vars:
 *   NOTION_TOKEN          — Integration secret
 *   NOTION_COMPANIES_DB   — Companies database ID
 *   NOTION_NOTES_DB       — Notes database ID
 *   NOTION_QUOTES_DB      — Quotes database ID
 *   NOTION_ROADMAP_DB     — Roadmap database ID
 *
 * Usage:
 *   node scripts/migrate-to-notion.js
 *   node scripts/migrate-to-notion.js --dry-run   (logs without creating pages)
 *   node scripts/migrate-to-notion.js --ticker TSLA  (migrate one company only)
 */

const { Client } = require('@notionhq/client');
const fs   = require('fs');
const path = require('path');

// ── Config ─────────────────────────────────────────────────────────────────────

const DRY_RUN     = process.argv.includes('--dry-run');
const SINGLE      = (() => { const i = process.argv.indexOf('--ticker'); return i !== -1 ? process.argv[i+1]?.toUpperCase() : null; })();
const DELAY_MS    = 350;  // Notion API rate limit: ~3 req/s

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const DB = {
  companies : process.env.NOTION_COMPANIES_DB,
  notes     : process.env.NOTION_NOTES_DB,
  quotes    : process.env.NOTION_QUOTES_DB,
  roadmap   : process.env.NOTION_ROADMAP_DB,
};

const DATA_DIR = path.join(__dirname, '..', 'data');

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function richText(str) {
  return [{ type: 'text', text: { content: String(str || '').slice(0, 2000) } }];
}

function title(str) {
  return [{ type: 'text', text: { content: String(str || '').slice(0, 2000) } }];
}

/** Split long text into multiple paragraph blocks (Notion block limit: 2000 chars) */
function textToBlocks(str) {
  if (!str) return [];
  const lines = str.split('\n');
  const blocks = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const type = trimmed.startsWith('• ')         ? 'bulleted_list_item'
               : trimmed.startsWith('[') && trimmed.endsWith(']') ? 'heading_2'
               : trimmed.startsWith('### ')       ? 'heading_3'
               : 'paragraph';

    let text = trimmed;
    if (type === 'bulleted_list_item') text = trimmed.slice(2);
    if (type === 'heading_2')          text = trimmed.slice(1, -1);
    if (type === 'heading_3')          text = trimmed.slice(4);

    // Chunk at 2000 chars
    for (let i = 0; i < text.length; i += 2000) {
      blocks.push({
        object : 'block',
        type,
        [type]: { rich_text: richText(text.slice(i, i + 2000)) },
      });
    }
  }
  return blocks.length ? blocks : [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [] } }];
}

// ── Create page with retry ────────────────────────────────────────────────────

async function createPage(params, label) {
  if (DRY_RUN) {
    console.log(`    [DRY-RUN] Would create: ${label}`);
    return { id: `dry-run-${Date.now()}` };
  }
  try {
    await sleep(DELAY_MS);
    return await notion.pages.create(params);
  } catch (err) {
    if (err.code === 'rate_limited') {
      console.warn(`    ⏳ Rate limited — waiting 10s…`);
      await sleep(10000);
      return createPage(params, label);
    }
    throw err;
  }
}

// ── Migrate company ────────────────────────────────────────────────────────────

async function migrateCompany(data) {
  const ticker = data.ticker;
  process.stdout.write(`  ⟳  ${ticker.padEnd(6)} `);

  // 1. Create Companies page
  const companyPage = await createPage({
    parent     : { database_id: DB.companies },
    properties : {
      'Ticker'            : { title: title(ticker) },
      'Name'              : { rich_text: richText(data.name   || '') },
      'Name TH'           : { rich_text: richText(data.name_th || '') },
      'Sector'            : { rich_text: richText(data.sector  || '') },
      'Exchange'          : { rich_text: richText(data.exchange || '') },
      'TradingView Symbol': { rich_text: richText(data.tradingview_symbol || '') },
      'Description'       : { rich_text: richText(data.description || '') },
      'CEO'               : { rich_text: richText(data.ceo  || '') },
      ...(data.employees != null ? { 'Employees': { number: data.employees } } : {}),
      ...(data.management_tone ? { 'Management Tone': { select: { name: data.management_tone } } } : {}),
    },
  }, `Company: ${ticker}`);

  const companyId = companyPage.id;

  // 2. Create Notes pages
  let noteCount = 0;
  for (const note of (data.notes || [])) {
    const props = {
      'Title'   : { title: title(note.title || 'Untitled') },
      'Company' : { relation: [{ id: companyId }] },
      'Active'  : { checkbox: true },
      ...(note.date   ? { 'Date':   { date: { start: note.date } } } : {}),
      ...(note.rating != null ? { 'Rating': { number: note.rating } } : {}),
      ...(note.tags?.length   ? { 'Tags':   { multi_select: note.tags.map(t => ({ name: t })) } } : {}),
    };

    const blocks = textToBlocks(note.content || '');

    await createPage({ parent: { database_id: DB.notes }, properties: props, children: blocks.slice(0, 100) }, `Note: ${note.title}`);

    // If note body exceeds 100 blocks, append the rest
    if (!DRY_RUN && blocks.length > 100) {
      // We'd need the page ID to append — handled separately if needed
      console.warn(`    ⚠️  Note "${note.title}" has ${blocks.length} blocks; only first 100 created`);
    }

    noteCount++;
  }

  // 3. Create Quotes pages
  let quoteCount = 0;
  for (const quote of (data.quotes || [])) {
    const props = {
      'Quote'   : { title: title((quote.quote || '').slice(0, 200)) },
      'Company' : { relation: [{ id: companyId }] },
      ...(quote.date     ? { 'Date':     { date: { start: quote.date } } } : {}),
      ...(quote.source   ? { 'Source':   { rich_text: richText(quote.source) } } : {}),
      ...(quote.speaker  ? { 'Speaker':  { rich_text: richText(quote.speaker) } } : {}),
      ...(quote.quote_th ? { 'Quote TH': { rich_text: richText(quote.quote_th) } } : {}),
      ...(quote.tag      ? { 'Tag':      { select: { name: quote.tag } } } : {}),
    };
    await createPage({ parent: { database_id: DB.quotes }, properties: props }, `Quote: ${(quote.quote||'').slice(0,60)}`);
    quoteCount++;
  }

  // 4. Create Roadmap pages
  let roadmapCount = 0;
  for (const item of (data.roadmap || [])) {
    const props = {
      'Commitment' : { title: title(item.commitment || 'Untitled') },
      'Company'    : { relation: [{ id: companyId }] },
      ...(item.date_said      ? { 'Date Said':      { date: { start: item.date_said } } } : {}),
      ...(item.follow_up_date ? { 'Follow Up Date': { date: { start: item.follow_up_date } } } : {}),
      ...(item.source         ? { 'Source':   { rich_text: richText(item.source) } } : {}),
      ...(item.follow_up      ? { 'Follow Up':{ rich_text: richText(item.follow_up) } } : {}),
      ...(item.status         ? { 'Status':   { select: { name: item.status } } } : {}),
    };
    await createPage({ parent: { database_id: DB.roadmap }, properties: props }, `Roadmap: ${(item.commitment||'').slice(0,60)}`);
    roadmapCount++;
  }

  console.log(`✓  (${noteCount}n ${quoteCount}q ${roadmapCount}r)`);
  return { ticker, noteCount, quoteCount, roadmapCount };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  // Validate env vars
  const missing = Object.entries(DB).filter(([, v]) => !v).map(([k]) => `NOTION_${k.toUpperCase()}_DB`);
  if (!process.env.NOTION_TOKEN) missing.unshift('NOTION_TOKEN');
  if (missing.length) {
    console.error(`❌  Missing env vars: ${missing.join(', ')}`);
    console.error('    Set them in .env or export them before running.');
    process.exit(1);
  }

  console.log(`🚀  Prometheus → Notion migration${DRY_RUN ? ' [DRY RUN]' : ''}${SINGLE ? ` [${SINGLE} only]` : ''}\n`);

  // Discover tickers from data/companies.json
  const companiesPath = path.join(DATA_DIR, 'companies.json');
  if (!fs.existsSync(companiesPath)) {
    console.error('❌  data/companies.json not found — run from repo root');
    process.exit(1);
  }
  const companiesMeta = JSON.parse(fs.readFileSync(companiesPath, 'utf8'));
  const tickers = SINGLE
    ? companiesMeta.filter(c => c.ticker === SINGLE).map(c => c.ticker)
    : companiesMeta.map(c => c.ticker);

  if (!tickers.length) {
    console.error(`❌  No companies found${SINGLE ? ` matching ticker "${SINGLE}"` : ''}`);
    process.exit(1);
  }

  console.log(`📋  Companies to migrate: ${tickers.join(', ')}\n`);

  const results = [];
  for (const ticker of tickers) {
    const dataPath = path.join(DATA_DIR, ticker, 'data.json');
    if (!fs.existsSync(dataPath)) {
      console.warn(`  ⚠️  ${ticker.padEnd(6)} data.json not found — skipping`);
      continue;
    }
    let data;
    try { data = JSON.parse(fs.readFileSync(dataPath, 'utf8')); }
    catch (e) { console.warn(`  ⚠️  ${ticker.padEnd(6)} JSON parse error — skipping`); continue; }

    try {
      const result = await migrateCompany(data);
      results.push(result);
    } catch (err) {
      console.error(`\n  ❌  ${ticker}: ${err.message}`);
      results.push({ ticker, error: err.message });
    }
  }

  // Summary
  const ok      = results.filter(r => !r.error);
  const failed  = results.filter(r =>  r.error);
  const totNotes   = ok.reduce((s, r) => s + (r.noteCount    || 0), 0);
  const totQuotes  = ok.reduce((s, r) => s + (r.quoteCount   || 0), 0);
  const totRoadmap = ok.reduce((s, r) => s + (r.roadmapCount || 0), 0);

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`✅  Migration complete`);
  console.log(`   Companies : ${ok.length} / ${tickers.length}`);
  console.log(`   Notes     : ${totNotes}`);
  console.log(`   Quotes    : ${totQuotes}`);
  console.log(`   Roadmap   : ${totRoadmap}`);
  if (failed.length) {
    console.log(`\n❌  Failed (${failed.length}):`);
    failed.forEach(r => console.log(`   ${r.ticker}: ${r.error}`));
  }
  if (DRY_RUN) console.log('\n⚠️  DRY RUN — no pages were actually created');
}

main().catch(err => { console.error('\n❌  Fatal:', err.message); process.exit(1); });
