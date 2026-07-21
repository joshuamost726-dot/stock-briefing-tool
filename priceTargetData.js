/**
 * priceTargetData.js
 *
 * Analyst price target consensus from the price_targets table (Yahoo Finance
 * snapshots via fetch_price_targets.py). Not a conviction signal — no
 * scoring/validation here, just the latest snapshot for display.
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function getPriceTarget(ticker, currentPrice) {
  const { rows } = await pool.query(
    `SELECT current_price, target_high, target_low, target_mean, num_analysts
       FROM price_targets
      WHERE ticker = $1
      ORDER BY snapshot_date DESC
      LIMIT 1`,
    [ticker]
  );

  if (rows.length === 0) {
    return { available: false };
  }

  const row = rows[0];
  const mean = Number(row.target_mean);
  const price = Number(currentPrice) || Number(row.current_price) || null;

  return {
    available: true,
    mean,
    low: Number(row.target_low),
    high: Number(row.target_high),
    numAnalysts: row.num_analysts,
    upsidePct: price ? ((mean - price) / price) * 100 : null,
  };
}

module.exports = { getPriceTarget };
