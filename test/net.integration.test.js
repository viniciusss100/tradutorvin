import { test } from "node:test";
import assert from "node:assert/strict";

const NET = process.env.NETWORK_TESTS === "1";

test("engine gtx real traduz e preserva contagem de linhas", { skip: !NET }, async () => {
  const { translateUnits } = await import("../lib/translator.js");
  const units = [];
  for (let i = 0; i < 30; i++) units.push({ text: `This is sentence number ${i} used for alignment checking` });
  const { results, stats } = await translateUnits(units, { from: "en", to: "pt" });
  assert.equal(results.length, 30);
  assert.ok(results.every((r) => typeof r === "string" && r.length > 0));
  assert.ok(stats.failures === 0, `failures=${stats.failures}`);
});

test("pipeline real sobre SRT completo (rede)", { skip: !NET }, async () => {
  const { readFileSync } = await import("node:fs");
  const { translateSubtitleText } = await import("../lib/pipeline.js");
  const { countCues } = await import("../lib/serializer.js");
  const srt = readFileSync(new URL("./fixtures/breaking_bad.srt", import.meta.url), "utf8");
  const { srt: out, events, stats } = await translateSubtitleText(srt, { from: "en", to: "pt" });
  assert.ok(events > 500, `events=${events}`);
  assert.equal(countCues(out), events);
  assert.ok(stats.translatedRatio >= 0.9, `ratio=${stats.translatedRatio}`);
});