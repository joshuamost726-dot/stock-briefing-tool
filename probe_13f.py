"""
probe_13f.py — measures the cost of a full 13F sweep before building it.
Processes a small sample and reports timing + what it found.
"""

import time
import requests
from edgar import set_identity, get_filings

SEC_IDENTITY = "joshuamost726@gmail.com"
set_identity(SEC_IDENTITY)

TRACKED = ['RILY', 'SKHY', 'ASTS', 'LRCX', 'QCOM', 'CWBHF']
SAMPLE_SIZE = 20


def main():
    print("Fetching 13F-HR filing index for 2026 Q2...")
    t0 = time.time()
    filings = get_filings(year=2026, quarter=2, form="13F-HR")
    total = len(filings)
    print(f"  found {total} filings in {time.time() - t0:.1f}s")

    print(f"\nProcessing first {SAMPLE_SIZE} filings...")
    t1 = time.time()

    hits = {}
    cusips_seen = {}
    parsed = 0
    skipped = 0

    for f in list(filings)[:SAMPLE_SIZE]:
        try:
            obj = f.obj()
            if obj is None or not getattr(obj, "has_infotable", False):
                skipped += 1
                continue

            df = obj.infotable
            parsed += 1

            if "Ticker" in df.columns:
                for _, row in df.iterrows():
                    tk = row.get("Ticker")
                    if tk in TRACKED:
                        hits.setdefault(tk, []).append(f.company)
                        cusips_seen[tk] = row.get("Cusip")

        except Exception as e:
            skipped += 1
            print(f"  error on {f.company}: {e}")

    elapsed = time.time() - t1

    print(f"\n--- RESULTS ---")
    print(f"Parsed:  {parsed}")
    print(f"Skipped: {skipped}")
    print(f"Time:    {elapsed:.1f}s for {SAMPLE_SIZE} filings")
    print(f"Rate:    {elapsed / SAMPLE_SIZE:.2f}s per filing")
    print(f"\nProjected full sweep of {total} filings: "
          f"{(elapsed / SAMPLE_SIZE) * total / 60:.0f} minutes")

    print(f"\nTicker matches in sample:")
    if hits:
        for tk, funds in hits.items():
            print(f"  {tk} (CUSIP {cusips_seen.get(tk)}): {len(funds)} holder(s)")
    else:
        print("  none — expected in a 20-filing sample")

    print(f"\nCUSIPs discovered: {cusips_seen}")


if __name__ == "__main__":
    main()
