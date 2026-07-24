"""
fetch_korea_major_shareholders.py

Pulls Korea's "large shareholding" reports (Korea's equivalent of a 13D/G —
disclosure triggered by crossing 5% ownership thresholds) from Open DART for
SK Hynix and stores them in the korea_major_shareholders table. This is
SKHY's institutional-buying equivalent, since it's a genuine foreign private
issuer with no US 13F/institutional coverage of its own.

Data source: https://opendart.fss.or.kr/api/majorstock.json
- Free, same OPENDART_API_KEY as fetch_korea_ownership.py.
- Requires corp_code (DART's own ID, not the ticker) — same one already
  used for SK Hynix (00164779).
- Returns full history in one call (no date-range parameter), so this
  replaces (delete + re-insert) each ticker's rows on every run, same as
  fetch_korea_ownership.py / fetch_congress_trades.py.

DESIGN NOTE: unlike executive ownership reports (fetch_korea_ownership.py),
this data has no "routine sells don't count" philosophy — a fund actively
reducing a 5%+ stake is a real portfolio decision, not routine compensation
liquidity, so both increases AND decreases are treated as meaningful
direction here, mirroring convictionScore.js's bidirectional momentum
treatment for US 13F data rather than insiderScore.js's asymmetric one.

Usage:
  python fetch_korea_major_shareholders.py
"""

import os
import sys

import requests
import psycopg2
from psycopg2.extras import execute_values

# --- Config ---------------------------------------------------------------

TRACKED_CORP_CODES = {
    "SKHY": "00164779",  # SK Hynix Inc. (SK하이닉스), KRX: 000660
}

DATABASE_URL = os.environ.get("DATABASE_URL")
OPENDART_API_KEY = os.environ.get("OPENDART_API_KEY")

API_URL = "https://opendart.fss.or.kr/api/majorstock.json"


# --- Schema ------------------------------------------------------------

CREATE_TABLE_SQL = """
    CREATE TABLE IF NOT EXISTS korea_major_shareholders (
        id SERIAL PRIMARY KEY,
        ticker TEXT NOT NULL,
        rcept_no TEXT NOT NULL,
        filing_date DATE NOT NULL,
        reporter_name TEXT,
        shares_held BIGINT,
        shares_change BIGINT,
        ownership_pct NUMERIC,
        ownership_pct_change NUMERIC,
        report_reason TEXT,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_korea_major_shareholders_ticker ON korea_major_shareholders(ticker);
"""


# --- Fetch -------------------------------------------------------------

def fetch_major_shareholders(corp_code):
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
                "shares_held": to_int(row.get("stkqy")),
                "shares_change": to_int(row.get("stkqy_irds")),
                "ownership_pct": to_numeric(row.get("stkrt")),
                "ownership_pct_change": to_numeric(row.get("stkrt_irds")),
                "report_reason": row.get("report_resn"),
            })
        except KeyError as e:
            print(f"  [DEBUG] Skipping malformed row for {ticker}: {row} ({e})")
            continue
    return parsed


# --- Database --------------------------------------------------------------

def replace_ticker_rows(conn, ticker, rows):
    with conn.cursor() as cur:
        cur.execute("DELETE FROM korea_major_shareholders WHERE ticker = %s", (ticker,))

        if rows:
            values = [
                (
                    r["ticker"], r["rcept_no"], r["filing_date"], r["reporter_name"],
                    r["shares_held"], r["shares_change"], r["ownership_pct"],
                    r["ownership_pct_change"], r["report_reason"],
                )
                for r in rows
            ]
            query = """
                INSERT INTO korea_major_shareholders
                    (ticker, rcept_no, filing_date, reporter_name, shares_held,
                     shares_change, ownership_pct, ownership_pct_change, report_reason)
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
            raw_rows = fetch_major_shareholders(corp_code)
        except (requests.RequestException, RuntimeError) as e:
            print(f"  Failed to fetch: {e}")
            continue

        print(f"  Found {len(raw_rows)} large shareholding report(s)")
        parsed = parse_rows(ticker, raw_rows)
        affected = replace_ticker_rows(conn, ticker, parsed)
        total += affected
        print(f"  {affected} rows stored")

    conn.close()
    print(f"\nDone. Total rows stored: {total}")


if __name__ == "__main__":
    main()
