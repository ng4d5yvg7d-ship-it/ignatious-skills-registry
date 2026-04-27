# Ignatious Skill Roadmap — Dashboard

Static HTML dashboard for the Skills Registry. Reads CSV exports of the Google Sheet and renders a partner-facing org chart, stats banner, and filterable skills table.

## Run locally

From this directory:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000> in your browser. (Browsers block `fetch()` on `file://` URLs, so a local server is required — Python's built-in is fine.)

## Switch from local CSVs to the live Sheet

Right now the dashboard reads from `data/*.csv`. To make it auto-refresh from the live Google Sheet on every page load:

1. Open the Skills Registry Sheet
2. **File → Share → Publish to web**
3. In the dialog: choose **Comma-separated values (.csv)** as the format. Repeat for each tab (Skills, Orchestrators, People). You'll get three URLs.
4. Open `app.js`, comment out the dev `sources` block, uncomment the prod block, and paste in the three URLs.
5. Save, refresh — the dashboard now pulls live data on every load.

## Deploy to Vercel

Once the live URLs are wired in:

```bash
cd dashboard
vercel deploy
```

Or drag the `dashboard/` folder onto the Vercel dashboard. No build step — Vercel serves the static files directly.

## Schema validation

The dashboard validates expected columns on load. If a column is renamed, deleted, or the Sheet schema otherwise drifts, the page shows a clear error message instead of silently breaking. To fix: revert the Sheet, refresh.

Required columns per tab:
- **Skills:** ID, Name, Status, Primary Orchestrator, Category, Source
- **Orchestrators:** Name, Display Order
- **People:** Name, Role

Extra columns are tolerated. Multi-line headers (e.g. `Source\n(for reference)`) work — the parser reads only the first line of each header.
