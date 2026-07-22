/**
 * aiTakeScore.js
 *
 * "Ask Claude" — a genuine conversational take on the stock, as if the user
 * asked about it directly in chat. Deliberately separate from every other
 * Claude call in this codebase: signalExplainer.js and noiseScore.js are
 * restricted to restating only the structured facts they're given, but this
 * is allowed to draw on Claude's own broader knowledge and give an actual
 * opinion — closer to what a knowledgeable, honest friend would say if
 * asked "what do you think about this stock right now."
 *
 * It's still handed the tool's own computed signals/price data as context so
 * the take is grounded in what's actually been found, not detached from it —
 * but it's explicitly told it may disagree with the tool's own verdict, and
 * to be upfront about uncertainty rather than performing false confidence.
 * Never scored or averaged into convictionScore — this is commentary, not a
 * measured signal, and the frontend must label it as such.
 */

const Anthropic = require('@anthropic-ai/sdk');
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

async function getAiTake({ ticker, companyName, quote, profile, convictionScore, tier, bottomLine, plainParts, priceTarget }) {
  if (!anthropic) {
    return {
      available: false,
      text: 'AI commentary is unavailable right now (no API key configured).',
    };
  }

  const context = {
    ticker,
    companyName,
    price: quote?.price,
    changePercent: quote?.changePercent,
    marketCap: profile?.marketCap,
    industry: profile?.industry,
    toolsConvictionScore: convictionScore,
    toolsTier: tier,
    toolsVerdict: bottomLine?.verdict,
    activeSignalSummary: plainParts,
    analystPriceTarget: priceTarget?.available
      ? { mean: priceTarget.mean, upsidePct: priceTarget.upsidePct, numAnalysts: priceTarget.numAnalysts }
      : null,
  };

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 350,
      system:
        'A retail investor is asking you directly, in chat, what you think about a stock they\'re ' +
        'tracking. Give your own honest, conversational take in 3-5 sentences — not a recitation of the ' +
        'data you\'re given, an actual opinion informed by it plus your own knowledge of the company, ' +
        'industry, and risks. You may agree or disagree with this tool\'s own computed verdict; say so ' +
        'plainly if you do. Be direct about uncertainty and about what would change your mind — don\'t ' +
        'perform confidence you don\'t have. Plain, casual, no hedging filler, no "as an AI", no financial ' +
        'advice disclaimers (the product already labels this as commentary, not advice). Prose only, no ' +
        'bullet points.',
      messages: [{ role: 'user', content: JSON.stringify(context) }],
    });

    const text = message.content.find(b => b.type === 'text')?.text?.trim();
    return { available: true, text: text || 'No response generated.' };
  } catch (err) {
    console.error(`AI take generation failed for ${ticker}:`, err);
    return { available: false, text: 'AI commentary failed to generate this time — try reloading.' };
  }
}

module.exports = { getAiTake };
