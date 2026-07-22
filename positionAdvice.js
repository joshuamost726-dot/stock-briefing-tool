/**
 * positionAdvice.js
 *
 * Phase 6 (see TASKS.md) — adjusts the raw signal-based tier/action based on
 * the user's actual position status (no position / in profit / at a loss),
 * rather than just rewording the same score for everyone.
 *
 * DESIGN NOTE: the core risk this guards against is chasing — a BUY call
 * that's correct for someone with no position can be a bad idea for someone
 * who already has one, in either direction:
 *   - already in profit: buying more on a merely-decent score risks piling
 *     onto a stock that's already worked, right when it's most tempting to.
 *   - already at a loss: buying more is "averaging down," which risks
 *     throwing money after a losing thesis rather than a genuine reassessment.
 * Averaging down gets the HIGHER conviction bar of the two (85 vs 80),
 * since catching a falling position is the riskier of the two chase
 * patterns. SELL/HOLD calls are never blocked by position status — only
 * BUY calls get raised bars, and only when a position already exists.
 * A small +/-0.5% band around cost basis is treated as breakeven (~no
 * position bias) to avoid flip-flopping on noise right at cost.
 */

const PROFIT_BUY_THRESHOLD = 80;
const LOSS_BUY_THRESHOLD = 85;
const BREAKEVEN_BAND_PCT = 0.5;

function getPositionStatus(currentPrice, position) {
  if (!position || !position.costPerShare || !position.shares) return 'none';

  const gainPct = ((currentPrice - position.costPerShare) / position.costPerShare) * 100;

  if (Math.abs(gainPct) <= BREAKEVEN_BAND_PCT) return 'breakeven';
  return gainPct > 0 ? 'profit' : 'loss';
}

function applyPositionAwareAdvice({ score, tier, action, currentPrice, position }) {
  const positionStatus = getPositionStatus(currentPrice, position);

  const gainLoss = (position && position.costPerShare && position.shares)
    ? {
        dollarPerShare: currentPrice - position.costPerShare,
        dollarTotal: (currentPrice - position.costPerShare) * position.shares,
        percent: ((currentPrice - position.costPerShare) / position.costPerShare) * 100,
      }
    : null;

  const base = { rawTier: tier, rawAction: action, positionStatus, gainLoss, adjusted: false };

  if (positionStatus === 'none' || positionStatus === 'breakeven' || action !== 'BUY') {
    return {
      ...base,
      tier,
      action,
      explanation: positionStatus === 'none'
        ? null
        : positionStatus === 'breakeven'
        ? `You're roughly at breakeven on this position — treated the same as having no position for this call.`
        : action === 'SELL'
        ? `You're ${positionStatus === 'profit' ? 'up' : 'down'} ${Math.abs(gainLoss.percent).toFixed(1)}% — this call already points to selling, so position status doesn't need to soften or sharpen it further.`
        : `You're ${positionStatus === 'profit' ? 'up' : 'down'} ${Math.abs(gainLoss.percent).toFixed(1)}% — a HOLD call doesn't need position-based adjustment either way.`,
    };
  }

  if (positionStatus === 'profit') {
    if (score < PROFIT_BUY_THRESHOLD) {
      return {
        ...base,
        tier: 'Moderate',
        action: 'HOLD',
        adjusted: true,
        explanation:
          `Raw signals say BUY, but you're already up ${gainLoss.percent.toFixed(1)}% on this position. ` +
          `A score of ${score} isn't strong enough to justify buying more of a stock that's already worked ` +
          `for you — downgraded to HOLD to avoid chasing.`,
      };
    }
    return {
      ...base,
      tier,
      action,
      explanation:
        `You're already up ${gainLoss.percent.toFixed(1)}%, but conviction here is strong enough ` +
        `(score ${score}) that adding more may still be reasonable — just size it knowing you're adding to a winner.`,
    };
  }

  // positionStatus === 'loss'
  if (score < LOSS_BUY_THRESHOLD) {
    return {
      ...base,
      tier: 'Moderate',
      action: 'HOLD',
      adjusted: true,
      explanation:
        `Raw signals say BUY, but you're down ${Math.abs(gainLoss.percent).toFixed(1)}% on this position. ` +
        `Averaging down needs stronger evidence than a score of ${score} — downgraded to HOLD rather than ` +
        `risk throwing more money at a losing thesis.`,
    };
  }
  return {
    ...base,
    tier,
    action,
    explanation:
      `You're down ${Math.abs(gainLoss.percent).toFixed(1)}%, but conviction here is very strong ` +
      `(score ${score}) — this could be a legitimate case for averaging down rather than just chasing a ` +
      `loss. Still, size carefully.`,
  };
}

module.exports = { applyPositionAwareAdvice, getPositionStatus };
