import express from "express";
import fetch from "node-fetch";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { translateSrt } from "../lib/subtitleTranslator.js";

const __dir = dirname(fileURLToPath(import.meta.url));

const app  = express();
const PORT = 3000;

// Idiomas de origem suportados (legenda original)
const SRC_LANGS = { eng: "en", jpn: "ja", spa: "es", fra: "fr", deu: "de", ita: "it", por: "pt" };

// Idiomas de destino disponíveis para o usuário escolher
const DST_LANG_OPTIONS = [
  "pt",   // Português (BR)
  "es",   // Espanhol
  "fr",   // Francês
  "de",   // Alemão
  "it",   // Italiano
  "pl",   // Polonês
  "tr",   // Turco
  "ru",   // Russo
  "ar",   // Árabe
  "zh",   // Chinês (Simplificado)
  "ko",   // Coreano
  "hi",   // Hindi
];

const DST_LANG_LABELS = {
  pt: "Português (BR)", es: "Espanhol", fr: "Francês", de: "Alemão",
  it: "Italiano", pl: "Polonês", tr: "Turco", ru: "Russo",
  ar: "Árabe", zh: "Chinês", ko: "Coreano", hi: "Hindi",
};

// Código BCP-47 que o Stremio exibe na lista de legendas
const DST_LANG_BCP = {
  pt: "por", es: "spa", fr: "fra", de: "ger", it: "ita",
  pl: "pol", tr: "tur", ru: "rus", ar: "ara", zh: "zho", ko: "kor", hi: "hin",
};

const BASE_MANIFEST = {
  id: "community.subtrans.autotranslate",
  version: "4.1.0",
  name: "Auto Translate Subtitles",
  description: "Traduz legendas automaticamente para o idioma escolhido via Google Translate.",
  logo: "/logo.svg",
  types: ["movie", "series"],
  catalogs: [],
  resources: [
    { name: "subtitles", types: ["movie", "series"], idPrefixes: ["tt", "kitsu"] }
  ],
  behaviorHints: { configurable: true, configurationRequired: true },
  config: [
    {
      key: "targetLang",
      type: "select",
      title: "Idioma de destino",
      options: DST_LANG_OPTIONS.map(c => `${c}|${DST_LANG_LABELS[c]}`),
      default: "pt|Português (BR)",
      required: true,
    },
    {
      key: "srcLang",
      type: "select",
      title: "Idioma de origem preferido",
      options: ["any|Qualquer (automático)", "en|Inglês", "ja|Japonês", "es|Espanhol", "fr|Francês", "de|Alemão", "it|Italiano"],
      default: "any|Qualquer (automático)",
    },
    {
      key: "apiKey",
      type: "password",
      title: "Google Translate API Key (opcional — sem chave usa API gratuita com limite)",
      required: false,
    },
  ],
};

// Decodifica userData base64 da URL
function parseUserData(b64) {
  try {
    const json = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(json);
  } catch { return {}; }
}

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use((req, res, next) => { console.log("REQ:", req.method, req.url); next(); });

app.get("/health", (_, res) => res.json({ ok: true }));

app.get("/logo.svg", (_, res) => {
  res.setHeader("Content-Type", "image/svg");
  res.send(readFileSync(join(__dir, "logo.svg")));
});

app.get("/configure", (_, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(readFileSync(join(__dir, "configure.html")));
});

function getBaseUrl(req) {
  return process.env.PUBLIC_URL || (req.protocol + "://" + req.get("host"));
}

// Manifest raiz — sem userData, mostra config obrigatória
app.get("/manifest.json", (req, res) => {
  res.json({ ...BASE_MANIFEST, logo: getBaseUrl(req) + "/logo.svg" });
});

// Manifest com userData: /:userData/manifest.json
app.get("/:userData/manifest.json", (req, res) => {
  const base = getBaseUrl(req);
  const ud = parseUserData(req.params.userData);
  const lang = (ud.targetLang || "pt").split("|")[0];
  const manifest = {
    ...BASE_MANIFEST,
    logo: base + "/logo.svg",
    id: `community.subtrans.autotranslate.${req.params.userData.slice(0, 8)}`,
    description: `Traduz legendas para ${DST_LANG_LABELS[lang] || lang} via Google Translate.`,
    behaviorHints: { configurable: true, configurationRequired: false },
  };
  res.json(manifest);
});

// ── Resolução Kitsu → IMDB ──────────────────────────────────────────────────

async function searchImdbByTitle(title) {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(
      "https://v3-cinemeta.strem.io/catalog/series/top/search=" + encodeURIComponent(title) + ".json",
      { signal: ctrl.signal }
    );
    if (!r.ok) return null;
    const titleBase = title.toLowerCase().split(":")[0].trim();
    const match = ((await r.json()).metas || []).find(m =>
      m.name?.toLowerCase().includes(titleBase) && m.imdb_id
    );
    if (match) { console.log("[subtrans] Cinemeta:", match.name, "->", match.imdb_id); return match.imdb_id; }
  } catch (err) { console.log("[subtrans] Cinemeta falhou:", err.message); }
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
        variables: { id: parseInt(anilistId) }
      })
    });
    if (!r.ok) return { rootId: anilistId, depth };
    const media      = (await r.json()).data?.Media;
    const imdbDirect = (media?.externalLinks || [])
      .find(l => l.site === "IMDb" || l.url?.includes("imdb.com/title/"))
      ?.url?.match(/tt\d+/)?.[0] || null;
    const prequel = (media?.relations?.edges || []).find(e =>
      e.relationType === "PREQUEL" && e.node.format !== "MOVIE"
    );
    if (!prequel) return { rootId: anilistId, depth, title: media?.title, imdbDirect };
    return walkToRoot(prequel.node.id, depth + 1);
  } catch { return { rootId: anilistId, depth }; }
}

