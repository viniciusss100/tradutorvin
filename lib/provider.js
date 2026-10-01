import { fetchBuffer, retry } from "./http.js";
import { toBcp47, toGoogleLang } from "./language.js";
import { info, warn, error } from "./logger.js";
import { cacheGet, cacheSet } from "./cache.js";

const OS_LIST_URL = "https://opensubtitles-v3.strem.io/subtitles";
const LIST_TIMEOUT_MS = Number(process.env.OS_LIST_TIMEOUT_MS || 8000);

let fakeProvider = null;
export function __setFakeProvider(fn) {
  fakeProvider = fn;
}

export async function searchMovie(imdbId) {
  if (fakeProvider) return fakeProvider({ type: "movie", imdbId });
  return search(`movie/${imdbId}.json`);
}

export async function searchEpisode(imdbId, season, episode) {
  if (fakeProvider) return fakeProvider({ type: "series", imdbId, season, episode });
  return search(`series/${imdbId}:${season}:${episode}.json`);
}

async function search(subPath) {
  const url = `${OS_LIST_URL}/${subPath}`;
  const cached = cacheGet(`os:${url}`);
  if (cached) return cached;
  let buf;
  try {
    buf = await retry(() => fetchBuffer(url, { timeoutMs: LIST_TIMEOUT_MS, maxBytes: 8 * 1024 * 1024, headers: { Accept: "application/json" } }), { retries: 1, baseDelay: 300, maxDelay: 1000 });
  } catch (e) {
    warn("openSubtitles lista falhou:", e.status, e.message);
    return { subtitles: [], cacheAge: 0 };
  }
  let json;
  try {
    json = JSON.parse(new TextDecoder("utf-8").decode(buf));
  } catch {
    error("openSubtitles resposta inválida");
    return { subtitles: [], cacheAge: 0 };
  }
  const entries = (json.subtitles || []).map(normalizeCandidate).filter(Boolean);
  const result = { subtitles: entries, cacheAge: json.cacheMaxAge || 0 };
  cacheSet(`os:${url}`, result, (json.cacheMaxAge || 600) * 1000);
  return result;
}

function normalizeCandidate(s) {
  if (!s || !s.url || !s.lang) return null;
  const lang2 = toGoogleLang(s.lang);
  return {
    id: String(s.id),
    url: s.url,
    lang: toBcp47(s.lang),
    lang2: lang2 === "auto" ? s.lang : lang2,
    encoding: s.SubEncoding || "UTF-8",
    m: s.m,
    filename: s.subtitleFileName,
    releaseName: s.movieReleaseName,
    releaseGroup: s.releaseGroup,
    releaseFormat: s.releaseFormat,
    fps: s.fpsMilli,
    season: s.season,
    episode: s.episode,
    raw: s,
  };
}

export { info };