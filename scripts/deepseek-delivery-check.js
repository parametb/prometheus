#!/usr/bin/env node
const https = require('https');

const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : null;
};
const boolArg = (name, fallback = 'false') => (getArg(name) || process.env[name.replace(/^--/, '').toUpperCase().replace(/-/g, '_')] || fallback) === 'true';

const TICKER = (getArg('--ticker') || process.env.TICKER || 'all').toUpperCase();
const DRY_RUN = boolArg('--dry-run', 'false');
const VALIDATE_SCHEMA_ONLY = boolArg('--validate-schema', 'false');
const DUMP_SCHEMA = boolArg('--dump-schema', 'false');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const NOTION_TOKEN = process.env.NOTION_TOKEN;

const ENV = {
  companies: process.env.NOTION_COMPANIES_DB,
  roadmap: process.env.NOTION_ROADMAP_DB,
  quotes: process.env.NOTION_QUOTES_DB,
  notes: process.env.NOTION_NOTES_DB,
  tasks: process.env.NOTION_TASKS_DB,
};

const SPEC = {
  companies: {
    label: 'Companies DB',
    required: true,
    props: {
      ticker: { name: 'Ticker', types: ['title', 'rich_text'] },
      name: { name: 'Name', types: ['title', 'rich_text'], optional: true },
    },
  },
  roadmap: {
    label: 'Roadmap DB',
    required: true,
    props: {
      company: { name: 'Company', types: ['relation'] },
      status: { name: 'Status', types: ['select', 'status'] },
      commitment: { name: 'Commitment', types: ['title', 'rich_text'] },
      commitmentTh: { name: 'Commitment (TH)', types: ['rich_text', 'title'], optional: true },
      targetQuarter: { name: 'Target Quarter', types: ['select', 'status'] },
      quarterSaid: { name: 'Quarter Said', types: ['select', 'status'], optional: true },
      category: { name: 'Category', types: ['select', 'status'], optional: true },
      followUp: { name: 'Follow Up', types: ['rich_text', 'title'], optional: true },
      deliveryNote: { name: 'Delivery Note', types: ['rich_text', 'title'], optional: true },
    },
  },
  quotes: {
    label: 'Quotes DB',
    required: false,
    props: {
      company: { name: 'Company', types: ['relation'] },
      quote: { name: 'Quote', types: ['title', 'rich_text'] },
      speaker: { name: 'Speaker', types: ['rich_text', 'title'], optional: true },
      date: { name: 'date', types: ['date'] },
      source: { name: 'Source', types: ['rich_text', 'title'], optional: true },
      tag: { name: 'Tag', types: ['multi_select'], optional: true },
    },
  },
  notes: {
    label: 'Notes DB',
    required: false,
    props: {
      company: { name: 'Company', types: ['relation'] },
      title: { name: 'Title', types: ['title', 'rich_text'] },
      noteType: { name: 'Note Type', types: ['select', 'status'], optional: true },
      summary: { name: 'Summary', types: ['rich_text', 'title'], optional: true },
      date: { name: 'date', types: ['date'], optional: true },
    },
  },
  tasks: {
    label: 'Tasks DB',
    required: false,
    props: {
      name: { name: 'Name', types: ['title', 'rich_text'] },
      status: { name: 'Status', types: ['status', 'select'] },
      notes: { name: 'Notes', types: ['rich_text', 'title'], optional: true },
      company: { name: 'Company', types: ['relation'], optional: true },
    },
  },
};

if (!NOTION_TOKEN) {
  console.error('ERROR: Missing NOTION_TOKEN');
  process.exit(1);
}
if (!VALIDATE_SCHEMA_ONLY && !DUMP_SCHEMA && !DEEPSEEK_API_KEY) {
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
          if (res.statusCode >= 400) return reject(new Error(parsed.message || `Notion HTTP ${res.statusCode}`));
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

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

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
  return `Q${Math.ceil((now.getMonth() + 1) / 3)} ${now.getFullYear()}`;
}

