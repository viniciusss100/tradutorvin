import { translateSubtitleText } from "./pipeline.js";

export async function translateSrt(srtText, from = "en", to = "pt", apiKey = null, opts = {}) {
  const { srt, events, stats } = await translateSubtitleText(srtText, {
    from,
    to,
    apiKey,
    offsetMs: 0,
    budgetMs: opts.budgetMs,
  });
  return srt;
}

export default { translateSrt };