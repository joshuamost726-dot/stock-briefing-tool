/**
 * convictionScore.js
 *
 * Validation layer scoring for the Institutional Buying signal.
 * Reads from institutional_holdings (populated weekly by fetch_sec_data.py)
 * and returns a Confidence Score (0-100), a multiplier, and a plain-English
 * explanation — the "genuine conviction or strategic noise?" answer.
 *
 * Usage:
 *   const { getInstitutionalBuyingSignal } = require('./convictionScore');
 *   const signal = await getInstitutionalBuyingSignal('LRCX');
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Funds considered highest-quality / most-watched "smart money" for the
// Track Record check. Expand this list over time as you build history.
const TOP_TIER_FUNDS = ['Berkshire Hathaway', 'Renaissance Technologies'];

function confidenceToMultiplier(score) {
  if (score >= 80) return { multiplier: 1.3, label: 'High Conviction' };
  if (score >= 50) return { multiplier: 1.0, label: 'Moderate Conviction' };
  if (score >= 20) return { multiplier: 0.7, label: 'Low Conviction / Possible Noise' };
  return { multiplier: 0.4, label: 'Likely Noise' };
}

async function getInstitutionalBuyingSignal(ticker) {
  const { rows } = await pool.query(
    `SELECT fund_name, shares_held, value_usd, pct_change, filing_period
     FROM institutional_holdings
     WHERE ticker = $1
     ORDER BY filing_period DESC`,
    [ticker]
  );

  if (rows.length === 0) {
    return {
      ticker,
      rawPoints: 0,
      confidenceScore: 0,
      multiplier: 0,
      label: 'No Data',
      adjustedPoints: 0,
      explanation: `No institutional holdings data found for ${ticker} yet.`,
    };
  }

  // --- Timing sub-score ---
  // Flat baseline for now — all current data comes from the same quarter.
  // Revisit once multiple quarters of history build up.
  const timingScore = 70;

  // --- Scale sub-score ---
  // Based on the largest % change seen among funds with known pct_change.
  const changes = rows.filter(r => r.pct_change !== null).map(r => Number(r.pct_change));
  const maxIncrease = changes.length ? Math.max(...changes) : null;
  let scaleScore = 40; // default: new/unknown-history position
  if (maxIncrease !== null) {
    if (maxIncrease > 50) scaleScore = 100;
    else if (maxIncrease > 15) scaleScore = 75;
    else if (maxIncrease > 0) scaleScore = 55;
    else if (maxIncrease < -30) scaleScore = 20; // big cuts are a bearish signal, not bullish
    else scaleScore = 40;
  }

  // --- Track record sub-score ---
  const hasTopTierFund = rows.some(r => TOP_TIER_FUNDS.includes(r.fund_name));
  const trackRecordScore = hasTopTierFund ? 90 : 55;

  // --- Corroboration sub-score ---
  const distinctFunds = new Set(rows.map(r => r.fund_name)).size;
  let corroborationScore = 30;
  if (distinctFunds >= 4) corroborationScore = 100;
  else if (distinctFunds >= 2) corroborationScore = 65;

  // --- Weighted Confidence Score ---
  const confidenceScore = Math.round(
    timingScore * 0.25 +
    scaleScore * 0.30 +
    trackRecordScore * 0.25 +
    corroborationScore * 0.20
  );

  const { multiplier, label } = confidenceToMultiplier(confidenceScore);

  // --- Raw signal points (institutional buying: max +20 per original design) ---
  const rawPoints = distinctFunds >= 2 ? 20 : 12;
  const adjustedPoints = Math.round(rawPoints * multiplier);

  // --- Plain English explanation ---
  const fundList = [...new Set(rows.map(r => r.fund_name))].join(', ');
  let explanation = `${distinctFunds} fund(s) hold ${ticker}: ${fundList}.`;
  if (maxIncrease !== null) {
    explanation += ` Largest quarter-over-quarter change: ${maxIncrease.toFixed(1)}%.`;
  }
  if (hasTopTierFund) {
    explanation += ` Includes a top-tier fund, boosting track record confidence.`;
  }

  return {
    ticker,
    rawPoints,
    confidenceScore,
    multiplier,
    label,
    adjustedPoints,
    explanation,
    detail: { timingScore, scaleScore, trackRecordScore, corroborationScore, distinctFunds, maxIncrease },
  };
}

module.exports = { getInstitutionalBuyingSignal };
