# 📈 Stock Briefing Tool

A personal "smart money tracker" dashboard for a small set of tracked stocks. Combines up to 14
independent signals (insider buying, institutional/13F activity, short interest, options volume,
congressional trading, government contracts, Reddit/WSB attention, Korean disclosure data for
foreign-listed tickers, technical momentum, and more) into one 0-100 conviction score per ticker,
with Claude-generated plain-English explanations throughout.

There's no automated email — everything lives on the website (Dashboard + per-ticker pages +
Settings), updated by scheduled data-fetch jobs running in the background.

## What it does

- **Dashboard** — every tracked stock's conviction score at a glance, plus a portfolio summary
  (total value, today's $/% change, a value trend chart) if you've entered cost-basis positions.
- **Per-ticker pages** — the full signal breakdown grouped by category, a price history chart, news
  with a one-line Claude explanation of what each headline means for the stock, upcoming dates
  (earnings, next 13F sweep, etc.), a rule-based "bottom line" verdict, and a separate "Ask Claude"
  section with a genuinely opinionated (not fact-restricted) AI take.
- **Position tracking** — enter your cost basis and share count per ticker (on the ticker page or in
  bulk via Settings) and BUY/HOLD/SELL calls adjust for whether you'd be chasing a stock that's
  already run, or averaging down on a loser.
- **Settings** — manage your tracked stock list and every position in one place.

Signals that are structurally impossible for a given ticker (e.g. FINRA short interest for a
foreign-listed stock) are automatically excluded from that ticker's signal count, rather than sitting
around forever as an empty "No Data" card.

## Architecture

Two independently deployed pieces, plus a scheduled data pipeline:

- **Backend** (`stock-briefing-backend.js`) — Express, deployed to Railway. Serves the API; reads
  from Postgres (via each `*Score.js` signal module) and calls a few live APIs (Finnhub, NewsAPI,
  Anthropic) directly on each request.
- **Frontend** (`src/`) — Create React App, deployed to Vercel, talks to the backend via
  `REACT_APP_API_URL`.
- **Data pipeline** (`fetch_*.py`, `sweep_13f.py`) — Python scripts scheduled independently via
  GitHub Actions (see `.github/workflows/`), writing directly to the same Postgres database the
  backend reads from. No API between the scripts and the backend — Postgres is the integration
  point.

See `CLAUDE.md` for the full architecture writeup (signal-by-signal breakdown, data flow, known
quirks).

## Setup

### 1. Environment variables

Backend (Railway) needs, at minimum:
```
FINNHUB_API_KEY=...      # quotes, profile, analyst ratings, earnings calendar
NEWS_API_KEY=...         # news headlines
DATABASE_URL=...         # Postgres connection string
ANTHROPIC_API_KEY=...    # optional — without it, Claude-written prose falls back to rule-based text everywhere
ALPHA_VANTAGE_KEY=...    # documented but not currently called by any code path
```
See `.env.example`.

The Python data pipeline (run via GitHub Actions — set these as **repository secrets**, not backend
env vars) needs `DATABASE_URL`, plus `QUIVER_API_KEY` and `OPENDART_API_KEY` for the specific scripts
that use them (congressional trading/gov contracts/off-exchange volume, and the Korea-specific
signals, respectively).

### 2. A persistent volume for the backend

`data.json` (the tracked-stock list and cost-basis positions) needs to live on a **persistent Railway
volume** mounted at `/data` — without one, it resets to the hardcoded default stock list on every
deploy. See `CLAUDE.md`'s data flow section.

### 3. Deploy

- **Backend**: push to the GitHub repo Railway is connected to; it auto-deploys.
- **Frontend**: push to the GitHub repo Vercel is connected to, with `REACT_APP_API_URL` set to the
  Railway backend's URL.
- **Data pipeline**: each script in `.github/workflows/*.yml` runs on its own schedule automatically
  once its secrets are set; most also support a manual `workflow_dispatch` trigger from the Actions
  tab for testing.

### 4. Adding a stock

Currently: add it in the Settings page (updates the tracked-stock list the website uses). **Known
limitation:** most of the Python fetch scripts have their own hardcoded ticker lists that don't read
from the same source yet, so a newly added stock will only get the signals that don't depend on one
of those scripts (analyst rating, technical momentum) until that's unified.

## Cost

Personal-use budget, roughly $50/month: Railway hosting (~$5-12), Quiver Quantitative Hobbyist tier
($30/mo), Anthropic API usage (~$0.50-1.50/mo at Haiku pricing), domain (~$1-2/mo if you set one up).
Open DART, ApeWisdom, Finnhub's free tier, NewsAPI's free tier, and yfinance are all free.

## Troubleshooting

**"A signal always shows 'No Data' for one ticker"** — check whether that signal is structurally
possible for that ticker at all (see `CLAUDE.md`'s per-ticker exclusion notes) before assuming
something's broken.

**"Railway keeps crashing"** — check the deployment logs in the Railway dashboard, and confirm every
required env var above is actually set.

**"A scheduled fetch script doesn't seem to be running"** — check the Actions tab on GitHub for that
workflow's run history; most can also be triggered manually via `workflow_dispatch` to test in
isolation.
