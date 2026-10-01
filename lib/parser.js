export function detectFormat(text) {
  const t = stripBom(String(text || ""));
  if (/^\uFEFF?WEBVTT\b/.test(t)) return "vtt";
  if (/^\[Script Info\]/m.test(t) || /^\[V4\+? ?Styles\]/m.test(t) || /^\[Events\]/m.test(t)) return "ass";
  if (/Dialogue:\s*\d+,/m.test(t)) return "ass";
  if (/(?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*(?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{1,3}/.test(t)) return "srt";
  return "srt";
}

export function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function parseSubtitles(text) {
  const src = stripBom(String(text || "")).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!src.trim()) return { format: "srt", cues: [], notes: [] };
  const format = detectFormat(src);
  if (format === "vtt") return parseVtt(src);
  if (format === "ass") return parseAss(src);
  return parseSrt(src);
}

export function parseSrt(src) {
  const cues = [];
  const notes = [];
  const blocks = src.split(/\n{2,}/);
  for (const rawBlock of blocks) {
    const block = rawBlock.replace(/^\n+|\n+$/g, "");
    if (!block) continue;
    const lines = block.split("\n");
    let idx = 0;
    if (/^\d+$/.test(lines[0].trim())) idx = 1;
    const timeLine = lines[idx];
    if (!timeLine || !timeLine.includes("-->")) {
      notes.push("block sem timing ignorado");
      continue;
    }
    const m = timeLine.match(/(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/);
    if (!m) {
      notes.push("timing inválido ignorado");
      continue;
    }
    const start = timeToMs(m[1]);
    const end = timeToMs(m[2]);
    const text = lines.slice(idx + 1).join("\n").replace(/^\n+|\n+$/g, "");
    cues.push({ index: cues.length + 1, start, end, text });
  }
  return { format: "srt", cues, notes };
}

export function parseVtt(src) {
  const cues = [];
  const notes = [];
  const headerEnd = src.indexOf("\n\n");
  const payload = headerEnd > 0 ? src.slice(headerEnd + 2) : src;
  const blocks = payload.split(/\n{2,}/);
  for (const block of blocks) {
    const b = block.replace(/^\n+|\n+$/g, "");
    if (!b) continue;
    if (/^(NOTE|STYLE|REGION)\b/.test(b)) continue;
    const lines = b.split("\n");
    let idx = 0;
    if (lines[0] && !lines[0].includes("-->")) idx = 1;
    const timeLine = lines[idx] || "";
    if (!timeLine.includes("-->")) continue;
    const m = timeLine.match(/(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/);
    if (!m) {
      notes.push("timing vtt inválido ignorado");
      continue;
    }
    const start = timeToMs(m[1]);
    const end = timeToMs(m[2]);
    const text = lines.slice(idx + 1).join("\n").replace(/^\n+|\n+$/g, "");
    cues.push({ index: cues.length + 1, start, end, text });
  }
  return { format: "vtt", cues, notes };
}

const ASS_DIALOGUE = /^Dialogue:\s*(.*)$/;

export function parseAss(src) {
  const cues = [];
  const notes = [];
  const headerEnd = src.search(/^Dialogue:/m);
  const header = headerEnd > 0 ? src.slice(0, headerEnd) : "";
  let textIdx = null;
  let startIdx = null;
  let endIdx = null;
  const eventsIdx = src.search(/^\[Events\]/m);
  const eventsFormatEnd = headerEnd > 0 ? headerEnd : src.length;
  if (eventsIdx >= 0) {
    const fmtMatch = /^Format:\s*(.+)$/mi.exec(src.slice(eventsIdx, eventsFormatEnd));
    if (fmtMatch) {
      const fields = fmtMatch[1].split(",").map((f) => f.trim());
      const ti = fields.indexOf("Text");
      textIdx = ti >= 0 ? ti : fields.length - 1;
      const si = fields.indexOf("Start");
      startIdx = si >= 0 ? si : null;
      const ei = fields.indexOf("End");
      endIdx = ei >= 0 ? ei : null;
    }
  }
  for (const line of src.split("\n")) {
    const m = ASS_DIALOGUE.exec(line);
    if (!m) continue;
    const content = m[1].trim();
    if (!content) continue;
    const startIdxF = startIdx !== null ? startIdx : 1;
    const endIdxF = endIdx !== null ? endIdx : 2;
    const textIdxF = textIdx !== null ? textIdx : 7;
    const values = content.split(",");
    if (values.length < Math.max(startIdxF, endIdxF, textIdxF) + 1) {
      notes.push("dialogue ASS ignorado (campos insuficientes)");
      continue;
    }
    const start = assTimeToMs(values[startIdxF]);
    const end = assTimeToMs(values[endIdxF]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      notes.push("timing ASS inválido ignorado");
      continue;
    }
    const text = values.slice(textIdxF).join(",").replace(/\\N/gi, "\n").replace(/\\n/gi, "\n");
    cues.push({ index: cues.length + 1, start, end, text });
  }
  return { format: "ass", cues, notes, header };
}

export function timeToMs(t) {
  const m = /^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/.exec(t.trim());
  if (!m) return NaN;
  return ((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) * 1000 + parseInt(m[4].padEnd(3, "0").slice(0, 3), 10);
}

export function assTimeToMs(t) {
  const m = /^(\d+):(\d{2}):(\d{2})\.(\d{1,2})$/.exec(t.trim());
  if (!m) return NaN;
  return ((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) * 1000 + (+m[4]) * 10;
}

export function msToSrtTime(ms) {
  const v = Math.max(0, Math.round(ms));
  const h = Math.floor(v / 3600000);
  const mi = Math.floor((v % 3600000) / 60000);
  const s = Math.floor((v % 60000) / 1000);
  const mmm = v % 1000;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(mmm).padStart(3, "0")}`;
}

export function msToVttTime(ms) {
  return msToSrtTime(ms).replace(",", ".");
}