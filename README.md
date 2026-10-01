# Auto Translate Subtitles — Stremio Addon

> 🇺🇸 [English version](README.en.md)

Addon para Stremio que traduz legendas automaticamente para **Português (Brasil)** (e outros idiomas) usando o Google Translate.
Suporta filmes e séries com IDs IMDB (`tt*`) e Kitsu (`kitsu:*`, incluindo anime).

---

## Funcionalidades

- Tradução automática para pt-BR com engine próprio **`client=gtx`** (mais estável que a lib antiga, que era bloqueada com frequência)
- **Cascata de engines com fallback automático**: `google-gtx` → `google-chrome` → `mymemory` (funciona em redes onde o Google livre retorna 401/403/429)
- **API Key oficial** do Google Cloud Translation opcional (usada automaticamente quando configurada)
- Parser robusto para **SRT, VTT e ASS/SSA** (com conversão segura para SRT mantendo timestamps)
- **Preservação exata dos timestamps** na tradução + normalização automática de eventos inválidos
- **Ajuste manual de sincronização** (offset em ms) configurável pelo usuário
- **Seleção inteligente da melhor legenda** (evita Forced/SDH/Hearing Impaired/OCR ruins por padrão)
- **Falha de um lote não derruba a legenda** (retry + backoff + isolamento por sub-lotes)
- **Cache em memória** (TTL) com chave por conteúdo + legenda + idiomas + versão
- **Timeouts e retry com backoff** em todas as chamadas externas
- **Fallback**: se a tradução falha parcialmente, serve a legenda original em vez de erro
- **Observabilidade**: logs estruturados sem segredos (API keys mascaradas/ocultadas)
- Resolução Kitsu → IMDB (AniList + Cinemeta) com detecção de temporada
- UI de configuração bilíngue (PT/EN) com geração de link base64url (sem `/` na URL)

---

## Arquitetura

```
lib/
├── parser.js        # Parse SRT/VTT/ASS/SSA -> cues (timestamps em ms)
├── serializer.js    # Cues -> SRT/VTT
├── translator.js    # Motor de tradução (gtx + API oficial), batching, retry/backoff, isolamento
├── pipeline.js      # Orquestra: decode -> parse -> normalize -> traduz -> serialize
├── provider.js      # Busca de legendas (OpenSubtitles v3 via strem.io)
├── selector.js      # Scoring da melhor legenda (SDH/forced/OCR/encoding/idioma)
├── syncer.js        # Sincronização: preservação, normalização (L2) e detecção de offset (L3)
├── language.js      # Mapeamento ISO 639-1 / 639-2 (B e T), alias pt-BR, pob...
├── http.js          # fetch com timeout, caps de tamanho, retry/backoff, allowlist de hosts
├── cache.js         # Cache TTL/LRU em memória + sha1
└── logger.js        # Logs estruturados e redação de chaves

api/
├── index.js         # Express: /manifest.json, /configure, /subtitles, /translate
└── configure.html   # UI de configuração
```

Fluxo: `Stremio → /subtitles/:type/:id → provider → seleção (scoring) → lista de candidatas → Stremio baixa /translate → download seguro da legenda → decode por encoding → parse → normalização de timestamps → tradução em lotes → serialização SRT → cache → resposta.`

---

## Deploy

### Opção 1 — Vercel (recomendado)

