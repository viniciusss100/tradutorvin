export const ALGO_VERSION = "3.0.0";

const TWO_TO_THREE = {
  en: "eng", es: "spa", fr: "fra", de: "deu", it: "ita", pt: "por",
  pl: "pol", tr: "tur", ru: "rus", ar: "ara", zh: "zho", ko: "kor",
  hi: "hin", ja: "jpn", nl: "nld", sv: "swe", no: "nor", da: "dan",
  fi: "fin", cs: "ces", el: "ell", hu: "hun", he: "heb", ro: "ron",
  bg: "bul", vi: "vie", id: "ind", hr: "hrv", sr: "srp", bs: "bos",
  sl: "slv", mk: "mkd", sk: "slk", uk: "ukr", et: "est", lv: "lav",
  lt: "lit", th: "tha", ms: "msa", tl: "tgl", fa: "per", az: "aze",
  ka: "kat", hy: "hye", ku: "kur", bn: "ben", ur: "urd", ta: "tam",
  te: "tel", ml: "mal", kn: "kan", sw: "swa", am: "amh", yo: "yor",
  zu: "zul", af: "afr", is: "isl", mt: "mlt", sq: "sqi", be: "bel",
  lb: "ltz", ga: "gle", cy: "cym", la: "lat", eo: "epo",
};

const THREE_TO_TWO = {};
for (const [k, v] of Object.entries(TWO_TO_THREE)) THREE_TO_TWO[v] = k;
THREE_TO_TWO.pob = "pt";
THREE_TO_TWO.pbr = "pt";
THREE_TO_TWO.ptb = "pt";
THREE_TO_TWO.ger = "de";
THREE_TO_TWO.fre = "fr";

const ALIASES = {
  "pt-br": "pt", "pt-pt": "pt", "zh-cn": "zh", "zh-tw": "zh",
  "zht": "zh", "zhs": "zh", "cmn": "zh", "yue": "zh",
  "slv": "sl", "hrv": "hr",
};

const clean = (c) => String(c || "").trim().toLowerCase().replace(/[_-]/g, "-");

export function toGoogleLang(langCode) {
  const c = clean(langCode);
  if (!c) return "auto";
  if (c === "auto" || c === "any") return "auto";
  if (ALIASES[c]) return ALIASES[c];
  if (TWO_TO_THREE[c]) return c;
  if (THREE_TO_TWO[c]) return THREE_TO_TWO[c];
  return c;
}

export function toBcp47(langCode) {
  const c = clean(langCode);
  if (!c) return "und";
  const g = toGoogleLang(c);
  return TWO_TO_THREE[g] || THREE_TO_TWO[g] || (TWO_TO_THREE[c] || c);
}

export function isSameLanguage(a, b) {
  return toGoogleLang(a) === toGoogleLang(b);
}

export function langLabel(langCode) {
  const g = toGoogleLang(langCode);
  const names = {
    en: "inglês", es: "espanhol", fr: "francês", de: "alemão", it: "italiano",
    pt: "português", pl: "polonês", tr: "turco", ru: "russo", ar: "árabe",
    zh: "chinês", ko: "coreano", hi: "hindi", ja: "japonês", nl: "holandês",
    sv: "sueco", no: "norueguês", da: "dinamarquês", fi: "finlandês",
    cs: "tcheco", el: "grego", hu: "húngaro", he: "hebraico", ro: "romeno",
    bg: "búlgaro", vi: "vietnamita", id: "indonésio", hr: "croata",
  };
  return names[g] || g.toUpperCase();
}