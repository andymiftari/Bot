/* Googles Gemini via Google AI Studio – gratisnivån räcker för en liten firma.
   Nyckeln skapas på aistudio.google.com (Get API key) och läggs i Cloudflare
   som GEMINI_API_KEY. GEMINI_MODEL kan sättas för att låsa en viss modell;
   annars väljs den nyaste Flash-modellen som kontot har tillgång till, och
   nästa i listan prövas om en modell är slut på gratiskvot. */

const API = "https://generativelanguage.googleapis.com/v1beta";
const FALLBACK = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest", "gemini-2.5-flash-lite"];
let modelCache = { list: null, until: 0 };

export class GeminiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

/* Flash-modeller, nyaste först. Förhandsversioner och specialmodeller
   (bild, ljud, tts) hoppas över – de har snålare kvoter och ändras ofta. */
async function flashModels(key) {
  if (modelCache.list && Date.now() < modelCache.until) return modelCache.list;
  let found = [];
  try {
    const res = await fetch(API + "/models?pageSize=200", { headers: { "x-goog-api-key": key } });
    if (res.ok) {
      const body = await res.json();
      found = (body.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map(m => String(m.name || "").replace(/^models\//, ""))
        .map(n => { const m = /^gemini-(\d+(?:\.\d+)?)-flash(-lite)?$/.exec(n); return m ? { n, v: +m[1], lite: !!m[2] } : null; })
        .filter(Boolean)
        .sort((a, b) => (a.lite - b.lite) || (b.v - a.v))
        .map(x => x.n);
    }
  } catch { /* listan är bara en hjälp – reservlistan nedan räcker */ }
  const list = found.concat(FALLBACK.filter(n => !found.includes(n)));
  modelCache = { list, until: Date.now() + 6 * 3600e3 };
  return list;
}

async function generate(key, model, body) {
  const res = await fetch(API + "/models/" + encodeURIComponent(model) + ":generateContent", {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    let msg = "";
    try { msg = ((await res.json()).error || {}).message || ""; } catch { /* tomt svar */ }
    throw new GeminiError(msg || ("Gemini svarade med fel " + res.status), res.status);
  }
  return res.json();
}

/* Kör en förfrågan mot första modellen som svarar. Slut på kvot (429),
   okänd modell (404) eller tillfälligt fel (5xx) går vidare till nästa. */
export async function geminiCall(env, body, onModel) {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new GeminiError("GEMINI_API_KEY saknas.", 503);
  const models = env.GEMINI_MODEL ? [env.GEMINI_MODEL] : (await flashModels(key)).slice(0, 4);
  let last = null;
  for (const model of models) {
    try {
      if (onModel) onModel(model);
      const out = await generate(key, model, body);
      return { model, out };
    } catch (e) {
      last = e;
      if (!(e instanceof GeminiError) || !(e.status === 429 || e.status === 404 || e.status >= 500)) throw e;
    }
  }
  throw last || new GeminiError("Ingen Gemini-modell svarade.", 503);
}

/* Texten i svaret, utan modellens egna tankar. */
export function geminiText(out) {
  const c = (out.candidates || [])[0] || {};
  return ((c.content || {}).parts || []).filter(p => p.text && !p.thought).map(p => p.text).join("");
}

/* Första JSON-objektet i en text, även om det står i ett kodblock. */
export function extractJson(text) {
  const t = String(text || "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

/* Förfrågan som ska svara med ett JSON-objekt. Utan verktyg kan Gemini
   tvingas till ren JSON; med Google-sökning läses JSON ur texten i stället. */
export async function geminiJson(env, { system, parts, search = false, temperature = 0.2, maxTokens = 16384 }, onModel) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    generationConfig: { temperature, maxOutputTokens: maxTokens }
  };
  if (search) body.tools = [{ google_search: {} }];
  else body.generationConfig.responseMimeType = "application/json";
  const { model, out } = await geminiCall(env, body, onModel);
  const c = (out.candidates || [])[0] || {};
  if (!c.content && (out.promptFeedback || {}).blockReason) throw new GeminiError("Gemini avböjde förfrågan.", 400);
  const text = geminiText(out);
  const meta = c.groundingMetadata || {};
  const sources = (meta.groundingChunks || []).map(g => g.web).filter(Boolean)
    .map(w => ({ title: w.title || "", uri: w.uri || "" }));
  return { model, text, json: extractJson(text), queries: meta.webSearchQueries || [], sources, finish: c.finishReason || "" };
}