async function resolveKitsuToImdb(kitsuId) {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 5000);
    const rk = await fetch(
      "https://kitsu.io/api/edge/anime/" + kitsuId + "/mappings",
      { headers: { "Accept": "application/vnd.api+json" }, signal: ctrl.signal }
    );
    if (!rk.ok) return null;
    const alMap = ((await rk.json()).data || []).find(m => m.attributes?.externalSite === "anilist/anime");
    const anilistId = alMap?.attributes?.externalId;
    if (!anilistId) return null;
    console.log("[subtrans] AniList ID:", anilistId);

    const { depth, title, imdbDirect } = await walkToRoot(parseInt(anilistId));
    const season = depth + 1;
    console.log("[subtrans] season:", season);

    if (imdbDirect) return { imdbId: imdbDirect, season };

    for (const t of [title?.english, title?.romaji].filter(Boolean)) {
      const imdbId = await searchImdbByTitle(t);
      if (imdbId) return { imdbId, season };
    }
  } catch (err) { console.log("[subtrans] Resolução falhou:", err.message); }
  return null;
}

// ── Subtitles ───────────────────────────────────────────────────────────────

app.get("/:userData/subtitles/:type/*", async (req, res) => {
  const { userData, type } = req.params;
  const ud         = parseUserData(userData);
  const targetLang = (ud.targetLang || "pt").split("|")[0];
  const srcPref    = (ud.srcLang   || "any").split("|")[0];
  const apiKey     = ud.apiKey || null;

  const raw = decodeURIComponent(req.params[0] || "");
  const id  = raw.replace(/\.json$/, "").split("/")[0];
  console.log("[subtrans] subtitles type=" + type + " id=" + id + " -> " + targetLang);

  const baseUrl   = process.env.PUBLIC_URL || (req.protocol + "://" + req.get("host"));
  const subtitles = [];

  const ttMatch = id.match(/tt\d+/);
  let imdbId = ttMatch ? ttMatch[0] : null;
  let season = null, episode = null;

  if (type === "series") {
    if (id.startsWith("kitsu:")) {
      episode = id.split(":")[2] || null;
    } else {
      const m = id.match(/:(\d+):(\d+)$/);
      if (m) { season = m[1]; episode = m[2]; }
    }
  }

  if (!imdbId && id.startsWith("kitsu:")) {
    const resolved = await resolveKitsuToImdb(id.split(":")[1]);
    if (resolved) { imdbId = resolved.imdbId; season = String(resolved.season); }
  }

  console.log("[subtrans] imdbId=" + imdbId + " season=" + season + " ep=" + episode);

  if (imdbId) {
    try {
      const apiUrl = (type === "series" && season && episode)
        ? `https://opensubtitles-v3.strem.io/subtitles/series/${imdbId}:${season}:${episode}.json`
        : `https://opensubtitles-v3.strem.io/subtitles/movie/${imdbId}.json`;
      const ctrl = new AbortController();
      const t    = setTimeout(() => ctrl.abort(), 8000);
      const r    = await fetch(apiUrl, { signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) {
        let candidates = ((await r.json()).subtitles || []).filter(s => SRC_LANGS[s.lang]);
        // Filtra por idioma de origem preferido (se não "any")
        if (srcPref !== "any") {
          const pref = candidates.filter(s => SRC_LANGS[s.lang] === srcPref);
          if (pref.length) candidates = pref;
        }
        // Não traduz se a legenda já está no idioma de destino
        candidates = candidates.filter(s => SRC_LANGS[s.lang] !== targetLang);

        for (let i = 0; i < Math.min(2, candidates.length); i++) {
          const sub  = candidates[i];
          const from = SRC_LANGS[sub.lang];
          const params = new URLSearchParams({ url: sub.url, from, to: targetLang });
          if (apiKey) params.set("apiKey", apiKey);
          subtitles.push({
            id:    sub.id + "-trans-" + i,
            url:   `${baseUrl}/${userData}/translate?${params}`,
            lang:  DST_LANG_BCP[targetLang] || "por",
            title: `[${DST_LANG_LABELS[targetLang] || targetLang}] traduzido de ${sub.lang.toUpperCase()}`,
          });
        }
        console.log("[subtrans] Legendas montadas:", subtitles.length);
      }
    } catch (err) { console.error("[subtrans] Erro OS:", err.message); }
  }

  return res.json({ subtitles });
});

// ── Translate ───────────────────────────────────────────────────────────────

app.get("/:userData/translate", async (req, res) => {
  const { url, from, to, apiKey } = req.query;
  if (!url) return res.status(400).send("Missing url");
  try {
    const srtResp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!srtResp.ok) throw new Error("Download falhou: " + srtResp.status);
    const srtText = await srtResp.text();
    console.log("[subtrans] Traduzindo", srtText.length, "chars", from, "->", to);
    const result = await translateSrt(srtText, from || "en", to || "pt", apiKey || null);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.send(result);
  } catch (err) {
    console.error("[subtrans] Erro tradução:", err.message);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.send("1\n00:00:00,000 --> 00:00:05,000\n[Erro ao traduzir legenda]\n");
  }
});

app.use((req, res) => res.status(404).json({ error: "Not found" }));

// Vercel exporta o app como serverless function; localmente sobe o servidor
if (process.env.VERCEL !== "1") {
  app.listen(PORT, () => console.log("Addon ativo na porta " + PORT));
}

export default app;
