/**
 * priceTargetData.js
 *
 * Fetches the latest analyst price target snapshot for a ticker.
 * Not a conviction signal — this is reference data, shown alongside
 * quote/profile stats (Market Cap, P/E, etc.), not scored into the
 * conviction score.
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function getPriceTarget(ticker) {
  const { rows } = await pool.query(
    `SELECT current_price, target_high, target_low, target_mean, target_median, num_analysts, snapshot_date
       FROM price_targets
      WHERE ticker = $1
      ORDER BY snapshot_date DESC
      LIMIT 1`,
    [ticker]
  );

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];

  if (row.target_mean === null) {
    return {
      available: false,
      numAnalysts: 0,
      note: 'No analyst price target coverage available for this ticker.',
    };
  }

  const currentPrice = Number(row.current_price);
  const meanTarget = Number(row.target_mean);
  const upsidePct = currentPrice > 0
    ? ((meanTarget - currentPrice) / currentPrice) * 100
    : null;

  return {
    available: true,
    high: Number(row.target_high),
    low: Number(row.target_low),
    mean: meanTarget,
    median: Number(row.target_median),
    numAnalysts: row.num_analysts,
    upsidePct,
    asOf: row.snapshot_date,
    freshness: {
      lastChecked: row.snapshot_date,
      schedule: 'Updates automatically, daily (weekdays)'
    }
  };
}

module.exports = { getPriceTarget };
