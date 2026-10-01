# Auto Translate Subtitles — Stremio Addon

> 🇧🇷 [Versão em Português](README.md)

A Stremio addon that automatically **translates subtitles to Brazilian Portuguese (and other languages)** using a self-contained Google Translate engine (`client=gtx`; official Cloud Translation API when an API key is configured).

Supports movies and series with IMDB (`tt*`) and Kitsu (`kitsu:*`, including anime).

## Highlights

- pt-BR translation with a stable engine chain and **automatic fallback**: `google-gtx` → `google-chrome` → `mymemory` (works on networks where the free Google endpoint returns 401/403/429)
- Robust SRT / VTT / ASS / SSA parser; always outputs safe SRT preserving original timestamps
- Smart subtitle selection (avoids Forced/SDH/HI/OCR by default)
- Batch translation with retry, backoff and per-batch isolation
- In-memory TTL cache keyed by content + subtitle + languages + algorithm version
- Timeouts and retries on every external call; anti-SSRF host allowlist
- Fallback to the original subtitle when translation is only partially possible
- Observability with secrets redacted from logs
- Kitsu → IMDB resolution (AniList + Cinemeta) with season detection
- Per-user config in a base64url URL (no database; no `/` in the path)

## Architecture

See [README.md](README.md) (PT) for the module map: `lib/` (`parser`, `serializer`, `translator`, `pipeline`, `provider`, `selector`, `syncer`, `language`, `http`, `cache`, `logger`) and `api/` (Express routes).

## Deploy

### Vercel
1. Import the repo on [Vercel](https://vercel.com) (`vercel.json` is auto-detected).
2. No required env vars.
3. Open `https://your-app.vercel.app/configure`.

> ⚠️ Free plan caps each request at **10s**. The addon is optimized (large batches, time budget, cache, fallback), but very large subtitles may still exceed it. Use Docker for heavy use.

### Docker (self-hosted)
```bash
git clone https://github.com/viniciusss100/tradutorvin.git
cd tradutorvin
docker compose up -d   # set PUBLIC_URL in compose.yml
```
Point your HTTPS domain to `http://tradutor:3000`.

### Local
```bash
npm install
npm start      # http://localhost:3000
npm test       # unit/integration tests (offline)
npm run test:net   # also runs real translation tests (network required)
```

## Environment variables

All documented in [README.md](README.md). Most important: `PUBLIC_URL`, `TRANSLATE_BUDGET_MS`, `MAX_BATCH_CHARS`, `CACHE_TTL_MS`, `FALLBACK_TO_ORIGINAL`.

## Endpoints

| Route | Description |
|---|---|
| `GET /manifest.json` | Base manifest |
| `GET /:userData/manifest.json` | Per-user manifest (base64url config) |
| `GET /configure` | Configuration UI |
| `GET /:userData/subtitles/:type/:id.json` | List translated subtitle options |
| `GET /:userData/translate?url=...&from=...&to=...` | Download, translate, serve SRT |
| `GET /health` | Health check |

## Synchronization
1. Original timestamps are preserved exactly (ms-level).
2. Automatic normalization of invalid timestamps, overlaps, negative durations, out-of-order cues.
3. Global-offset detection (histogram) between same-episode subtitles for evidence; users can also set a manual `delayMs`.

## Audio / STT fallback

**Not implemented — documented technical limitation.** Subtitle addons do not receive the video/audio URL, and Vercel cannot run local Whisper inference. The repo (`Dockerfile`, `.gitignore` `models/`) is ready for a future self-hosted `faster-whisper` implementation if Stremio ever exposes media URLs to subtitle addons.

## Limitations
- Single subtitle source (OpenSubtitles via `strem.io`) without API keys.
- Anime depends on Kitsu→IMDB resolution (AniList rarely exposes IMDb).
- Google may translate proper nouns (e.g. "White" → "Branco").
- Already-Brazilian-Portuguese subtitles are not shown (avoids pt→pt re-translation).
- Extremely large subtitles may exceed the 10s Vercel limit.

## Publish
Submit `https://your-domain.com/manifest.json` to any addon catalog.

## ⚡ Supercharge with a Debrid
- **[TorBox](https://torbox.app/subscription?referral=b08bcd10-8df2-44c9-a0ba-4d5bdb62ef96)**
- **[Real-Debrid](http://real-debrid.com/?id=6684575)**
