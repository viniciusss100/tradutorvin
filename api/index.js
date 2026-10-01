import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as provider from "../lib/provider.js";
import { translateSubtitleUrl } from "../lib/pipeline.js";
import { fetchBuffer, validateSubtitleUrl, retry } from "../lib/http.js";
import { cacheGet, cacheSet, sha1 } from "../lib/cache.js";
import { toBcp47, toGoogleLang, isSameLanguage } from "../lib/language.js";
import { pickBest, formatHint } from "../lib/selector.js";
import { toSrt } from "../lib/serializer.js";
import { parseSubtitles } from "../lib/parser.js";
import { normalizeCues } from "../lib/syncer.js";
import { info, warn, error } from "../lib/logger.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);

const SRC_LANG_OPTIONS = ["any|Detectar idioma automaticamente, em qualquer idioma", "eng|Inglês", "jpn|Japonês", "spa|Espanhol", "fra|Francês", "deu|Alemão", "ita|Italiano"];

const DST_LANG_OPTIONS = [{ code: "pt", label: "Português (Brasil)" }];

const DST_LANG_LABELS = { pt: "Português (Brasil)" };
const TARGET_LANG = "pt";

const BASE_MANIFEST = {
  id: "community.subtrans.autotranslate",
  version: "4.4.0",
  name: "Auto Translate Subtitles",
  description: "Traduz legendas automaticamente para Português (Brasil) via Google Translate / Gemini, preservando timestamps e sincronização.",
  logo: "/logo.svg",
  types: ["movie", "series"],
  catalogs: [],
  resources: [{ name: "subtitles", types: ["movie", "series"], idPrefixes: ["tt", "kitsu"] }],
  behaviorHints: { configurable: true, configurationRequired: true },
  config: [
    { key: "targetLang", type: "select", title: "Idioma de destino", options: DST_LANG_OPTIONS.map((o) => `${o.code}|${o.label}`), default: "pt|Português (Brasil)", required: true },
    { key: "srcLang", type: "select", title: "Idioma de origem preferido", options: SRC_LANG_OPTIONS, default: "any|Detectar idioma automaticamente, em qualquer idioma" },
    { key: "apiKey", type: "password", title: "Google Cloud Translation API Key (opcional — sem chave usa API gratuita)", required: false },
  ],
};

