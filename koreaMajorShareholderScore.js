/**
 * koreaMajorShareholderScore.js
 *
 * Korea Major Shareholder signal — SK Hynix's institutional-buying
 * equivalent, scored against Open DART's large shareholding reports
 * (triggered when a fund crosses a 5% ownership threshold, Korea's rough
 * equivalent of a 13D/G). Built for the same reason as
 * koreaOwnershipScore.js: SKHY is a genuine foreign private issuer with no
 * US 13F coverage of its own institutional ownership.
 *
 * DESIGN NOTE: unlike koreaOwnershipScore.js (executive ownership, where
 * only increases count — sells are routine compensation liquidity), a fund
 * actively reducing a 5%+ stake is a real portfolio decision, not routine.
 * So this treats both increases AND decreases as meaningful direction,
 * mirroring convictionScore.js's bidirectional momentum scoring for US 13F
 * data rather than insiderScore.js's asymmetric "only buys count" one.
 * These events are also much sparser than executive filings (roughly a
 * handful per year, not per month), so the lookback window is a full year
 * rather than 90 days — otherwise this would show "no data" almost always.
 * Same limitation as koreaOwnershipScore.js: no price data, share-count/
 * ownership-% only.
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const LOOKBACK_DAYS = 365;

async function getKoreaMajorShareholderSignal(ticker) {
  const { rows: filings } = await pool.query(
    `SELECT reporter_name, shares_held, shares_change, ownership_pct,
            ownership_pct_change, report_reason, filing_date
       FROM korea_major_shareholders
      WHERE ticker = $1
        AND filing_date >= NOW() - INTERVAL '${LOOKBACK_DAYS} days'
      ORDER BY filing_date DESC`,
    [ticker]
  );

  const { rows: freshnessRows } = await pool.query(
    `SELECT MAX(fetched_at) AS last_checked FROM korea_major_shareholders WHERE ticker = $1`,
    [ticker]
  );
  const lastChecked = freshnessRows[0]?.last_checked || null;

  if (filings.length === 0) {
    return {
      ticker,
      confidenceScore: 0,
      hasSignal: false,
      label: 'No Data',
      explanation: `No major shareholder filings (5%+ ownership threshold crossings) on file for ${ticker} in the last ${LOOKBACK_DAYS} days.`,
      detail: { filingCount: 0, lastChecked },
    };
  }

  const increases = filings.filter(f => Number(f.shares_change) > 0);
  const decreases = filings.filter(f => Number(f.shares_change) < 0);

  const distinctReporters = new Set(filings.map(f => f.reporter_name)).size;
  const netPct = (increases.length / filings.length) * 100;
  const direction = netPct > 55 ? 'increasing' : netPct < 45 ? 'decreasing' : 'mixed';

  let momentumScore;
  if (netPct > 65) momentumScore = 90;
  else if (netPct > 55) momentumScore = 70;
  else if (netPct > 45) momentumScore = 50;
  else if (netPct > 35) momentumScore = 30;
  else momentumScore = 15;

  const timingScore = scoreTiming(filings);
  const corroborationScore = distinctReporters >= 3 ? 90 : distinctReporters === 2 ? 70 : 40;

  const confidenceScore = Math.round(
    momentumScore * 0.55 + timingScore * 0.25 + corroborationScore * 0.20
  );

  let label;
  if (confidenceScore >= 70) label = 'Notable Institutional Activity';
  else if (confidenceScore >= 50) label = 'Moderate Institutional Activity';
  else label = 'Low Conviction / Possible Noise';

  const explanation =
    `${filings.length} large-shareholder filing(s) (5%+ ownership threshold crossings) from ` +
    `${distinctReporters} institution(s) in the last ${LOOKBACK_DAYS} days: ${increases.length} increased, ` +
    `${decreases.length} decreased their stake — net direction is ${direction}. ` +
    filings.slice(0, 3).map(f =>
      `${f.reporter_name} ${Number(f.shares_change) > 0 ? 'increased' : 'decreased'} to ${Number(f.ownership_pct).toFixed(2)}% ownership.`
    ).join(' ') +
    ' Korean disclosure reports share-count/ownership-% changes only, not transaction price — ' +
    'unlike the US institutional signal, there is no implied price here.';

  return {
    ticker,
    confidenceScore,
    hasSignal: true,
    label,
    direction,
    explanation,
    detail: {
      filingCount: filings.length,
      increaseCount: increases.length,
      decreaseCount: decreases.length,
      distinctReporters,
      momentumScore,
      timingScore,
      corroborationScore,
      lastChecked,
    },
  };
}

function scoreTiming(filings) {
  const mostRecent = filings.map(f => new Date(f.filing_date)).sort((a, b) => b - a)[0];
  const daysAgo = (Date.now() - mostRecent.getTime()) / (1000 * 60 * 60 * 24);

  if (daysAgo <= 90) return 90;
  if (daysAgo <= 180) return 70;
  if (daysAgo <= 270) return 50;
  return 30;
}

module.exports = { getKoreaMajorShareholderSignal };
