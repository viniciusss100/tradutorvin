import { msToSrtTime, msToVttTime, timeToMs } from "./parser.js";

export function validateCue(cue) {
  if (typeof cue.start !== "number" || typeof cue.end !== "number" || !Number.isFinite(cue.start) || !Number.isFinite(cue.end)) return false;
  if (cue.start < 0 || cue.end < 0) return false;
  if (cue.end <= cue.start) return false;
  return true;
}

export function toSrt(cues, { dedupeAdjacent = false } = {}) {
  const valid = (cues || []).filter(validateCue);
  let prevText = null;
  const parts = [];
  for (let i = 0; i < valid.length; i++) {
    const c = valid[i];
    const text = normalizeText(c.text);
    if (!text && !dedupeAdjacent) {
      parts.push(`${i + 1}\n${msToSrtTime(c.start)} --> ${msToSrtTime(c.end)}\n`);
      prevText = null;
      continue;
    }
    if (dedupeAdjacent && text && text === prevText) {
      parts.push(`${i + 1}\n${msToSrtTime(c.start)} --> ${msToSrtTime(c.end)}\n${text}\n`);
      prevText = text;
      continue;
    }
    parts.push(`${i + 1}\n${msToSrtTime(c.start)} --> ${msToSrtTime(c.end)}\n${text}\n`);
    prevText = text;
  }
  return parts.join("\n");
}

export function toVtt(cues) {
  const valid = (cues || []).filter(validateCue);
  const parts = ["WEBVTT", ""];
  for (let i = 0; i < valid.length; i++) {
    const c = valid[i];
    parts.push(`${msToVttTime(c.start)} --> ${msToVttTime(c.end)}`);
    const text = normalizeText(c.text);
    if (text) parts.push(text);
    parts.push("");
  }
  return parts.join("\n");
}

function normalizeText(text) {
  return String(text == null ? "" : text).replace(/\r/g, "");
}

export function countCues(srt) {
  let n = 0;
  for (const line of String(srt || "").split("\n")) {
    if (line.includes("-->")) n++;
  }
  return n;
}