# Notion CMS Setup Guide — Prometheus

This guide walks you through connecting your Notion Plus workspace to the Prometheus auto-sync pipeline.

---

## Overview

```
Notion (you edit here)
   ↓  GitHub Actions (every 6h + manual)
   ↓  notion-sync.js
   ↓  data/[TICKER]/data.json  (auto-committed)
   ↓  GitHub Pages (live site)
```

**What Notion controls:** company info, notes, quotes, roadmap items.
**What Claude controls (untouched by sync):** `financials`, `overview` in each data.json.

---

## Step 1 — Create a Notion Integration

1. Go to [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **"+ New integration"**
3. Name it: `Prometheus Sync`
4. Select your workspace
5. Under **Capabilities**: enable **Read content**, **Insert content**, **Update content**
6. Click **Save**
7. Copy the **"Internal Integration Secret"** — you'll need it as `NOTION_TOKEN`

---

## Step 2 — Create the Four Databases

Create these four databases in Notion. They can all live inside one Notion page (e.g. a "Prometheus" root page). After creating each database, click **"Share"** → **"Invite"** → select the `Prometheus Sync` integration.

### 2a. Companies Database

| Property Name        | Type          | Notes                                     |
|----------------------|---------------|-------------------------------------------|
| `Ticker`             | Title         | Primary key (e.g. `AAPL`)                 |
| `Name`               | Text          | Full company name in English              |
| `Name TH`            | Text          | Full company name in Thai (optional)      |
| `Sector`             | Text          | e.g. `Technology`, `Mining`, `Healthcare` |
| `Exchange`           | Text          | e.g. `NASDAQ`, `NYSE`, `LSE`              |
| `TradingView Symbol` | Text          | e.g. `NASDAQ:AAPL`                        |
| `Description`        | Text          | 1–3 sentence company description          |
| `CEO`                | Text          | Current CEO name                          |
| `Employees`          | Number        | Headcount (integer)                       |
| `Management Tone`    | Select        | Options: `bullish`, `cautious`, `mixed`   |

### 2b. Notes Database

| Property Name | Type          | Notes                                              |
|---------------|---------------|----------------------------------------------------|
| `Title`       | Title         | Note headline                                      |
| `Company`     | Relation      | Links to **Companies** database                    |
| `Date`        | Date          | Date of the note                                   |
| `Tags`        | Multi-select  | e.g. `earnings`, `risk`, `strategy`                |
| `Rating`      | Number        | 1–5 rating (optional)                              |
| `Active`      | Checkbox      | Uncheck to hide note from the site (default: ✅)   |

The body (page content) of each Note page becomes the `content` field in data.json.

### 2c. Quotes Database

| Property Name | Type     | Notes                                         |
|---------------|----------|-----------------------------------------------|
| `Quote`       | Title    | The quote text (English)                      |
| `Company`     | Relation | Links to **Companies** database               |
| `Date`        | Date     | Date the quote was said                       |
| `Source`      | Text     | e.g. `Q1 FY2025 Earnings Call`                |
| `Speaker`     | Text     | e.g. `Tim Cook`                               |
| `Quote TH`    | Text     | Thai translation of the quote (optional)      |
| `Tag`         | Select   | Category: `growth`, `risk`, `strategy`, etc.  |

### 2d. Roadmap Database

| Property Name    | Type     | Notes                                                              |
|------------------|----------|--------------------------------------------------------------------|
| `Commitment`     | Title    | What management committed to                                       |
| `Company`        | Relation | Links to **Companies** database                                    |
| `Date Said`      | Date     | When the commitment was made                                       |
| `Source`         | Text     | e.g. `Q2 2024 Earnings Call`                                       |
| `Status`         | Select   | `pending`, `in_progress`, `delivered`, `missed`, `monitoring`      |
| `Follow Up`      | Text     | Notes on delivery progress                                         |
| `Follow Up Date` | Date     | Date of next expected milestone                                    |

---

## Step 3 — Copy the Database IDs

For each database:
1. Open the database as a full page in Notion
2. Copy the URL — it looks like: `https://www.notion.so/YOUR_WORKSPACE/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx?v=...`
3. The 32-character hex string **before** the `?v=` is the **Database ID**

---

## Step 4 — Add GitHub Secrets

In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**

| Secret Name            | Value                                  |
|------------------------|----------------------------------------|
| `NOTION_TOKEN`         | Integration secret from Step 1        |
| `NOTION_COMPANIES_DB`  | Companies database ID from Step 3     |
| `NOTION_NOTES_DB`      | Notes database ID from Step 3         |
| `NOTION_QUOTES_DB`     | Quotes database ID from Step 3        |
| `NOTION_ROADMAP_DB`    | Roadmap database ID from Step 3       |

---

## Step 5 — Run the One-Time Migration

This pushes your 13 existing companies from `data/*.json` into Notion.

```bash
# From the investment-research/ directory:
npm install

# Dry run first (no pages created — just logs)
NOTION_TOKEN=secret_xxx \
NOTION_COMPANIES_DB=xxx \
NOTION_NOTES_DB=xxx \
NOTION_QUOTES_DB=xxx \
NOTION_ROADMAP_DB=xxx \
npm run migrate:dry

# When it looks right, run the real migration
NOTION_TOKEN=secret_xxx \
  ... \
  npm run migrate
```

Or use a `.env` file (never commit this file):

```bash
# .env  (add to .gitignore!)
NOTION_TOKEN=secret_xxx
NOTION_COMPANIES_DB=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
NOTION_NOTES_DB=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
NOTION_QUOTES_DB=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
NOTION_ROADMAP_DB=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Then:
```bash
# Install dotenv if using .env (optional)
npm install dotenv
node -r dotenv/config scripts/migrate-to-notion.js --dry-run
node -r dotenv/config scripts/migrate-to-notion.js
```

Migration takes about 3–5 minutes for 13 companies (API rate limiting).

---

## Step 6 — Enable the GitHub Actions Workflow

The workflow file is already at `.github/workflows/notion-sync.yml`.

1. Push the file to GitHub (if not already there)
2. Go to **Actions** tab in your repo
3. Find **"Notion → Prometheus Sync"**
4. Click **"Run workflow"** to trigger the first sync manually
5. Confirm it runs without errors (check the logs)

Going forward, it will run **automatically every 6 hours** and commit any changed `data/` files back to the repo. GitHub Pages will pick up the changes and redeploy automatically.

---

## Day-to-Day Workflow

### Adding a new company
1. Use the **`prometheus:add-company`** Cowork skill to create the data.json scaffold
2. Then add the company row in your Notion **Companies** database
3. Next sync will pick it up automatically

### Adding notes or quotes
1. Open the **Notes** or **Quotes** database in Notion
2. Create a new page — fill in the properties
3. For notes, write the full content in the page body
4. Either wait for the next auto-sync (≤6h) or trigger a manual sync from GitHub Actions

### Triggering a manual sync
- GitHub → Actions → "Notion → Prometheus Sync" → "Run workflow"

### Updating financials or overview
- Use Claude / Cowork skills (`prometheus:analyze-report`, `prometheus:analyze-earnings`)
- These fields are **not** synced from Notion — they're managed by Claude directly in data.json

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Sync fails with 401 | `NOTION_TOKEN` wrong or expired | Re-create integration secret |
| Sync fails with 404 | Database not shared with integration | Share database with `Prometheus Sync` integration |
| Company missing from site | `Ticker` field empty in Notion | Fill in the Ticker property |
| Note not showing | `Active` checkbox unchecked | Check the box |
| Data looks stale | Workflow not running | Check GitHub Actions tab for errors |
| Relation field empty | Wrong database linked | Verify Company relation points to Companies DB |

---

## File Reference

```
investment-research/
├── scripts/
│   ├── notion-sync.js          ← runs in GitHub Actions (Notion → data.json)
│   └── migrate-to-notion.js    ← run once (data.json → Notion)
├── .github/
│   └── workflows/
│       └── notion-sync.yml     ← GitHub Actions schedule
├── package.json                ← npm deps (@notionhq/client)
└── NOTION_SETUP.md             ← this file
```
