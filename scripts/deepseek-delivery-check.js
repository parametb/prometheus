#!/usr/bin/env node
/**
 * deepseek-delivery-check.js — Prometheus v2.2
 *
 * Scans Roadmap items with status="pending" whose target_quarter is in the past.
 * For each overdue item, fetches recent Quotes and Notes from Notion as evidence,
 * then asks DeepSeek to assess delivery: "delivered" | "partial" | "missed" | "monitoring"
 *
 * Usage:
 *   node scripts/deepseek-delivery-check.js --ticker GOOGL
 *   node scripts/deepseek-delivery-check.js --ticker all
 *   node scripts/deepseek-delivery-check.js --ticker AAPL --dry-run true
 */

const https = require('https');

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : null;
};
const TICKER = (getArg('--ticker') || process.env.TICKER || 'all').toUpperCase();
const DRY_RUN = (getArg('--dry-run') || process.env.DRY_RUN || 'false') === 'true';

// ─── Env ──────────────────────────────────────────────────────────────────────
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const NOTION_TOKEN     = process.env.NOTION_TOKEN;
const ROADMAP_DB       = process.env.NOTION_ROADMAP_DB;
const QUOTES_DB        = process.env.NOTION_QUOTES_DB;
const NOTES_DB         = process.env.NOTION_NOTES_DB;
const TASKS_DB         = process.env.NOTION_TASKS_DB;

