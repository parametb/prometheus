#!/usr/bin/env node
/**
 * generate-quartz.js
 * ==================
 * Converts Prometheus data/TICKER/data.json → Quartz Markdown content files
 *
 * Output structure:
 *   quartz/content/
 *     index.md              ← Homepage with company list
 *     companies/TICKER.md   ← Per-company research page
 *     sectors/SECTOR.md     ← Sector grouping pages
 *
 * Usage:
 *   node scripts/generate-quartz.js
 *   node scripts/generate-quartz.js --verbose
 */

const fs = require("fs");
const path = require("path");

const VERBOSE = process.argv.includes("--verbose");

const ROOT_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const QUARTZ_CONTENT = path.join(ROOT_DIR, "quartz", "content");
const COMPANIES_DIR = path.join(QUARTZ_CONTENT, "companies");
const SECTORS_DIR = path.join(QUARTZ_CONTENT, "sectors");

// ── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_ICONS = {
  delivered: "✅",
  completed: "✅",
  in_progress: "🔄",
  partial: "⚠️",
  pending: "⏳",
  cancelled: "❌",
  delayed: "⚠️",
};

function icon(status) {
  return STATUS_ICONS[(status || "").toLowerCase()] || "⏳";
}

/** Convert [Section Name] lines in note content to ### headings */
function formatNoteContent(content) {
  if (!content) return "";
  return content
    .replace(/^\[([^\]]+)\]\s*$/gm, "### $1")
    .replace(/^•/gm, "-")      // bullet normalisation
    .trim();
}

