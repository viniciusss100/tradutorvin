import { timeToMs } from "./parser.js";

const MAX_CUE_DURATION_MS = Number(process.env.MAX_CUE_DURATION_MS || 12000);
const MIN_CUE_DURATION_MS = 80;
const MAX_GAP_MS = Number(process.env.MAX_GAP_MS || 10000);

export function normalizeCues(cues, stats) {
  const out = (cues || []).map((c, i) => ({ ...c, originalIndex: i }));
  const fixes = [];

  for (const c of out) {
    if (!Number.isFinite(c.start) || !Number.isFinite(c.end)) {
      fixes.push("timestamp inválido resetado");
      c.start = 0;
      c.end = 0;
      c.broken = true;
    }
    if (c.start < 0) {
      fixes.push("start negativo zerado");
      c.start = 0;
    }
    if (c.end < c.start) {
      fixes.push("end < start ajustado");
      c.end = Math.max(c.start, c.end);
    }
    if (c.end - c.start < MIN_CUE_DURATION_MS) {
      fixes.push("duração mínima aplicada");
      c.end = c.start + MIN_CUE_DURATION_MS;
    }
    if (c.end - c.start > MAX_CUE_DURATION_MS) {
      fixes.push("duração máxima aplicada");
      c.end = c.start + MAX_CUE_DURATION_MS;
    }
  }

  out.sort((a, b) => (a.start - b.start) || (a.originalIndex - b.originalIndex));

  let prevEnd = -1;
  for (const c of out) {
    if (c.broken) continue;
    if (prevEnd > 0 && c.start < prevEnd) {
      fixes.push(`overlap corrigido em ${c.index}`);
      c.start = prevEnd;
      if (c.end <= c.start) c.end = c.start + MIN_CUE_DURATION_MS;
    }
    prevEnd = Math.max(prevEnd, c.end);
  }

  const last = out[out.length - 1];
  if (last && last.end > 24 * 3600 * 1000) fixes.push("subtítulo muito longo truncado");

  if (stats) stats.syncFixes = fixes;
  return out;
}

const tokenRe = /[A-Za-zÀ-ÿ0-9']+/g;
function tokensOf(text) {
  return (String(text || "").match(tokenRe) || []).map((t) => t.toLowerCase());
}

export function textSimilarity(a, b) {
  const ta = tokensOf(a);
  const tb = tokensOf(b);
  if (!ta.length || !tb.length) return 0;
  const small = ta.length <= tb.length ? ta : tb;
  const set = new Set((ta.length <= tb.length ? tb : ta));
  let hits = 0;
  for (const t of small) if (set.has(t)) hits++;
  return hits / Math.max(1, Math.max(ta.length, tb.length));
}

export function computeOffsets(refCues, targetCues, { maxOffsetMs = 15000, sampleSize = 250 } = {}) {
  const target = sampleEvenly(targetCues, sampleSize);
  const binSize = 250;
  const buckets = new Map();
  let bestBucket = null;
  let totalTokens = 0;

  for (const tcue of target) {
    const tt = tokensOf(tcue.text);
    if (!tt.length) continue;
    totalTokens += tt.length;
    const lo = tcue.start - maxOffsetMs;
    const hi = tcue.end + maxOffsetMs;
    let bestScore = 0;
    let bestOffset = 0;
    let seen = 0;
    for (const rc of refCues) {
      if (rc.end < lo || rc.start > hi) continue;
      seen++;
      if (seen > 400) break;
      const rset = new Set(tokensOf(rc.text));
      const overlapMs = Math.min(tcue.end, rc.end) - Math.max(tcue.start, rc.start);
      if (overlapMs <= 200) continue;
      let hits = 0;
      for (const t of tt) if (rset.has(t)) hits++;
      const score = (hits / Math.max(1, tt.length)) * (1 + overlapMs / 4000);
      if (score > bestScore) {
        bestScore = score;
        bestOffset = rc.start - tcue.start;
      }
    }
    if (bestScore < 0.2) continue;
    const bin = Math.round(bestOffset / binSize) * binSize;
    buckets.set(bin, (buckets.get(bin) || 0) + 1);
    if (!bestBucket || buckets.get(bin) > buckets.get(bestBucket)) bestBucket = bin;
  }

  if (!bestBucket) return null;
  const peakCount = buckets.get(bestBucket) || 0;
  return {
    offset: bestBucket,
    score: totalTokens ? Math.min(1, peakCount / Math.max(1, target.length)) : 0,
    samples: target.length,
    matchedBuckets: buckets.size,
    drift: 1,
  };
}

function sampleEvenly(arr, n) {
  if (!arr || arr.length <= n) return arr || [];
  const out = [];
  const step = (arr.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

export function applyOffset(cues, offsetMs) {
  return (cues || []).map((c) => ({
    ...c,
    start: Math.max(0, Math.round(c.start + offsetMs)),
    end: Math.max(0, Math.round(c.end + offsetMs)),
  }));
}