if (!DEEPSEEK_API_KEY || !NOTION_TOKEN || !ROADMAP_DB) {
  console.error('ERROR: Missing required env vars (DEEPSEEK_API_KEY, NOTION_TOKEN, NOTION_ROADMAP_DB)');
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
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
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${data.substring(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function deepseekChat(messages, maxTokens = 4096) {
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
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Parse quarter to a comparable date ───────────────────────────────────────
function quarterToEndDate(q) {
  // q: "Q2 2025" → Date
  const m = (q || '').match(/^(Q[1-4])\s+(\d{4})$/);
  if (!m) return null;
  const endMonth = { Q1: 3, Q2: 6, Q3: 9, Q4: 12 }[m[1]];
  const year = parseInt(m[2]);
  return new Date(year, endMonth - 1, 30); // end of quarter (approx)
}

function currentQuarter() {
  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  return `Q${q} ${now.getFullYear()}`;
}

function isOverdue(targetQuarter) {
  const targetDate = quarterToEndDate(targetQuarter);
  if (!targetDate) return false;
  // Add 30-day grace period
  const gracePeriod = new Date(targetDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  return gracePeriod < new Date();
}

// ─── Notion queries ────────────────────────────────────────────────────────────
async function getPendingRoadmapItems(ticker) {
  console.log(`\nQuerying Roadmap DB for pending items${ticker !== 'ALL' ? ` (${ticker})` : ''}...`);

  const filter = {
    and: [
      { property: 'Status', select: { equals: 'pending' } },
    ]
  };

  if (ticker !== 'ALL') {
    filter.and.push({ property: 'Ticker', rich_text: { equals: ticker } });
  }

  let allItems = [];
  let cursor = undefined;

  do {
    const body = { filter, page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const resp = await notionRequest('POST', `/v1/databases/${ROADMAP_DB}/query`, body);
    if (resp.object === 'error') throw new Error(`Notion error: ${resp.message}`);

    allItems = allItems.concat(resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  console.log(`  Found ${allItems.length} pending items total`);

  // Filter to overdue items only
  const overdue = allItems.filter(item => {
    const tq = item.properties['Target Quarter']?.select?.name;
    return tq && isOverdue(tq);
  });

  console.log(`  Overdue (past target quarter + 30 days): ${overdue.length} items`);
  return overdue;
}

async function getRecentQuotesForTicker(ticker, limit = 20) {
  const filter = {
    and: [
      { property: 'Ticker', rich_text: { equals: ticker } },
    ]
  };

  const body = {
    filter,
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
    tags: item.properties['Tag']?.multi_select?.map(t => t.name) || [],
  })).filter(q => q.quote.length > 10);
}

async function getRecentNotesForTicker(ticker, limit = 10) {
  const filter = {
    and: [
      { property: 'Ticker', rich_text: { equals: ticker } },
    ]
  };

  const body = {
    filter,
    sorts: [{ property: 'Date', direction: 'descending' }],
    page_size: limit,
  };

  const resp = await notionRequest('POST', `/v1/databases/${NOTES_DB}/query`, body);
  if (resp.object === 'error') return [];

  return resp.results.map(item => ({
    title: item.properties['Title']?.title?.[0]?.plain_text || '',
    type: item.properties['Note Type']?.select?.name || '',
    summary: item.properties['Summary']?.rich_text?.[0]?.plain_text || '',
  })).filter(n => n.title.length > 0);
}

// ─── DeepSeek delivery assessment ─────────────────────────────────────────────
async function assessDelivery(roadmapItem, quotes, notes) {
  const ticker = roadmapItem.properties['Ticker']?.rich_text?.[0]?.plain_text || 'UNKNOWN';
  const commitment = roadmapItem.properties['Commitment']?.title?.[0]?.plain_text || '';
  const commitmentTh = roadmapItem.properties['Commitment (TH)']?.rich_text?.[0]?.plain_text || '';
  const targetQuarter = roadmapItem.properties['Target Quarter']?.select?.name || '';
  const quarterSaid = roadmapItem.properties['Quarter Said']?.select?.name || '';
  const category = roadmapItem.properties['Category']?.select?.name || '';
  const followUp = roadmapItem.properties['Follow Up']?.rich_text?.[0]?.plain_text || '';

  const quotesText = quotes.slice(0, 15).map(q =>
    `[${q.date}] ${q.speaker}: "${q.quote}" (source: ${q.source})`
  ).join('\n');

  const notesText = notes.slice(0, 5).map(n =>
    `[${n.type}] ${n.title}: ${n.summary}`
  ).join('\n');

  const prompt = `You are an investment analyst tracking management delivery on stated commitments.

COMMITMENT (${ticker}):
- Said in: ${quarterSaid}
- Target quarter: ${targetQuarter}
- Commitment: "${commitment}"
- Category: ${category}
- What to watch: "${followUp}"

RECENT QUOTES (last 20, most recent first):
${quotesText || '(none found)'}

RECENT NOTES (last 10):
${notesText || '(none found)'}

TODAY: ${new Date().toISOString().split('T')[0]}
CURRENT QUARTER: ${currentQuarter()}

Based on ALL available evidence, assess whether management delivered on this commitment.

Return JSON ONLY:
{
  "status": "delivered" | "partial" | "missed" | "monitoring",
  "confidence": "high" | "medium" | "low",
  "delivery_note_en": "2-3 sentences: what evidence supports your assessment? cite specific quotes or events.",
  "delivery_note_th": "2-3 ประโยค: หลักฐานอะไรสนับสนุนการประเมิน? อ้างอิง quotes หรือเหตุการณ์เฉพาะ",
  "reasoning": "1 sentence: why you chose this status"
}

Status guide:
- "delivered": clear evidence commitment was fulfilled (product launched, target met, announced)
- "partial": commitment partially met but not fully (e.g., started rollout but limited scope)
- "missed": target passed with no evidence of delivery, and no explanation from management
- "monitoring": target passed but management still referencing it as in-progress for near-term delivery`;

  const raw = await deepseekChat([
    { role: 'system', content: 'You are a senior investment analyst. Respond with JSON only.' },
    { role: 'user', content: prompt },
  ], 2048);

  const result = JSON.parse(raw);
  return { ticker, commitment, targetQuarter, result };
}

// ─── Update Notion roadmap item ────────────────────────────────────────────────
async function updateRoadmapItem(pageId, status, deliveryNoteEn, deliveryNoteTh) {
  const properties = {
    'Status': { select: { name: status } },
  };

  // Build delivery note (EN + TH combined)
  if (deliveryNoteEn) {
    const combined = `${deliveryNoteEn}\n\n[TH] ${deliveryNoteTh || ''}`;
    properties['Delivery Note'] = {
      rich_text: [{ type: 'text', text: { content: combined.substring(0, 2000) } }],
    };
  }

  return notionRequest('PATCH', `/v1/pages/${pageId}`, { properties });
}

// ─── Create summary task in Tasks DB ──────────────────────────────────────────
async function createSummaryTask(results) {
  if (!TASKS_DB) return;

  const delivered = results.filter(r => r.result.status === 'delivered').length;
  const partial   = results.filter(r => r.result.status === 'partial').length;
  const missed    = results.filter(r => r.result.status === 'missed').length;
  const monitoring = results.filter(r => r.result.status === 'monitoring').length;

  const summary = [
    `Delivery Check — ${currentQuarter()}`,
    `Processed ${results.length} overdue roadmap items:`,
    `  ✅ Delivered: ${delivered}`,
    `  🟡 Partial: ${partial}`,
    `  ❌ Missed: ${missed}`,
    `  👀 Monitoring: ${monitoring}`,
    '',
    'Items assessed:',
    ...results.map(r => `  [${r.result.status.toUpperCase()}] ${r.ticker}: ${r.commitment.substring(0, 80)}`),
  ].join('\n');

  const body = {
    parent: { database_id: TASKS_DB },
    properties: {
      'Name': { title: [{ type: 'text', text: { content: `Delivery Check — ${currentQuarter()}` } }] },
      'Status': { status: { name: 'Done' } },
      'Notes': { rich_text: [{ type: 'text', text: { content: summary.substring(0, 2000) } }] },
    },
  };

  await notionRequest('POST', '/v1/pages', body);
  console.log('  ✅ Summary task created in Tasks DB');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Prometheus Delivery Check ===');
  console.log(`Ticker: ${TICKER} | Dry Run: ${DRY_RUN} | Quarter: ${currentQuarter()}`);

  // 1. Get overdue roadmap items
  const overdueItems = await getPendingRoadmapItems(TICKER);

  if (overdueItems.length === 0) {
    console.log('\nNo overdue roadmap items found. Nothing to assess.');
    return;
  }

  // 2. Group by ticker for evidence fetching
  const tickerGroups = {};
  for (const item of overdueItems) {
    const t = item.properties['Ticker']?.rich_text?.[0]?.plain_text || 'UNKNOWN';
    if (!tickerGroups[t]) tickerGroups[t] = [];
    tickerGroups[t].push(item);
  }

  const allResults = [];

  for (const [ticker, items] of Object.entries(tickerGroups)) {
    console.log(`\n── ${ticker}: ${items.length} overdue item(s) ──`);

    // Fetch evidence once per ticker
    const [quotes, notes] = await Promise.all([
      getRecentQuotesForTicker(ticker, 20),
      getRecentNotesForTicker(ticker, 10),
    ]);
    console.log(`  Evidence: ${quotes.length} quotes, ${notes.length} notes`);

    for (const item of items) {
      const commitment = item.properties['Commitment']?.title?.[0]?.plain_text || '';
      const targetQ = item.properties['Target Quarter']?.select?.name || '';
      console.log(`  Assessing: "${commitment.substring(0, 60)}..." [target: ${targetQ}]`);

      try {
        const assessment = await assessDelivery(item, quotes, notes);
        const { status, confidence, delivery_note_en, delivery_note_th, reasoning } = assessment.result;

        const statusEmoji = { delivered: '✅', partial: '🟡', missed: '❌', monitoring: '👀' }[status] || '❓';
        console.log(`    ${statusEmoji} ${status.toUpperCase()} (${confidence} confidence): ${reasoning}`);

        allResults.push({ ...assessment, pageId: item.id });

        if (!DRY_RUN) {
          await updateRoadmapItem(item.id, status, delivery_note_en, delivery_note_th);
          console.log(`    → Updated Notion`);
        } else {
          console.log(`    → DRY RUN: would update to "${status}"`);
        }

        await sleep(500); // Rate limit courtesy
      } catch (err) {
        console.error(`    ERROR assessing item: ${err.message}`);
      }
    }
  }

  // 3. Summary
  console.log('\n=== Summary ===');
  const counts = { delivered: 0, partial: 0, missed: 0, monitoring: 0 };
  for (const r of allResults) counts[r.result.status] = (counts[r.result.status] || 0) + 1;
  console.log(`Total assessed: ${allResults.length}`);
  console.log(`  ✅ Delivered: ${counts.delivered}`);
  console.log(`  🟡 Partial:   ${counts.partial}`);
  console.log(`  ❌ Missed:    ${counts.missed}`);
  console.log(`  👀 Monitoring: ${counts.monitoring}`);

  if (!DRY_RUN && allResults.length > 0) {
    await createSummaryTask(allResults);
  }

  console.log('\nDelivery check complete.');
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
