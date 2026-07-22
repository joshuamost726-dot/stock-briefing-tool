/**
 * offExchangeScore.js
 *
 * Off-Exchange (dark pool) Trading signal, from Quiver Quantitative's daily
 * FINRA off-exchange volume data.
 *
 * DESIGN NOTE: same ambiguity as shortInterestScore.js, different data
 * source. `DPI` here is Quiver's dark pool index — the share of
 * off-exchange volume that printed as SHORT volume (OTC_Short / OTC_Total),
 * not overall dark-pool participation. A rising DPI is often read as bearish
 * positioning building quietly off-exchange, but a meaningful share of
 * off-exchange short volume is routine market-maker hedging, not directional
 * conviction — so this reports DIRECTION and MAGNITUDE separately rather
 * than picking a side, same philosophy as short interest. Requires at least
 * 10 days of history before scoring, mirroring optionsVolumeScore.js's
 * baseline requirement.
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const MIN_HISTORY_DAYS = 10;

async function getOffExchangeSignal(ticker) {
  const { rows } = await pool.query(
    `SELECT trade_date, otc_short, otc_total, dpi
       FROM off_exchange_volume
      WHERE ticker = $1
      ORDER BY trade_date DESC
      LIMIT 30`,
    [ticker]
  );

  if (rows.length === 0) {
    return {
      ticker,
      confidenceScore: 0,
      hasSignal: false,
      label: 'No Data',
      explanation: `No off-exchange volume data on file for ${ticker}.`,
      detail: {},
    };
  }

  if (rows.length < MIN_HISTORY_DAYS) {
    return {
      ticker,
      confidenceScore: 0,
      hasSignal: false,
      label: 'Building History',
      explanation:
        `Only ${rows.length} trading day(s) of off-exchange data on file for ${ticker} — ` +
        `need at least ${MIN_HISTORY_DAYS} to judge whether today's activity is unusual. ` +
        `This signal will activate automatically as daily snapshots accumulate.`,
      detail: { daysAvailable: rows.length, daysNeeded: MIN_HISTORY_DAYS },
    };
  }

  const today = rows[0];
  const history = rows.slice(1);

  const rawDate = today.trade_date;
  const tradeDateStr = rawDate instanceof Date
    ? rawDate.toISOString().slice(0, 10)
    : String(rawDate).slice(0, 10);

  const avgOtcTotal = average(history.map(r => Number(r.otc_total)));
  const todayOtcTotal = Number(today.otc_total);
  const volumeRatio = avgOtcTotal > 0 ? todayOtcTotal / avgOtcTotal : 0;

  const avgDpi = average(history.map(r => Number(r.dpi)));
  const todayDpi = Number(today.dpi);
  const dpiPointChange = (todayDpi - avgDpi) * 100; // percentage-point move

  const direction = dpiPointChange > 3 ? 'increasing'
    : dpiPointChange < -3 ? 'decreasing'
    : 'flat';

  // --- Magnitude: how far above/below normal is today's off-exchange volume? ---
  let volumeScore;
  if (volumeRatio >= 2.5) volumeScore = 90;
  else if (volumeRatio >= 1.75) volumeScore = 70;
  else if (volumeRatio >= 1.25) volumeScore = 50;
  else volumeScore = 25;

  // --- Move size: how large is today's short-side share vs the recent baseline? ---
  const absDpiMove = Math.abs(dpiPointChange);
  let dpiMoveScore;
  if (absDpiMove >= 15) dpiMoveScore = 90;
  else if (absDpiMove >= 8) dpiMoveScore = 70;
  else if (absDpiMove >= 3) dpiMoveScore = 50;
  else dpiMoveScore = 25;

  const confidenceScore = Math.round(volumeScore * 0.5 + dpiMoveScore * 0.5);

  let label;
  if (confidenceScore >= 75) label = 'Unusual Activity';
  else if (confidenceScore >= 50) label = 'Moderate Activity';
  else label = 'Normal / Baseline Activity';

  const explanation =
    `Off-exchange volume today: ${Math.round(todayOtcTotal).toLocaleString()} shares ` +
    `(${volumeRatio.toFixed(1)}x the ${history.length}-day average). ` +
    `Short-side share of that volume is ${direction} ` +
    `(${(todayDpi * 100).toFixed(1)}% today vs ${(avgDpi * 100).toFixed(1)}% average). ` +
    (direction === 'increasing'
      ? 'A rising short-side share off-exchange can reflect quietly building bearish positioning, but is often routine market-maker hedging rather than directional conviction.'
      : direction === 'decreasing'
      ? 'A falling short-side share suggests less off-exchange short-side pressure, though this alone doesn\'t confirm bullish conviction.'
      : 'No meaningful shift in the short-side share of off-exchange volume.');

  return {
    ticker,
    confidenceScore,
    hasSignal: true,
    label,
    direction,
    explanation,
    detail: {
      todayOtcTotal,
      avgOtcTotal,
      volumeRatio,
      todayDpi,
      avgDpi,
      dpiPointChange,
      volumeScore,
      dpiMoveScore,
      daysOfHistory: history.length,
      lastChecked: tradeDateStr,
    },
  };
}

function average(nums) {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

module.exports = { getOffExchangeSignal };
