/**
 * noiseScore.js
 *
 * "Real vs. Noise" verdict — synthesizes the active signals and price
 * target into one plain-English read: is this genuine conviction worth
 * acting on, or noise/incomplete evidence to wait out?
 *
 * Does NOT re-derive signal content itself — takes the already-assembled
 * plain-English signal summary (plainParts.join(' ')) and price target data,
 * and wraps them with a headline verdict + closing reasoning sentence.
 */

function getVerdict({ activeCount, statuses, priceTarget }) {
  const total = 6;
  const positiveCount = statuses.filter(s => s === 'positive').length;
  const negativeCount = statuses.filter(s => s === 'negative').length;
  const disagrees = positiveCount > 0 && negativeCount > 0;

  let headline;
  let reasoning;
  let badge;

  if (activeCount === 0) {
    badge = 'No Data';
    headline = 'NO EVIDENCE YET — NOTHING TO ACT ON';
    reasoning = `No signals are active yet for this ticker. There's nothing here to base a decision on — this isn't a "no" or "yes," it's simply unmeasured.`;
  } else if (activeCount === 1) {
    badge = 'Low Reliability';
    headline = "MOSTLY NOISE — DON'T ACT ON THIS YET";
    reasoning = `Only 1 of ${total} signals is active, with nothing else to corroborate it. This is a single weak data point dressed up as a score — wait for more signals to activate before drawing any conclusion.`;
  } else if (disagrees) {
    badge = 'Signals Disagree';
    headline = 'MIXED SIGNALS — TREAT WITH CAUTION';
    reasoning = `${activeCount} of ${total} signals are active, but they disagree — ${positiveCount} lean bullish, ${negativeCount} lean bearish. This is a genuine conflict in the evidence, not a clean read. Don't trust the blended score alone; weigh the individual signals yourself before acting.`;
  } else if (activeCount >= 4) {
    badge = 'High Reliability';
    headline = 'REAL SIGNAL — WORTH ACTING ON';
    reasoning = `${activeCount} of ${total} signals are active and mostly agree. This is broad, corroborated evidence, not a single data point — worth taking seriously, though no signal set guarantees an outcome.`;
  } else {
    badge = 'Moderate Reliability';
    headline = 'REAL, BUT INCOMPLETE — WATCH CLOSELY';
    reasoning = `${activeCount} of ${total} signals are active and generally agree. There's a real, if incomplete, case here — but half the picture is still missing, so this isn't strong enough to act on aggressively yet.`;
  }

  let priceTargetSentence = '';
  if (priceTarget?.available) {
    const direction = priceTarget.upsidePct >= 0 ? 'upside' : 'downside';
    priceTargetSentence = ` Combined with a ${Math.abs(priceTarget.upsidePct).toFixed(1)}% ${direction} to the average analyst price target ($${priceTarget.mean.toFixed(2)} from ${priceTarget.numAnalysts} analysts), this adds context to the picture above.`;
  }

  return { badge, headline, reasoning, priceTargetSentence };
}

module.exports = { getVerdict };
