/**
 * koreaOwnershipScore.js
 *
 * Korea Ownership Change signal — SK Hynix's equivalent of insider buying,
 * scored against Open DART's executive/major-shareholder ownership change
 * reports (Korea's Financial Supervisory Service, the rough equivalent of
 * SEC EDGAR). Built specifically because SKHY is a genuine foreign private
 * issuer exempt from Form 4/Section 16 reporting — there is no US insider
 * data source for it, so this fills that gap using Korea's own disclosure
 * regime instead.
 *
 * DESIGN NOTE: same philosophy as insiderScore.js — only genuine INCREASES
 * in ownership represent conviction; decreases are stored and surfaced as
 * context but never scored, for the same reasons (routine equity
 * compensation vesting/sales carry no signal). The one real difference from
 * Form 4: Korean disclosure never reports a transaction price, only share
 * count and ownership-percentage changes — so this signal cannot support a
 * position-context price comparison the way insiderScore.js/convictionScore.js
 * can (see signalPriceContext.js), and magnitude is scored off raw share
 * count rather than dollar value, since no price is available to compute one.
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const LOOKBACK_DAYS = 90;

async function getKoreaOwnershipSignal(ticker) {
  const { rows: changes } = await pool.query(
    `SELECT reporter_name, executive_title, is_major_shareholder, shares_held,
            shares_change, ownership_pct, ownership_pct_change, filing_date
       FROM korea_ownership_changes
      WHERE ticker = $1
        AND filing_date >= NOW() - INTERVAL '${LOOKBACK_DAYS} days'
      ORDER BY filing_date DESC`,
    [ticker]
  );

  const { rows: freshnessRows } = await pool.query(
    `SELECT MAX(fetched_at) AS last_checked FROM korea_ownership_changes WHERE ticker = $1`,
    [ticker]
  );
  const lastChecked = freshnessRows[0]?.last_checked || null;

  if (changes.length === 0) {
    return {
      ticker,
      confidenceScore: 0,
      hasSignal: false,
      label: 'No Data',
      explanation: `No executive/major-shareholder ownership reports on file for ${ticker} in the last ${LOOKBACK_DAYS} days.`,
      detail: { increaseCount: 0, decreaseCount: 0, lastChecked },
    };
  }

  const increases = changes.filter(c => Number(c.shares_change) > 0);
  const decreases = changes.filter(c => Number(c.shares_change) < 0);

  if (increases.length === 0) {
    return {
      ticker,
      confidenceScore: 0,
      hasSignal: false,
      label: 'No Buy Signal',
      explanation:
        `${decreases.length} ownership decrease(s) on file in the last ${LOOKBACK_DAYS} days, no increases. ` +
        `Decreases alone are not scored — executives reduce holdings for many routine reasons ` +
        `(equity compensation sales, tax obligations) that carry no directional signal. This signal ` +
        `activates only when a genuine ownership increase appears.`,
      detail: { increaseCount: 0, decreaseCount: decreases.length, lastChecked },
    };
  }

  const scoredIncreases = increases.map(scoreIncrease);
  const avgMagnitude = average(scoredIncreases.map(s => s.magnitudeScore));
  const timingScore = scoreTiming(increases);
  const corroborationScore = scoreCorroboration(increases);

  const confidenceScore = Math.round(
    avgMagnitude * 0.50 + corroborationScore * 0.30 + timingScore * 0.20
  );

  const distinctReporters = new Set(increases.map(i => i.reporter_name)).size;
  const totalSharesIncreased = increases.reduce((sum, i) => sum + Number(i.shares_change), 0);

  let label;
  if (confidenceScore >= 80) label = 'High Conviction';
  else if (confidenceScore >= 50) label = 'Moderate Conviction';
  else label = 'Low Conviction / Possible Noise';

  let explanation =
    `${increases.length} executive/major-shareholder ownership increase(s) from ${distinctReporters} ` +
    `reporter(s) in the last ${LOOKBACK_DAYS} days, ${totalSharesIncreased.toLocaleString()} shares total. ` +
    scoredIncreases.map(s => s.note).join(' ');

  if (distinctReporters >= 2) {
    explanation += ' Multiple reporters increased holdings in the same window — corroborated.';
  } else {
    explanation += ' Only one reporter increased holdings — no corroboration from others yet.';
  }

  if (decreases.length > 0) {
    explanation += ` (${decreases.length} decrease(s) also on file — not scored.)`;
  }

  explanation += ' Korean disclosure reports share-count changes only, not transaction price — ' +
    'unlike the US insider/institutional signals, there is no price to compare against a cost basis here.';

  return {
    ticker,
    confidenceScore,
    hasSignal: true,
    label,
    explanation,
    detail: {
      increaseCount: increases.length,
      decreaseCount: decreases.length,
      distinctReporters,
      totalSharesIncreased,
      avgMagnitude,
      timingScore,
      corroborationScore,
      lastChecked,
    },
  };
}

function scoreIncrease(change) {
  const shares = Number(change.shares_change) || 0;

  let magnitudeScore;
  if (shares >= 5000) magnitudeScore = 90;
  else if (shares >= 1000) magnitudeScore = 70;
  else if (shares >= 200) magnitudeScore = 50;
  else magnitudeScore = 30;

  const titleNote = change.is_major_shareholder ? 'major shareholder' : (change.executive_title || 'reporter');

  return {
    magnitudeScore,
    note: `${change.reporter_name} (${titleNote}) increased holdings by ${shares.toLocaleString()} shares.`,
  };
}

function scoreTiming(increases) {
  const mostRecent = increases.map(i => new Date(i.filing_date)).sort((a, b) => b - a)[0];
  const daysAgo = (Date.now() - mostRecent.getTime()) / (1000 * 60 * 60 * 24);

  if (daysAgo <= 14) return 90;
  if (daysAgo <= 30) return 70;
  if (daysAgo <= 60) return 50;
  return 30;
}

function scoreCorroboration(increases) {
  const distinctReporters = new Set(increases.map(i => i.reporter_name)).size;
  if (distinctReporters >= 3) return 90;
  if (distinctReporters === 2) return 70;
  return 40;
}

function average(nums) {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

module.exports = { getKoreaOwnershipSignal };
