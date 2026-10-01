import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { cacheGet, cacheSet, cacheDelete, cacheInfo } from "../lib/cache.js";
import { sha1 } from "../lib/cache.js";

beforeEach(() => {
  cacheDelete("t1");
  cacheDelete("t2");
  cacheDelete("t3");
});

test("cache miss e hit", () => {
  assert.equal(cacheGet("t1"), null);
  cacheSet("t1", "valor", 60000);
  assert.equal(cacheGet("t1"), "valor");
});

test("cache TTL expira", async () => {
  cacheSet("t2", "x", 30);
  assert.equal(cacheGet("t2"), "x");
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(cacheGet("t2"), null);
});

test("conteúdo diferente não colide", () => {
  cacheSet("t1", "a", 60000);
  cacheSet("t2", "b", 60000);
  assert.equal(cacheGet("t1"), "a");
  assert.equal(cacheGet("t2"), "b");
});

test("sha1 é estável e diferente entre chaves", () => {
  const a = sha1("ep1|sub1|en|pt|ver");
  const b = sha1("ep1|sub1|en|pt|ver");
  const c = sha1("ep1|sub2|en|pt|ver");
  const d = sha1("ep1|sub1|fr|pt|ver");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
});

test("cacheInfo expõe métricas", () => {
  const i = cacheInfo();
  assert.ok(i.max > 0);
  assert.ok(i.ttlMs > 0);
  assert.ok(Number.isInteger(i.entries));
});