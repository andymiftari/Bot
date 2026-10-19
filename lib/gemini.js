/* Googles Gemini via Google AI Studio – gratisnivån räcker för en liten firma.
   Nyckeln skapas på aistudio.google.com (Get API key) och läggs i Cloudflare
   som GEMINI_API_KEY.

   Varje uppgift får den modell som passar den bäst bland dem kontot når:
     kalkyl  – Pro först (bäst på att resonera och räkna), annars Flash,
               och den tänker grundligt.
     miltal  – Flash först (snabb och stark på bilder – föraren väntar),
               och den tänker måttligt.
   Är en modell slut på gratiskvot, eller inte öppen för kontot, prövas nästa.
   GEMINI_MODEL_KALKYL eller GEMINI_MODEL_MILTAL låser en viss modell. */

const API = "https://generativelanguage.googleapis.com/v1beta";
const FALLBACK = ["gemini-pro-latest", "gemini-2.5-pro", "gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest", "gemini-2.5-flash-lite"];
const TASKS = {
  kalkyl: { order: ["pro", "flash", "lite"], think: "high", tries: 5 },
  miltal: { order: ["flash", "pro", "lite"], think: "medium", tries: 3 },
  /* bara att ställa upp en färdig text som JSON – det enklaste och snabbaste räcker */
  format: { order: ["flash", "lite", "pro"], think: "low", tries: 3 }
};
const familyOf = n => /-flash-lite/.test(n) ? "lite" : /-flash/.test(n) ? "flash" : /-pro/.test(n) ? "pro" : "";
let modelCache = { list: null, until: 0 };

export class GeminiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

/* Stabila Pro-, Flash- och Flash-Lite-modeller, nyaste först inom varje sort.
   Förhandsversioner och specialmodeller (bild, ljud, tts) hoppas över – de
   har snålare kvoter och ändras ofta. */
async function allModels(key) {
  if (modelCache.list && Date.now() < modelCache.until) return modelCache.list;
  let found = [];
  try {
    const res = await fetch(API + "/models?pageSize=200", { headers: { "x-goog-api-key": key } });
    if (res.ok) {
      const body = await res.json();
      found = (body.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map(m => String(m.name || "").replace(/^models\//, ""))
        .map(n => { const m = /^gemini-(\d+)(?:\.(\d+))?-(pro|flash|flash-lite)$/.exec(n); return m ? { n, v: +m[1] * 100 + (+m[2] || 0) } : null; })
        .filter(Boolean)
        .sort((a, b) => b.v - a.v)
        .map(x => x.n);
    }
  } catch { /* listan är bara en hjälp – reservlistan nedan räcker */ }
  const list = found.length ? found : FALLBACK;
  modelCache = { list, until: Date.now() + 6 * 3600e3 };
  return list;
}

function modelsFor(list, task) {
  const t = TASKS[task] || TASKS.kalkyl;
  /* högst två av varje sort, så att en sort som är stängd inte äter upp försöken */
  return t.order.flatMap(f => list.filter(n => familyOf(n) === f).slice(0, 2)).slice(0, t.tries);
}

/* Hur mycket modellen ska tänka. Gemini 3 och senare tar en nivå, 2.5 en budget. */
function thinkingFor(model, level) {
  const m = /^gemini-(\d+)/.exec(model);
  if (!m || !level) return null;
  if (+m[1] >= 3) return { thinkingLevel: level };
  return { thinkingBudget: level === "high" ? -1 : level === "medium" ? 4096 : 1024 };
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
export async function geminiCall(env, body, onModel, task = "kalkyl") {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new GeminiError("GEMINI_API_KEY saknas.", 503);
  const locked = env["GEMINI_MODEL_" + task.toUpperCase()] || env.GEMINI_MODEL;
  const models = locked ? [locked] : modelsFor(await allModels(key), task);
  const think = (TASKS[task] || TASKS.kalkyl).think;
  let last = null;
  for (const model of models) {
    try {
      if (onModel) onModel(model);
      const tc = thinkingFor(model, think);
      const withThink = tc ? { ...body, generationConfig: { ...body.generationConfig, thinkingConfig: tc } } : body;
      try {
        return { model, out: await generate(key, model, withThink) };
      } catch (e) {
        /* Modeller som inte kan styras på det sättet körs med sitt eget förval. */
        if (!tc || !(e instanceof GeminiError) || e.status !== 400 || !/think/i.test(e.message)) throw e;
        return { model, out: await generate(key, model, body) };
      }
    } catch (e) {
      last = e;
      /* 403 här är oftast en modell som inte ingår i gratisnivån. */
      if (!(e instanceof GeminiError) || !(e.status === 429 || e.status === 404 || e.status === 403 || e.status >= 500)) throw e;
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
export async function geminiJson(env, { system, parts, search = false, temperature = 0.2, maxTokens = 16384, task = "kalkyl" }, onModel) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    generationConfig: { temperature, maxOutputTokens: maxTokens }
  };
  if (search) body.tools = [{ google_search: {} }];
  else body.generationConfig.responseMimeType = "application/json";
  const { model, out } = await geminiCall(env, body, onModel, task);
  const c = (out.candidates || [])[0] || {};
  if (!c.content && (out.promptFeedback || {}).blockReason) throw new GeminiError("Gemini avböjde förfrågan.", 400);
  const text = geminiText(out);
  const meta = c.groundingMetadata || {};
  const sources = (meta.groundingChunks || []).map(g => g.web).filter(Boolean)
    .map(w => ({ title: w.title || "", uri: w.uri || "" }));
  return { model, text, json: extractJson(text), queries: meta.webSearchQueries || [], sources, finish: c.finishReason || "" };
}
