import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSubtitles, timeToMs, msToSrtTime, stripBom, detectFormat } from "../lib/parser.js";

const SAMPLE_SRT = `1
00:01:09,386 --> 00:01:11,221
Oh, my god.

2
00:01:11,430 --> 00:01:12,931
Christ!
Christ!!

3
00:01:16,185 --> 00:01:17,978
Shit.
`;

test("SRT válido com múltiplas linhas e eventos", () => {
  const { format, cues, notes } = parseSubtitles(SAMPLE_SRT);
  assert.equal(format, "srt");
  assert.equal(cues.length, 3);
  assert.equal(cues[0].start, 69386);
  assert.equal(cues[0].end, 71221);
  assert.equal(cues[1].text, "Christ!\nChrist!!");
  assert.equal(notes.length, 0);
});

test("SRT com CRLF", () => {
  const { cues } = parseSubtitles("1\r\n00:00:01,000 --> 00:00:02,000\r\nOi\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nTchau");
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, "Oi");
});

test("SRT sem numeração de índice", () => {
  const { cues } = parseSubtitles("00:00:01,000 --> 00:00:02,000\nOlá mundo");
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, "Olá mundo");
});

test("SRT inválido (blocos sem timing) é ignorado com nota", () => {
  const { cues, notes } = parseSubtitles("1\n00:00:01,000 --> 00:00:02,000\nA\n\nlixo sem timing\n\n2\n00:00:03,000 --> 00:00:04,000\nB");
  assert.equal(cues.length, 2);
  assert.ok(notes.length >= 1);
});

test("SRT vazio", () => {
  const { cues } = parseSubtitles("");
  assert.equal(cues.length, 0);
  const { cues: c2 } = parseSubtitles("   \n\n ");
  assert.equal(c2.length, 0);
});

test("timestamps inválidos não criam eventos", () => {
  const { cues } = parseSubtitles("1\n00:00:01,000 --> 00:00:05,000\ntexto\n\n2\n00:00:XX,000 --> 00:00:05,000\noutro");
  assert.equal(cues.length, 1);
});

test("caracteres especiais e UTF-8 preservados", () => {
  const { cues } = parseSubtitles("1\n00:00:01,000 --> 00:00:02,000\nç ã é — “aspas” ♪");
  assert.equal(cues[0].text, "ç ã é — “aspas” ♪");
});

test("BOM e detecção de formato", () => {
  assert.equal(stripBom("\uFEFFabc"), "abc");
  assert.equal(detectFormat("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\noi"), "vtt");
  assert.equal(detectFormat("[Script Info]\nTitle: x"), "ass");
  assert.equal(detectFormat("[Events]\nFormat: x"), "ass");
  assert.equal(detectFormat("1\n00:00:01,000 --> 00:00:02,000\noi"), "srt");
});

test("VTT com header e IDs", () => {
  const vtt = `WEBVTT
Kind: captions
Language: en

1
00:00:01.000 --> 00:00:02.000
Hello world

2
00:00:03.000 --> 00:00:04.000
How are you?
`;
  const { format, cues } = parseSubtitles(vtt);
  assert.equal(format, "vtt");
  assert.equal(cues.length, 2);
  assert.equal(cues[0].start, 1000);
  assert.equal(msToSrtTime(cues[0].end), "00:00:02,000");
});

test("VTT NOTE blocks ignorados", () => {
  const vtt = `WEBVTT

NOTE this is a comment

00:00:01.000 --> 00:00:02.000
Hello
`;
  const { cues } = parseSubtitles(vtt);
  assert.equal(cues.length, 1);
});

test("ASS com estilos e eventos", () => {
  const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour
Style: Default,Arial,20,&H00FFFFFF

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,Hello, world
Dialogue: 0,0:00:05.00,0:00:08.00,Default,,0,0,0,,Second\\Nline
`;
  const { format, cues, header } = parseSubtitles(ass);
  assert.equal(format, "ass");
  assert.equal(cues.length, 2);
  assert.equal(cues[0].start, 1000);
  assert.equal(cues[0].end, 4000);
  assert.equal(cues[1].text, "Second\nline");
  assert.ok(header.includes("[Script Info]"));
});

test("ASS clássico (sem campo Effect)", () => {
  const ass = `[Events]
Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Text
Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,Classic style
`;
  const { cues } = parseSubtitles(ass);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, "Classic style");
});

test("conteúdo com milhares de eventos não explode", () => {
  const lines = [];
  for (let i = 1; i <= 3000; i++) {
    const hh = String(Math.floor(i / 3600)).padStart(2, "0");
    const mm = String(Math.floor((i % 3600) / 60)).padStart(2, "0");
    const ss = String(i % 60).padStart(2, "0");
    lines.push(`${i}\n${hh}:${mm}:${ss},000 --> ${hh}:${mm}:${ss},500\nLinha ${i}`);
  }
  const { cues } = parseSubtitles(lines.join("\n\n"));
  assert.equal(cues.length, 3000);
});

test("timeToMs e msToSrtTime redondos", () => {
  assert.equal(timeToMs("00:01:02,500"), 62500);
  assert.equal(timeToMs("01:00:00,000"), 3600000);
  assert.equal(msToSrtTime(62500), "00:01:02,500");
  assert.equal(msToSrtTime(0), "00:00:00,000");
});