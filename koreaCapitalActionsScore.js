/**
 * koreaCapitalActionsScore.js
 *
 * Korea Capital Actions signal — tracks SK Hynix's own buyback and share
 * issuance decisions via Open DART's material matters reports. Built to
 * fill a real gap: SKHY has no US buyback/offering disclosure of its own.
 *
 * DESIGN NOTE: buybacks and issuances are opposite-direction corporate
 * actions bundled into one signal, since they're really "two sides of the
 * same coin" — the company directly changing its own share count. A
 * buyback is unambiguously bullish (the company thinks its own stock is
 * undervalued). A share issuance is more nuanced — dilutive to existing
 * holders in isolation, but the STATED PURPOSE matters enormously: funding
 * growth capex (e.g. new fab capacity during an industry upswing) reads
 * very differently from funding debt repayment or an operating shortfall.
 * This module reports the facts (direction, dilution magnitude, purpose)
 * and leaves that judgment call to the Claude explainer rather than
 * collapsing it into a single "bad" score.
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const LOOKBACK_DAYS = 180;

const PURPOSE_LABELS = {
  facility: 'facility/capex investment',
  business_acquisition: 'business acquisition',
  operating: 'general operating funds',
  debt_repayment: 'debt repayment',
  securities_acquisition: 'securities acquisition',
  other: 'unspecified purposes',
};

async function getKoreaCapitalActionsSignal(ticker) {
  const { rows: actions } = await pool.query(
    `SELECT rcept_no, action_type, shares_involved, shares_outstanding_before,
            purpose, fetched_at
       FROM korea_capital_actions
      WHERE ticker = $1
      ORDER BY fetched_at DESC`,
    [ticker]
  );

  const { rows: freshnessRows } = await pool.query(
    `SELECT MAX(fetched_at) AS last_checked FROM korea_capital_actions WHERE ticker = $1`,
    [ticker]
  );
  const lastChecked = freshnessRows[0]?.last_checked || null;

  // fetched_at tracks when we pulled the row, not the filing date (these
  // report types don't return a receipt date in a convenient field the way
  // the equity-disclosure endpoints do) — treat "recent" as recently seen
  // in our own fetch history, which runs daily, so this is a reasonable
  // proxy for filing recency.
  const recent = actions.filter(a => {
    const daysAgo = (Date.now() - new Date(a.fetched_at).getTime()) / (1000 * 60 * 60 * 24);
    return daysAgo <= LOOKBACK_DAYS;
  });

  if (recent.length === 0) {
    return {
      ticker,
      confidenceScore: 0,
      hasSignal: false,
      label: 'No Data',
      explanation: `No buyback or share issuance decisions on file for ${ticker}.`,
      detail: { actionCount: 0, lastChecked },
    };
  }

  const buybacks = recent.filter(a => a.action_type === 'buyback_direct' || a.action_type === 'buyback_trust');
  const issuances = recent.filter(a => a.action_type === 'issuance');

  let direction;
  if (buybacks.length > 0 && issuances.length === 0) direction = 'buyback';
  else if (issuances.length > 0 && buybacks.length === 0) direction = 'issuance';
  else direction = 'mixed';

  let confidenceScore;
  let explanation;

  if (direction === 'issuance') {
    const latest = issuances[0];
    const shares = Number(latest.shares_involved) || 0;
    const before = Number(latest.shares_outstanding_before) || 0;
    const dilutionPct = before > 0 ? (shares / before) * 100 : null;

    let magnitudeScore;
    if (dilutionPct == null) magnitudeScore = 50;
    else if (dilutionPct >= 5) magnitudeScore = 90;
    else if (dilutionPct >= 2) magnitudeScore = 70;
    else if (dilutionPct >= 0.5) magnitudeScore = 50;
    else magnitudeScore = 30;

    confidenceScore = magnitudeScore;
    const purposeLabel = PURPOSE_LABELS[latest.purpose] || 'unspecified purposes';

    explanation = `${ticker} filed a new share issuance decision for ${shares.toLocaleString()} shares` +
      (dilutionPct != null ? ` (${dilutionPct.toFixed(1)}% dilution vs. ${before.toLocaleString()} shares outstanding)` : '') +
      `, stated purpose: ${purposeLabel}. Share issuances dilute existing holders, but whether that's ` +
      `concerning depends heavily on purpose — funding growth investment reads very differently from ` +
      `funding a cash shortfall or debt repayment.` +
      (issuances.length > 1 ? ` (${issuances.length} issuance decisions on file in this window.)` : '');
  } else if (direction === 'buyback') {
    const totalShares = buybacks.reduce((sum, b) => sum + (Number(b.shares_involved) || 0), 0);

    let magnitudeScore;
    if (totalShares >= 5000000) magnitudeScore = 90;
    else if (totalShares >= 1000000) magnitudeScore = 70;
    else if (totalShares >= 100000) magnitudeScore = 50;
    else magnitudeScore = 30;

    confidenceScore = magnitudeScore;
    explanation = `${ticker} filed ${buybacks.length} buyback decision(s) totaling ${totalShares.toLocaleString()} ` +
      `shares in this window — a company buying back its own stock is a direct statement that management ` +
      `sees it as undervalued.`;
  } else {
    confidenceScore = 50;
    explanation = `${ticker} has both buyback (${buybacks.length}) and issuance (${issuances.length}) decisions ` +
      `on file in this window — genuinely mixed signals about the company's own view of its share count/value.`;
  }

  let label;
  if (direction === 'buyback') label = confidenceScore >= 70 ? 'Notable Buyback Activity' : 'Modest Buyback Activity';
  else if (direction === 'issuance') label = confidenceScore >= 70 ? 'Significant Dilution' : 'Modest Dilution';
  else label = 'Mixed Capital Actions';

  return {
    ticker,
    confidenceScore,
    hasSignal: true,
    label,
    direction,
    explanation,
    detail: {
      actionCount: recent.length,
      buybackCount: buybacks.length,
      issuanceCount: issuances.length,
      lastChecked,
    },
  };
}

module.exports = { getKoreaCapitalActionsSignal };
