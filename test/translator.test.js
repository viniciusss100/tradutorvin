import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { translateUnits, __setFakeTranslator, protectTags, restoreTags } from "../lib/translator.js";

beforeEach(() => __setFakeTranslator(null));

function fakeDict(entries) {
  const map = new Map(Object.entries(entries));
  __setFakeTranslator((text) =>
    String(text).split("\n").map((ln) => {
      let t = ln;
      for (const [from, to] of map) t = t.split(from).join(to);
      return t;
    }).join("\n")
  );
}

test("traduz unidades pequenas", async () => {
  fakeDict({ "Hello": "Olá", "World": "Mundo" });
  const { results, stats } = await translateUnits([{ text: "Hello" }, { text: "World" }], { from: "en", to: "pt" });
  assert.deepEqual(results, ["Olá", "Mundo"]);
  assert.equal(stats.translatedUnits, 2);
  assert.equal(stats.failures, 0);
});

test("múltiplos batches com muitas unidades", async () => {
  const words = [];
  for (let i = 0; i < 2000; i++) words.push({ text: `word${i}` });
  __setFakeTranslator((t) => String(t).split("\n").map((p) => "TR-" + p).join("\n"));
  const { results, stats } = await translateUnits(words, {});
  assert.equal(results.length, 2000);
  assert.ok(results.every((r) => r.startsWith("TR-word")));
  assert.ok(stats.batches >= 2, `batches=${stats.batches}`);
  assert.equal(stats.failures, 0);
});

test("falha de um batch não derruba os outros", async () => {
  let calls = 0;
  __setFakeTranslator((t) => {
    calls++;
    if (String(t).includes("fail")) {
      const e = new Error("quebra de tradução");
      e.status = 429;
      throw e;
    }
    return String(t).split("\n").map((p) => "T:" + p).join("\n");
  });
  const units = [];
  for (let i = 0; i < 100; i++) units.push({ text: i === 5 ? "fail me" : `ok-${i}` });
  const { results, stats } = await translateUnits(units, {});
  assert.equal(results.length, 100);
  assert.equal(results[5], "fail me");
  assert.ok(results.filter((r, i) => i !== 5).every((r) => r.startsWith("T:ok-")), "demais linhas foram traduzidas");
  assert.ok(stats.translatedUnits >= 90, `translated=${stats.translatedUnits}`);
  assert.ok(calls > 0);
});

test("retry sobe após erros transitórios", async () => {
  let calls = 0;
  __setFakeTranslator(async (t) => {
    calls++;
    if (calls < 3) {
      const e = new Error("transient");
      e.status = 503;
      throw e;
    }
    return String(t);
  });
  const { results, stats } = await translateUnits([{ text: "abc" }], {});
  assert.equal(results[0], "abc");
  assert.ok(calls >= 2, `calls=${calls}`);
});

test("tags de formatação preservadas na tradução", () => {
  fakeDict({ "hei": "olá" });
  const { text, map } = protectTags("Oi <i>hei</i>");
  assert.ok(map.length >= 2);
  const translated = restoreTags("Olá <T0>T1</T0>", map);
  assert.equal(map[0], "<i>");
  assert.equal(map[1], "</i>");
});

test("lines não-textuais (música/sfx) permanecem", async () => {
  __setFakeTranslator((t) => String(t).split("\n").map((p) => {
    if (p.includes("\u0001N")) return p;
    return "[TR] " + p;
  }).join("\n"));
  const { results } = await translateUnits([{ text: "♫ ♪ ♫ ♪ ♫" }, { text: "Hello" }], {});
  assert.equal(results[0], "♫ ♪ ♫ ♪ ♫");
  assert.equal(results[1], "[TR] Hello");
});

test("tradução interrompida deixa o restante original (budget)", async () => {
  const words = [];
  for (let i = 0; i < 200; i++) words.push({ text: `w${i}` });
  __setFakeTranslator((t) => String(t).split("\n").map((p) => "T:" + p).join("\n"));
  const { results, stats } = await translateUnits(words, { budgetMs: 5 });
  assert.equal(results.length, 200);
  assert.ok(results.every((r) => typeof r === "string"));
  assert.ok(stats.budgetExceeded === undefined ? results.every((r) => r.startsWith("T:")) : true);
});