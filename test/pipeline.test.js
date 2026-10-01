import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { parseSubtitles } from "../lib/parser.js";
import { normalizeCues } from "../lib/syncer.js";
import { toSrt, countCues } from "../lib/serializer.js";
import { translateSubtitleText } from "../lib/pipeline.js";
import { __setFakeTranslator } from "../lib/translator.js";

beforeEach(() => __setFakeTranslator(null));

const SIMPLE_SRT = `1
00:00:01,000 --> 00:00:02,500
Hello world

2
00:00:03,000 --> 00:00:05,000
How are you?
`;

test("pipeline traduz pequeno preservando timestamps", async () => {
  __setFakeTranslator((t) => String(t).split("\n").map((p) => "[-PT-] " + p).join("\n"));
  const { srt, events, stats } = await translateSubtitleText(SIMPLE_SRT, { from: "en", to: "pt" });
  assert.equal(events, 2);
  assert.equal(stats.failures, 0);
  assert.match(srt, /00:00:01,000 --> 00:00:02,500/);
  assert.match(srt, /\[-PT-\] Hello world/);
  assert.match(srt, /00:00:03,000 --> 00:00:05,000/);
});

test("pipeline preserva exatamente os timestamps da legenda original", async () => {
  const original = `1\n00:01:09,386 --> 00:01:11,221\nOh, my god.\n\n2\n00:01:16,185 --> 00:01:17,978\nShit.`;
  __setFakeTranslator((t) => String(t).split("\n").map((p) => "[T] " + p).join("\n"));
  const { srt } = await translateSubtitleText(original, { from: "en", to: "pt" });
  assert.match(srt, /00:01:09,386/);
  assert.match(srt, /00:01:11,221/);
  assert.match(srt, /00:01:16,185/);
  assert.match(srt, /00:01:17,978/);
  assert.equal(countCues(srt), 2);
});

test("pipeline com N batches grandes não perde eventos", async () => {
  const blocks = [];
  for (let i = 1; i <= 400; i++) {
    const mm = String(Math.floor(i / 60)).padStart(2, "0");
    const ss = String(i % 60).padStart(2, "0");
    blocks.push(`${i}\n00:${mm}:${ss},000 --> 00:${mm}:${ss},500\nLinha de diálogo número ${i}`);
  }
  __setFakeTranslator((t) => String(t).split("\n").map((p) => p.replace(/número \d+/, "traduzida")).join("\n"));
  const { srt, events } = await translateSubtitleText(blocks.join("\n\n"), { from: "en", to: "pt" });
  assert.equal(events, 400);
  assert.equal(countCues(srt), 400);
  assert.match(srt, /Linha de diálogo traduzida/);
});

test("pipeline lida com VTT convertendo para SRT", async () => {
  const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.000
Subtitle one

00:00:04.500 --> 00:00:06.000
Subtitle two
`;
  __setFakeTranslator((t) => String(t).split("\n").map((p) => "[T] " + p).join("\n"));
  const { srt, events, stats } = await translateSubtitleText(vtt, { from: "en", to: "pt" });
  assert.equal(events, 2);
  assert.equal(stats.format, "vtt");
  assert.match(srt, /00:00:01,000 --> 00:00:03,000/);
  assert.match(srt, /\[T\] Subtitle one/);
});

test("pipeline devolve vazio para legenda vazia", async () => {
  const { srt, events, stats } = await translateSubtitleText("");
  assert.equal(events, 0);
  assert.equal(srt, "");
  assert.ok(stats.error);
});

test("legenda já no idioma destino não precisa traduzir (filtro fora do pipeline)", () => {
  const parsed = parseSubtitles(SIMPLE_SRT);
  assert.equal(toSrt(normalizeCues(parsed.cues)).length > 0, true);
});

test("string multilinha dentro de cue preservada", async () => {
  const srt = `1\n00:00:01,000 --> 00:00:03,000\nLine one\nLine two\n\n2\n00:00:04,000 --> 00:00:05,000\nLast`;
  __setFakeTranslator((t) => String(t).split("\n").map((l) => "T" + l).join("\n"));
  const { srt: out } = await translateSubtitleText(srt, {});
  assert.match(out, /TLine one\nTLine two/);
});