/** Escape pipe characters inside table cells */
function escapeCell(text) {
  return (text || "").replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function log(msg) {
  if (VERBOSE) console.log(msg);
}

// ── Page Generators ──────────────────────────────────────────────────────────

function generateCompanyPage(data) {
  const {
    ticker = "",
    name = "",
    name_th = "",
    sector = "Unknown",
    exchange = "",
    last_updated = "",
    description = "",
    notes = [],
    quotes = [],
    roadmap = [],
    overview = {},
    financials = {},
  } = data;

  const sectorSlug = sector.toLowerCase().replace(/\s+/g, "-");

  // Collect tags from notes
  const noteTags = notes.flatMap((n) => n.tags || []);
  const baseTags = [sectorSlug, exchange.toLowerCase(), ticker.toLowerCase()];
  const allTags = [...new Set([...baseTags, ...noteTags])].filter(Boolean);

  let md = "";

  // ── Frontmatter
  md += `---\n`;
  md += `title: "${ticker} — ${name}"\n`;
  md += `ticker: ${ticker}\n`;
  md += `name: "${name}"\n`;
  if (name_th && name_th !== name) md += `name_th: "${name_th}"\n`;
  md += `sector: ${sector}\n`;
  md += `exchange: ${exchange}\n`;
  md += `last_updated: ${last_updated}\n`;
  md += `tags:\n`;
  allTags.forEach((t) => (md += `  - ${t}\n`));
  md += `---\n\n`;

  // ── Page Header
  md += `# ${ticker} — ${name}\n\n`;
  if (name_th && name_th !== name) md += `*${name_th}*\n\n`;
  md += `**Sector:** ${sector} | **Exchange:** ${exchange} | **Updated:** ${last_updated}\n\n`;
  if (description) md += `${description}\n\n`;

  // ── Overview
  if (overview.business_model_summary) {
    md += `## Business Model\n\n${overview.business_model_summary}\n\n`;
  }

  if (overview.competitive_position) {
    md += `## Competitive Position\n\n${overview.competitive_position}\n\n`;
  }

  if (overview.moat_factors?.length > 0) {
    md += `### Moat Factors\n\n`;
    overview.moat_factors.forEach((f) => (md += `- ${f}\n`));
    md += `\n`;
  }

  // ── Segments
  if (overview.segments?.length > 0) {
    md += `## Business Segments\n\n`;
    overview.segments.forEach((s) => {
      md += `**${s.name}** — ${s.description || ""}\n\n`;
    });
  }

  // ── Management
  if (overview.management?.length > 0) {
    md += `## Management\n\n`;
    overview.management.forEach((m) => {
      md += `**${m.name}** *(${m.title})*`;
      if (m.note) md += `\n> ${m.note.replace(/\n/g, "\n> ")}`;
      md += `\n\n`;
    });
  }

  // ── Investment Case
  // bull_case / bear_case can be string or array depending on data source
  const bullItems = Array.isArray(overview.bull_case)
    ? overview.bull_case
    : overview.bull_case
    ? [overview.bull_case]
    : [];
  const bearItems = Array.isArray(overview.bear_case)
    ? overview.bear_case
    : overview.bear_case
    ? [overview.bear_case]
    : [];

  if (bullItems.length > 0 || bearItems.length > 0) {
    md += `## Investment Case\n\n`;
    if (bullItems.length > 0) {
      md += `### Bull Case\n\n`;
      bullItems.forEach((b) => (md += `- ${b}\n`));
      md += `\n`;
    }
    if (bearItems.length > 0) {
      md += `### Bear Case\n\n`;
      bearItems.forEach((b) => (md += `- ${b}\n`));
      md += `\n`;
    }
  }

  // ── Key Risks
  if (overview.key_risks?.length > 0) {
    md += `## Key Risks\n\n`;
    overview.key_risks.forEach((r) => {
      if (typeof r === "string") {
        md += `- ${r}\n`;
      } else {
        const sev = r.severity ? ` *(${r.severity})*` : "";
        md += `- **${r.risk}**${sev}: ${r.description || ""}\n`;
      }
    });
    md += `\n`;
  }

  // ── Roadmap
  if (roadmap.length > 0) {
    const delivered = roadmap.filter((r) =>
      ["delivered", "completed"].includes((r.status || "").toLowerCase())
    ).length;
    const total = roadmap.length;
    const pct = Math.round((delivered / total) * 100);

    md += `## Roadmap\n\n`;
    md += `*Delivery: ${delivered}/${total} (${pct}%)*\n\n`;
    md += `| | Commitment | Date Said | Source | Follow-up |\n`;
    md += `|---|---|---|---|---|\n`;
    roadmap.forEach((r) => {
      const follow = r.follow_up ? escapeCell(r.follow_up) : "";
      md += `| ${icon(r.status)} | ${escapeCell(r.commitment)} | ${r.date_said || ""} | ${r.source || ""} | ${follow} |\n`;
    });
    md += `\n`;
  }

  // ── Management Quotes
  if (quotes.length > 0) {
    md += `## Management Quotes\n\n`;
    quotes.forEach((q) => {
      md += `> "${q.quote}"\n`;
      md += `>\n`;
      md += `> — **${q.speaker}**, *${q.source}* (${q.date || ""})`;
      if (q.tag) md += ` \`#${q.tag}\``;
      md += `\n\n`;
    });
  }

  // ── Analysis Notes
  if (notes.length > 0) {
    md += `## Analysis Notes\n\n`;
    notes.forEach((n) => {
      const stars = n.rating ? "⭐".repeat(Math.min(n.rating, 5)) : "";
      md += `### ${n.title || "Note"} *(${n.date || ""})*\n\n`;
      if (stars) md += `**Rating:** ${stars}\n\n`;
      if (n.tags?.length > 0) {
        md += `**Tags:** ${n.tags.map((t) => `\`${t}\``).join(" ")}\n\n`;
      }
      if (n.content) {
        md += `${formatNoteContent(n.content)}\n\n`;
      }
      // Thai version (collapsible hint)
      if (n.content_th) {
        md += `<details>\n<summary>🇹🇭 Thai Version</summary>\n\n${formatNoteContent(n.content_th)}\n\n</details>\n\n`;
      }
    });
  }

  // ── Financials summary (just years available)
  if (financials.years?.length > 0) {
    md += `## Financials\n\n`;
    md += `*Data available for: ${financials.years.join(", ")} (${financials.currency || "USD"} ${financials.unit || ""})*\n\n`;
    if (financials.links?.length > 0) {
      financials.links.forEach((l) => {
        md += `- [${l.label || l.url}](${l.url})\n`;
      });
      md += `\n`;
    }
  }

  // ── See Also
  md += `## See Also\n\n`;
  md += `- [[sectors/${sectorSlug}|All ${sector} companies]]\n`;
  md += `- [Dashboard](https://parametb.github.io/prometheus/company.html?ticker=${ticker})\n`;

  return md;
}

function generateSectorPage(sectorName, companies) {
  const slug = sectorName.toLowerCase().replace(/\s+/g, "-");
  let md = `---\ntitle: "${sectorName} Sector"\ntags:\n  - sector\n  - ${slug}\n---\n\n`;
  md += `# ${sectorName}\n\n`;
  md += `${companies.length} ${companies.length === 1 ? "company" : "companies"} tracked in **${sectorName}**:\n\n`;
  companies.forEach((c) => {
    md += `- [[companies/${c.ticker}|${c.ticker} — ${c.name}]]\n`;
  });
  md += `\n`;
  return md;
}

function generateIndex(companies) {
  // Group by exchange
  const byExchange = {};
  companies.forEach((c) => {
    const ex = c.exchange || "Other";
    if (!byExchange[ex]) byExchange[ex] = [];
    byExchange[ex].push(c);
  });

  // Group by sector
  const bySector = {};
  companies.forEach((c) => {
    const sec = c.sector || "Unknown";
    if (!bySector[sec]) bySector[sec] = [];
    bySector[sec].push(c);
  });

  const today = new Date().toISOString().split("T")[0];

  let md = `---\ntitle: "Prometheus — Investment Research"\ntags:\n  - index\n---\n\n`;
  md += `# 🔭 Prometheus Investment Research\n\n`;
  md += `Personal investment research dashboard tracking **${companies.length} companies** across ${Object.keys(bySector).length} sectors.\n\n`;
  md += `*Last generated: ${today}*\n\n`;
  md += `> Use the **Graph View** (right panel) to explore connections between companies, sectors, and themes.\n\n`;

  // By Exchange
  md += `## Companies by Exchange\n\n`;
  Object.entries(byExchange)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([exchange, cos]) => {
      md += `### ${exchange}\n\n`;
      cos
        .sort((a, b) => a.ticker.localeCompare(b.ticker))
        .forEach((c) => {
          md += `- [[companies/${c.ticker}|${c.ticker}]] — ${c.name} *(${c.sector})*\n`;
        });
      md += `\n`;
    });

  // By Sector
  md += `## Companies by Sector\n\n`;
  Object.entries(bySector)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([sector, cos]) => {
      const slug = sector.toLowerCase().replace(/\s+/g, "-");
      md += `### [[sectors/${slug}|${sector}]]\n\n`;
      cos
        .sort((a, b) => a.ticker.localeCompare(b.ticker))
        .forEach((c) => {
          md += `- [[companies/${c.ticker}|${c.ticker} — ${c.name}]]\n`;
        });
      md += `\n`;
    });

  return md;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🔄 Prometheus → Quartz content generator\n");

  // Ensure output directories exist
  [QUARTZ_CONTENT, COMPANIES_DIR, SECTORS_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      log(`  📁 Created ${path.relative(ROOT_DIR, dir)}`);
    }
  });

  // Read master companies list
  const companiesFile = path.join(DATA_DIR, "companies.json");
  if (!fs.existsSync(companiesFile)) {
    console.error("❌ data/companies.json not found. Aborting.");
    process.exit(1);
  }

  const allCompanies = JSON.parse(fs.readFileSync(companiesFile, "utf8"));
  // Exclude BROKEN test fixtures
  const companies = allCompanies.filter((c) => !c.ticker.startsWith("BROKEN"));
  console.log(`📦 ${companies.length} companies found (${allCompanies.length - companies.length} test fixtures skipped)\n`);

  // Generate per-company pages
  const sectorMap = {};
  let generated = 0;
  let skipped = 0;

  for (const meta of companies) {
    const dataFile = path.join(DATA_DIR, meta.ticker, "data.json");
    if (!fs.existsSync(dataFile)) {
      console.warn(`  ⚠️  ${meta.ticker}: data.json not found, skipping`);
      skipped++;
      continue;
    }

    let data;
    try {
      data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    } catch (e) {
      console.warn(`  ⚠️  ${meta.ticker}: JSON parse error — ${e.message}`);
      skipped++;
      continue;
    }

    const md = generateCompanyPage(data);
    const outPath = path.join(COMPANIES_DIR, `${meta.ticker}.md`);
    fs.writeFileSync(outPath, md, "utf8");
    console.log(`  ✅ companies/${meta.ticker}.md`);
    generated++;

    // Track sector membership
    const sec = data.sector || "Unknown";
    if (!sectorMap[sec]) sectorMap[sec] = [];
    sectorMap[sec].push({ ticker: data.ticker, name: data.name });
  }

  // Generate sector pages
  console.log("");
  for (const [sector, cos] of Object.entries(sectorMap)) {
    const slug = sector.toLowerCase().replace(/\s+/g, "-");
    const md = generateSectorPage(sector, cos);
    const outPath = path.join(SECTORS_DIR, `${slug}.md`);
    fs.writeFileSync(outPath, md, "utf8");
    console.log(`  📂 sectors/${slug}.md  (${cos.length} companies)`);
  }

  // Generate homepage
  const indexMd = generateIndex(companies);
  fs.writeFileSync(path.join(QUARTZ_CONTENT, "index.md"), indexMd, "utf8");
  console.log(`  🏠 index.md`);

  // Summary
  console.log(`
────────────────────────────────────────
✨ Done!
   Company pages : ${generated}
   Sector pages  : ${Object.keys(sectorMap).length}
   Skipped       : ${skipped}
────────────────────────────────────────`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