function parseUserData(b64) {
  if (!b64) return {};
  try {
    let json;
    try {
      json = Buffer.from(b64, "base64url").toString("utf8");
    } catch {
      json = Buffer.from(b64, "base64").toString("utf8");
    }
    if (!json.startsWith("{")) {
      json = Buffer.from(b64, "base64").toString("utf8");
    }
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function encodeUserData(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use((req, res, next) => {
  const safeUrl = req.url.replace(/\/([A-Za-z0-9_-]{16,})\//, "/<ud>/");
  info("REQ", req.method, safeUrl);
  next();
});

app.get("/health", (_, res) => res.json({ ok: true }));

app.get("/logo.svg", (_, res) => {
  res.setHeader("Content-Type", "image/svg+xml");
  res.send(readFileSync(join(__dir, "../public", "logo.svg")));
});

app.get("/configure", (_, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(readFileSync(join(__dir, "configure.html")));
});

function getBaseUrl(req) {
  return process.env.PUBLIC_URL || (req.protocol + "://" + req.get("host"));
}

app.get("/manifest.json", (req, res) => {
  res.json({ ...BASE_MANIFEST, logo: getBaseUrl(req) + "/logo.svg" });
});

app.get("/:userData/manifest.json", (req, res) => {
  const base = getBaseUrl(req);
  const ud = parseUserData(req.params.userData);
  res.json({
    ...BASE_MANIFEST,
    logo: base + "/logo.svg",
    id: `community.subtrans.autotranslate.${req.params.userData.slice(0, 8)}`,
    description: `Traduz legendas para ${DST_LANG_LABELS[TARGET_LANG]} via Google Translate / Gemini.`,
    behaviorHints: { configurable: true, configurationRequired: false },
  });
});

async function searchImdbByTitle(title) {
  try {
    const r = await fetch(
      "https://v3-cinemeta.strem.io/catalog/series/top/search=" + encodeURIComponent(title) + ".json",
      { signal: AbortSignal.timeout(5000) }
    );
    if (!r.ok) return null;
    const titleBase = title.toLowerCase().split(":")[0].trim().replace(/[()]/g, "");
    const j = await r.json();
    const match = (j.metas || []).find((m) => m.name?.toLowerCase().includes(titleBase) && m.imdb_id);
    if (match) {
      info("Cinemeta:", match.name, "->", match.imdb_id);
      return match.imdb_id;
    }
  } catch (e) {
    warn("Cinemeta falhou:", e.message);
  }
  return null;
}

async function walkToRoot(anilistId, depth = 0) {
  if (depth > 6) return { rootId: anilistId, depth };
  try {
    const r = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query($id:Int){Media(id:$id,type:ANIME){title{english romaji} format externalLinks{site url} relations{edges{relationType node{id format}}}}}`,
        variables: { id: parseInt(anilistId) },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return { rootId: anilistId, depth };
    const media = (await r.json()).data?.Media;
    const imdbDirect = media?.externalLinks?.find((l) => l.site === "IMDb" || l.url?.includes("imdb.com/title/"))?.url?.match(/tt\d+/)?.[0] || null;
    const prequel = media?.relations?.edges?.find((e) => e.relationType === "PREQUEL" && e.node.format !== "MOVIE");
    if (!prequel) return { rootId: anilistId, depth, title: media?.title, imdbDirect };
    return walkToRoot(prequel.node.id, depth + 1);
  } catch {
    return { rootId: anilistId, depth };
  }
}

async function resolveKitsuToImdb(kitsuId) {
  const cacheKey = "kitsu:" + kitsuId;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  try {
    const rk = await fetch("https://kitsu.io/api/edge/anime/" + kitsuId + "/mappings", {
      headers: { "Accept": "application/vnd.api+json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!rk.ok) return null;
    const alMap = ((await rk.json()).data || []).find((m) => m.attributes?.externalSite === "anilist/anime");
    const anilistId = alMap?.attributes?.externalId;
    if (!anilistId) return null;
    info("AniList ID:", anilistId);
    const { depth, title, imdbDirect } = await walkToRoot(parseInt(anilistId));
    const season = depth + 1;
    if (season > 1) info("Season detectada:", season);
    if (imdbDirect) {
      cacheSet(cacheKey, { imdbId: imdbDirect, season });
      return { imdbId: imdbDirect, season };
    }
    for (const t of [title?.english, title?.romaji].filter(Boolean)) {
      const imdbId = await searchImdbByTitle(t);
      if (imdbId) {
        cacheSet(cacheKey, { imdbId, season });
        return { imdbId, season };
      }
    }
  } catch (e) {
    warn("Resolução Kitsu falhou:", e.message);
  }
  return null;
}

function parseContentId(id, type) {
  const tt = id.match(/tt\d+/);
  const imdbId = tt ? tt[0] : null;
  let season = null;
  let episode = null;
  let kitsuId = null;
  if (type === "series") {
    if (id.startsWith("kitsu:")) {
      kitsuId = id.split(":")[1] || null;
      episode = id.split(":")[2] || null;
    } else {
      const m = id.match(/:(\d+):(\d+)$/);
      if (m) {
        season = m[1];
        episode = m[2];
      }
    }
  }
  return { imdbId, season, episode, kitsuId };
}

const SUBTITLE_LIMIT = Math.min(5, Math.max(1, Number(process.env.MAX_SUBTITLE_OPTIONS || 3)));

// ── Subtitles ───────────────────────────────────────────────────────────────

app.get("/:userData/subtitles/:type/*", async (req, res) => {
  const { userData, type } = req.params;
  const ud = parseUserData(userData);
  const targetLang = TARGET_LANG;
  const srcPref = (ud.srcLang || "any").split("|")[0] || "any";

  const raw = decodeURIComponent(req.params[0] || "");
  const id = raw.replace(/\.json$/, "").split("/")[0];
  const { imdbId, season, episode, kitsuId } = parseContentId(id, type);
  const contentKey = id;
  info("subtitles type=", type, "content=", contentKey, "->", targetLang);

  let usableImdb = imdbId;
  let usableSeason = season;
  if (!usableImdb && kitsuId) {
    const resolved = await resolveKitsuToImdb(kitsuId);
    if (resolved) {
      usableImdb = resolved.imdbId;
      usableSeason = String(resolved.season);
    }
  }
  if (!usableImdb) {
    info("sem imdb resolvível para", contentKey);
    return res.json({ subtitles: [] });
  }

  const candidatesRaw = type === "series" && usableSeason && episode ? await provider.searchEpisode(usableImdb, usableSeason, episode) : await provider.searchMovie(usableImdb);

  let candidates = (candidatesRaw.subtitles || []).filter((s) => {
    if (isSameLanguage(s.lang, targetLang)) return false;
    if (srcPref !== "any" && !isSameLanguage(s.lang, srcPref)) return false;
    return true;
  });

  if (srcPref === "any" && candidates.length > 3) {
    const eng = candidates.filter((s) => isSameLanguage(s.lang, "en"));
    if (eng.length) candidates = eng;
  }

  const ranked = pickBest(candidates, { targetLang });
  const chosen = ranked.slice(0, SUBTITLE_LIMIT);

  const subtitles = chosen.map((sub, i) => {
    const params = new URLSearchParams({ url: sub.url, from: sub.lang2, to: targetLang, k: sub.id, enc: sub.encoding || "UTF-8" });
    const href = `${getBaseUrl(req)}/${userData}/translate?${params}`;
    return {
      id: `${sub.id}-tr-${i}`,
      url: href,
      lang: toBcp47(targetLang),
      label: `[${DST_LANG_LABELS[targetLang]}] traduzido de ${sub.lang.toUpperCase()}${formatHint(sub) ? " • " + formatHint(sub) : ""}`,
      title: `Traduzido de ${sub.lang.toUpperCase()}`,
    };
  });

  info("legendas montadas:", subtitles.length, "para", contentKey, "(", candidatesRaw.cacheAge, "s cache )");
  return res.json({ subtitles });
});

// ── Translate ───────────────────────────────────────────────────────────────

app.get("/:userData/translate", async (req, res) => {
  const { url, from, to, k } = req.query;
  const enc = typeof req.query.enc === "string" ? req.query.enc : null;
  const ud = parseUserData(req.params.userData);
  const apiKey = ud.apiKey || null;
  const targetLang = TARGET_LANG;

  if (!url) {
    return res.status(400).json({ error: "missing url" });
  }
  if (!validateSubtitleUrl(url)) {
    warn("URL de legenda recusada:", url);
    return res.status(403).json({ error: "forbidden host" });
  }

  const algorithmKey = sha1(`algo:${k || ""}|${url}|${enc || ""}|${toGoogleLang(from) || "auto"}|${targetLang}|3`);
  const cacheKey = "tr:" + algorithmKey;
  const hit = cacheGet(cacheKey);
  if (hit) {
    info("cache HIT", "translate", algorithmKey.slice(0, 12), "events=", hit.events);
    sendSrt(res, hit.srt, { mode: hit.mode || "translated", partial: !!hit.partial, fromCache: true });
    return;
  }

  let buf;
  try {
    buf = await retry(() => fetchBuffer(url, { timeoutMs: Number(process.env.SUBTITLE_DOWNLOAD_TIMEOUT_MS || 8000), headers: { "User-Agent": "Mozilla/5.0" } }), { retries: 1, baseDelay: 300, maxDelay: 1000 });
  } catch (e) {
    warn("download da legenda falhou:", e.status, e.message);
    return res.status(502).json({ error: "download failed", cause: e.status });
  }

  const fromLang = (from || "auto").split("|")[0] || "auto";
  let result;
  try {
    result = await translateSubtitleUrl(buf, {
      from: toGoogleLang(fromLang),
      to: toGoogleLang(targetLang),
      apiKey,
      encoding: enc,
      budgetMs: Number(process.env.TRANSLATE_BUDGET_MS || 9000),
    });
  } catch (e) {
    error("tradução falhou:", e.message);
    return res.status(502).json({ error: "translation failed" });
  }

  const { srt, events, stats } = result;
  if (!srt || !events) {
    warn("subtitle sem eventos", stats);
    return res.status(422).json({ error: stats?.error || "no subtitle content" });
  }

  let finalSrt = srt;
  let mode = "translated";
  if (stats.partial && stats.translatedRatio < 0.6 && process.env.FALLBACK_TO_ORIGINAL !== "0") {
    const original = decodeCuesToSrt(buf);
    if (original) {
      finalSrt = original;
      mode = "original";
      warn("tradução parcial abaixo do limite, servindo original", stats.translatedRatio);
    }
  }

  cacheSet(cacheKey, { srt: finalSrt, events, mode, partial: stats.partial });
  info("cache SET", algorithmKey.slice(0, 12), "mode=", mode, "events=", events, "batches=", stats.batches, "ok=", stats.translatedUnits, "falhas=", stats.failures, "t=", stats.translationMs, "ms", "ratio=", stats.translatedRatio, "engines=", (stats.enginesUsed || []).join(",") || "n/a");
  sendSrt(res, finalSrt, { mode, partial: stats.partial });
});

function decodeCuesToSrt(buf) {
  try {
    const parsed = parseSubtitles(new TextDecoder("utf-8").decode(buf));
    if (parsed.cues.length) return toSrt(normalizeCues(parsed.cues));
    const reParsed = parseSubtitles(new TextDecoder("windows-1252").decode(buf));
    return reParsed.cues.length ? toSrt(normalizeCues(reParsed.cues)) : null;
  } catch {
    return null;
  }
}

function sendSrt(res, srt, { mode = "translated", partial = false, fromCache = false } = {}) {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.setHeader("X-Subtrans-Mode", mode);
  if (partial) res.setHeader("X-Subtrans-Partial", "1");
  if (fromCache) res.setHeader("X-Subtrans-Cache", "1");
  res.send(srt);
}

app.use((req, res) => res.status(404).json({ error: "Not found" }));

if (process.env.VERCEL !== "1") {
  app.listen(PORT, () => info("Addon ativo na porta", PORT));
}

export default app;