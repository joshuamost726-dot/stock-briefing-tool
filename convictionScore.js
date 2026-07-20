/**
 * convictionScore.js
 *
 * Institutional Buying signal, scored against full 13F sweep data
 * (~6k holdings/quarter rather than a 5-fund watchlist).
 *
 * IMPORTANT: holder count tracks market cap far more than conviction.
 * The real conviction signal is quarter-over-quarter position change,
 * which requires two sweeps to exist. Until then this function reports
 * momentumAvailable: false and the score should be read as
 * "ownership profile," not "smart money is buying."
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const TOP_TIER_FUNDS = [
  'BERKSHIRE HATHAWAY',
  'RENAISSANCE TECHNOLOGIES',
  'BAUPOST',
  'THIRD POINT',
  'TIGER GLOBAL',
  'LONE PINE',
  'VIKING GLOBAL',
  'COATUE',
  'APPALOOSA',
  'PERSHING SQUARE',
];

function labelFor(score) {
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
        AND filing_period = (
          SELECT MAX(filing_period) FROM institutional_holdings WHERE ticker = $1
        )
      ORDER BY value_usd DESC NULLS LAST`,
    [ticker]
  );

  if (rows.length === 0) {
    return {
      ticker,
      confidenceScore: 0,
      multiplier: 0,
      label: 'No Data',
      momentumAvailable: false,
      explanation: `No institutional holdings on file for ${ticker}.`,
      detail: { holderCount: 0 },
    };
  }

  const holderCount = rows.length;
  const period = rows[0].filing_period;

  // --- Breadth: log-scaled holder count. Context, not conviction. ---
  // 1 holder -> ~0, 10 -> ~33, 100 -> ~66, 1000+ -> ~100
  const breadthScore = Math.min(100, Math.round((Math.log10(holderCount) / 3) * 100));

  // --- Concentration: share of total value held by the top 10 ---
  const values = rows.map(r => Number(r.value_usd) || 0);
  const totalValue = values.reduce((a, b) => a + b, 0);
  const top10Value = values.slice(0, 10).reduce((a, b) => a + b, 0);
  const top10Pct = totalValue > 0 ? (top10Value / totalValue) * 100 : null;

  // Concentrated ownership implies deliberate positions rather than
  // passive index exposure. Diffuse ownership scores lower.
  let concentrationScore = 50;
  if (top10Pct !== null) {
    if (top10Pct > 70) concentrationScore = 90;
    else if (top10Pct > 50) concentrationScore = 75;
    else if (top10Pct > 30) concentrationScore = 55;
    else concentrationScore = 35;
  }

  // --- Top-tier presence: weak evidence at this scale, kept for context ---
  const topTierHolders = rows
    .map(r => (r.fund_name || '').toUpperCase())
    .filter(name => TOP_TIER_FUNDS.some(f => name.includes(f)));
  const hasTopTier = topTierHolders.length > 0;
  const trackRecordScore = hasTopTier ? 80 : 50;

  // --- Momentum: the actual conviction signal. Null until 2+ sweeps exist. ---
  const changes = rows
    .filter(r => r.pct_change !== null)
    .map(r => Number(r.pct_change));

  const momentumAvailable = changes.length > 0;
  let momentumScore = null;
  let increasing = 0;
  let decreasing = 0;

  if (momentumAvailable) {
    increasing = changes.filter(c => c > 0).length;
    decreasing = changes.filter(c => c < 0).length;
    const netPct = (increasing / changes.length) * 100;

    if (netPct > 65) momentumScore = 95;
    else if (netPct > 55) momentumScore = 75;
    else if (netPct > 45) momentumScore = 50;
    else if (netPct > 35) momentumScore = 30;
    else momentumScore = 15;
  }

  // --- Weighted score. Momentum dominates when present. ---
  let confidenceScore;
  if (momentumAvailable) {
    confidenceScore = Math.round(
      momentumScore * 0.50 +
      concentrationScore * 0.25 +
      breadthScore * 0.15 +
      trackRecordScore * 0.10
    );
  } else {
    confidenceScore = Math.round(
      concentrationScore * 0.50 +
      breadthScore * 0.30 +
      trackRecordScore * 0.20
    );
  }

  const { multiplier, label } = labelFor(confidenceScore);

  // --- Plain English ---
  let explanation = `${holderCount.toLocaleString()} institutional holder(s) as of ${period}.`;

  if (top10Pct !== null) {
    explanation += ` Top 10 hold ${top10Pct.toFixed(0)}% of reported value.`;
  }

  if (hasTopTier) {
    const names = [...new Set(topTierHolders)].slice(0, 2).join(', ');
    explanation += ` Includes ${names}.`;
  }

  if (momentumAvailable) {
    explanation += ` ${increasing} increased, ${decreasing} decreased vs prior quarter.`;
  } else {
    explanation += ` Quarter-over-quarter change not yet available — needs a second sweep.`;
  }

  return {
    ticker,
    confidenceScore,
    multiplier,
    label,
    momentumAvailable,
    explanation,
    detail: {
      holderCount,
      top10Pct,
      totalValue,
      breadthScore,
      concentrationScore,
      trackRecordScore,
      momentumScore,
      increasing,
      decreasing,
      period,
    },
  };
}

module.exports = { getInstitutionalBuyingSignal };
