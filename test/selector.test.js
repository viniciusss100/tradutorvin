import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreSubtitle, pickBest } from "../lib/selector.js";

function cand(over) {
  return {
    id: "x",
    url: "https://subs5.strem.io/f",
    lang: "eng",
    lang2: "en",
    encoding: "UTF-8",
    m: "i",
    filename: "movie.srt",
    raw: {},
    ...over,
  };
}

test("SDH penalizada vs normal mesmo idioma", () => {
  const normal = cand({ filename: "movie.eng.srt" });
  const sdh = cand({ filename: "movie.eng.sdh.srt" });
  assert.ok(scoreSubtitle(normal) > scoreSubtitle(sdh));
});

test("forced penalizada", () => {
  const forced = cand({ filename: "movie.forced.srt" });
  const normal = cand({ filename: "movie.srt" });
  assert.ok(scoreSubtitle(normal) > scoreSubtitle(forced));
});

test("idioma já no target é rebaixado", () => {
  const pt = cand({ lang: "por", lang2: "pt" });
  assert.ok(scoreSubtitle(cand({ lang: "eng", lang2: "en" }), { targetLang: "pt" }) > scoreSubtitle(pt, { targetLang: "pt" }));
});

test("pickBest ordena por score", () => {
  const list = [cand({ filename: "movie.eng.sdh.srt" }), cand({ filename: "movie.eng.srt" })];
  const ranked = pickBest(list);
  assert.equal(ranked[0].filename, "movie.eng.srt");
});

test("legenda completa (duração longa) tem vantagem", () => {
  const short = cand({ filename: "x.srt", eventDurationSec: 60 });
  const long = cand({ filename: "y.srt", eventDurationSec: 5400 });
  assert.ok(scoreSubtitle(long) > scoreSubtitle(short));
});