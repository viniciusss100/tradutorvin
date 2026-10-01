import { fetchBuffer } from "./http.js";
import { warn, error } from "./logger.js";
import { retry } from "./http.js";

const DEFAULT_HOSTS = ["translate.googleapis.com", "translate.google.com", "translate.google.com.br"];
const MAX_BATCH_CHARS = Number(process.env.MAX_BATCH_CHARS || 6000);
const MAX_BATCH_UNITS = Number(process.env.MAX_BATCH_UNITS || 800);
const TRANSLATE_TIMEOUT_MS = Number(process.env.TRANSLATE_TIMEOUT_MS || 6000);

const TAG_RE = /(<\/?(?:i|b|u|em|strong|font\b[^>]*|c[.\w]*|v[.\w]*)[^>]*>)|(\{\\[ibu][\d-]+\})/gi;

function protectTags(text) {
  const map = [];
  const out = String(text || "").replace(TAG_RE, (m) => {
    map.push(m);
    return `\u0001T${map.length - 1}\u0001`;
  });
  return { text: out, map };
}

function restoreTags(text, map) {
  return String(text || "").replace(/\u0001T(\d+)\u0001/g, (_, i) => map[Number(i)] ?? "");
}

function isTextualLine(line) {
  return /[A-Za-zÀ-ÿα-ωА-Яא-ת0-9]/u.test(line);
}

function protectNonTextLines(text) {
  const lines = String(text || "").split("\n");
  return lines.map((l) => (isTextualLine(l) ? l : `\u0001N${JSON.stringify(l)}\u0001`)).join("\n");
}

function restoreNonTextLines(text) {
  return String(text || "").replace(/\u0001N("[^"]*")\u0001/g, (_, json) => {
    try {
      return JSON.parse(json);
    } catch {
      return "";
    }
  });
}

let fakeTranslator = null;
export function __setFakeTranslator(fn) {
  fakeTranslator = fn;
}

async function callAny(query, opts) {
  if (fakeTranslator) return fakeTranslator(query, { from: opts.from, to: opts.to });
  if (opts.apiKey) {
    const text = await callOfficialV2(query, opts);
    opts.onEngine?.("google-official");
    return text;
  }
  const engines = engineResolver();
  let lastErr = null;
  for (const engine of engines) {
    try {
      const text = await engine.fn(query, opts);
      opts.onEngine?.(engine.name);
      return text;
    } catch (e) {
      lastErr = e;
      warn("engine", engine.name, "falhou:", e.status || e.message);
    }
  }
  throw lastErr || new Error("todos os engines de tradução falharam");
}

const ENGINE_RESOLVER = [
  { name: "google-gtx", fn: googleGtxEngine },
  { name: "google-chrome", fn: googleChromeEngine },
  { name: "mymemory", fn: myMemoryEngine },
];

function engineResolver() {
  const order = String(process.env.TRANSLATION_ENGINES || "google-gtx,google-chrome,mymemory")
    .split(",").map((s) => s.trim()).filter(Boolean);
  return order.map((n) => ENGINE_RESOLVER.find((e) => e.name === n)).filter(Boolean);
}

