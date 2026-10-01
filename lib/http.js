import { warn, error } from "./logger.js";

const UA = "Mozilla/5.0 (compatible; StremioTranslator/3.0)";

export const DEFAULT_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 9000);
export const MAX_SUBTITLE_BYTES = Number(process.env.MAX_SUBTITLE_BYTES || 6 * 1024 * 1024);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fakeDownload = null;
export function __setFakeDownload(fn) {
  fakeDownload = fn;
}

export async function fetchBuffer(url, { timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = MAX_SUBTITLE_BYTES, headers = {}, method = "GET", body = null, redirect = "follow", allowNonOk = false } = {}) {
  if (fakeDownload) return fakeDownload(url, { timeoutMs, maxBytes, headers, method, body });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      redirect,
      signal: ctrl.signal,
      headers: { "User-Agent": UA, ...headers },
      method,
      body,
    });
    clearTimeout(t);
  } catch (e) {
    clearTimeout(t);
    const cause = e.name === "AbortError" ? `timeout ${timeoutMs}ms` : e.message;
    throw new HttpError(0, `download failed: ${cause}`, url);
  }
  if (!allowNonOk && !res.ok) {
    throw new HttpError(res.status, `http ${res.status}`, url);
  }

  const cl = Number(res.headers.get("content-length") || 0);
  if (cl > maxBytes) throw new HttpError(413, `subtitle too large: ${cl} bytes`, url);

  const chunks = [];
  let total = 0;
  const reader = res.body?.getReader?.();
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new HttpError(413, "subtitle too large", url);
    return buf;
  }
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await ctrl.abort();
      throw new HttpError(413, "subtitle too large", url);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function fetchText(url, opts = {}) {
  const buf = await fetchBuffer(url, opts);
  return decodeBuffer(buf, opts.encoding);
}

export function decodeBuffer(buf, encoding) {
  const enc = normalizeEncoding(encoding);
  const candidates = [enc, "utf-8", "utf-16le"].filter((v, i, arr) => v && arr.indexOf(v) === i);
  for (const c of candidates) {
    try {
      const text = new TextDecoder(c, { fatal: true }).decode(buf);
      if (c !== "utf-8" || !text.includes("\uFFFD")) {
        if (c === "utf-16le") {
          const check = new TextDecoder("utf-8", { fatal: true }).decode(buf);
          if (isBinary(check)) continue;
        }
        return text;
      }
    } catch {
      /* tenta próximo encoding */
    }
  }
  return new TextDecoder("utf-8").decode(buf);
}

function normalizeEncoding(enc) {
  if (!enc) return "utf-8";
  const e = String(enc).toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (e.startsWith("windows-1252") || e.startsWith("cp1252") || e === "cp-1252" || e === "latin1" || e === "latin-1" || e === "iso-8859-1" || e === "iso88591") return "windows-1252";
  if (e.startsWith("gb18030") || e.startsWith("gb2312") || e.startsWith("gbk")) return "gb18030";
  if (e === "utf16" || e === "utf-16" || e.startsWith("unicode")) return "utf-16le";
  if (e.startsWith("iso-8859") || e.startsWith("cp850") || e.startsWith("cp437")) return "windows-1252";
  return "utf-8";
}

function isBinary(text) {
  return text.includes("\u0000") || (text.match(/[\u0000-\u0008\u000E-\u001F]/g) || []).length > text.length * 0.05;
}

export class HttpError extends Error {
  constructor(status, message, url) {
    super(message);
    this.status = status;
    this.url = url;
  }
}

export const isTemporary = (status) =>
  status === 429 || status === 408 || status === 500 || status === 502 || status === 503 || status === 504 || status === 0;

export async function retry(fn, { retries = 2, baseDelay = 400, maxDelay = 4000, shouldRetry } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const backoff = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1)) + Math.floor(Math.random() * 150);
      await sleep(backoff);
    }
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      if (shouldRetry && !shouldRetry(e)) throw e;
      if (!isTemporary(e.status)) throw e;
      error(typeof e.message === "string" ? e.message : "retry attempt failed", "attempt", attempt);
    }
  }
  throw lastErr;
}

export function validateSubtitleUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();
    if (host === "subs5.strem.io" || host === "subs4.strem.io" || host === "subs.strem.io" || host.endsWith(".strem.io")) return true;
    if (host === "dl.opensubtitles.org" || host === "www.opensubtitles.org") return true;
    if (host.endsWith(".opensubtitles.org")) return true;
    if (host === "raw.githubusercontent.com") return process.env.ALLOW_TEST_URLS === "1";
    return false;
  } catch {
    return false;
  }
}

export { warn, error };