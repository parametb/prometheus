#!/usr/bin/env node
/**
 * edgar-sync.js — Prometheus v2.1
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches financial data from SEC EDGAR XBRL API → Notion Financials DB
 *
 * Flow:
 *   1. Read all companies from Notion Companies DB (ticker + CIK)
 *   2. For each company with a CIK:
 *      a. GET https://data.sec.gov/api/xbrl/companyfacts/CIK{padded}.json
 *      b. Extract 5 years Annual (10-K) + 8 quarters Quarterly (10-Q)
 *      c. Upsert to Notion Financials DB (one page per period)
 *
 * Env vars required:
 *   NOTION_TOKEN          — Notion integration secret
 *   NOTION_COMPANIES_DB   — Companies database ID
 *   NOTION_FINANCIALS_DB  — Financials database ID
 *
 * No SEC API key needed — free public API.
 * SEC rate limit: 10 req/s (use 120ms delay)
 * Notion rate limit: 3 req/s (use 360ms delay)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { Client } = require('@notionhq/client');
const https = require('https');

// ─── Init ─────────────────────────────────────────────────────────────────────

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const COMPANIES_DB  = process.env.NOTION_COMPANIES_DB;
const FINANCIALS_DB = process.env.NOTION_FINANCIALS_DB;

const SEC_USER_AGENT = 'Prometheus Research prometheus-research@github.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── SEC EDGAR XBRL concept map ───────────────────────────────────────────────
// Try each concept name in order; use first one found in the company facts.

const XBRL = {
  revenue: [
    'Revenues',
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'SalesRevenueNet',
    'SalesRevenueGoodsNet',
    'RevenuesNetOfInterestExpense',
  ],
  gross_profit: ['GrossProfit'],
  operating_income: ['OperatingIncomeLoss'],
  net_income: [
    'NetIncomeLoss',
    'NetIncomeLossAvailableToCommonStockholdersBasic',
    'ProfitLoss',
  ],
  eps_diluted: ['EarningsPerShareDiluted'],
  shares_diluted: [
    'WeightedAverageNumberOfDilutedSharesOutstanding',
    'CommonStockSharesOutstanding',
  ],
  operating_cf: ['NetCashProvidedByUsedInOperatingActivities'],
  capex: [
    'PaymentsToAcquirePropertyPlantAndEquipment',
    'PaymentsForCapitalImprovements',
  ],
  dna: [                                        // depreciation & amortization (for EBITDA)
    'DepreciationDepletionAndAmortization',
    'DepreciationAndAmortization',
    'DepreciationAmortizationAndAccretionNet',
  ],
  cash: [
    'CashAndCashEquivalentsAtCarryingValue',
    'CashCashEquivalentsAndShortTermInvestments',
    'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
  ],
  total_debt: [
    'LongTermDebt',
    'LongTermDebtAndCapitalLeaseObligations',
    'DebtAndCapitalLeaseObligations',
  ],
  total_assets: ['Assets'],
  total_equity: [
    'StockholdersEquity',
    'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
  ],
};

// Unit type per concept (most are USD, EPS is USD/shares, shares in shares)
const XBRL_UNIT = {
  eps_diluted   : 'USD/shares',
  shares_diluted: 'shares',
};

// Scale: USD concepts are in raw dollars → divide by 1M for storage
// shares_diluted: in shares → divide by 1M
// eps_diluted: per share → keep as-is (2 decimal)
const SCALE = {
  eps_diluted   : v => Math.round(v * 100) / 100,
  shares_diluted: v => Math.round(v / 1_000_000 * 10) / 10,
  default       : v => Math.round(v / 1_000_000 * 10) / 10,   // → millions
};

// ─── SEC HTTP fetch ───────────────────────────────────────────────────────────

function secFetch(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': SEC_USER_AGENT,
        'Accept'    : 'application/json',
      },
    }, (res) => {
      if (res.statusCode === 404) { resolve(null); return; }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} for ${url}`)); return; }

      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(new Error('SEC fetch timeout')); });
  });
}

// ─── EDGAR data extraction ────────────────────────────────────────────────────

/**
 * Extract entries for a given concept + unit from facts.
 * Returns array of { val, fy, fp, end, filed, form, accn }
 */