function isOverdue(targetQuarter) {
  const targetDate = quarterToEndDate(targetQuarter);
  if (!targetDate) return false;
  const gracePeriod = new Date(targetDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  return gracePeriod < new Date();
}

const resolvedSchema = {};

async function getDatabaseSchema(databaseId) {
  const resp = await notionRequest('GET', `/v1/databases/${databaseId}`);
  return resp.properties || {};
}

function resolveType(foundType, allowedTypes) {
  return allowedTypes.includes(foundType) ? foundType : null;
}

async function resolveSchemas() {
  console.log('Resolving Notion schema...');
  for (const [dbKey, spec] of Object.entries(SPEC)) {
    const dbId = ENV[dbKey];
    if (!dbId) {
      if (spec.required) throw new Error(`${spec.label}: missing database env var`);
      console.log(`- ${spec.label}: skipped (env not set)`);
      continue;
    }

    const liveSchema = await getDatabaseSchema(dbId);
    resolvedSchema[dbKey] = { label: spec.label, props: {}, raw: liveSchema };

    for (const [alias, def] of Object.entries(spec.props)) {
      const found = liveSchema[def.name];
      if (!found) {
        if (def.optional) continue;
        throw new Error(`${spec.label}: missing property "${def.name}"`);
      }
      const actualType = resolveType(found.type, def.types);
      if (!actualType) {
        throw new Error(`${spec.label}: property "${def.name}" expected one of [${def.types.join(', ')}] but got type=${found.type}`);
      }
      resolvedSchema[dbKey].props[alias] = { name: def.name, type: actualType };
    }
    console.log(`- ${spec.label}: OK`);
  }
}

function dumpResolvedSchemas() {
  const payload = {};
  for (const [dbKey, data] of Object.entries(resolvedSchema)) {
    payload[dbKey] = {
      label: data.label,
      props: Object.fromEntries(Object.entries(data.props).map(([alias, p]) => [alias, { name: p.name, type: p.type }])),
      raw: Object.fromEntries(Object.entries(data.raw).map(([name, p]) => [name, p.type])),
    };
  }
  console.log(JSON.stringify(payload, null, 2));
}

function prop(dbKey, alias) {
  const p = resolvedSchema[dbKey]?.props?.[alias];
  if (!p) throw new Error(`Unknown resolved prop: ${dbKey}.${alias}`);
  return p;
}

function getProp(page, dbKey, alias) {
  const p = prop(dbKey, alias);
  return page?.properties?.[p.name];
}

function getText(page, dbKey, alias) {
  const p = prop(dbKey, alias);
  const v = getProp(page, dbKey, alias);
  if (!v) return '';
  if (p.type === 'title' || p.type === 'rich_text') {
    return (v[p.type] || []).map((x) => x.plain_text || '').join('').trim();
  }
  return '';
}

function getNamedOption(page, dbKey, alias) {
  const p = prop(dbKey, alias);
  const v = getProp(page, dbKey, alias);
  if (!v) return '';
  if (p.type === 'select' || p.type === 'status') return v[p.type]?.name || '';
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
  if (p.type === 'title') return { property: p.name, title: { equals: value } };
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

function writeOptionValue(dbKey, alias, value) {
  const p = prop(dbKey, alias);
  if (p.type === 'select') return { [p.name]: { select: { name: value } } };
  if (p.type === 'status') return { [p.name]: { status: { name: value } } };
  throw new Error(`Unsupported option write for ${dbKey}.${alias} (${p.type})`);
}

function writeTextValue(dbKey, alias, value) {
  const p = prop(dbKey, alias);
  const content = String(value || '').substring(0, 2000);
  if (p.type === 'rich_text') return { [p.name]: { rich_text: [{ type: 'text', text: { content } }] } };
  if (p.type === 'title') return { [p.name]: { title: [{ type: 'text', text: { content } }] } };
  throw new Error(`Unsupported text write for ${dbKey}.${alias} (${p.type})`);
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
  const items = await queryDatabaseAll(ENV.roadmap, {
    filter: {
      and: [
        equalsFilter('roadmap', 'status', 'pending'),
        equalsFilter('roadmap', 'company', companyPageId),
      ],
    },
  });
  return items.filter((item) => isOverdue(getNamedOption(item, 'roadmap', 'targetQuarter')));
}

async function getAllPendingRoadmapItems() {
  const items = await queryDatabaseAll(ENV.roadmap, {
    filter: equalsFilter('roadmap', 'status', 'pending'),
  });
  return items.filter((item) => isOverdue(getNamedOption(item, 'roadmap', 'targetQuarter')));
}

async function getRecentQuotesByCompany(companyPageId, limit = 20) {
  if (!ENV.quotes || !resolvedSchema.quotes) return [];
  const resp = await notionRequest('POST', `/v1/databases/${ENV.quotes}/query`, {
    filter: equalsFilter('quotes', 'company', companyPageId),
    sorts: [sortBy('quotes', 'date', 'descending')],
    page_size: limit,
  });
  return (resp.results || []).map((item) => ({
    quote: getText(item, 'quotes', 'quote'),
    speaker: resolvedSchema.quotes.props.speaker ? getText(item, 'quotes', 'speaker') : '',
    date: getDateValue(item, 'quotes', 'date'),
    source: resolvedSchema.quotes.props.source ? getText(item, 'quotes', 'source') : '',
    tags: resolvedSchema.quotes.props.tag ? (getProp(item, 'quotes', 'tag')?.multi_select || []).map((t) => t.name) : [],
  })).filter((q) => q.quote.length > 10);
}

async function getRecentNotesByCompany(companyPageId, limit = 10) {
  if (!ENV.notes || !resolvedSchema.notes) return [];
  const body = {
    filter: equalsFilter('notes', 'company', companyPageId),
    page_size: limit,
  };
  if (resolvedSchema.notes.props.date) body.sorts = [sortBy('notes', 'date', 'descending')];
  const resp = await notionRequest('POST', `/v1/databases/${ENV.notes}/query`, body);
  return (resp.results || []).map((item) => ({
    title: getText(item, 'notes', 'title'),
    type: resolvedSchema.notes.props.noteType ? getNamedOption(item, 'notes', 'noteType') : '',
    summary: resolvedSchema.notes.props.summary ? getText(item, 'notes', 'summary') : '',
    date: resolvedSchema.notes.props.date ? getDateValue(item, 'notes', 'date') : '',
  })).filter((n) => n.title.length > 0);
}

async function assessDelivery({ ticker, roadmapItem, quotes, notes }) {
  const commitment = getText(roadmapItem, 'roadmap', 'commitment');
  const targetQuarter = getNamedOption(roadmapItem, 'roadmap', 'targetQuarter');
  const quarterSaid = resolvedSchema.roadmap.props.quarterSaid ? getNamedOption(roadmapItem, 'roadmap', 'quarterSaid') : '';
  const category = resolvedSchema.roadmap.props.category ? getNamedOption(roadmapItem, 'roadmap', 'category') : '';
  const followUp = resolvedSchema.roadmap.props.followUp ? getText(roadmapItem, 'roadmap', 'followUp') : '';

  const quotesText = quotes.slice(0, 15).map((q) => `[${q.date || 'unknown'}] ${q.speaker || 'Management'}: "${q.quote}" (source: ${q.source || 'n/a'})`).join('\n');
  const notesText = notes.slice(0, 5).map((n) => `[${n.type || 'Note'}] ${n.title}: ${n.summary}`).join('\n');

  const prompt = `You are an investment analyst tracking management delivery on stated commitments.\n\nCOMMITMENT (${ticker}):\n- Said in: ${quarterSaid}\n- Target quarter: ${targetQuarter}\n- Commitment: "${commitment}"\n- Category: ${category}\n- What to watch: "${followUp}"\n\nRECENT QUOTES:\n${quotesText || '(none found)'}\n\nRECENT NOTES:\n${notesText || '(none found)'}\n\nTODAY: ${new Date().toISOString().split('T')[0]}\nCURRENT QUARTER: ${currentQuarter()}\n\nReturn JSON ONLY:\n{\n  "status": "delivered" | "partial" | "missed" | "monitoring",\n  "confidence": "high" | "medium" | "low",\n  "delivery_note_en": "2-3 sentences with specific evidence",\n  "delivery_note_th": "2-3 ประโยคพร้อมหลักฐานที่เฉพาะเจาะจง",\n  "reasoning": "1 sentence"\n}`;

  const raw = await deepseekChat([
    { role: 'system', content: 'You are a senior investment analyst. Respond with JSON only.' },
    { role: 'user', content: prompt },
  ]);
  const result = JSON.parse(raw);
  return { ticker, commitment, targetQuarter, result };
}

async function updateRoadmapItem(pageId, status, deliveryNoteEn, deliveryNoteTh) {
  let properties = {
    ...writeOptionValue('roadmap', 'status', status),
  };
  if (resolvedSchema.roadmap.props.deliveryNote && deliveryNoteEn) {
    const combined = `${deliveryNoteEn}\n\n[TH] ${deliveryNoteTh || ''}`;
    properties = { ...properties, ...writeTextValue('roadmap', 'deliveryNote', combined) };
  }
  return notionRequest('PATCH', `/v1/pages/${pageId}`, { properties });
}

async function createSummaryTask(results) {
  if (!ENV.tasks || !resolvedSchema.tasks) return;
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
  ].join('\n');

  let properties = {
    ...writeTextValue('tasks', 'name', `Delivery Check — ${currentQuarter()}`),
    ...writeOptionValue('tasks', 'status', 'Done'),
  };
  if (resolvedSchema.tasks.props.notes) {
    properties = { ...properties, ...writeTextValue('tasks', 'notes', summary) };
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
  const companyId = companyPage.id;
  const overdueItems = await getPendingRoadmapItemsByCompany(companyId);
  if (!overdueItems.length) {
    console.log(`\nNo overdue roadmap items found for ${ticker}.`);
    return [];
  }

  console.log(`\n── ${ticker}: ${overdueItems.length} overdue item(s) ──`);
  const [quotes, notes] = await Promise.all([
    getRecentQuotesByCompany(companyId, 20),
    getRecentNotesByCompany(companyId, 10),
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
    const companyId = getRelationIds(item, 'roadmap', 'company')[0];
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
  console.log('=== Prometheus Delivery Check v4 ===');
  console.log(`Ticker: ${TICKER} | Dry Run: ${DRY_RUN} | Validate Schema: ${VALIDATE_SCHEMA_ONLY} | Dump Schema: ${DUMP_SCHEMA}`);
  console.log(`Quarter: ${currentQuarter()}`);

  await resolveSchemas();

  if (DUMP_SCHEMA) {
    dumpResolvedSchemas();
    return;
  }

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
  if (!DRY_RUN && results.length > 0) await createSummaryTask(results);
  console.log('\nDelivery check complete.');
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
