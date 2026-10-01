import { test } from "node:test";
import assert from "node:assert/strict";
import { toSrt, toVtt, countCues, validateCue } from "../lib/serializer.js";

test("toSrt preserva ordem, numeração e timestamps", () => {
  const cues = [
    { start: 1000, end: 2000, text: "Olá" },
    { start: 2500, end: 3500, text: "Mundo" },
  ];
  const srt = toSrt(cues);
  assert.match(srt, /^1\n00:00:01,000 --> 00:00:02,000\nOlá\n/);
  assert.match(srt, /2\n00:00:02,500 --> 00:00:03,500\nMundo\n$/);
});

test("toSrt ignora cues inválidas", () => {
  const cues = [
    { start: 1000, end: 500, text: "inválida" },
    { start: NaN, end: 2000, text: "nan" },
    { start: -5, end: 2000, text: "negativo" },
  ];
  const srt = toSrt(cues);
  assert.equal(srt.trim(), "");
});

test("toVtt com cabeçalho e pontos", () => {
  const cues = [{ start: 1000, end: 2000, text: "Oi" }];
  const vtt = toVtt(cues);
  assert.match(vtt, /^WEBVTT/);
  assert.match(vtt, /00:00:01.000 --> 00:00:02.000/);
  assert.match(vtt, /Oi/);
});

test("countCues conta eventos", () => {
  const srt = toSrt([
    { start: 1000, end: 2000, text: "a" },
    { start: 3000, end: 4000, text: "b" },
  ]);
  assert.equal(countCues(srt), 2);
});

test("validateCue", () => {
  assert.equal(validateCue({ start: 1, end: 2 }), true);
  assert.equal(validateCue({ start: 2, end: 2 }), false);
  assert.equal(validateCue({ start: "x", end: 2 }), false);
});