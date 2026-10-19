/* Läser av mätarställningen på ett foto av instrumentpanelen –
   Cloudflare Pages Function på /api/miltal.

   Appen läser först av siffrorna i telefonen. Den här funktionen är ett
   andra öga: Google Gemini (gratisnivån) tittar på samma foto och svarar med
   totalmätaren, eller med en instruktion till föraren när fotot inte räcker.
   Alla inloggade med en profil får använda den – det är förarna som fotar.

   Tar emot {image: "data:image/jpeg;base64,...", context: {...}} och svarar
   {km, confidence, message, candidates}. Kräver GEMINI_API_KEY. */

import { DEFAULT_PROJECT, verifyFirebaseToken, roleOf } from "../../lib/auth.js";
import { geminiJson, GeminiError } from "../../lib/gemini.js";
import { MILTAL_PROMPT } from "../../lib/miltal-prompt.js";

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const int = v => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 && n < 10000000 ? n : 0; };
const line = v => String(v == null ? "" : v).replace(/[\r\n]+/g, " ").slice(0, 80);

export async function onRequestPost({ request, env }) {
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT;
  if (!env.GEMINI_API_KEY) return json(503, { error: "AI-avläsningen är inte påslagen." });

  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  try {
    const uid = await verifyFirebaseToken(token, projectId);
    if (!(await roleOf(uid, token, projectId))) return json(403, { error: "Profilen saknas." });
  } catch (e) {
    return json(401, { error: e.message || "Ogiltig inloggning." });
  }

  let body;
  try { body = await request.json(); } catch { return json(400, { error: "Felaktig förfrågan." }); }
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.image || ""));
  if (!m) return json(400, { error: "Fotot saknas." });
  if (m[2].length > 4000000) return json(413, { error: "Fotot är för stort." });
  const c = body.context && typeof body.context === "object" ? body.context : {};
  const fas = c.phase === "slut" ? "slut" : "start";

  const kontext = [
    "KONTEXT",
    "- Fordon (modell): " + line(c.model),
    "- Regnr: " + line(c.regnr),
    "- Fas (start eller slut): " + fas,
    "- Startvärde för resan (bara vid slut): " + (fas === "slut" && int(c.startKm) ? int(c.startKm) : ""),
    "- Förra ställningen för bilen: " + (int(c.lastKm) || ""),
    "- Max rimligt hopp i km (lämna tomt för standard): "
  ].join("\n");

  try {
    const res = await geminiJson(env, {
      system: MILTAL_PROMPT,
      parts: [{ inline_data: { mime_type: m[1], data: m[2] } }, { text: kontext }],
      temperature: 0, maxTokens: 4096
    });
    const r = res.json || {};
    const km = int(r.odometer_km);
    const confidence = ["hög", "medel", "låg"].includes(r.confidence) ? r.confidence : "låg";
    const candidates = (Array.isArray(r.candidates) ? r.candidates : [])
      .map(x => ({ km: int(x && x.km), note: line(x && x.note) })).filter(x => x.km).slice(0, 4);
    return json(200, {
      km, confidence: km ? confidence : "låg",
      message: String(r.driver_message || "").slice(0, 300),
      raw: line(r.raw_text), status: line((r.plausibility || {}).status),
      candidates, model: res.model
    });
  } catch (e) {
    if (e instanceof GeminiError && e.status === 429) return json(429, { error: "Dagens gratiskvot för AI-avläsning är slut." });
    return json(502, { error: "AI-avläsningen svarade inte." });
  }
}