function getEntries(facts, conceptNames, unit) {
  for (const name of conceptNames) {
    const c = facts?.['us-gaap']?.[name];
    if (!c) continue;
    const u = unit || 'USD';
    const arr = c.units?.[u];
    if (arr?.length) return arr;
  }
  return [];
}

/**
 * Pick the best (most recently filed) entry for a given fy + fp combination.
 */
function pickBest(entries, fy, fp) {
  const matches = entries.filter(e => e.fy === fy && e.fp === fp);
  if (!matches.length) return null;
  return matches.sort((a, b) => (b.filed || '').localeCompare(a.filed || ''))[0];
}

/**
 * Extract all metrics for one period.
 * Returns { revenue, gross_profit, ..., ebitda, free_cash_flow, ... } in USD millions
 */
function extractPeriod(facts, fy, fp) {
  const m = {};
  let dominantAccn = null;
  let dominantFiled = null;
  let dominantForm = null;
  let dominantEnd = null;

  for (const [key, concepts] of Object.entries(XBRL)) {
    const unit = XBRL_UNIT[key];
    const entries = getEntries(facts, concepts, unit);
    const entry = pickBest(entries, fy, fp);
    if (!entry) { m[key] = null; continue; }

    const scale = SCALE[key] || SCALE.default;
    m[key] = scale(entry.val);

    // Track dominant filing info (from revenue or net_income)
    if ((key === 'revenue' || key === 'net_income') && entry.filed) {
      dominantAccn  = entry.accn  || dominantAccn;
      dominantFiled = entry.filed || dominantFiled;
      dominantForm  = entry.form  || dominantForm;
      dominantEnd   = entry.end   || dominantEnd;
    }
    if (!dominantEnd) dominantEnd = entry.end;
  }

  // Compute derived metrics
  if (m.operating_cf != null && m.capex != null) {
    m.free_cash_flow = Math.round((m.operating_cf - m.capex) * 10) / 10;
  }
  if (m.operating_income != null && m.dna != null) {
    m.ebitda = Math.round((m.operating_income + m.dna) * 10) / 10;
  }

  // CapEx stored as negative (convention: outflow)
  if (m.capex != null) m.capex = -m.capex;

  return {
    metrics    : m,
    accn       : dominantAccn,
    filed      : dominantFiled,
    form       : dominantForm,
    period_end : dominantEnd,
  };
}

// ─── Notion helpers ───────────────────────────────────────────────────────────

function prop(page, name) {
  const p = page.properties?.[name];
  if (!p) return null;
  switch (p.type) {
    case 'title'    : return p.title.map(t => t.plain_text).join('') || null;
    case 'rich_text': return p.rich_text.map(t => t.plain_text).join('') || null;
    case 'number'   : return p.number ?? null;
    case 'select'   : return p.select?.name ?? null;
    default         : return null;
  }
}

async function fetchAllNotion(dbId) {
  const pages = [];
  let cursor;
  do {
    await sleep(360);
    const res = await notion.databases.query({
      database_id: dbId,
      start_cursor: cursor,
      page_size: 100,
    });
    pages.push(...res.results);
    cursor = res.next_cursor;
  } while (cursor);
  return pages;
}

/**
 * Find existing Notion Financials page for (companyId, fy, periodType, quarter)
 */
