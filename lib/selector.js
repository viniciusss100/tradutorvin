import { isSameLanguage } from "./language.js";

const SDH_RE = /(\bsdh\b|hearing\s*impaired|\bhi\b|\bcc\b|closed\s*captions|\bhic\b|eng\.?sdh|\.sdh\.)/i;
const FORCED_RE = /(\bforced\b|\bforce\b|\.forc?|foreign\s*parts|forced)/i;
const OCR_RE = /(\bocr\b|subs?\s*ocr|\bsc$)/i;
const ENC_PREF = ["utf-8", "utf8", "unicode", "utf-16", "bom"];

export function scoreSubtitle(cand, { targetLang = "pt" } = {}) {
  let score = 0;
  const name = [cand.filename, cand.movieReleaseName, cand.releaseOther || ""].filter(Boolean).join(" ").toLowerCase();
  const original = cand.raw?.subtitleFileName || cand.label || "";

  if (cand.lang) {
    if (isSameLanguage(cand.lang, "en")) score += 30;
    else score += 10;
    if (isSameLanguage(cand.lang, targetLang)) score -= 50;
  }
  if (cand.m === "i") score += 8;
  if (!/i|m/.test(cand.m || "i")) score -= 8;

  if (SDH_RE.test(name)) score -= 40;
  if (FORCED_RE.test(name)) score -= 45;
  if (OCR_RE.test(name)) score -= 30;

  if (ENC_PREF.some((e) => (cand.encoding || "").toLowerCase().includes(e))) score += 6;

  const fmt = (cand.format || "").toLowerCase();
  if (fmt === "srt") score += 4;
  else if (fmt === "vtt") score += 2;
  else if (fmt === "ass" || fmt === "ssa") score -= 1;

  if (cand.eventCount && cand.eventCount < 30) score -= 20;
  if (cand.eventDurationSec) {
    if (cand.eventDurationSec >= 900) score += 6;
    else if (cand.eventDurationSec >= 600) score += 4;
    else if (cand.eventDurationSec < 300) score -= 10;
  }

  if (/(1080p|720p|bluray|web-?dl|web-?rip|hdtv|brrip|bdrip|x264|x265|h\.264|h\.265|hevc|aac)/i.test(name)) score += 3;

  return score;
}

export function pickBest(candidates, opts = {}) {
  return (candidates || [])
    .map((c) => ({ ...c, _score: scoreSubtitle(c, opts) }))
    .sort((a, b) => b._score - a._score);
}

export function formatHint(cand) {
  const hints = [];
  if (cand.raw?.subtitleFileName) hints.push(cand.raw.subtitleFileName);
  if (cand.raw?.releaseFormat) hints.push(cand.raw.releaseFormat);
  if (cand.raw?.releaseGroup) hints.push(cand.raw.releaseGroup);
  return hints.join(" • ");
}