1. Importe o repositório no [Vercel](https://vercel.com) (o `vercel.json` é detectado automaticamente).
2. Sem variáveis obrigatórias.
3. Acesse `https://seu-projeto.vercel.app/configure`.

> ⚠️ O plano gratuito da Vercel limita cada request a **10s**. O addon foi otimizado (lotes maiores, budget de tempo, cache e fallback), mas legendas muito grandes ainda podem estourar. Para uso intenso, use Docker.

### Opção 2 — Docker (self-hosted)

```bash
git clone https://github.com/viniciusss100/tradutorvin.git
cd tradutorvin
# ajuste PUBLIC_URL no compose.yml
docker compose up -d
```

Aponte seu domínio (com HTTPS) para `http://tradutor:3000`.

### Desenvolvimento local

```bash
npm install
npm start          # http://localhost:3000
npm test           # testes unitários/integração (sem rede)
npm run test:net   # inclui testes reais de tradução (requer rede)
```

---

## Variáveis de ambiente

| Variável | Descrição | Padrão |
|---|---|---|
| `PUBLIC_URL` | URL pública do addon (sem barra final) | detectada automaticamente |
| `PORT` | Porta do servidor local | `3000` |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` | `info` |
| `CACHE_TTL_MS` | TTL do cache (ms) | `6h` |
| `CACHE_MAX_ENTRIES` | Máximo de entradas no cache | `3000` |
| `MAX_BATCH_CHARS` | Tamanho máximo por request de tradução (chars) | `6000` |
| `MAX_BATCH_UNITS` | Máximo de unidades (cues) por request | `800` |
| `TRANSLATE_TIMEOUT_MS` | Timeout de cada request de tradução | `6000` |
| `TRANSLATE_BUDGET_MS` | Orçamento total de tradução por request | `9000` |
| `SUBTITLE_DOWNLOAD_TIMEOUT_MS` | Timeout para baixar a legenda original | `8000` |
| `MAX_SUBTITLE_BYTES` | Tamanho máximo de legenda aceita | `6 MB` |
| `MAX_SUBTITLE_CHARS` | Máximo de caracteres processáveis | `500000` |
| `MAX_SUBTITLE_OPTIONS` | Quantas legendas expor ao Stremio (1–5) | `3` |
| `MAX_CUE_DURATION_MS` | Duração máxima por cue (normalização) | `12000` |
| `TRANSLATION_ENGINES` | Ordem dos engines de tradução (vírgula) | `google-gtx,google-chrome,mymemory` |
| `FALLBACK_TO_ORIGINAL` | `1` serve a legenda original se a tradução falhar | `1` |

### Engines de tradução (fallback automático)

Cada lote tenta os engines na ordem configurada e, se todos falharem, o addon **isola o lote** (sub-lotes) para não perder o restante:

1. **`google-gtx`** — endpoint livre do Google (`translate_a/single?client=gtx`) com rotação de hosts `translate.googleapis.com`, `translate.google.com`, `translate.google.com.br`.
2. **`google-chrome`** — endpoint de tradução do Chrome (`translate_a/t?client=dict-chrome-ex`), funciona em redes onde o `gtx` é bloqueado (ex.: casos de HTTP 401/403/429).
3. **`mymemory`** — [MyMemory](https://mymemory.translated.net) (gratuito, sem chave), em blocos de até ~450 caracteres. Mais lento, usado como última linha.

Se uma chave oficial do Google estiver configurada, o engine `google-official` (Cloud Translation v2) tem prioridade. O engine realmente usado por lote aparece no log (`engines=...`).

### Tipos de erro de resposta do `/translate`

- `400` falta `url`
- `403` host de legenda não permitido (anti-SSRF)
- `502` falha no download ou na tradução (permanente)
- `422` legenda sem eventos válidos
- `200` SRT traduzido (header `X-Subtrans-Mode: translated|original`, `X-Subtrans-Cache: 1` em cache hit)

---

## Sincronização

1. **Preservação direta (Nível 1):** timestamps da legenda original são mantidos byte a byte (ms).
2. **Normalização (Nível 2):** corrige timestamps inválidos, overlap, duração negativa/fora do limite e ordem incorreta.
3. **Alinhamento (Nível 3):** detecção global de offset por histograma de correspondência temporal/textual entre legendas do mesmo episódio (usado para evidência, sem correção automática agressiva). Ajuste manual disponível no config (`delayMs`, ex. `1500` adianta; `-1000` atrasa).

## Fallback

```
/translate:
  download seguro (timeout + cap de tamanho)
    → falhou? 502
  parse + normalizar
  tradução (engines em cascata com fallback automático):
    google-official (se apiKey) → google-gtx (3 hosts) → google-chrome → mymemory
    → todos falharam? sub-lotes isolando a causa
  lote com falha → mantém texto original só daquele trecho
  tradução parcial < 60% → serve legenda original (se FALLBACK_TO_ORIGINAL=1)
  erro final → 502 com JSON (nunca derruba o addon)
```

## Fallback por áudio (speech-to-text)

**Não implementado — limitação técnica documentada.**

Um addon de legendas do Stremio **não recebe o áudio nem a URL do vídeo**: o fluxo de subtitles é disparado com apenas `{type, id}` e retorna URLs; o stream chega via outro addon/integração. Além disso, no ambiente Vercel não há CPU/RAM para inferência local de Whisper e adicionar um modelo pesado violaria os limites da plataforma. O `Dockerfile`/`.gitignore` já preveem a pasta `models/` para uma futura implementação self-hosted (faster-whisper + ffmpeg) caso o Stremio passe a expor uma URL de mídia/áudio ao addon de legendas.

## Limitações

- Fonte única de legendas (OpenSubtitles via `strem.io`) — sem chave não há segunda fonte pública confiável.
- Animes dependem da resolução Kitsu→IMDB (AniList raramente expõe IMDb; alguns títulos não são encontrados).
- Tradução Google pode traduzir nomes próprios (ex.: "White" → "Branco") — limitação do modelo.
- Legenda já em pt-BR não é exibida (evita retradução pt→pt).
- Legendas de tamanho extremo podem exceder o limite de 10s da Vercel.

## Publicação

Submeta a URL pública do manifest:
```
https://seu-dominio.com/manifest.json
```

---

## ⚡ Turbine sua experiência com um Debrid

- **[TorBox](https://torbox.app/subscription?referral=b08bcd10-8df2-44c9-a0ba-4d5bdb62ef96)** — Rápido, moderno e com ótimo custo-benefício
- **[Real-Debrid](http://real-debrid.com/?id=6684575)** — O mais popular e amplamente suportado