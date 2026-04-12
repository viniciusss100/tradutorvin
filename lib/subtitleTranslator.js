import { translate } from "@vitalets/google-translate-api";

async function translateBatch(texts, from, to, apiKey) {
  if (!texts.length) return [];
  const SEP    = "\n@@@\n";
  const joined = texts.join(SEP);
  try {
    const opts = { from, to };
    if (apiKey) opts.fetchOptions = { headers: { "X-Goog-Api-Key": apiKey } };
    const result = await translate(joined, opts);
    return result.text.split(SEP);
  } catch (err) {
    console.error("[subtrans] Google Translate erro:", err.message);
    return texts; // fallback: retorna originais
  }
}

export async function translateSrt(srtText, from = "en", to = "pt", apiKey = null) {
  const lines       = srtText.split(/\r?\n/);
  const textIndices = [];
  const textValues  = [];

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!/^\d+$/.test(t) && !t.includes("-->") && t !== "") {
      textIndices.push(i);
      textValues.push(lines[i]);
    }
  }

  console.log("[subtrans] Traduzindo", textValues.length, "linhas", from, "->", to);

  const BATCH      = 500;
  const translated = [...lines];

  for (let b = 0; b < textValues.length; b += BATCH) {
    const bTexts   = textValues.slice(b, b + BATCH);
    const bIndices = textIndices.slice(b, b + BATCH);
    const results  = await translateBatch(bTexts, from, to, apiKey);
    for (let i = 0; i < bIndices.length; i++) {
      translated[bIndices[i]] = results[i] ?? lines[bIndices[i]];
    }
  }

  console.log("[subtrans] Tradução concluída.");
  return translated.join("\n");
}
