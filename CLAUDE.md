# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal stock briefing tool for a single user (joshuamost726@gmail.com). A Node.js backend emails
a briefing 3x/day (8am, 1pm, 5pm UTC) and serves a "conviction score" API; a set of Python scripts
(run on schedule via GitHub Actions) fill a Postgres database with SEC/market data that the backend's
scoring functions read from. There are two separate, independently deployed halves:

- **Backend** (`stock-briefing-backend.js`) — Express + node-cron, deployed to Railway.
- **Frontend** (`src/`) — Create React App, deployed to Vercel, talks to the backend via
  `REACT_APP_API_URL`.
- **Data pipeline** (`fetch_*.py`, `sweep_13f.py`, `probe_13f.py`, `parse_def14a.py`) — scheduled
  independently via `.github/workflows/*.yml`, writes directly to the same Postgres DB
  (`DATABASE_URL`) the backend reads from. There is no API between the Python scripts and the
  Node backend — Postgres tables are the integration point.

## Commands

Backend (run from repo root):
```
npm start   # node stock-briefing-backend.js
npm run dev # nodemon stock-briefing-backend.js
```

Frontend (Create React App):
```
npm install
npm start   # dev server, expects REACT_APP_API_URL (defaults to http://localhost:5000)
npm run build
```

Python data pipeline (`pip install -r requirements.txt` first; each script needs `DATABASE_URL` set):
```
python fetch_form4.py                  # incremental Form 4 (insider txns), last 7 days
python fetch_form4.py --backfill 365   # one-time backfill
python fetch_sec_data.py               # institutional holdings (13F) for a fixed fund watchlist + exec comp (DEF 14A)
python probe_13f.py                    # dry-run timing probe before running a full 13F sweep
python sweep_13f.py                    # full 13F-HR sweep for one quarter (edit YEAR/QUARTER constants first)
python fetch_short_interest.py         # Nasdaq short interest
python fetch_options_volume.py         # Yahoo Finance options call/put volume snapshot
python fetch_price_targets.py          # Yahoo Finance analyst price targets
```

There is no test suite, linter, or CI check configured in this repo — GitHub Actions only runs the
scheduled data-fetch scripts, not any validation.

## Architecture

### Conviction score system

The backend combines up to 6 independent signals into one 0-100 "conviction score" per ticker,
returned by `GET /api/ticker/:ticker`. Each signal lives in its own `*Score.js` module and is
deliberately conservative about claiming a signal exists:

- `convictionScore.js` — institutional buying, from 13F sweep data. A single quarter shows
  ownership, not buying; the score is capped at 60 until quarter-over-quarter `pct_change` is
  available (i.e. until a second sweep has run).
- `insiderScore.js` — insider buying, from Form 4 filings. Only open-market buys (`transaction_type
  = 'P'`) are scored; routine sells are surfaced as context but never scored.
- `shortInterestScore.js` — short interest direction/magnitude from FINRA data via Nasdaq. Reports
  strength and direction separately rather than collapsing them into one number, since rising short
  interest is ambiguous (bearish conviction vs. squeeze setup).
- `optionsVolumeScore.js` — options call volume vs. a rolling baseline. Requires 5+ days of history
  before it will score anything.
- `getAnalystSignal` (inline in `stock-briefing-backend.js`) — Finnhub recommendation trends.

Each module returns `{ confidenceScore, hasSignal, label, explanation, detail }` and, for the
per-ticker endpoint, a `validation` object (`timing`, `scaleVsSalary`, `trackRecord`,
`corroboration`) describing how much to trust the signal. When adding or modifying a signal,
preserve this pattern: a signal with insufficient data should return `hasSignal: false` /
`confidenceScore: 0` and say plainly why, rather than inventing a number. This "say I don't know"
behavior is intentional across all four modules — don't smooth it away in refactors.

`GET /api/ticker/:ticker` averages whichever signals returned a nonzero score (not all 6 — see
`activeSignals`) into the overall `convictionScore`, then maps it to `tier`/`action` buckets (>=70
High/BUY, >=50 Moderate/HOLD, else Low/SELL). The separate `bottomLine.verdict`/`signalQuality`
fields come from `noiseScore.js`'s `getVerdict()`, which classifies "Real vs. Noise" from active
signal count/agreement (not from `convictionScore` directly) — badge/headline are rule-based and
deterministic; only the `reasoning` paragraph is optionally rewritten by Claude (`claude-haiku-4-5`,
`ANTHROPIC_API_KEY`) for better prose, falling back to the rule-based sentence if the key is unset
or the call fails.

### Data flow

1. GitHub Actions cron jobs run the Python scripts on independent schedules (see
   `.github/workflows/`), each writing to its own Postgres table (`insider_transactions`,
   `institutional_holdings`, `executive_compensation`, `short_interest`, `options_volume`,
   `price_targets`). Scripts use `INSERT ... ON CONFLICT` upserts keyed on natural keys (ticker +
   date, or cik + ticker + transaction fields), so they're safe to re-run.
2. `stock-briefing-backend.js` queries Postgres (via the `*Score.js` modules) and external live
   APIs (Finnhub for quotes/profile/recommendations/earnings, NewsAPI for news) on each request —
   there's no caching layer, every API call hits Finnhub/NewsAPI directly.
3. `data.json` (gitignored, created at runtime next to the backend script) is separate,
   file-based storage for the tracked-stock list, user email, and briefing history — this is NOT in
   Postgres. `loadData()`/`saveData()` read/write it directly; there's no migration path if the
   Railway filesystem resets, so tracked stocks reset to the hardcoded default list in `loadData()`
   if `data.json` is missing.
4. Ticker universes differ per script and are NOT unified: `stock-briefing-backend.js`'s default
   tracked list, `fetch_form4.py`'s `TRACKED_CIKS`, and `fetch_short_interest.py` /
   `fetch_options_volume.py` / `fetch_price_targets.py`'s `TRACKED_TICKERS` are separate hardcoded
   lists that must be updated independently when adding a ticker. Foreign-listed tickers (SKHY,
   CWBHF) are intentionally excluded from the US-only data sources (short interest, options,
   price targets, Form 4/CIK lookups).
5. `sweep_13f.py` requires manually editing the `YEAR`/`QUARTER` constants before each run and is
   only triggered manually (`workflow_dispatch`, no schedule) — unlike the other fetch scripts.

### Email delivery

Nodemailer sends via Gmail using an app password (`GMAIL_USER`/`GMAIL_PASSWORD`), scheduled with
`node-cron` inside the long-running backend process (not GitHub Actions) — the three daily cron
expressions (8am/1pm/5pm UTC) live directly in `stock-briefing-backend.js`.

## Environment variables

Backend (Railway): `GMAIL_USER`, `GMAIL_PASSWORD`, `ALPHA_VANTAGE_KEY`, `NEWS_API_KEY`,
`FINNHUB_API_KEY`, `DATABASE_URL`, `PORT`, `ANTHROPIC_API_KEY` (optional — see below). Frontend
(Vercel): `REACT_APP_API_URL`. Python scripts (GitHub Actions secrets): `DATABASE_URL` only.

Note `ALPHA_VANTAGE_KEY` is documented in `.env.example`/README but the backend code currently only
calls Finnhub for quotes — Alpha Vantage isn't wired into `stock-briefing-backend.js`.
