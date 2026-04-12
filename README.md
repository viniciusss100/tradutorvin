# Auto Translate Subtitles — Stremio Addon

> 🇺🇸 [English version](README.en.md)

Addon para Stremio que traduz legendas automaticamente para o idioma escolhido usando Google Translate.  
Suporta filmes e séries com IDs IMDB (`tt*`) e Kitsu (`kitsu:*`), incluindo anime.

## Funcionalidades

- Tradução automática via Google Translate (gratuito ou com API Key própria)
- 12 idiomas de destino: PT-BR, ES, FR, DE, IT, PL, TR, RU, AR, ZH, KO, HI
- Filtro de idioma de origem preferido
- Resolução automática Kitsu → IMDB via AniList + Cinemeta (com detecção de season)
- UI de configuração bilíngue (PT/EN) com geração de link de instalação
- Configuração por usuário embutida na URL — sem banco de dados

---

## Deploy

### Opção 1 — Vercel (recomendado, gratuito)

**1. Fork ou clone o repositório e suba para o GitHub**

**2. Importe no Vercel**

- Acesse [vercel.com](https://vercel.com) → **Add New Project** → importe o repositório
- Não é necessário configurar nenhuma variável de ambiente para funcionar
- O Vercel detecta automaticamente o `vercel.json` e faz o deploy

**3. Acesse a página de configuração**

```
https://seu-projeto.vercel.app/configure
```

> ⚠️ O plano gratuito do Vercel tem limite de 10s por request. Legendas longas podem estourar o timeout.  
> Para uso intenso, use a opção Docker.

---

### Opção 2 — Docker (self-hosted)

**Pré-requisitos:** Docker, Docker Compose, domínio com HTTPS (ex: Nginx Proxy Manager)

**1. Clone o repositório**

```bash
git clone <repo-url>
cd tradutor
```

**2. Ajuste o `compose.yml`**

```yaml
environment:
  - PUBLIC_URL=https://seu-dominio.com
```

**3. Suba o container**

```bash
docker compose up -d
```

> O `compose.yml` usa uma rede Docker externa `npm-net` (Nginx Proxy Manager).  
> Ajuste a seção `networks` se usar outro proxy.

**4. Configure o proxy reverso**

Aponte `seu-dominio.com` → `http://tradutor:3000` com HTTPS.

**5. Acesse**

```
https://seu-dominio.com/configure
```

---

### Desenvolvimento local

```bash
docker compose -f compose.local.yml up -d
```

Acesse: `http://localhost:3001/configure`

Logs em tempo real:
```bash
docker logs -f tradutor
```

---

## Estrutura

```
.
├── api/
│   ├── index.js               # Servidor Express + lógica principal
│   └── configure.html         # UI de configuração (PT/EN)
├── lib/
│   └── subtitleTranslator.js  # Parser SRT + Google Translate
├── vercel.json                # Config deploy Vercel
├── compose.yml                # Produção Docker
└── compose.local.yml          # Desenvolvimento local
```

## Variáveis de ambiente

| Variável | Descrição | Padrão |
|---|---|---|
| `PUBLIC_URL` | URL pública do addon (sem barra final) | detectado automaticamente |

## Endpoints

| Rota | Descrição |
|---|---|
| `GET /manifest.json` | Manifest base |
| `GET /configure` | Página de configuração |
| `GET /:userData/manifest.json` | Manifest personalizado por usuário |
| `GET /:userData/subtitles/:type/*` | Busca legendas |
| `GET /:userData/translate` | Traduz e serve o SRT |
| `GET /health` | Health check |

`userData` = JSON com configurações do usuário codificado em base64.

## Publicar no stremio-addons.net

Submeta a URL do manifest público:
```
https://seu-dominio.com/manifest.json
```

---

## ⚡ Turbine sua experiência com um Debrid

Para streams rápidos e sem buffer no Stremio, use um serviço de debrid:

- **[TorBox](https://torbox.app/subscription?referral=b08bcd10-8df2-44c9-a0ba-4d5bdb62ef96)** — Rápido, moderno e com ótimo custo-benefício
- **[Real-Debrid](http://real-debrid.com/?id=6684575)** — O mais popular e amplamente suportado
