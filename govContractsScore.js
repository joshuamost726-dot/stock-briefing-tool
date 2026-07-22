/**
 * govContractsScore.js
 *
 * Government Contracts signal, from Quiver Quantitative's federal contract
 * award data.
 *
 * DESIGN NOTE: a company having ANY government contract history is not a
 * signal — LRCX's only rows are from 2008-2009. Only a contract reported in
 * the last two available quarters counts as "recent," since Quiver's data
 * is quarterly and lags real award dates. Scale is judged relative to the
 * ticker's OWN historical average contract size (not market cap, which
 * isn't available to this module) — a contract 3x a company's typical award
 * is a bigger deal for that company specifically than an absolute dollar
 * threshold would capture across very differently sized tickers.
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Federal fiscal quarters report ~1 quarter behind in practice; treat the
// two most recent quarters on file as "recent" the same way congressTradingScore
// treats a rolling window, since we don't get a transaction_date to window on.
const RECENT_QUARTERS = 2;

async function getGovContractsSignal(ticker) {
  const { rows } = await pool.query(
    `SELECT contract_year, contract_qtr, amount, fetched_at
       FROM gov_contracts
      WHERE ticker = $1
      ORDER BY contract_year DESC, contract_qtr DESC`,
    [ticker]
  );

  if (rows.length === 0) {
    return {
      ticker,
      confidenceScore: 0,
      hasSignal: false,
      label: 'No Data',
      explanation: `No federal government contracts on file for ${ticker}.`,
      detail: { contractCount: 0 },
    };
  }

  const lastChecked = rows[0].fetched_at;
  const sorted = [...rows].sort((a, b) =>
    b.contract_year - a.contract_year || b.contract_qtr - a.contract_qtr
  );
  const recent = sorted.slice(0, RECENT_QUARTERS);
  const older = sorted.slice(RECENT_QUARTERS);

  const mostRecent = sorted[0];
  const currentYear = new Date().getFullYear();
  const quartersAgo = (currentYear - mostRecent.contract_year) * 4 +
    (Math.ceil((new Date().getMonth() + 1) / 3) - mostRecent.contract_qtr);

  // Anything older than ~1 year (4 quarters incl. reporting lag) isn't "recent" activity.
  if (quartersAgo > 4) {
    return {
      ticker,
      confidenceScore: 0,
      hasSignal: false,
      label: 'No Recent Contracts',
      explanation:
        `${rows.length} historical government contract(s) on file for ${ticker}, ` +
        `most recent from ${mostRecent.contract_year} Q${mostRecent.contract_qtr} — too old to ` +
        `treat as an active signal.`,
      detail: { contractCount: rows.length, lastChecked },
    };
  }

  const recentTotal = recent.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const baseline = older.length > 0
    ? older.reduce((sum, r) => sum + (Number(r.amount) || 0), 0) / older.length
    : null;

  const timingScore = quartersAgo <= 1 ? 90 : quartersAgo <= 2 ? 70 : 40;

  let scaleScore;
  let scaleNote;
  if (baseline && baseline > 0) {
    const ratio = recentTotal / baseline;
    if (ratio >= 3) { scaleScore = 90; scaleNote = `${ratio.toFixed(1)}x this company's typical contract size.`; }
    else if (ratio >= 1.5) { scaleScore = 70; scaleNote = `${ratio.toFixed(1)}x this company's typical contract size.`; }
    else if (ratio >= 0.75) { scaleScore = 50; scaleNote = `In line with this company's typical contract size.`; }
    else { scaleScore = 30; scaleNote = `Smaller than this company's typical contract size.`; }
  } else {
    // No prior history to compare against — first contract on file.
    scaleScore = 55;
    scaleNote = 'No prior contract history for this company to compare against.';
  }

  const corroborationScore = recent.length >= RECENT_QUARTERS ? 70 : 40;

  const confidenceScore = Math.round(
    scaleScore * 0.50 + timingScore * 0.30 + corroborationScore * 0.20
  );

  let label;
  if (confidenceScore >= 70) label = 'Notable New Contract Activity';
  else if (confidenceScore >= 50) label = 'Moderate Contract Activity';
  else label = 'Low Conviction / Possible Noise';

  const explanation =
    `$${Math.round(recentTotal).toLocaleString()} in federal contracts reported for ` +
    `${ticker} in the last ${recent.length} quarter(s) on file (most recent: ` +
    `${mostRecent.contract_year} Q${mostRecent.contract_qtr}). ${scaleNote}`;

  return {
    ticker,
    confidenceScore,
    hasSignal: true,
    label,
    explanation,
    detail: {
      contractCount: rows.length,
      recentTotal,
      baseline,
      timingScore,
      scaleScore,
      corroborationScore,
      mostRecentPeriod: `${mostRecent.contract_year} Q${mostRecent.contract_qtr}`,
      lastChecked,
    },
  };
}

module.exports = { getGovContractsSignal };
