/**
 * newsExplainer.js
 *
 * Takes a batch of news headlines for a ticker and asks Claude, in one call,
 * "what does this mean for the stock" for each — one sentence per article.
 *
 * DESIGN NOTE: unlike signalExplainer.js (which only rewrites structured
 * facts we already computed), this is allowed to draw on Claude's own
 * background knowledge of the company/industry to explain WHY a headline
 * might matter — a headline alone often doesn't say that. It's still
 * grounded in the actual headline/description given, not free-floating
 * speculation. Batched into a single call (all articles at once) rather
 * than one call per article, to keep cost proportional to a page load, not
 * to article count. Falls back to no blurb (title-only) per article if the
 * call fails or the response doesn't parse — never blocks the news list
 * from rendering.
 */

const Anthropic = require('@anthropic-ai/sdk');
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

async function explainNewsForTicker(ticker, companyName, articles) {
  if (!articles || articles.length === 0) return articles;

  if (!anthropic) {
    return articles.map(a => ({ ...a, whatItMeans: null }));
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 500,
      system:
        `You explain news headlines to a retail investor holding or watching ${companyName || ticker} ` +
        `(ticker ${ticker}). For each article given, write ONE short sentence: what this headline might ` +
        `mean for the stock specifically, drawing on your own knowledge of the company/industry as needed. ` +
        `If a headline is genuinely unrelated to the stock's investment case (e.g. a coincidental name ` +
        `match, or trivia not about the business), say so plainly instead of forcing a connection. No ` +
        `hedging filler, no "as an AI". Respond with ONLY a JSON array of strings, one per input article, ` +
        `in the same order — no other text.`,
      messages: [{
        role: 'user',
        content: JSON.stringify(articles.map(a => ({ title: a.title, description: a.description }))),
      }],
    });

    const text = message.content.find(b => b.type === 'text')?.text?.trim() || '[]';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const explanations = JSON.parse(jsonMatch ? jsonMatch[0] : text);

    return articles.map((a, i) => ({
      ...a,
      whatItMeans: typeof explanations[i] === 'string' ? explanations[i] : null,
    }));
  } catch (err) {
    console.error(`News explanation failed for ${ticker}, showing headlines only:`, err);
    return articles.map(a => ({ ...a, whatItMeans: null }));
  }
}

module.exports = { explainNewsForTicker };
