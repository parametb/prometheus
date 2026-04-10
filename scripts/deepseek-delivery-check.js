#!/usr/bin/env node
/**
 * deepseek-delivery-check.js — Prometheus v3
 *
 * Schema-driven delivery checker for Notion + DeepSeek.
 *
 * Design goals:
 * - No hardcoded property names in business logic
 * - Validate Notion DB schema before querying
 * - Resolve ticker -> Company page first, then query related DBs via relation
 * - Support --validate-schema mode for CI safety checks
 *
 * Usage:
 *   node scripts/deepseek-delivery-check.js --ticker NVDA
 *   node scripts/deepseek-delivery-check.js --ticker all --dry-run true
 *   node scripts/deepseek-delivery-check.js --validate-schema true
 */

const https = require('https');

const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : null;
};
const getBoolArg = (name, fallback = 'false') => (getArg(name) || process.env[name.replace(/^--/, '').toUpperCase().replace(/-/g, '_')] || fallback) === 'true';

const TICKER = (getArg('--ticker') || process.env.TICKER || 'all').toUpperCase();
const DRY_RUN = getBoolArg('--dry-run', 'false');
const VALIDATE_SCHEMA_ONLY = getBoolArg('--validate-schema', 'false');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const NOTION_TOKEN = process.env.NOTION_TOKEN;

const ENV = {
  companies: process.env.NOTION_COMPANIES_DB,
  roadmap: process.env.NOTION_ROADMAP_DB,
  quotes: process.env.NOTION_QUOTES_DB,
  notes: process.env.NOTION_NOTES_DB,
  tasks: process.env.NOTION_TASKS_DB,
};

const SCHEMA = {
  companies: {
    label: 'Companies DB',
    required: true,
    props: {
      ticker: { name: 'Ticker', type: 'rich_text' },
      name: { name: 'Name', type: 'title', optional: true },
    },
  },
  roadmap: {
    label: 'Roadmap DB',
    required: true,
    props: {
      company: { name: 'Company', type: 'relation' },
      status: { name: 'Status', type: 'select' },
      commitment: { name: 'Commitment', type: 'title' },
      commitmentTh: { name: 'Commitment (TH)', type: 'rich_text', optional: true },
      targetQuarter: { name: 'Target Quarter', type: 'select' },
      quarterSaid: { name: 'Quarter Said', type: 'select', optional: true },
      category: { name: 'Category', type: 'select', optional: true },
      followUp: { name: 'Follow Up', type: 'rich_text', optional: true },
      deliveryNote: { name: 'Delivery Note', type: 'rich_text', optional: true },
    },
  },
  quotes: {
    label: 'Quotes DB',
    required: false,
    props: {
      company: { name: 'Company', type: 'relation' },
      quote: { name: 'Quote', type: 'rich_text' },
      speaker: { name: 'Speaker', type: 'rich_text', optional: true },
      date: { name: 'date', type: 'date' },
      source: { name: 'Source', type: 'rich_text', optional: true },
      tag: { name: 'Tag', type: 'multi_select', optional: true },
    },
  },
  notes: {
    label: 'Notes DB',
    required: false,
    props: {
      company: { name: 'Company', type: 'relation' },
      title: { name: 'Title', type: 'title' },
      noteType: { name: 'Note Type', type: 'select', optional: true },
      summary: { name: 'Summary', type: 'rich_text', optional: true },
      date: { name: 'date', type: 'date', optional: true },
    },
  },
  tasks: {
    label: 'Tasks DB',
    required: false,
    props: {
      name: { name: 'Name', type: 'title' },
      status: { name: 'Status', type: 'status' },
      notes: { name: 'Notes', type: 'rich_text', optional: true },
      company: { name: 'Company', type: 'relation', optional: true },
    },
  },
};

if (!NOTION_TOKEN) {
  console.error('ERROR: Missing NOTION_TOKEN');
  process.exit(1);
}
if (!VALIDATE_SCHEMA_ONLY && !DEEPSEEK_API_KEY) {
  console.error('ERROR: Missing DEEPSEEK_API_KEY');
  process.exit(1);
}
if (!ENV.companies || !ENV.roadmap) {
  console.error('ERROR: Missing required env vars (NOTION_COMPANIES_DB, NOTION_ROADMAP_DB)');
  process.exit(1);
}

function notionRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.notion.com',
      path,
      method,
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data || '{}');
          if (res.statusCode >= 400) {
            return reject(new Error(parsed.message || `Notion HTTP ${res.statusCode}`));
          }
          resolve(parsed);
        } catch (e) {
          reject(new Error(`JSON parse error: ${String(data).substring(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function deepseekChat(messages, maxTokens = 2048) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages,
      max_tokens: maxTokens,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });
    const options = {
      hostname: 'api.deepseek.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data || '{}');
          if (parsed.error) return reject(new Error(parsed.error.message));
          resolve(parsed.choices?.[0]?.message?.content || '{}');
        } catch (e) {
          reject(new Error(`DeepSeek parse error: ${String(data).substring(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function quarterToEndDate(q) {
  const m = String(q || '').match(/^(Q[1-4])\s+(\d{4})$/);
  if (!m) return null;
  const endMonth = { Q1: 3, Q2: 6, Q3: 9, Q4: 12 }[m[1]];
  const year = parseInt(m[2], 10);
  const lastDay = new Date(year, endMonth, 0).getDate();
  return new Date(year, endMonth - 1, lastDay);
}

function currentQuarter() {
  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  return `Q${q} ${now.getFullYear()}`;
}

function isOverdue(targetQuarter) {
  const targetDate = quarterToEndDate(targetQuarter);
  if (!targetDate) return false;
  const gracePeriod = new Date(targetDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  return gracePeriod < new Date();
}

function prop(dbKey, alias) {
  const p = SCHEMA[dbKey]?.props?.[alias];
  if (!p) throw new Error(`Unknown schema prop: ${dbKey}.${alias}`);
  return p;
}

function getProp(page, dbKey, alias) {
  const p = prop(dbKey, alias);
  return page?.properties?.[p.name];
}

function getText(page, dbKey, alias) {
  const definition = prop(dbKey, alias);
  const value = getProp(page, dbKey, alias);
  if (!value) return '';
  if (definition.type === 'title' || definition.type === 'rich_text') {
    return (value[definition.type] || []).map((x) => x.plain_text || '').join('').trim();
  }
  return '';
}

function getNamedOption(page, dbKey, alias) {
  const definition = prop(dbKey, alias);
  const value = getProp(page, dbKey, alias);
  if (!value) return '';
  if (definition.type === 'select' || definition.type === 'status') {
    return value[definition.type]?.name || '';
  }
  return '';
}

function getDateValue(page, dbKey, alias) {
  return getProp(page, dbKey, alias)?.date?.start || '';
}

function getRelationIds(page, dbKey, alias) {
  return (getProp(page, dbKey, alias)?.relation || []).map((r) => r.id);
}

function equalsFilter(dbKey, alias, value) {
  const p = prop(dbKey, alias);
  if (p.type === 'rich_text') return { property: p.name, rich_text: { equals: value } };
  if (p.type === 'select') return { property: p.name, select: { equals: value } };
  if (p.type === 'status') return { property: p.name, status: { equals: value } };
  if (p.type === 'relation') return { property: p.name, relation: { contains: value } };
  throw new Error(`Unsupported equals filter for ${dbKey}.${alias} (${p.type})`);
}

function sortBy(dbKey, alias, direction = 'descending') {
  const p = prop(dbKey, alias);
  return { property: p.name, direction };
}

async function getDatabaseSchema(databaseId) {
  const resp = await notionRequest('GET', `/v1/databases/${databaseId}`);
  return resp.properties || {};
}

function assertProperty(schema, propName, expectedType, label) {
  const found = schema[propName];
  if (!found) throw new Error(`${label}: missing property "${propName}"`);
  if (expectedType && found.type !== expectedType) {
    throw new Error(`${label}: property "${propName}" expected type=${expectedType} but got type=${found.type}`);
  }
}

async function validateConfiguredSchema() {
  console.log('Validating Notion schema...');
  for (const [dbKey, config] of Object.entries(SCHEMA)) {
    const dbId = ENV[dbKey];
    if (!dbId) {
      if (config.required) throw new Error(`${config.label}: missing database env var`);
      console.log(`- ${config.label}: skipped (env not set)`);
      continue;
    }
    const schema = await getDatabaseSchema(dbId);
    for (const def of Object.values(config.props)) {
      if (def.optional) continue;
      assertProperty(schema, def.name, def.type, config.label);
    }
    console.log(`- ${config.label}: OK`);
  }
}

async function queryDatabaseAll(databaseId, body) {
  let results = [];
  let cursor;
  do {
    const payload = { ...body, page_size: body.page_size || 100 };
    if (cursor) payload.start_cursor = cursor;
    const resp = await notionRequest('POST', `/v1/databases/${databaseId}/query`, payload);
    results = results.concat(resp.results || []);
    cursor = resp.has_more ? resp.next_cursor : null;
  } while (cursor);
  return results;
}

async function getCompanyByTicker(ticker) {
  const results = await queryDatabaseAll(ENV.companies, {
    filter: equalsFilter('companies', 'ticker', ticker),
    page_size: 10,
  });
  const company = results[0];
  if (!company) throw new Error(`Company not found for ticker: ${ticker}`);
  return company;
}

async function getPendingRoadmapItemsByCompany(companyPageId) {
  const allItems = await queryDatabaseAll(ENV.roadmap, {
    filter: {
      and: [
        equalsFilter('roadmap', 'status', 'pending'),
        equalsFilter('roadmap', 'company', companyPageId),
      ],
    },
  });
  return allItems.filter((item) => {
    const tq = getNamedOption(item, 'roadmap', 'targetQuarter');
    return tq && isOverdue(tq);
  });
}

async function getAllPendingRoadmapItems() {
  const allItems = await queryDatabaseAll(ENV.roadmap, {
    filter: equalsFilter('roadmap', 'status', 'pending'),
  });
  return allItems.filter((item) => {
    const tq = getNamedOption(item, 'roadmap', 'targetQuarter');
    return tq && isOverdue(tq);
  });
}

async function getRecentQuotesByCompany(companyPageId, limit = 20) {
  if (!ENV.quotes) return [];
  const resp = await notionRequest('POST', `/v1/databases/${ENV.quotes}/query`, {
    filter: equalsFilter('quotes', 'company', companyPageId),
    sorts: [sortBy('quotes', 'date', 'descending')],
    page_size: limit,
  });
  return (resp.results || []).map((item) => ({
    quote: getText(item, 'quotes', 'quote'),
    speaker: getText(item, 'quotes', 'speaker'),
    date: getDateValue(item, 'quotes', 'date'),
    source: getText(item, 'quotes', 'source'),
    tags: getProp(item, 'quotes', 'tag')?.multi_select?.map((t) => t.name) || [],
  })).filter((q) => q.quote.length > 10);
}

async function getRecentNotesByCompany(companyPageId, limit = 10) {
  if (!ENV.notes) return [];
  const body = {
    filter: equalsFilter('notes', 'company', companyPageId),
    page_size: limit,
  };
  if (SCHEMA.notes.props.date) body.sorts = [sortBy('notes', 'date', 'descending')];
  const resp = await notionRequest('POST', `/v1/databases/${ENV.notes}/query`, body);
  return (resp.results || []).map((item) => ({
    title: getText(item, 'notes', 'title'),
    type: getNamedOption(item, 'notes', 'noteType'),
    summary: getText(item, 'notes', 'summary'),
    date: getDateValue(item, 'notes', 'date'),
  })).filter((n) => n.title.length > 0);
}

async function assessDelivery(context) {
  const { ticker, roadmapItem, quotes, notes } = context;
  const commitment = getText(roadmapItem, 'roadmap', 'commitment');
  const targetQuarter = getNamedOption(roadmapItem, 'roadmap', 'targetQuarter');
  const quarterSaid = getNamedOption(roadmapItem, 'roadmap', 'quarterSaid');
  const category = getNamedOption(roadmapItem, 'roadmap', 'category');
  const followUp = getText(roadmapItem, 'roadmap', 'followUp');

  const quotesText = quotes.slice(0, 15).map((q) =>
    `[${q.date || 'unknown'}] ${q.speaker || 'Management'}: "${q.quote}" (source: ${q.source || 'n/a'})`
  ).join('\n');

  const notesText = notes.slice(0, 5).map((n) =>
    `[${n.type || 'Note'}] ${n.title}: ${n.summary}`
  ).join('\n');

  const prompt = `You are an investment analyst tracking management delivery on stated commitments.\n\nCOMMITMENT (${ticker}):\n- Said in: ${quarterSaid}\n- Target quarter: ${targetQuarter}\n- Commitment: "${commitment}"\n- Category: ${category}\n- What to watch: "${followUp}"\n\nRECENT QUOTES:\n${quotesText || '(none found)'}\n\nRECENT NOTES:\n${notesText || '(none found)'}\n\nTODAY: ${new Date().toISOString().split('T')[0]}\nCURRENT QUARTER: ${currentQuarter()}\n\nReturn JSON ONLY:\n{\n  "status": "delivered" | "partial" | "missed" | "monitoring",\n  "confidence": "high" | "medium" | "low",\n  "delivery_note_en": "2-3 sentences with specific evidence",\n  "delivery_note_th": "2-3 ประโยคพร้อมหลักฐานที่เฉพาะเจาะจง",\n  "reasoning": "1 sentence"\n}`;

  const raw = await deepseekChat([
    { role: 'system', content: 'You are a senior investment analyst. Respond with JSON only.' },
    { role: 'user', content: prompt },
  ]);

  const result = JSON.parse(raw);
  return { ticker, commitment, targetQuarter, result };
}

async function updateRoadmapItem(pageId, status, deliveryNoteEn, deliveryNoteTh) {
  const properties = {
    [prop('roadmap', 'status').name]: { select: { name: status } },
  };
  if (deliveryNoteEn && SCHEMA.roadmap.props.deliveryNote) {
    const combined = `${deliveryNoteEn}\n\n[TH] ${deliveryNoteTh || ''}`.substring(0, 2000);
    properties[prop('roadmap', 'deliveryNote').name] = {
      rich_text: [{ type: 'text', text: { content: combined } }],
    };
  }
  return notionRequest('PATCH', `/v1/pages/${pageId}`, { properties });
}

async function createSummaryTask(results) {
  if (!ENV.tasks) return;
  const delivered = results.filter((r) => r.result.status === 'delivered').length;
  const partial = results.filter((r) => r.result.status === 'partial').length;
  const missed = results.filter((r) => r.result.status === 'missed').length;
  const monitoring = results.filter((r) => r.result.status === 'monitoring').length;

  const summary = [
    `Delivery Check — ${currentQuarter()}`,
    `Processed ${results.length} overdue roadmap items:`,
    `✅ Delivered: ${delivered}`,
    `🟡 Partial: ${partial}`,
    `❌ Missed: ${missed}`,
    `👀 Monitoring: ${monitoring}`,
    '',
    'Items assessed:',
    ...results.map((r) => `[${r.result.status.toUpperCase()}] ${r.ticker}: ${r.commitment.substring(0, 80)}`),
  ].join('\n').substring(0, 2000);

  const properties = {
    [prop('tasks', 'name').name]: {
      title: [{ type: 'text', text: { content: `Delivery Check — ${currentQuarter()}` } }],
    },
    [prop('tasks', 'status').name]: { status: { name: 'Done' } },
  };
  if (SCHEMA.tasks.props.notes) {
    properties[prop('tasks', 'notes').name] = {
      rich_text: [{ type: 'text', text: { content: summary } }],
    };
  }

  await notionRequest('POST', '/v1/pages', {
    parent: { database_id: ENV.tasks },
    properties,
  });
  console.log('✅ Summary task created in Tasks DB');
}

function inferTickerFromCompany(companyPage) {
  return getText(companyPage, 'companies', 'ticker') || companyPage.id.slice(0, 8).toUpperCase();
}

async function runForTicker(ticker) {
  const companyPage = await getCompanyByTicker(ticker);
  const companyPageId = companyPage.id;
  const overdueItems = await getPendingRoadmapItemsByCompany(companyPageId);

  if (!overdueItems.length) {
    console.log(`\nNo overdue roadmap items found for ${ticker}.`);
    return [];
  }

  console.log(`\n── ${ticker}: ${overdueItems.length} overdue item(s) ──`);
  const [quotes, notes] = await Promise.all([
    getRecentQuotesByCompany(companyPageId, 20),
    getRecentNotesByCompany(companyPageId, 10),
  ]);
  console.log(`Evidence: ${quotes.length} quotes, ${notes.length} notes`);

  const results = [];
  for (const item of overdueItems) {
    const commitment = getText(item, 'roadmap', 'commitment');
    const targetQ = getNamedOption(item, 'roadmap', 'targetQuarter');
    console.log(`Assessing: "${commitment.substring(0, 60)}..." [target: ${targetQ}]`);
    try {
      const assessment = await assessDelivery({ ticker, roadmapItem: item, quotes, notes });
      const { status, confidence, delivery_note_en, delivery_note_th, reasoning } = assessment.result;
      const emoji = { delivered: '✅', partial: '🟡', missed: '❌', monitoring: '👀' }[status] || '❓';
      console.log(`${emoji} ${status.toUpperCase()} (${confidence} confidence): ${reasoning}`);
      results.push({ ...assessment, pageId: item.id });

      if (!DRY_RUN) {
        await updateRoadmapItem(item.id, status, delivery_note_en, delivery_note_th);
        console.log('→ Updated Notion');
      } else {
        console.log(`→ DRY RUN: would update to "${status}"`);
      }
      await sleep(500);
    } catch (err) {
      console.error(`ERROR assessing item: ${err.message}`);
    }
  }
  return results;
}

async function runForAllTickers() {
  const overdueItems = await getAllPendingRoadmapItems();
  if (!overdueItems.length) {
    console.log('\nNo overdue roadmap items found. Nothing to assess.');
    return [];
  }

  const companyIdToItems = new Map();
  for (const item of overdueItems) {
    const companyIds = getRelationIds(item, 'roadmap', 'company');
    const companyId = companyIds[0];
    if (!companyId) {
      console.warn(`Skipping roadmap item ${item.id}: no Company relation`);
      continue;
    }
    if (!companyIdToItems.has(companyId)) companyIdToItems.set(companyId, []);
    companyIdToItems.get(companyId).push(item);
  }

  const allResults = [];
  for (const [companyId, items] of companyIdToItems.entries()) {
    try {
      const companyPage = await notionRequest('GET', `/v1/pages/${companyId}`);
      const ticker = inferTickerFromCompany(companyPage);
      console.log(`\n── ${ticker}: ${items.length} overdue item(s) ──`);
      const [quotes, notes] = await Promise.all([
        getRecentQuotesByCompany(companyId, 20),
        getRecentNotesByCompany(companyId, 10),
      ]);
      console.log(`Evidence: ${quotes.length} quotes, ${notes.length} notes`);

      for (const item of items) {
        const commitment = getText(item, 'roadmap', 'commitment');
        const targetQ = getNamedOption(item, 'roadmap', 'targetQuarter');
        console.log(`Assessing: "${commitment.substring(0, 60)}..." [target: ${targetQ}]`);
        try {
          const assessment = await assessDelivery({ ticker, roadmapItem: item, quotes, notes });
          const { status, confidence, delivery_note_en, delivery_note_th, reasoning } = assessment.result;
          const emoji = { delivered: '✅', partial: '🟡', missed: '❌', monitoring: '👀' }[status] || '❓';
          console.log(`${emoji} ${status.toUpperCase()} (${confidence} confidence): ${reasoning}`);
          allResults.push({ ...assessment, pageId: item.id });

          if (!DRY_RUN) {
            await updateRoadmapItem(item.id, status, delivery_note_en, delivery_note_th);
            console.log('→ Updated Notion');
          } else {
            console.log(`→ DRY RUN: would update to "${status}"`);
          }
          await sleep(500);
        } catch (err) {
          console.error(`ERROR assessing item: ${err.message}`);
        }
      }
    } catch (err) {
      console.error(`ERROR processing company ${companyId}: ${err.message}`);
    }
  }
  return allResults;
}

async function main() {
  console.log('=== Prometheus Delivery Check v3 ===');
  console.log(`Ticker: ${TICKER} | Dry Run: ${DRY_RUN} | Validate Schema: ${VALIDATE_SCHEMA_ONLY}`);
  console.log(`Quarter: ${currentQuarter()}`);

  await validateConfiguredSchema();

  if (VALIDATE_SCHEMA_ONLY) {
    console.log('\nSchema validation passed.');
    return;
  }

  const results = TICKER === 'ALL' ? await runForAllTickers() : await runForTicker(TICKER);

  console.log('\n=== Summary ===');
  const counts = { delivered: 0, partial: 0, missed: 0, monitoring: 0 };
  for (const r of results) counts[r.result.status] = (counts[r.result.status] || 0) + 1;
  console.log(`Total assessed: ${results.length}`);
  console.log(`✅ Delivered: ${counts.delivered}`);
  console.log(`🟡 Partial: ${counts.partial}`);
  console.log(`❌ Missed: ${counts.missed}`);
  console.log(`👀 Monitoring: ${counts.monitoring}`);

  if (!DRY_RUN && results.length > 0) {
    await createSummaryTask(results);
  }

  console.log('\nDelivery check complete.');
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
