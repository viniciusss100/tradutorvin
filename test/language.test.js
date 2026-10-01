import { test } from "node:test";
import assert from "node:assert/strict";
import { toGoogleLang, toBcp47, isSameLanguage, langLabel } from "../lib/language.js";

test("códigos 2 e 3 letras convergem", () => {
  assert.equal(toGoogleLang("eng"), "en");
  assert.equal(toGoogleLang("ger"), "de");
  assert.equal(toGoogleLang("fre"), "fr");
  assert.equal(toGoogleLang("deu"), "de");
  assert.equal(toGoogleLang("fra"), "fr");
  assert.equal(toGoogleLang("spa"), "es");
  assert.equal(toGoogleLang("por"), "pt");
  assert.equal(toGoogleLang("pob"), "pt");
  assert.equal(toGoogleLang("pt-BR"), "pt");
  assert.equal(toGoogleLang("en"), "en");
  assert.equal(toGoogleLang(""), "auto");
  assert.equal(toGoogleLang("any"), "auto");
  assert.equal(toGoogleLang("zho"), "zh");
  assert.equal(toGoogleLang("zht"), "zh");
  assert.equal(toGoogleLang("jpn"), "ja");
});

test("toBcp47 produz códigos válidos", () => {
  assert.equal(toBcp47("en"), "eng");
  assert.equal(toBcp47("pt"), "por");
  assert.equal(toBcp47("deu"), "deu");
  assert.equal(toBcp47("ger"), "deu");
});

test("isSameLanguage", () => {
  assert.equal(isSameLanguage("por", "pt"), true);
  assert.equal(isSameLanguage("pob", "pt"), true);
  assert.equal(isSameLanguage("deu", "ger"), true);
  assert.equal(isSameLanguage("eng", "spa"), false);
  assert.equal(isSameLanguage("en", "en"), true);
});

test("langLabel", () => {
  assert.equal(langLabel("eng"), "inglês");
  assert.equal(langLabel("por"), "português");
  assert.equal(langLabel("ja"), "japonês");
});