async function googleGtxEngine(query, opts) {
  let lastErr = null;
  for (const host of DEFAULT_HOSTS) {
    try {
      const url = `https://${host}/translate_a/single`;
      const form = new URLSearchParams();
      form.set("client", "gtx");
      form.set("sl", opts.from || "auto");
      form.set("tl", opts.to || "pt");
      form.set("dt", "t");
      form.set("q", query);
      const buf = await fetchBuffer(url, {
        timeoutMs: opts.timeoutMs || TRANSLATE_TIMEOUT_MS,
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8", "User-Agent": "Mozilla/5.0" },
        maxBytes: 1024 * 1024,
        method: "POST",
        body: form.toString(),
      });
      const arr = JSON.parse(new TextDecoder("utf-8").decode(buf));
      const translated = extractTranslations(arr);
      if (translated.length === 0) throw new Error("tradução vazia");
      return translated.join("");
    } catch (e) {
      lastErr = e;
      warn("gtx falhou no host", host, e.status || e.message);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw lastErr || new Error("gtx indisponível");
}

async function googleChromeEngine(query, opts) {
  const chunks = chunkLinesByChars(String(query).split("\n"), 1300);
  let lastErr = null;
  const out = [];
  for (const chunkLines of chunks) {
    const q = chunkLines.join("\n");
    for (const host of ["clients5.google.com", "translate.google.com"]) {
      try {
        const url = `https://${host}/translate_a/t?client=dict-chrome-ex&sl=${encodeURIComponent(opts.from || "auto")}&tl=${encodeURIComponent(opts.to || "pt")}&q=${encodeURIComponent(q)}`;
        const buf = await fetchBuffer(url, {
          timeoutMs: opts.timeoutMs || TRANSLATE_TIMEOUT_MS,
          headers: { "User-Agent": "Mozilla/5.0" },
          maxBytes: 512 * 1024,
        });
        const arr = JSON.parse(new TextDecoder("utf-8").decode(buf));
        if (!Array.isArray(arr)) throw new Error("resposta chrome inválida");
        const joined = arr.map((x) => String(x)).join("");
        if (!joined) throw new Error("resposta chrome vazia");
        out.push(joined);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        warn("chrome engine falhou no host", host, e.status || e.message);
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    if (lastErr) throw lastErr;
  }
  return out.join("\n");
}

function chunkLinesByChars(lines, maxChars) {
  const chunks = [];
  let cur = [];
  let curChars = 0;
  for (const l of lines) {
    const size = l.length + 1;
    if (cur.length && curChars + size > maxChars) {
      chunks.push(cur);
      cur = [];
      curChars = 0;
    }
    cur.push(l);
    curChars += size;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

async function myMemoryEngine(query, opts) {
  const chunks = chunkLinesByChars(String(query).split("\n"), 450);

  const out = [];
  for (let c = 0; c < chunks.length; c++) {
    const chunkQ = chunks[c].join("\n");
    const params = new URLSearchParams({ q: chunkQ, langpair: `${opts.from === "auto" ? "en" : opts.from}|${opts.to || "pt"}` });
    const buf = await retry(() => fetchBuffer(`https://api.mymemory.translated.net/get?${params}`, {
      timeoutMs: opts.timeoutMs || TRANSLATE_TIMEOUT_MS,
      headers: { "User-Agent": "Mozilla/5.0" },
      maxBytes: 1024 * 1024,
    }), { retries: 1, baseDelay: 250, maxDelay: 800, onRetry: opts.onRetry });
    const json = JSON.parse(new TextDecoder("utf-8").decode(buf));
    const translatedText = json?.responseData?.translatedText;
    if (typeof translatedText !== "string") throw new Error("mymemory sem tradução");
    out.push(translatedText);
  }
  return out.join("\n");
}

async function callOfficialV2(query, { from, to, apiKey, timeoutMs }) {
  const oneLine = query.split("\n").join(" ");
  const params = new URLSearchParams({ key: apiKey, q: oneLine, target: to || "pt", format: "text" });
  if (from && from !== "auto") params.set("source", from);
  const url = `https://translation.googleapis.com/language/translate/v2?${params}`;
  const buf = await fetchBuffer(url, { timeoutMs: timeoutMs || TRANSLATE_TIMEOUT_MS, maxBytes: 1024 * 1024 });
  const json = JSON.parse(new TextDecoder("utf-8").decode(buf));
  const el = json?.data?.translations?.[0];
  if (!el) throw new Error("api oficial sem tradução");
  return el.translatedText;
}

function extractTranslations(arr) {
  const rows = Array.isArray(arr) && Array.isArray(arr[0]) ? arr[0] : Array.isArray(arr?.sentences) ? arr.sentences : [];
  const out = [];
  for (const row of rows) {
    if (Array.isArray(row) && row[0] != null) out.push(String(row[0]));
  }
  return out;
}

function splitBatches(units) {
  const batches = [];
  let cur = [];
  let curChars = 0;
  for (const u of units) {
    const size = u.text.length + 1;
    if (cur.length && (curChars + size > MAX_BATCH_CHARS || cur.length >= MAX_BATCH_UNITS)) {
      batches.push(cur);
      cur = [];
      curChars = 0;
    }
    cur.push(u);
    curChars += size;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

export async function translateUnits(units, opts = {}) {
  const stats = { totalUnits: units.length, translatedUnits: 0, batches: 0, failures: 0, retries: 0 };
  const enginesUsed = new Set();
  if (!units.length) return { results: [], stats };
  const batches = splitBatches(units);
  const results = new Array(units.length).fill(null);
  const deadline = opts.budgetMs ? Date.now() + opts.budgetMs : Infinity;

  const indexOf = new Map();
  units.forEach((u, i) => indexOf.set(u, i));

  for (let b = 0; b < batches.length; b++) {
    if (Date.now() > deadline) {
      stats.budgetExceeded = true;
      for (let i = b; i < batches.length; i++) {
        for (const u of batches[i]) {
          results[indexOf.get(u)] = u.text;
          stats.failures++;
        }
      }
      break;
    }
    stats.batches++;
    const indexes = batches[b].map((u) => indexOf.get(u));
    const prepared = batches[b].map((u) => protectTags(protectNonTextLines(u.text)));
    const texts = prepared.map((p) => p.text);
    const tagMaps = prepared.map((p) => p.map);

    const items = await translateUnitList(prepared.map((p) => p.text), {
      from: opts.from,
      to: opts.to,
      apiKey: opts.apiKey,
      timeoutMs: opts.timeoutMs,
      onRetry: () => stats.retries++,
      onEngine: (n) => enginesUsed.add(n),
      depth: 0,
    });

    for (let i = 0; i < texts.length; i++) {
      if (items[i] == null) {
        results[indexes[i]] = units[indexes[i]].text;
        stats.failures++;
        continue;
      }
      try {
        const restored = restoreTags(restoreNonTextLines(items[i]), tagMaps[i]);
        results[indexes[i]] = restored;
        stats.translatedUnits++;
      } catch {
        results[indexes[i]] = units[indexes[i]].text;
        stats.failures++;
      }
    }
  }
  stats.enginesUsed = [...enginesUsed];
  return { results, stats };
}

async function translateUnitList(texts, opts) {
  if (!texts.length) return [];
  const joined = texts.join("\n");
  let out;
  try {
    out = await retry(() => callAny(joined, opts), {
      retries: opts.depth > 0 ? 0 : 1,
      baseDelay: 200,
      maxDelay: 800,
      onRetry: opts.onRetry,
    });
  } catch (e) {
    if (opts.depth === 0) warn("lote falhou", texts.length, "linhas; tentando isolar:", e.message);
    if (opts.depth >= 14) {
      const out = [];
      for (const t of texts) {
        try {
          const solo = await retry(() => callAny(t, opts), { retries: 0, baseDelay: 0, maxDelay: 0, onRetry: opts.onRetry });
          out.push(solo);
        } catch {
          out.push(null);
        }
      }
      return out;
    }
    if (texts.length <= 1) return texts.map(() => null);
    const half = Math.floor(texts.length / 2);
    const left = await translateUnitList(texts.slice(0, half), { ...opts, depth: opts.depth + 1 });
    const right = await translateUnitList(texts.slice(half), { ...opts, depth: opts.depth + 1 });
    return [...left, ...right];
  }
  const lineCounts = texts.map((t) => t.split("\n").length);
  return remapLines(lineCounts, String(out).split("\n"), joined);
}

function remapLines(lineCounts, translatedLines, originalJoined) {
  const totalWanted = lineCounts.reduce((a, b) => a + b, 0);
  let lines = translatedLines.slice();
  if (lines.length !== totalWanted) {
    lines = balanceLines(lines.join("\n"), totalWanted);
  }
  const out = [];
  let idx = 0;
  for (let i = 0; i < lineCounts.length; i++) {
    const n = Math.max(1, lineCounts[i]);
    let item = null;
    if (idx + n <= lines.length) {
      item = lines.slice(idx, idx + n).join("\n");
      idx += n;
    } else if (idx < lines.length) {
      item = lines.slice(idx).join("\n");
      idx = lines.length;
    }
    out.push(item);
  }
  if (idx < lines.length && out.length) {
    const extra = lines.slice(idx).join("\n");
    out[out.length - 1] = out[out.length - 1] ? out[out.length - 1] + "\n" + extra : extra;
  }
  return out;
}

function balanceLines(text, count) {
  const base = text.split("\n");
  if (base.length <= count) return base.concat(new Array(count - base.length).fill(""));
  const avg = Math.ceil(base.length / count);
  const out = [];
  let i = 0;
  while (i < base.length && out.length < count - 1) {
    const chunk = base.slice(i, i + avg).join("\n");
    out.push(chunk);
    i += avg;
  }
  if (i < base.length) out.push(base.slice(i).join("\n"));
  while (out.length < count) out.push("");
  return out;
}

export { callAny as translateEngine, protectTags, restoreTags };