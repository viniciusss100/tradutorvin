import { createHash } from "node:crypto";

const TTL_DEFAULT_MS = Number(process.env.CACHE_TTL_MS || 6 * 60 * 60 * 1000);
const MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES || 3000);

const store = new Map();

export function cacheGet(key) {
  const e = store.get(String(key));
  if (!e) return null;
  if (Date.now() > e.exp) {
    store.delete(String(key));
    return null;
  }
  e.access = Date.now();
  return e.value;
}

export function cacheSet(key, value, ttlMs = TTL_DEFAULT_MS) {
  const k = String(key);
  if (store.has(k)) store.delete(k);
  else if (store.size >= MAX_ENTRIES) {
    let oldest = null;
    for (const [ck, ce] of store) {
      if (!oldest || ce.access < oldest.access) oldest = ce;
    }
    if (oldest) store.delete(oldest[0]);
  }
  store.set(k, { value, exp: Date.now() + ttlMs, access: Date.now() });
  return value;
}

export function cacheDelete(key) {
  store.delete(String(key));
}

export function cacheInfo() {
  return { entries: store.size, max: MAX_ENTRIES, ttlMs: TTL_DEFAULT_MS };
}

export function sha1(str) {
  return createHash("sha1").update(String(str)).digest("hex");
}