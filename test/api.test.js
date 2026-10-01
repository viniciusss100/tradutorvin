import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.VERCEL = "1";

let server;
let base;
let { default: app } = await import("../api/index.js");
const provider = await import("../lib/provider.js");
const translator = await import("../lib/translator.js");

const FIXTURE_MOVIE = {
  subtitles: [
    { id: "9001", url: "https://subs5.strem.io/en/fixture/movie1.srt", lang: "eng", lang2: "en", encoding: "UTF-8", m: "i", filename: "movie.eng.srt", raw: { subtitleFileName: "movie.eng.srt" } },
    { id: "9002", url: "https://subs5.strem.io/en/fixture/movie2.srt", lang: "por", lang2: "pt", encoding: "UTF-8", m: "i", filename: "movie.pt.srt", raw: { subtitleFileName: "movie.pt.srt" } },
    { id: "9003", url: "https://subs5.strem.io/en/fixture/sdh.srt", lang: "eng", lang2: "en", encoding: "UTF-8", m: "s", filename: "movie.eng.sdh.srt", raw: { subtitleFileName: "movie.eng.sdh.srt" } },
  ],
  cacheAge: 600,
};
const FIXTURE_SERIES = {
  subtitles: [
    { id: "9101", url: "https://subs5.strem.io/en/fixture/s01e01.srt", lang: "ger", lang2: "de", encoding: "UTF-8", m: "i", filename: "Show.s01e01.German.srt", raw: { subtitleFileName: "Show.s01e01.German.srt", releaseFormat: "WEB-DL" } },
    { id: "9102", url: "https://subs5.strem.io/en/fixture/s01e01_fr.srt", lang: "fre", lang2: "fr", encoding: "UTF-8", m: "i", filename: "Show.s01e01.French.srt", raw: { subtitleFileName: "Show.s01e01.French.srt" } },
  ],
  cacheAge: 300,
};

const SRT_FIXTURE = (() => {
  const parts = [];
  for (let i = 1; i <= 20; i++) {
    parts.push(`${i}\n00:00:${String(i % 60).padStart(2, "0")},000 --> 00:00:${String((i + 1) % 60).padStart(2, "0")},000\nDialogue line number ${i}`);
  }
  return parts.join("\n\n");
})();

const ud = Buffer.from(JSON.stringify({ targetLang: "pt", srcLang: "any", apiKey: "" })).toString("base64url");

before(async () => {
  provider.__setFakeProvider(async ({ type, imdbId, season, episode }) => {
    if (imdbId === "tt9999999") return { subtitles: [], cacheAge: 0 };
    if (type === "movie") return FIXTURE_MOVIE;
    return FIXTURE_SERIES;
  });
  translator.__setFakeTranslator((t) => String(t).split("\n").map((p) => "[PT] " + p).join("\n"));

  const http = await import("../lib/http.js");
  http.__setFakeDownload(async (url) => Buffer.from(SRT_FIXTURE, "utf8"));

  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close?.();
});

test("manifest.json base", async () => {
  const r = await fetch(base + "/manifest.json");
  assert.equal(r.status, 200);
  const m = await r.json();
  assert.equal(m.types.includes("movie"), true);
  assert.equal(m.resources[0].name, "subtitles");
});

test("manifest com userData", async () => {
  const r = await fetch(`${base}/${ud}/manifest.json`);
  assert.equal(r.status, 200);
  const m = await r.json();
  assert.match(m.id, /community\.subtrans\.autotranslate/);
});

test("subtitles para filme válida (ignora SDH e já-traduzidas)", async () => {
  const r = await fetch(`${base}/${ud}/subtitles/movie/tt0111161.json`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.subtitles.length >= 1);
  const first = j.subtitles[0];
  assert.equal(first.lang, "pt-BR");
  assert.ok(first.label);
  assert.match(first.url, /translate\?/);
  assert.ok(!/\.sdh\.srt/.test(first.url), "não deve escolher SDH primeiro");
  assert.ok(!first.url.includes("movie.pt.srt"), "não deve traduzir pt->pt");
});

test("subtitles para série german/fre mapeados corretamente (código B)", async () => {
  const r = await fetch(`${base}/${ud}/subtitles/series/tt0903747:1:1.json`);
  const j = await r.json();
  assert.ok(j.subtitles.length >= 1);
  for (const s of j.subtitles) assert.equal(s.lang, "pt-BR");
});

test("subtitles para conteúdo inexistente devolve lista vazia", async () => {
  const r = await fetch(`${base}/${ud}/subtitles/movie/tt9999999.json`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.subtitles, []);
});

test("translate gera SRT traduzido e preserva timestamps", async () => {
  const r = await fetch(`${base}/${ud}/translate?url=${encodeURIComponent(FIXTURE_MOVIE.subtitles[0].url)}&from=en&to=pt&k=9001&enc=UTF-8`);
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.match(text, /\d+\n00:00:\d{2},000 --> 00:00:\d{2},000\n/);
  assert.match(text, /\[PT\] Dialogue line number 1/);
  assert.match(r.headers.get("content-type"), /text\/plain/);
});

test("translate recusa hosts não permitidos", async () => {
  const r = await fetch(`${base}/${ud}/translate?url=${encodeURIComponent("https://evil.example.com/x.srt")}&from=en&to=pt`);
  assert.equal(r.status, 403);
});

test("translate sem url devolve 400", async () => {
  const r = await fetch(`${base}/${ud}/translate`);
  assert.equal(r.status, 400);
});

test("cache hit após primeira tradução", async () => {
  const url = `${base}/${ud}/translate?url=${encodeURIComponent(FIXTURE_MOVIE.subtitles[0].url)}&from=en&to=pt&k=9001&enc=UTF-8`;
  await fetch(url);
  const r2 = await fetch(url);
  assert.equal(r2.headers.get("X-Subtrans-Cache"), "1");
});

test("translate de legenda pt para pt não é ofertado (sem tradução redundante)", async () => {
  provider.__setFakeProvider(async () => ({ subtitles: [FIXTURE_MOVIE.subtitles[1]], cacheAge: 0 }));
  const r = await fetch(`${base}/${ud}/subtitles/movie/tt0111161.json`);
  const j = await r.json();
  assert.ok(j.subtitles.filter((s) => s.url.includes("movie.pt.srt")).length === 0);
});