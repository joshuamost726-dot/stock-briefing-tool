"""
fetch_korea_capital_actions.py

Pulls treasury stock (buyback) and paid-in capital increase (new share
issuance) decisions from Korea's Open DART for SK Hynix and stores them in
the korea_capital_actions table. Both are "material matters reports"
(주요사항보고서) — corporate decisions that directly change share count,
the closest Korean equivalent to US buyback announcements / secondary
offerings.

Data sources (all same OPENDART_API_KEY, all require a bgn_de/end_de date
range unlike the equity-disclosure endpoints used elsewhere):
- https://opendart.fss.or.kr/api/tsstkAqDecsn.json (직접 취득 — direct buyback)
- https://opendart.fss.or.kr/api/tsstkAqTrctrCnsDecsn.json (신탁계약 — trust-based buyback)
- https://opendart.fss.or.kr/api/piicDecsn.json (유상증자 — paid-in capital increase / new share issuance)

DESIGN NOTE: unlike koreaOwnershipScore.js/koreaMajorShareholderScore.js,
buybacks and issuances are opposite-direction corporate actions bundled into
one signal, since they're really "two sides of the same coin" — a company
directly changing its own share count. Buybacks are unambiguously bullish
(the company itself thinks its stock is undervalued). Issuances are more
nuanced: dilutive to existing shareholders in isolation, but the PURPOSE
matters — funding growth capex reads very differently from funding debt
repayment or plugging an operating cash shortfall. koreaCapitalActionsScore.js
reports the facts (direction, magnitude, stated purpose) and leaves that
nuance to the Claude explainer rather than collapsing it into one number.

Usage:
  python fetch_korea_capital_actions.py
"""

import os
import sys
from datetime import date, timedelta

import requests
import psycopg2
from psycopg2.extras import execute_values

# --- Config ---------------------------------------------------------------

TRACKED_CORP_CODES = {
    "SKHY": "00164779",  # SK Hynix Inc. (SK하이닉스), KRX: 000660
}

# Open DART data for these report types only goes back to 2015, but we only
# need a few years of "recent" history for scoring purposes.
LOOKBACK_YEARS = 3

DATABASE_URL = os.environ.get("DATABASE_URL")
OPENDART_API_KEY = os.environ.get("OPENDART_API_KEY")

ENDPOINTS = {
    "buyback_direct": "https://opendart.fss.or.kr/api/tsstkAqDecsn.json",
    "buyback_trust": "https://opendart.fss.or.kr/api/tsstkAqTrctrCnsDecsn.json",
    "issuance": "https://opendart.fss.or.kr/api/piicDecsn.json",
}


# --- Schema ------------------------------------------------------------

CREATE_TABLE_SQL = """
    CREATE TABLE IF NOT EXISTS korea_capital_actions (
        id SERIAL PRIMARY KEY,
        ticker TEXT NOT NULL,
        rcept_no TEXT NOT NULL,
        action_type TEXT NOT NULL,
        shares_involved BIGINT,
        shares_outstanding_before BIGINT,
        purpose TEXT,
        raw_purpose_amounts JSONB,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (ticker, rcept_no, action_type)
    );
    CREATE INDEX IF NOT EXISTS idx_korea_capital_actions_ticker ON korea_capital_actions(ticker);
"""


# --- Fetch -------------------------------------------------------------

def fetch_report(url, corp_code, bgn_de, end_de):
    resp = requests.get(url, params={
        "crtfc_key": OPENDART_API_KEY,
        "corp_code": corp_code,
        "bgn_de": bgn_de,
        "end_de": end_de,
    }, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    status = data.get("status")
    if status == "013":  # DART's "no data found" status code
        return []
    if status != "000":
        raise RuntimeError(f"Open DART API error {status}: {data.get('message')}")

    return data.get("list", [])


def to_int(val):
    if val is None or val == "-":
        return None
    try:
        return int(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        return None


def parse_buyback_row(ticker, row, action_type):
    shares = to_int(row.get("planned_stock_common"))
    return {
        "ticker": ticker,
        "rcept_no": row["rcept_no"],
        "action_type": action_type,
        "shares_involved": shares,
        "shares_outstanding_before": None,
        "purpose": row.get("acquisition_purpose"),
        "raw_purpose_amounts": None,
    }


def parse_issuance_row(ticker, row):
    import json
    purpose_amounts = {
        "facility": to_int(row.get("fdpp_fclt")),
        "business_acquisition": to_int(row.get("fdpp_bsninh")),
        "operating": to_int(row.get("fdpp_op")),
        "debt_repayment": to_int(row.get("fdpp_dtrp")),
        "securities_acquisition": to_int(row.get("fdpp_ocsa")),
        "other": to_int(row.get("fdpp_etc")),
    }
    dominant_purpose = max(
        (k for k, v in purpose_amounts.items() if v),
        key=lambda k: purpose_amounts[k],
        default=None,
    )
    return {
        "ticker": ticker,
        "rcept_no": row["rcept_no"],
        "action_type": "issuance",
        "shares_involved": to_int(row.get("nstk_ostk_cnt")),
        "shares_outstanding_before": to_int(row.get("bfic_tisstk_ostk")),
        "purpose": dominant_purpose,
        "raw_purpose_amounts": json.dumps(purpose_amounts),
    }


# --- Database --------------------------------------------------------------

def upsert_rows(conn, rows):
    query = """
        INSERT INTO korea_capital_actions
            (ticker, rcept_no, action_type, shares_involved,
             shares_outstanding_before, purpose, raw_purpose_amounts)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (ticker, rcept_no, action_type) DO UPDATE SET
            shares_involved = EXCLUDED.shares_involved,
            shares_outstanding_before = EXCLUDED.shares_outstanding_before,
            purpose = EXCLUDED.purpose,
            raw_purpose_amounts = EXCLUDED.raw_purpose_amounts,
            fetched_at = NOW()
    """
    with conn.cursor() as cur:
        for r in rows:
            cur.execute(query, (
                r["ticker"], r["rcept_no"], r["action_type"], r["shares_involved"],
                r["shares_outstanding_before"], r["purpose"], r["raw_purpose_amounts"],
            ))
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

    end_de = date.today().strftime("%Y%m%d")
    bgn_de = (date.today() - timedelta(days=365 * LOOKBACK_YEARS)).strftime("%Y%m%d")

    total = 0

    for ticker, corp_code in TRACKED_CORP_CODES.items():
        print(f"\n--- {ticker} (corp_code {corp_code}) ---")
        all_rows = []

        for action_type, url in ENDPOINTS.items():
            try:
                raw_rows = fetch_report(url, corp_code, bgn_de, end_de)
            except (requests.RequestException, RuntimeError) as e:
                print(f"  {action_type}: failed to fetch: {e}")
                continue

            print(f"  {action_type}: {len(raw_rows)} report(s)")
            for row in raw_rows:
                try:
                    if action_type == "issuance":
                        all_rows.append(parse_issuance_row(ticker, row))
                    else:
                        all_rows.append(parse_buyback_row(ticker, row, action_type))
                except KeyError as e:
                    print(f"    [DEBUG] Skipping malformed row: {row} ({e})")

        try:
            affected = upsert_rows(conn, all_rows)
            total += affected
            print(f"  {affected} rows upserted")
        except Exception as e:
            print(f"  Failed to upsert: {e}")
            conn.rollback()

    conn.close()
    print(f"\nDone. Total rows upserted: {total}")


if __name__ == "__main__":
    main()
