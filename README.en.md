# Auto Translate Subtitles — Stremio Addon

> 🇧🇷 [Versão em Português](README.md)

A Stremio addon that automatically translates subtitles to your chosen language using Google Translate.  
Supports movies and series with IMDB (`tt*`) and Kitsu (`kitsu:*`) IDs, including anime.

## Features

- Automatic translation via Google Translate (free or with your own API Key)
- 12 target languages: PT-BR, ES, FR, DE, IT, PL, TR, RU, AR, ZH, KO, HI
- Preferred source language filter
- Automatic Kitsu → IMDB resolution via AniList + Cinemeta (with season detection)
- Bilingual configuration UI (PT/EN) with install link generator
- Per-user configuration embedded in the URL — no database required

---

## Deploy

### Option 1 — Vercel (recommended, free)

**1. Fork or clone the repository and push to GitHub**

**2. Import on Vercel**

- Go to [vercel.com](https://vercel.com) → **Add New Project** → import the repository
- No environment variables needed to get started
- Vercel auto-detects `vercel.json` and deploys

**3. Open the configuration page**

```
https://your-project.vercel.app/configure
```

> ⚠️ Vercel's free plan has a 10s request timeout. Long subtitles may time out.  
> For heavy use, go with the Docker option.

---

### Option 2 — Docker (self-hosted)

**Requirements:** Docker, Docker Compose, public domain with HTTPS (e.g. Nginx Proxy Manager)

**1. Clone the repository**

```bash
git clone <repo-url>
cd tradutor
```

**2. Edit `compose.yml`**

```yaml
environment:
  - PUBLIC_URL=https://your-domain.com
```

**3. Start the container**

```bash
docker compose up -d
```

> `compose.yml` uses an external Docker network `npm-net` (Nginx Proxy Manager).  
> Adjust the `networks` section if you use a different proxy.

**4. Configure reverse proxy**

Point `your-domain.com` → `http://tradutor:3000` with HTTPS.

**5. Open**

```
https://your-domain.com/configure
```

---

### Local development

```bash
docker compose -f compose.local.yml up -d
```

Open: `http://localhost:3001/configure`

Live logs:
```bash
docker logs -f tradutor
```

---

## Project structure

```
.
├── api/
│   ├── index.js               # Express server + main logic
│   └── configure.html         # Configuration UI (PT/EN)
├── lib/
│   └── subtitleTranslator.js  # SRT parser + Google Translate
├── vercel.json                # Vercel deploy config
├── compose.yml                # Production Docker
└── compose.local.yml          # Local development
```

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `PUBLIC_URL` | Public URL of the addon (no trailing slash) | auto-detected |

## Endpoints

| Route | Description |
|---|---|
| `GET /manifest.json` | Base manifest |
| `GET /configure` | Configuration page |
| `GET /:userData/manifest.json` | Per-user manifest |
| `GET /:userData/subtitles/:type/*` | Fetch subtitles |
| `GET /:userData/translate` | Translate and serve SRT |
| `GET /health` | Health check |

`userData` = user config JSON encoded as base64.

## Publish on stremio-addons.net

Submit your public manifest URL:
```
https://your-domain.com/manifest.json
```

---

## ⚡ Supercharge your experience with a Debrid

For fast, buffer-free, high-quality streams on Stremio, use a debrid service:

- **[TorBox](https://torbox.app/subscription?referral=b08bcd10-8df2-44c9-a0ba-4d5bdb62ef96)** — Fast, modern and great value
- **[Real-Debrid](http://real-debrid.com/?id=6684575)** — The most popular and widely supported
