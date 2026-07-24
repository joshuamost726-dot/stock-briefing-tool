"""
fetch_korea_ownership.py

Pulls executive/major-shareholder stock ownership CHANGE reports from Korea's
Open DART (Financial Supervisory Service) API for SK Hynix and stores them in
the korea_ownership_changes table. This is Korea's equivalent of a Form 4 —
SKHY is a genuine foreign private issuer and is exempt from SEC Section 16
reporting entirely, so this is the only real "insider activity" data source
available for it.

Data source: https://opendart.fss.or.kr/api/elestock.json
- Free, requires a personal API key (register at opendart.fss.or.kr / English
  portal at engopendart.fss.or.kr) — see OPENDART_API_KEY below.
- Requires a `corp_code` (DART's own 8-digit company ID, NOT the ticker) —
  looked up once via the bulk corpCode.xml download, hardcoded below since
  it never changes for a given company.
- Returns a company's FULL history in one call (no date-range parameter), so
  like fetch_congress_trades.py this replaces (delete + re-insert) each
  ticker's rows on every run rather than doing incremental upserts.

DESIGN NOTE (important limitation vs. Form 4): this report gives share-count
and ownership-percentage CHANGES, but NEVER a price per share — Korean
disclosure rules don't require reporting transaction price the way Section 16
does. koreaOwnershipScore.js can score direction/magnitude of a change but
cannot do the price-vs-cost-basis comparison Form 4 and 13F support.

Usage:
  python fetch_korea_ownership.py
"""

import os
import sys

import requests
import psycopg2
from psycopg2.extras import execute_values

# --- Config ---------------------------------------------------------------

# ticker -> DART corp_code. Only SKHY has a mapping here — every other
# tracked ticker is a genuine US domestic filer already covered by Form 4.
TRACKED_CORP_CODES = {
    "SKHY": "00164779",  # SK Hynix Inc. (SK하이닉스), KRX: 000660
}

DATABASE_URL = os.environ.get("DATABASE_URL")
OPENDART_API_KEY = os.environ.get("OPENDART_API_KEY")

API_URL = "https://opendart.fss.or.kr/api/elestock.json"


# --- Schema ------------------------------------------------------------

CREATE_TABLE_SQL = """
    CREATE TABLE IF NOT EXISTS korea_ownership_changes (
        id SERIAL PRIMARY KEY,
        ticker TEXT NOT NULL,
        rcept_no TEXT NOT NULL,
        filing_date DATE NOT NULL,
        reporter_name TEXT,
        executive_title TEXT,
        is_major_shareholder BOOLEAN,
        shares_held BIGINT,
        shares_change BIGINT,
        ownership_pct NUMERIC,
        ownership_pct_change NUMERIC,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_korea_ownership_changes_ticker ON korea_ownership_changes(ticker);
"""


# --- Fetch -------------------------------------------------------------

def fetch_ownership_changes(corp_code):
    resp = requests.get(API_URL, params={"crtfc_key": OPENDART_API_KEY, "corp_code": corp_code}, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    status = data.get("status")
    if status == "013":  # DART's "no data found" status code
        return []
    if status != "000":
        raise RuntimeError(f"Open DART API error {status}: {data.get('message')}")

    return data.get("list", [])


def to_int(val):
    if val is None:
        return None
    try:
        return int(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        return None


def to_numeric(val):
    if val is None:
        return None
    try:
        return float(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        return None


def parse_rows(ticker, raw_rows):
    parsed = []
    for row in raw_rows:
        try:
            parsed.append({
                "ticker": ticker,
                "rcept_no": row["rcept_no"],
                "filing_date": row["rcept_dt"],
                "reporter_name": row.get("repror"),
                "executive_title": row.get("isu_exctv_ofcps"),
                "is_major_shareholder": row.get("isu_main_shrholdr") not in (None, "-", ""),
                "shares_held": to_int(row.get("sp_stock_lmp_cnt")),
                "shares_change": to_int(row.get("sp_stock_lmp_irds_cnt")),
                "ownership_pct": to_numeric(row.get("sp_stock_lmp_rate")),
                "ownership_pct_change": to_numeric(row.get("sp_stock_lmp_irds_rate")),
            })
        except KeyError as e:
            print(f"  [DEBUG] Skipping malformed row for {ticker}: {row} ({e})")
            continue
    return parsed


# --- Database --------------------------------------------------------------

def replace_ticker_rows(conn, ticker, rows):
    with conn.cursor() as cur:
        cur.execute("DELETE FROM korea_ownership_changes WHERE ticker = %s", (ticker,))

        if rows:
            values = [
                (
                    r["ticker"], r["rcept_no"], r["filing_date"], r["reporter_name"],
                    r["executive_title"], r["is_major_shareholder"], r["shares_held"],
                    r["shares_change"], r["ownership_pct"], r["ownership_pct_change"],
                )
                for r in rows
            ]
            query = """
                INSERT INTO korea_ownership_changes
                    (ticker, rcept_no, filing_date, reporter_name, executive_title,
                     is_major_shareholder, shares_held, shares_change,
                     ownership_pct, ownership_pct_change)
                VALUES %s
            """
            execute_values(cur, query, values)

    conn.commit()
    return len(rows)


# --- Main --------------------------------------------------------------

def main():
    if not DATABASE_URL:
        print("ERROR: DATABASE_URL environment variable not set.")
        sys.exit(1)
    if not OPENDART_API_KEY:
        print("ERROR: OPENDART_API_KEY environment variable not set.")
        sys.exit(1)

    conn = psycopg2.connect(DATABASE_URL)
    with conn.cursor() as cur:
        cur.execute(CREATE_TABLE_SQL)
    conn.commit()

    total = 0

    for ticker, corp_code in TRACKED_CORP_CODES.items():
        print(f"\n--- {ticker} (corp_code {corp_code}) ---")
        try:
            raw_rows = fetch_ownership_changes(corp_code)
        except (requests.RequestException, RuntimeError) as e:
            print(f"  Failed to fetch: {e}")
            continue

        print(f"  Found {len(raw_rows)} ownership change report(s)")
        parsed = parse_rows(ticker, raw_rows)
        affected = replace_ticker_rows(conn, ticker, parsed)
        total += affected
        print(f"  {affected} rows stored")

    conn.close()
    print(f"\nDone. Total rows stored: {total}")


if __name__ == "__main__":
    main()
