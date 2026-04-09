#!/usr/bin/env node
/**
 * generate-quartz.js — Prometheus v2.1
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads  data/{TICKER}/data.json
 * Writes quartz/content/{ticker}.md   (one page per company)
 * Writes quartz/content/index.md      (master index)
 *
 * New in v2.1:
 *   - Industry, Country, Market Cap (B), Conviction Level, Investment Thesis
 *   - Sources section (from data.sources[])
 *   - Analytic Reports section (from data.analytic_reports[])
 *   - Note Type badge on research notes
 *   - Sub-tags, Sentiment, Analyst Note on quotes
 *   - Delivery Note, Confidence on roadmap items
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR    = path.join(__dirname, 'data');
const CONTENT_DIR = path.join(__dirname, 'quartz', 'content');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const esc = (s) => (s || '').replace(/"/g, '\\"');

const STATUS_EMOJI = {
  delivered : '✅',
  pending   : '⏳',
  missed    : '❌',
  partial   : '🔶',
  monitoring: '👁️',
};

function formatDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return d;
  }
}

// ─── Company page generator ───────────────────────────────────────────────────

function generateCompanyPage(data) {
  const lines = [];

  const sources  = data.sources          || [];
  const notes    = data.notes            || [];
  const quotes   = data.quotes           || [];
  const roadmap  = data.roadmap          || [];
  const reports  = data.analytic_reports || [];
  const ov       = data.overview         || null;
  const fin      = data.financials       || null;

  const delivered = roadmap.filter(r => r.status === 'delivered').length;
  const concluded = roadmap.filter(r => ['delivered','missed','partial'].includes(r.status)).length;
  const drPct     = concluded > 0 ? Math.round(delivered / concluded * 100) : null;

  // ── Frontmatter ───────────────────────────────────────────────────────────
  lines.push('---');
  lines.push(`title: "${esc(data.name)} (${data.ticker})"`);
  lines.push(`ticker: ${data.ticker}`);
  if (data.sector)           lines.push(`sector: "${esc(data.sector)}"`);
  if (data.industry)         lines.push(`industry: "${esc(data.industry)}"`);
  if (data.exchange)         lines.push(`exchange: ${data.exchange}`);
  if (data.country)          lines.push(`country: "${esc(data.country)}"`);
  if (data.conviction_level) lines.push(`conviction: "${esc(data.conviction_level)}"`);
  if (data.last_analyzed)    lines.push(`last_analyzed: ${data.last_analyzed}`);
  if (data.last_updated)     lines.push(`date: ${data.last_updated}`);
  lines.push('tags:');
  lines.push('  - company');
  if (data.sector)           lines.push(`  - ${data.sector.toLowerCase().replace(/[\s/]+/g, '-')}`);
  if (data.conviction_level) lines.push(`  - conviction-${data.conviction_level.toLowerCase().replace(/\s+/g, '-')}`);
  lines.push('draft: false');
  lines.push('---');
  lines.push('');

  // ── Page header ───────────────────────────────────────────────────────────
  lines.push(`# ${data.name} (${data.ticker})`);
  lines.push('');

  // Meta row
  const metaParts = [];
  if (data.exchange)      metaParts.push(`**Exchange:** ${data.exchange}`);
  if (data.sector)        metaParts.push(`**Sector:** ${data.sector}`);
  if (data.industry)      metaParts.push(`**Industry:** ${data.industry}`);
  if (data.country)       metaParts.push(`**Country:** ${data.country}`);
  if (data.market_cap_b)  metaParts.push(`**Mkt Cap:** $${data.market_cap_b}B`);
  if (data.ceo)           metaParts.push(`**CEO:** ${data.ceo}`);
  if (data.website)       metaParts.push(`**Web:** [${data.website.replace(/^https?:\/\//, '')}](${data.website})`);
  if (metaParts.length)   lines.push(metaParts.join('  ·  '));
  lines.push('');

  if (data.description) {
    lines.push(`> ${data.description}`);
    lines.push('');
  }

  // ── Conviction & Investment Thesis ────────────────────────────────────────
  if (data.conviction_level || data.investment_thesis) {
    lines.push('## 🎯 Investment Thesis');
    lines.push('');
    if (data.conviction_level) {
      lines.push(`**Conviction Level:** ${data.conviction_level}  ·  **Last Analyzed:** ${data.last_analyzed || '—'}`);
      lines.push('');
    }
    if (data.investment_thesis) {
      lines.push(data.investment_thesis);
      lines.push('');
    }
  }

  // ── Quick Stats ───────────────────────────────────────────────────────────
  lines.push('## 📊 Quick Stats');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Sources Analyzed | ${sources.length} |`);
  lines.push(`| Research Notes | ${notes.length} |`);
  lines.push(`| Management Quotes | ${quotes.length} |`);
  lines.push(`| Roadmap Items | ${roadmap.length} |`);
  if (drPct !== null) lines.push(`| Delivery Rate | **${drPct}%** (${delivered}/${concluded} concluded) |`);
  if (reports.length) lines.push(`| Analytic Reports | ${reports.length} |`);
  if (data.management_tone) lines.push(`| Management Tone | ${data.management_tone} |`);
  lines.push('');

  // ── Sources ───────────────────────────────────────────────────────────────
  if (sources.length) {
    lines.push('## 📁 Sources');
    lines.push('');
    lines.push('| Title | Type | Quarter | Date | Status | Analyzed By |');
    lines.push('|-------|------|---------|------|--------|-------------|');
    for (const s of sources) {
      const title  = s.url ? `[${s.title || '—'}](${s.url})` : (s.title || '—');
      const type   = s.source_type  || '—';
      const qtr    = s.quarter      || '—';
      const dt     = s.date         || '—';
      const status = s.status       || '—';
      const by     = s.analyzed_by  || '—';
      lines.push(`| ${title} | ${type} | ${qtr} | ${dt} | ${status} | ${by} |`);
    }
    lines.push('');
  }

  // ── Analytic Reports ──────────────────────────────────────────────────────
  if (reports.length) {
    lines.push('## 📋 Analytic Reports');
    lines.push('');
    for (const r of reports) {
      lines.push(`### ${r.title || 'Untitled Report'}`);
      const rMeta = [];
      if (r.report_type) rMeta.push(`**Type:** ${r.report_type}`);
      if (r.quarter)     rMeta.push(`**Quarter:** ${r.quarter}`);
      if (r.author)      rMeta.push(`**Author:** ${r.author}`);
      if (r.status)      rMeta.push(`**Status:** ${r.status}`);
      if (rMeta.length)  lines.push(rMeta.join('  ·  '));
      lines.push('');
      if (r.executive_summary) {
        lines.push(`> ${r.executive_summary}`);
        lines.push('');
      }
      if (r.body) {
        lines.push(r.body);
        lines.push('');
      }
      lines.push('---');
      lines.push('');
    }
  }

  // ── Research Notes ────────────────────────────────────────────────────────
  if (notes.length) {
    lines.push('## 📝 Research Notes');
    lines.push('');
    const sorted = [...notes].reverse();
    for (const n of sorted) {
      if (!n.active && n.active !== undefined) continue; // skip inactive
      lines.push(`### ${n.title || 'Untitled Note'}`);
      const nMeta = [];
      if (n.note_type)  nMeta.push(`**${n.note_type}**`);
      if (n.quarter)    nMeta.push(n.quarter);
      if (n.date)       nMeta.push(formatDate(n.date));
      if (n.rating)     nMeta.push(`${'★'.repeat(n.rating)}${'☆'.repeat(5 - n.rating)}`);
      if (nMeta.length) lines.push(nMeta.join('  ·  '));
      if (n.tags?.length) lines.push(`*${n.tags.map(tg => '#' + tg).join(' ')}*`);
      lines.push('');
      if (n.content) {
        lines.push(n.content);
        lines.push('');
      }
      if (n.source_doc?.title) {
        const srcLink = n.source_doc.url
          ? `[${n.source_doc.title}](${n.source_doc.url})`
          : n.source_doc.title;
        lines.push(`*Source: ${srcLink}*`);
        lines.push('');
      }
    }
  }

  // ── Management Quotes ─────────────────────────────────────────────────────
  if (quotes.length) {
    lines.push('## 💬 Management Quotes');
    lines.push('');
    const sorted = [...quotes].reverse();
    for (const q of sorted) {
      if (!q.quote) continue;
      lines.push(`> ${q.quote}`);
      const qMeta = [];
      if (q.speaker)   qMeta.push(`— ${q.speaker}`);
      if (q.source)    qMeta.push(q.source);
      if (q.quarter)   qMeta.push(q.quarter);
      else if (q.date) qMeta.push(formatDate(q.date));
      if (qMeta.length) lines.push(`*${qMeta.join('  ·  ')}*`);

      // Tags
      const allTags = [q.tag, ...(q.sub_tags || [])].filter(Boolean);
      if (allTags.length) lines.push(`*${allTags.map(tg => '#' + tg).join(' ')}*`);

      // Sentiment
      if (q.sentiment) {
        const emoji = q.sentiment === 'Bullish' ? '🟢' : q.sentiment === 'Bearish' ? '🔴' : '🟡';
        lines.push(`*${emoji} ${q.sentiment}*`);
      }

      // Analyst note
      if (q.analyst_note) {
        lines.push('');
        lines.push(`📌 *${q.analyst_note}*`);
      }

      if (q.quote_th) {
        lines.push('');
        lines.push(`> 🇹🇭 ${q.quote_th}`);
      }

      lines.push('');
    }
  }

  // ── Management Roadmap ────────────────────────────────────────────────────
  if (roadmap.length) {
    lines.push('## 🗺️ Management Roadmap');
    lines.push('');

    if (drPct !== null) {
      lines.push(`**Delivery Rate:** ${drPct}%  (${delivered} delivered / ${concluded} concluded / ${roadmap.length} total)`);
      lines.push('');
    }

    const sorted = [...roadmap].sort(
      (a, b) => new Date(b.date_said || 0) - new Date(a.date_said || 0)
    );

    for (const r of sorted) {
      const emoji = STATUS_EMOJI[r.status] || '•';
      const text  = r.commitment || '—';
      lines.push(`${emoji} **${text}**`);

      const rMeta = [];
      if (r.date_said)       rMeta.push(`Said: ${formatDate(r.date_said)}`);
      if (r.target_quarter)  rMeta.push(`Target: ${r.target_quarter}`);
      if (r.source)          rMeta.push(r.source);
      if (r.confidence)      rMeta.push(`Confidence: ${r.confidence}`);
      if (rMeta.length)      lines.push(`*${rMeta.join('  ·  ')}*`);

      if (r.follow_up) {
        lines.push(`  → **Outcome (${formatDate(r.follow_up_date)}):** ${r.follow_up}`);
      }
      if (r.delivery_note) {
        lines.push(`  📌 ${r.delivery_note}`);
      }
      lines.push('');
    }
  }

  // ── Financials ────────────────────────────────────────────────────────────
  if (fin?.metrics?.length && fin?.years?.length) {
    lines.push('## 💰 Financials');
    lines.push('');
    lines.push(`*${fin.currency || 'USD'}, ${fin.unit || 'Million'}*`);
    lines.push('');
    lines.push(`| Metric | ${fin.years.join(' | ')} |`);
    lines.push(`|--------|${fin.years.map(() => '------').join('|')}|`);
    for (const m of fin.metrics) {
      const vals = m.values.map(v => v != null ? v.toLocaleString() : '—');
      lines.push(`| ${m.name} | ${vals.join(' | ')} |`);
    }
    lines.push('');
    if (fin.notes) {
      lines.push(`*${fin.notes}*`);
      lines.push('');
    }
  }

  // ── Overview (key fields) ─────────────────────────────────────────────────
  if (ov) {
    if (ov.bull_case || ov.bear_case) {
      lines.push('## ⚖️ Bull / Bear Case');
      lines.push('');
      if (ov.bull_case) {
        lines.push('**🟢 Bull Case**');
        lines.push('');
        lines.push(ov.bull_case);
        lines.push('');
      }
      if (ov.bear_case) {
        lines.push('**🔴 Bear Case**');
        lines.push('');
        lines.push(ov.bear_case);
        lines.push('');
      }
    }
    if (ov.key_risks?.length) {
      lines.push('## ⚠️ Key Risks');
      lines.push('');
      for (const r of ov.key_risks) {
        lines.push(`- **[${r.severity || 'medium'}]** ${r.risk}${r.description ? ': ' + r.description : ''}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ─── Index page generator ─────────────────────────────────────────────────────

function generateIndexPage(companies) {
  const sorted = [...companies].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const lines = [
    '---',
    'title: "Prometheus Research"',
    'tags:',
    '  - index',
    'draft: false',
    '---',
    '',
    '# 🔥 Prometheus Research',
    '',
    '> Investment research powered by Notion + AI — updated every 6 hours',
    '',
    `*Last generated: ${new Date().toISOString().slice(0, 10)}  ·  ${sorted.length} companies tracked*`,
    '',
    '## Companies',
    '',
    '| Ticker | Name | Sector | Conviction | Delivery | Sources | Notes |',
    '|--------|------|--------|------------|----------|---------|-------|',
  ];

  for (const c of sorted) {
    const srcs      = (c.sources          || []).length;
    const notes     = (c.notes            || []).length;
    const roadmap   = c.roadmap           || [];
    const delivered = roadmap.filter(r => r.status === 'delivered').length;
    const concluded = roadmap.filter(r => ['delivered','missed','partial'].includes(r.status)).length;
    const dr        = concluded > 0 ? `${Math.round(delivered/concluded*100)}%` : '—';

    lines.push(
      `| [[${c.ticker}]] | ${c.name || '—'} | ${c.sector || '—'} | ` +
      `${c.conviction_level || '—'} | ${dr} | ${srcs} | ${notes} |`
    );
  }

  lines.push('');
  return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n⚡ Prometheus Quartz Generator v2.1');
  console.log('────────────────────────────────────\n');

  fs.mkdirSync(CONTENT_DIR, { recursive: true });

  // Collect all ticker directories
  const tickers = fs.readdirSync(DATA_DIR).filter(d => {
    try { return fs.statSync(path.join(DATA_DIR, d)).isDirectory(); }
    catch { return false; }
  });

  const allCompanies = [];
  let count = 0;

  for (const ticker of tickers) {
    const dataFile = path.join(DATA_DIR, ticker, 'data.json');
    if (!fs.existsSync(dataFile)) continue;

    try {
      const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      if (!data.ticker) continue;

      allCompanies.push(data);

      const md      = generateCompanyPage(data);
      const outFile = path.join(CONTENT_DIR, `${ticker}.md`);
      fs.writeFileSync(outFile, md, 'utf8');
      console.log(`  ✅ ${ticker.padEnd(8)} ${data.name || ''}`);
      count++;
    } catch (err) {
      console.error(`  ❌ ${ticker}: ${err.message}`);
    }
  }

  // Write index
  const indexMd = generateIndexPage(allCompanies);
  fs.writeFileSync(path.join(CONTENT_DIR, 'index.md'), indexMd, 'utf8');
  console.log('  ✅ index.md');

  console.log(`\n✨ Done: ${count} companies → quartz/content/\n`);
}

main().catch(err => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
