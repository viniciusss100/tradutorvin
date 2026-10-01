import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCues, applyOffset, computeOffsets, textSimilarity } from "../lib/syncer.js";

function cuesFrom(list) {
  return list.map(([start, end, text], i) => ({ index: i + 1, start, end, text }));
}

test("normalizeCues preserva timestamps válidos sem alteração", () => {
  const inCues = cuesFrom([[1000, 2500, "a"], [3000, 4500, "b"], [5000, 6000, "c"]]);
  const out = normalizeCues(inCues);
  assert.deepEqual(out.map((c) => [c.start, c.end]), [[1000, 2500], [3000, 4500], [5000, 6000]]);
});

test("normalizeCues corrige end menor que start", () => {
  const out = normalizeCues(cuesFrom([[2000, 1000, "a"]]), {});
  assert.ok(out[0].end >= out[0].start);
});

test("normalizeCues corrige duração negativa e overlap", () => {
  const out = normalizeCues(cuesFrom([[1000, 1500, "a"], [1200, 2000, "b"]]));
  assert.ok(out[1].start >= out[0].end);
});

test("normalizeCues ordena fora de ordem", () => {
  const out = normalizeCues(cuesFrom([[5000, 6000, "a"], [1000, 2000, "b"]]));
  assert.ok(out[0].start < out[1].start);
});

test("applyOffset global", () => {
  const out = applyOffset(cuesFrom([[1000, 2000, "a"]]), 1500);
  assert.deepEqual([out[0].start, out[0].end], [2500, 3500]);
  const neg = applyOffset(cuesFrom([[1000, 2000, "a"]]), -1500);
  assert.equal(neg[0].start, 0);
});

test("computeOffsets detecta offset quando ref está atrasada", () => {
  const ref = cuesFrom([
    [1200, 2500, "Hello world"],
    [3500, 4600, "How are you"],
    [5600, 6800, "Fine thanks"],
    [7800, 9000, "Goodbye my friend"],
  ]);
  const target = ref.map((c) => ({ ...c, start: c.start - 1000, end: c.end - 1000 }));
  const r = computeOffsets(ref, target);
  assert.ok(r, "deveria encontrar alinhamento");
  assert.equal(r.offset, 1000);
});

test("computeOffsets retorna null para legendas diferentes", () => {
  const ref = cuesFrom([[1000, 2000, "one two three four"], [3000, 4000, "qwerty asdf"]]);
  const target = cuesFrom([[15000, 16000, "completely different text here with no matches"], [20000, 21000, "nothing in common at all"]]);
  const r = computeOffsets(ref, target);
  assert.ok(r === null || (r.matchedBuckets || 0) < 3);
});

test("textSimilarity", () => {
  assert.ok(textSimilarity("Hello world", "hello world") > 0.9);
  assert.ok(textSimilarity("Hello world", "xyz") < 0.5);
});

test("normalizeCues verifica sintaxe básica (timestamp válidos)", () => {
  const out = normalizeCues(cuesFrom([[1000, 2000, "oi"]]));
  assert.ok(Number.isFinite(out[0].start));
  assert.ok(out[0].end > out[0].start);
});