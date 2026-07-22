/**
 * wsbSentimentScore.js
 *
 * Retail Attention (WallStreetBets/Reddit) signal, from ApeWisdom's free
 * public mention-tracking API (no key required, covers r/wallstreetbets and
 * related trading subreddits).
 *
 * DESIGN NOTE: ApeWisdom reports MENTION VOLUME, not sentiment polarity — it
 * doesn't tell you whether the chatter is bullish or bearish, only that
 * attention exists and how it's moving. Treat this like short interest and
 * off-exchange volume: report magnitude/direction of the attention spike as
 * context, not as a bullish/bearish call. A mention spike can precede a
 * genuine momentum move or a pump-and-dump — this signal cannot tell the
 * difference, and says so. Requires a minimum absolute mention count before
 * scoring anything, since 1-2 stray mentions in a niche subreddit isn't
 * meaningful retail attention.
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const MIN_HISTORY_DAYS = 5;
const MIN_MENTIONS_FOR_SIGNAL = 5;

async function getWsbSentimentSignal(ticker) {
  const { rows } = await pool.query(
    `SELECT snapshot_date, mentions, rank, upvotes
       FROM wsb_mentions
      WHERE ticker = $1
      ORDER BY snapshot_date DESC
      LIMIT 21`,
    [ticker]
  );

  if (rows.length === 0) {
    return {
      ticker,
      confidenceScore: 0,
      hasSignal: false,
      label: 'No Data',
      explanation: `No Reddit/WallStreetBets mention data on file for ${ticker}.`,
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
        `Only ${rows.length} day(s) of Reddit mention data on file for ${ticker} — ` +
        `need at least ${MIN_HISTORY_DAYS} to judge whether today's mention count is unusual.`,
      detail: { daysAvailable: rows.length, daysNeeded: MIN_HISTORY_DAYS },
    };
  }

  const today = rows[0];
  const history = rows.slice(1);

  const rawDate = today.snapshot_date;
  const snapshotDateStr = rawDate instanceof Date
    ? rawDate.toISOString().slice(0, 10)
    : String(rawDate).slice(0, 10);

  const todayMentions = Number(today.mentions) || 0;
  const avgMentions = average(history.map(r => Number(r.mentions) || 0));

  if (todayMentions < MIN_MENTIONS_FOR_SIGNAL && avgMentions < MIN_MENTIONS_FOR_SIGNAL) {
    return {
      ticker,
      confidenceScore: 0,
      hasSignal: false,
      label: 'Below Noise Floor',
      explanation:
        `${ticker} has negligible Reddit/WallStreetBets chatter (${todayMentions} mention(s) today, ` +
        `${avgMentions.toFixed(1)} average over the last ${history.length} days) — too little volume to read.`,
      detail: { todayMentions, avgMentions, daysOfHistory: history.length },
    };
  }

  const mentionRatio = avgMentions > 0 ? todayMentions / avgMentions : (todayMentions > 0 ? 3 : 0);
  const direction = mentionRatio > 1.3 ? 'increasing' : mentionRatio < 0.7 ? 'decreasing' : 'flat';

  let magnitudeScore;
  if (mentionRatio >= 4) magnitudeScore = 90;
  else if (mentionRatio >= 2.5) magnitudeScore = 75;
  else if (mentionRatio >= 1.5) magnitudeScore = 55;
  else magnitudeScore = 30;

  // Absolute scale matters too — 20 mentions is a real spike for a name
  // that's usually invisible on WSB; scale bonus keyed off today's rank when available.
  const todayRank = today.rank != null ? Number(today.rank) : null;
  let rankScore = 40;
  if (todayRank != null) {
    if (todayRank <= 20) rankScore = 90;
    else if (todayRank <= 50) rankScore = 70;
    else if (todayRank <= 150) rankScore = 50;
    else rankScore = 30;
  }

  const confidenceScore = Math.round(magnitudeScore * 0.6 + rankScore * 0.4);

  let label;
  if (confidenceScore >= 75) label = 'Elevated Retail Attention';
  else if (confidenceScore >= 50) label = 'Moderate Retail Attention';
  else label = 'Low / Baseline Attention';

  const explanation =
    `${todayMentions} Reddit/WallStreetBets mention(s) today` +
    (todayRank != null ? ` (rank #${todayRank} across tracked subreddits)` : '') +
    `, vs a ${history.length}-day average of ${avgMentions.toFixed(1)} — attention is ${direction}. ` +
    `This tracks mention VOLUME only, not sentiment — it does not indicate whether the chatter is ` +
    `bullish or bearish, and a spike can precede genuine momentum or a pump-and-dump just as easily.`;

  return {
    ticker,
    confidenceScore,
    hasSignal: true,
    label,
    direction,
    explanation,
    detail: {
      todayMentions,
      avgMentions,
      mentionRatio,
      todayRank,
      magnitudeScore,
      rankScore,
      daysOfHistory: history.length,
      lastChecked: snapshotDateStr,
    },
  };
}

function average(nums) {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

module.exports = { getWsbSentimentSignal };