async function findExisting(companyId, fy, periodType, quarter) {
  await sleep(360);
  const filter = {
    and: [
      { property: 'Company'     , relation: { contains: companyId } },
      { property: 'Fiscal Year' , number  : { equals : fy          } },
      { property: 'Period Type' , select  : { equals : periodType  } },
    ],
  };
  if (quarter) {
    filter.and.push({ property: 'Quarter', select: { equals: quarter } });
  } else {
    filter.and.push({ property: 'Quarter', select: { is_empty: true } });
  }

  const res = await notion.databases.query({
    database_id: FINANCIALS_DB,
    filter,
    page_size: 1,
  });
  return res.results[0] || null;
}

/**
 * Build Notion page properties for a financial period.
 */
function buildProps(companyId, ticker, cik, fy, fp, quarter, periodLabel, period, metricsData) {
  const { metrics, form, filed, period_end } = period;

  const num = (v) => v != null ? { number: v } : undefined;

  const props = {
    'Name'         : { title      : [{ text: { content: `${ticker} ${periodLabel}` } }] },
    'Company'      : { relation   : [{ id: companyId }] },
    'Ticker'       : { rich_text  : [{ text: { content: ticker } }] },
    'Period Type'  : { select     : { name: fp === 'FY' ? 'Annual' : 'Quarterly' } },
    'Period Label' : { rich_text  : [{ text: { content: periodLabel } }] },
    'Fiscal Year'  : { number     : fy },
    'Data Source'  : { select     : { name: 'EDGAR' } },
    'CIK'          : { rich_text  : [{ text: { content: cik } }] },
  };

  if (quarter)      props['Quarter']     = { select: { name: quarter } };
  if (form)         props['Form']        = { select: { name: form === '10-K' ? '10-K' : form === '10-Q' ? '10-Q' : 'Manual' } };
  if (filed)        props['Filed Date']  = { date  : { start: filed } };
  if (period_end)   props['Period End Date'] = { date: { start: period_end } };

  const MAP = {
    revenue        : 'Revenue',
    gross_profit   : 'Gross Profit',
    operating_income: 'Operating Income',
    ebitda         : 'EBITDA',
    net_income     : 'Net Income',
    eps_diluted    : 'EPS Diluted',
    shares_diluted : 'Shares Diluted',
    operating_cf   : 'Operating CF',
    capex          : 'CapEx',
    free_cash_flow : 'Free Cash Flow',
    cash           : 'Cash',
    total_debt     : 'Total Debt',
    total_assets   : 'Total Assets',
    total_equity   : 'Total Equity',
  };

  for (const [key, notionProp] of Object.entries(MAP)) {
    const v = metrics[key];
    if (v != null) props[notionProp] = { number: v };
  }

  return props;
}

/**
 * Upsert one financial period to Notion.
 */
