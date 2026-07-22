/**
 * congressTradingScore.js
 *
 * Congressional Trading signal, scored against STOCK Act disclosures
 * (Quiver Quantitative).
 *
 * DESIGN NOTE: same philosophy as insiderScore.js — only open-market
 * PURCHASES represent genuine conviction. Sales, partial sales, and
 * exchanges are surfaced as context but never scored, since members of
 * Congress sell for many routine reasons unrelated to conviction.
 *
 * Unlike insiderScore.js, this query is windowed to the last 180 days.
 * Congress trading history in this table goes back over a decade for
 * liquid tickers — without a window, corroboration/scale would be
 * dominated by stale purchases and the score would barely move day to
 * day. STOCK Act disclosures can lag up to 45 days behind the actual
 * trade, so 180 days gives a meaningful but still "recent" signal window.
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const LOOKBACK_DAYS = 180;

async function getCongressTradingSignal(ticker) {
  const { rows: transactions } = await pool.query(
    `SELECT representative, party, chamber, transaction_date, transaction_type,
            amount, amount_range, fetched_at
       FROM congress_trades
      WHERE ticker = $1
        AND transaction_date >= NOW() - INTERVAL '${LOOKBACK_DAYS} days'
      ORDER BY transaction_date DESC`,
    [ticker]
  );

  const { rows: freshnessRows } = await pool.query(
    `SELECT MAX(fetched_at) AS last_checked FROM congress_trades WHERE ticker = $1`,
    [ticker]
  );
  const lastChecked = freshnessRows[0]?.last_checked || null;

  if (transactions.length === 0) {
    return {
      ticker,
      confidenceScore: 0,
      hasSignal: false,
      label: 'No Data',
      explanation: `No congressional trading disclosures on file for ${ticker} in the last ${LOOKBACK_DAYS} days.`,
      detail: { buyCount: 0, sellCount: 0, lastChecked },
    };
  }

  const buys = transactions.filter(t => t.transaction_type === 'Purchase');
  const sells = transactions.filter(t => t.transaction_type !== 'Purchase');

  if (buys.length === 0) {
    return {
      ticker,
      confidenceScore: 0,
      hasSignal: false,
      label: 'No Buy Signal',
      explanation:
        `${sells.length} sale(s)/exchange(s) on file in the last ${LOOKBACK_DAYS} days, no purchases. ` +
        `Sell activity alone is not scored — members of Congress sell for many routine reasons ` +
        `(diversification, liquidity, blind trusts) that carry no directional signal. This signal ` +
        `activates only when a genuine purchase appears.`,
      detail: { buyCount: 0, sellCount: sells.length, lastChecked },
    };
  }

  const scoredBuys = buys.map(scoreBuy);
  const avgScale = average(scoredBuys.map(b => b.scaleScore));
  const timingScore = scoreTiming(buys);
  const corroborationScore = scoreCorroboration(buys);

  const confidenceScore = Math.round(
    clamp(avgScale * 0.50 + corroborationScore * 0.30 + timingScore * 0.20, 0, 100)
  );

  const distinctBuyers = new Set(buys.map(b => b.representative)).size;
  const totalBuyValue = buys.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);

  let label;
  if (confidenceScore >= 80) label = 'High Conviction';
  else if (confidenceScore >= 50) label = 'Moderate Conviction';
  else label = 'Low Conviction / Possible Noise';

  let explanation = `${buys.length} congressional purchase(s) from ${distinctBuyers} member(s) ` +
    `of Congress in the last ${LOOKBACK_DAYS} days, $${Math.round(totalBuyValue).toLocaleString()}+ total ` +
    `(disclosed as ranges, not exact amounts). ` +
    scoredBuys.map(b => b.note).join(' ');

  if (distinctBuyers >= 2) {
    explanation += ' Multiple members bought in the same window — corroborated.';
  } else {
    explanation += ' Only one member bought — no corroboration from others yet.';
  }

  if (sells.length > 0) {
    explanation += ` (${sells.length} sale(s)/exchange(s) also on file — not scored.)`;
  }

  return {
    ticker,
    confidenceScore,
    hasSignal: true,
    label,
    explanation,
    detail: {
      buyCount: buys.length,
      sellCount: sells.length,
      distinctBuyers,
      totalBuyValue,
      avgScale,
      timingScore,
      corroborationScore,
      lastChecked,
    },
  };
}

function scoreBuy(buy) {
  const value = Number(buy.amount) || 0;

  let scaleScore;
  if (value >= 250000) scaleScore = 95;
  else if (value >= 50000) scaleScore = 85;
  else if (value >= 15000) scaleScore = 65;
  else if (value >= 1000) scaleScore = 45;
  else scaleScore = 30;

  return {
    scaleScore,
    note: `${buy.representative} (${buy.party || 'unknown party'}, ${buy.chamber || 'Congress'}) ` +
          `disclosed a purchase in the ${buy.amount_range || 'unspecified'} range.`,
  };
}

function scoreTiming(buys) {
  const mostRecent = buys.map(b => new Date(b.transaction_date)).sort((a, b) => b - a)[0];
  const daysAgo = (Date.now() - mostRecent.getTime()) / (1000 * 60 * 60 * 24);

  // Wider thresholds than insiderScore.js's — STOCK Act disclosures can lag
  // up to 45 days behind the actual trade, so "recent" means something
  // different here than for same-week Form 4 filings.
  if (daysAgo <= 30) return 90;
  if (daysAgo <= 60) return 70;
  if (daysAgo <= 90) return 50;
  return 30;
}

function scoreCorroboration(buys) {
  const distinctBuyers = new Set(buys.map(b => b.representative)).size;
  if (distinctBuyers >= 3) return 90;
  if (distinctBuyers === 2) return 70;
  return 40;
}

function average(nums) {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

module.exports = { getCongressTradingSignal };
