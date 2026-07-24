/**
 * technicalScore.js
 *
 * Technical Momentum signal — 50-day vs. 200-day moving average trend, 52-
 * week range position, and volume confirmation, computed from daily
 * close/volume history (fetch_technical_prices.py, via yfinance).
 *
 * DESIGN NOTE: this is the one signal in the whole app that doesn't depend
 * on any company's disclosure regime — no SEC, no FINRA, no Quiver, no
 * Korean equivalent. Built specifically because SKHY and CWBHF have very
 * thin coverage from every jurisdiction-specific source, but it applies to
 * every tracked ticker equally. Requires at least 200 days of price history
 * before scoring anything (a 200-day moving average needs that much data to
 * mean anything) — says so plainly rather than computing a misleading
 * average from a short window, same "Building History" pattern as
 * optionsVolumeScore.js/offExchangeScore.js.
 *
 * The classic "golden cross / death cross" framing (price vs. 50-day SMA,
 * 50-day SMA vs. 200-day SMA) is the trend read; 52-week range position and
 * a volume-vs-baseline ratio are reported as corroborating context, not
 * folded into one opaque number — a price near its 52-week high on rising
 * volume is a very different situation from the same price on fading
 * volume, and the explanation should be able to say so.
 *
 * CURRENCY NOTE: SKHY's price history here comes from SK Hynix's actual
 * Korea Exchange listing (000660.KS, priced in KRW), not the thin US OTC
 * ADR line the rest of the app quotes in USD (see fetch_technical_prices.py's
 * docstring for why) — a completely different price series/currency from
 * what the ticker detail page's header shows. Rather than mislabel or
 * awkwardly juggle two currencies, every figure below is expressed as a
 * percentage/relative position, never an absolute price level, so the
 * currency mismatch never needs to surface at all.
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const MIN_HISTORY_DAYS = 200;
const SHORT_MA_DAYS = 50;
const LONG_MA_DAYS = 200;
const RECENT_VOLUME_DAYS = 20;

async function getTechnicalSignal(ticker) {
  const { rows } = await pool.query(
    `SELECT trade_date, close, volume
       FROM daily_prices
      WHERE ticker = $1
      ORDER BY trade_date DESC
      LIMIT 260`,
    [ticker]
  );

  if (rows.length === 0) {
    return {
      ticker,
      confidenceScore: 0,
      hasSignal: false,
      label: 'No Data',
      explanation: `No daily price history on file for ${ticker}.`,
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
        `Only ${rows.length} trading day(s) of price history on file for ${ticker} — need at least ` +
        `${MIN_HISTORY_DAYS} for a 200-day moving average to mean anything. This signal will activate ` +
        `automatically as daily snapshots accumulate.`,
      detail: { daysAvailable: rows.length, daysNeeded: MIN_HISTORY_DAYS },
    };
  }

  // rows[0] is most recent (DESC order)
  const closes = rows.map(r => Number(r.close));
  const volumes = rows.map(r => Number(r.volume));
  const currentPrice = closes[0];

  const shortMA = average(closes.slice(0, SHORT_MA_DAYS));
  const longMA = average(closes.slice(0, LONG_MA_DAYS));

  const yearHigh = Math.max(...closes);
  const yearLow = Math.min(...closes);
  const rangePosition = yearHigh > yearLow ? ((currentPrice - yearLow) / (yearHigh - yearLow)) * 100 : 50;

  const recentAvgVolume = average(volumes.slice(0, RECENT_VOLUME_DAYS));
  const baselineAvgVolume = average(volumes);
  const volumeRatio = baselineAvgVolume > 0 ? recentAvgVolume / baselineAvgVolume : 1;

  const priceAboveShortMA = currentPrice > shortMA;
  const shortAboveLongMA = shortMA > longMA;

  let trendScore, direction;
  if (priceAboveShortMA && shortAboveLongMA) {
    trendScore = 90; direction = 'bullish';
  } else if (priceAboveShortMA && !shortAboveLongMA) {
    trendScore = 60; direction = 'bullish';
  } else if (!priceAboveShortMA && shortAboveLongMA) {
    trendScore = 40; direction = 'bearish';
  } else {
    trendScore = 15; direction = 'bearish';
  }

  // Volume confirms the trend when it's elevated (>1.2x baseline) — a move
  // on fading volume (<0.8x) is weaker evidence either way.
  let volumeConfirmationScore;
  if (volumeRatio >= 1.5) volumeConfirmationScore = 90;
  else if (volumeRatio >= 1.2) volumeConfirmationScore = 70;
  else if (volumeRatio >= 0.8) volumeConfirmationScore = 50;
  else volumeConfirmationScore = 30;

  const confidenceScore = Math.round(trendScore * 0.65 + volumeConfirmationScore * 0.35);

  let label;
  if (direction === 'bullish' && confidenceScore >= 70) label = 'Uptrend Confirmed';
  else if (direction === 'bullish') label = 'Modest Uptrend';
  else if (direction === 'bearish' && confidenceScore <= 35) label = 'Downtrend Confirmed';
  else label = 'Modest Downtrend';

  const pctVsShortMA = shortMA > 0 ? ((currentPrice - shortMA) / shortMA) * 100 : 0;
  const shortVsLongPct = longMA > 0 ? ((shortMA - longMA) / longMA) * 100 : 0;

  const explanation =
    `${ticker} is trading ${Math.abs(pctVsShortMA).toFixed(1)}% ${priceAboveShortMA ? 'above' : 'below'} its ` +
    `${SHORT_MA_DAYS}-day average, and that ${SHORT_MA_DAYS}-day average is ${Math.abs(shortVsLongPct).toFixed(1)}% ` +
    `${shortAboveLongMA ? 'above' : 'below'} the ${LONG_MA_DAYS}-day average — a classic ` +
    `${shortAboveLongMA ? '"golden cross"' : '"death cross"'} trend setup. Currently at ` +
    `${rangePosition.toFixed(0)}% of its 52-week range (0% = the 52-week low, 100% = the 52-week high). ` +
    `Recent volume is ${(volumeRatio * 100).toFixed(0)}% of the ${rows.length}-day baseline — ` +
    (volumeRatio >= 1.2
      ? 'elevated volume adds real conviction behind this move.'
      : volumeRatio < 0.8
      ? 'below-average volume means this trend lacks strong participation right now.'
      : 'roughly normal participation, no strong confirmation either way.');

  return {
    ticker,
    confidenceScore,
    hasSignal: true,
    label,
    direction,
    explanation,
    detail: {
      currentPrice,
      shortMA,
      longMA,
      yearHigh,
      yearLow,
      rangePosition,
      volumeRatio,
      trendScore,
      volumeConfirmationScore,
      daysOfHistory: rows.length,
      lastChecked: rows[0].trade_date,
    },
  };
}

function average(nums) {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

module.exports = { getTechnicalSignal };