async function upsertPeriod(companyId, ticker, cik, fy, fp, quarter, period) {
  const periodLabel  = fp === 'FY' ? `FY${fy}` : `${quarter} ${fy}`;
  const periodType   = fp === 'FY' ? 'Annual' : 'Quarterly';

  // Skip if no useful data at all
  const hasData = Object.values(period.metrics).some(v => v != null);
  if (!hasData) return 'skipped';

  const props    = buildProps(companyId, ticker, cik, fy, fp, quarter, periodLabel, period, null);
  // Re-build with period passed correctly (buildProps takes period object)
  const existing = await findExisting(companyId, fy, periodType, quarter || null);

  // Rebuild full props
  const fullProps = buildProps(companyId, ticker, cik, fy, fp, quarter, periodLabel, period);

  await sleep(360);
  if (existing) {
    await notion.pages.update({ page_id: existing.id, properties: fullProps });
    return 'updated';
  } else {
    await notion.pages.create({ parent: { database_id: FINANCIALS_DB }, properties: fullProps });
    return 'created';
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n📊 Prometheus EDGAR Sync v2.1');
  console.log('──────────────────────────────\n');

  // Validate env
  if (!process.env.NOTION_TOKEN)  { console.error('❌ Missing NOTION_TOKEN');  process.exit(1); }
  if (!COMPANIES_DB)              { console.error('❌ Missing NOTION_COMPANIES_DB');  process.exit(1); }
  if (!FINANCIALS_DB)             { console.error('❌ Missing NOTION_FINANCIALS_DB'); process.exit(1); }

  // Step 1: Load companies from Notion
  console.log('📋 Loading companies from Notion...');
  const companyPages = await fetchAllNotion(COMPANIES_DB);
  const companies = companyPages.map(p => ({
    id    : p.id,
    ticker: prop(p, 'Ticker'),
    cik   : prop(p, 'CIK'),
    name  : prop(p, 'Name'),
  })).filter(c => c.ticker && c.cik);

  console.log(`   Found ${companies.length} companies with CIK\n`);
  if (!companies.length) {
    console.log('⚠️  No companies have CIK set. Add CIK values to Notion Companies DB first.');
    process.exit(0);
  }

  const currentYear = new Date().getFullYear();
  const minAnnualYear = currentYear - 5;        // 5 years of annual
  const minQuarterYear = currentYear - 2;       // 2 fiscal years of quarters (~8 quarters)
  const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

  let totalCreated = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  // Step 2: Process each company
  for (const company of companies) {
    console.log(`\n🏢 ${company.ticker} — ${company.name}`);

    // Pad CIK to 10 digits
    const cikPadded = String(company.cik).replace(/^CIK/i, '').padStart(10, '0');
    const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cikPadded}.json`;

    await sleep(120); // SEC rate limit
    let facts;
    try {
      facts = await secFetch(url);
      if (!facts) {
        console.log(`   ⚠️  CIK ${cikPadded} not found on EDGAR — skipping`);
        continue;
      }
      console.log(`   ✅ EDGAR: ${facts.entityName}`);
    } catch (err) {
      console.error(`   ❌ EDGAR fetch failed: ${err.message}`);
      continue;
    }

    // Step 3: Extract Annual data
    console.log(`   📅 Annual (FY${minAnnualYear}–${currentYear})...`);
    for (let fy = minAnnualYear; fy <= currentYear; fy++) {
      const period = extractPeriod(facts.facts, fy, 'FY');
      if (!Object.values(period.metrics).some(v => v != null)) continue;

      const result = await upsertPeriod(company.id, company.ticker, cikPadded, fy, 'FY', null, period);
      const icon = result === 'created' ? '+' : result === 'updated' ? '↑' : '·';
      console.log(`     ${icon} FY${fy} (${period.period_end || 'no date'}) — ${result}`);
      if (result === 'created') totalCreated++;
      else if (result === 'updated') totalUpdated++;
      else totalSkipped++;
    }

    // Step 4: Extract Quarterly data
    console.log(`   📅 Quarterly (FY${minQuarterYear}–${currentYear})...`);
    for (let fy = minQuarterYear; fy <= currentYear; fy++) {
      for (const q of QUARTERS) {
        const period = extractPeriod(facts.facts, fy, q);
        if (!Object.values(period.metrics).some(v => v != null)) continue;

        const result = await upsertPeriod(company.id, company.ticker, cikPadded, fy, q, q, period);
        const icon = result === 'created' ? '+' : result === 'updated' ? '↑' : '·';
        console.log(`     ${icon} ${q} FY${fy} (${period.period_end || 'no date'}) — ${result}`);
        if (result === 'created') totalCreated++;
        else if (result === 'updated') totalUpdated++;
        else totalSkipped++;
      }
    }
  }

  console.log('\n──────────────────────────────');
  console.log(`✅ Done!`);
  console.log(`   Created : ${totalCreated}`);
  console.log(`   Updated : ${totalUpdated}`);
  console.log(`   Skipped : ${totalSkipped}`);
  console.log('');
}

main().catch(err => {
  console.error('\n❌ Fatal:', err.message);
  console.error(err.stack);
  process.exit(1);
});
