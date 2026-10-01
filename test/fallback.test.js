import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { translateUnits } from "../lib/translator.js";
import { __setFakeDownload, HttpError } from "../lib/http.js";

beforeEach(() => {
  __setFakeDownload(null);
  delete process.env.TRANSLATION_ENGINES;
});

test("cascata: quando o primeiro engine devolve 401, o segundo traduz", async () => {
  process.env.TRANSLATION_ENGINES = "google-gtx,google-chrome";
  __setFakeDownload(async (url) => {
    if (url.includes("translate.googleapis.com") || url.includes("translate.google.com/translate_a/single")) {
      throw new HttpError(401, "http 401", url);
    }
    if (url.includes("translate_a/t")) {
      return Buffer.from(JSON.stringify(["olá mundo outro teste"]));
    }
    throw new HttpError(404, "unexpected", url);
  });
  const { results, stats } = await translateUnits([{ text: "hello world another test" }], { from: "en", to: "pt" });
  assert.equal(results[0], "olá mundo outro teste");
  assert.equal(stats.failures, 0);
  assert.ok(stats.enginesUsed.includes("google-chrome"));
});

test("cascata: falha em todos retorna unidades originais e marca falha", async () => {
  process.env.TRANSLATION_ENGINES = "google-gtx";
  __setFakeDownload(async () => {
    throw new HttpError(429, "http 429", "x");
  });
  const units = [{ text: "a" }, { text: "b" }];
  const { results, stats } = await translateUnits(units, { from: "en", to: "pt" });
  assert.deepEqual(results, ["a", "b"]);
  assert.equal(stats.failures, 2);
  assert.equal(stats.translatedUnits, 0);
});

test("cascata: mymemory usado como último recurso com chunks < 500 chars", async () => {
  process.env.TRANSLATION_ENGINES = "google-gtx,mymemory";
  __setFakeDownload(async (url) => {
    if (url.includes("translate.googleapis.com")) throw new HttpError(403, "http 403", url);
    if (url.includes("api.mymemory.translated.net")) {
      const u = new URL(url);
      const q = u.searchParams.get("q") || "";
      assert.ok(q.length <= 500, `chunk de ${q.length} chars ultrapassa limite`);
      const translatedLines = q.split("\n").map((l) => "[mm] " + l).join("\n");
      return Buffer.from(JSON.stringify({ responseData: { translatedText: translatedLines } }));
    }
    throw new HttpError(404, "unexpected", url);
  });
  const texts = [];
  for (let i = 0; i < 30; i++) texts.push({ text: `line number ${i} with content to fill the batch` });
  const { results, stats } = await translateUnits(texts, { from: "en", to: "pt" });
  assert.equal(stats.failures, 0);
  assert.ok(stats.enginesUsed.includes("mymemory"));
  assert.ok(results.every((r) => r.startsWith("[mm] ")));
  assert.ok(results.every((r) => r.length > 0));
});

test("circuit breaker: Google bloqueado não é tentado de novo em lotes seguintes", async () => {
  process.env.TRANSLATION_ENGINES = "google-gtx,google-chrome";
  let gtxCalls = 0;
  __setFakeDownload(async (url) => {
    if (url.includes("translate_a/single")) {
      gtxCalls++;
      throw new HttpError(401, "http 401", url);
    }
    if (url.includes("translate_a/t")) {
      return Buffer.from(JSON.stringify(["tr-line"]));
    }
    throw new HttpError(404, "unexpected", url);
  });

  const units = [];
  for (let i = 0; i < 1700; i++) units.push({ text: `line ${i}` });
  const { stats } = await translateUnits(units, { from: "en", to: "pt" });
  assert.ok(stats.batches >= 3, `batches=${stats.batches}`);
  assert.equal(stats.failures, 0);
  assert.equal(gtxCalls, 6, `gtx tentado ${gtxCalls} vez(es), esperado 6 (3 hosts no 1º e 2º lote, ignorado do 3º em diante; sem breaker seriam 9)`);
  assert.ok(stats.enginesUsed.includes("google-chrome"));
});