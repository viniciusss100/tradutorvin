import { parseSubtitles, stripBom } from "./parser.js";
import { normalizeCues } from "./syncer.js";
import { toSrt } from "./serializer.js";
import { translateUnits } from "./translator.js";
import { decodeBuffer } from "./http.js";

const MAX_SUBTITLE_CHARS = Number(process.env.MAX_SUBTITLE_CHARS || 500000);
const TRANSLATE_BUDGET_MS = Number(process.env.TRANSLATE_BUDGET_MS || 9000);

export async function translateSubtitleText(rawText, { from = "auto", to = "pt", apiKey = null, offsetMs = 0, budgetMs = TRANSLATE_BUDGET_MS } = {}) {
  const stats = { startedAt: Date.now(), format: null, events: 0, partial: false };
  const src = stripBom(String(rawText || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
  if (!src.trim()) {
    stats.error = "subtítulo vazio";
    return { srt: "", events: 0, stats };
  }
  if (src.length > MAX_SUBTITLE_CHARS) {
    stats.error = `subtítulo grande demais (${src.length} chars)`;
    return { srt: "", events: 0, stats };
  }

  const parsed = parseSubtitles(src);
  stats.format = parsed.format;
  let cues = normalizeCues(parsed.cues, stats);
  if (offsetMs && Number.isFinite(offsetMs)) {
    cues = cues.map((c) => ({ ...c, start: Math.max(0, c.start + offsetMs), end: Math.max(0, c.end + offsetMs) }));
    stats.syncOffsets = (stats.syncOffsets || 0) + 1;
  }
  stats.events = cues.length;

  const units = cues.map((c) => ({ text: c.text || "" }));
  const effectiveBudget = budgetMs - (Date.now() - stats.startedAt);
  const { results, stats: trStats } = await translateUnits(units, {
    from,
    to,
    apiKey,
    budgetMs: Math.max(1500, effectiveBudget),
  });
  Object.assign(stats, trStats);
  stats.translationMs = Date.now() - stats.startedAt;

  cues.forEach((c, i) => {
    c.text = results[i] ?? c.text;
  });

  const srt = toSrt(cues);
  const translatedRatio = stats.totalUnits ? stats.translatedUnits / stats.totalUnits : 0;
  stats.translatedRatio = translatedRatio;
  stats.partial = translatedRatio < 0.999;

  return { srt, events: cues.length, stats, cues };
}

export function decodeSubtitleText(buf, encodingHint) {
  let text = decodeBuffer(buf, encodingHint);
  if (!containsCue(text) && encodingHint && !/utf/i.test(encodingHint)) {
    const retry = decodeBuffer(buf, "utf-8");
    if (containsCue(retry)) text = retry;
  }
  return text;
}

function containsCue(text) {
  return /(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/.test(text.slice(0, 4000));
}

export async function translateSubtitleUrl(buf, { from, to, apiKey, offsetMs = 0, budgetMs, encoding }) {
  const text = decodeSubtitleText(buf, encoding);
  return translateSubtitleText(text, { from, to, apiKey, offsetMs, budgetMs });
}

export { toSrt };