/* AI-kalkyl för offerter – Cloudflare Pages Function på /api/kalkyl.

   Tar emot kundens förfrågan och firmans förval från appen, låter Claude söka
   aktuella priser på webben och räkna fram arbete, material och resor, och
   skickar tillbaka raderna. Bara inloggade superadmin- och supportkonton får
   använda den, så att ingen annan kan förbruka API-krediter.

   Svaret strömmas som en rad JSON per händelse (NDJSON):
     {"status":"..."}   lägesrapporter medan kalkylen pågår
     {"result":{...}}   den färdiga kalkylen
     {"error":"..."}    om något gick fel

   Två sätt att köra den (Cloudflare: Settings → Variables and Secrets):
     GEMINI_API_KEY     gratis via Google AI Studio – söker priser med Google
     ANTHROPIC_API_KEY  Claude, kostar per kalkyl men räknar noggrannare
   Finns båda används Claude. FIREBASE_PROJECT_ID kan sättas om projektet
   byter namn. */

import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_PROJECT, verifyFirebaseToken, roleOf } from "../../lib/auth.js";
import { geminiJson, GeminiError } from "../../lib/gemini.js";

const MODEL = "claude-opus-5-5";
const MAX_CONTINUATIONS = 6;

/* ------------------------------ kalkylen ------------------------------ */

const SYSTEM = `Du är kalkylator på en svensk smidesverkstad som tillverkar och monterar räcken, trappor, grindar, staket, balkonger, stålkonstruktioner och andra smidesarbeten i svart stål, varmförzinkat och rostfritt. Du läser en kundförfrågan och tar fram en komplett kalkyl som ett offertunderlag. Raderna du lämnar förs direkt in i firmans offertverktyg, som själv räknar summor och moms.

Arbeta så här:

1. Förstå jobbet: typ av arbete, mått, material, ytbehandling, plats, montering, önskad tid, och om kunden är privatperson eller företag.
2. Hitta luckorna (mått, antal, materialval, ytbehandling, infästning, underlag, åtkomst, ritning, regler). Gör ett rimligt antagande för varje lucka så att du ändå kan räkna, och skriv ut varje antagande. Gissa aldrig utan att säga att det är ett antagande.
3. Mängdavtagning: räkna materialet rad för rad med profil och dimension (t.ex. VKR 40x40x3, plattstång 40x8, rundstång Ø12), längd, vikt där det är relevant, antal, beslag, infästningar, skruv, expander, gångjärn, lås. Lägg 10 % spill på stångmaterial och skriv det i radens beskrivning eller i antagandena.
4. Priser: sök aktuella priser på webben för material, förzinkning, pulverlackering, rostfritt och beslag. Räkna om varje pris till inköpspris exkl. moms (konsumentpriser inkl. moms delas med 1,25, och ett konsumentpris ligger normalt över en verkstads inköpspris – säg i källan att det är ett konsumentpris). Ange källa (leverantör eller länk) för varje materialrad. Hittar du inget pris: uppskatta, sätt estimated=true och förklara uppskattningen i källfältet. Hitta aldrig på ett pris och påstå att det är hämtat.
5. Arbetstid: bryt ner i moment (uppmätning/besök, ritning, kapning, borrning, bockning, svetsning, slipning, ytbehandling eller transport till förzinkning/lack, lastning, montering, städning). Två personer vid tunga lyft räknas som dubbla timmar och skrivs ut i beskrivningen. Avrunda till närmaste halvtimme.
6. Resor: antal resor (besök, montering, ev. förzinkare) gånger tur och retur i mil från verkstaden.
7. Risk: bedöm osäkerheten (låg/medel/hög). Vid medel eller hög, lägg en arbetsrad "Reserv för oförutsett" och förklara varför i antagandena.
8. Rimlighetskontroll: jämför slutsumman med vad liknande jobb brukar kosta och säg om den ligger lågt, normalt eller högt.

Regler:
- Skriv på svenska.
- Alla priser är exkl. moms. Moms är 25 % och läggs på av offertverktyget.
- Använd firmans timpris för arbetsraderna och firmans milpris för resorna. Saknas något av dem, använd en rimlig nivå för en svensk smidesverkstad och skriv det som ett antagande.
- Använd firmans påslag på material om inget särskilt talar emot det.
- Kunden ser aldrig inköpspris eller påslag. Beskrivningen av arbetet (intro) och mejlet får därför aldrig nämna dem.
- Är förfrågan för otydlig för att räkna: räkna ändå på det mest troliga utförandet, sätt confidence till "låg", och lägg tyngden på frågorna till kunden.
- Får du FIRMANS KUNSKAP gäller den före allt annat: priser i firmans egen prislista används i stället för webbpriser (skriv "Egen prislista" som källa och estimated=false), tidsnormerna används för timmarna, och de fasta reglerna följs alltid. De lärda exemplen visar hur firman faktiskt räknar liknande jobb: lägg dig på samma nivå för timmar, påslag och resor. Där ett exempel säger att AI:n först räknade fel, eller där utfallet i projektet blev ett annat, rätta åt samma håll. Skriv i sanity vilket exempel du jämfört med och hur din kalkyl förhåller sig till det.
- När du är klar: anropa verktyget spara_kalkyl exakt en gång med hela kalkylen. Skriv ingen annan slutsammanfattning.`;

const STR = { type: "string" };
const NUM = { type: "number" };
const obj = (props) => ({ type: "object", additionalProperties: false, required: Object.keys(props), properties: props });

const SAVE_TOOL = {
  name: "spara_kalkyl",
  description: "Sparar den färdiga kalkylen i offertverktyget. Anropas en gång, när kalkylen är klar.",
  strict: true,
  input_schema: obj({
    summary: { ...STR, description: "3–5 meningar: vad jobbet är, ungefärligt totalpris exkl. moms och hur säker kalkylen är." },
    confidence: { type: "string", enum: ["låg", "medel", "hög"] },
    customer: obj({ name: STR, contact: STR, address: STR, email: STR, phone: STR }),
    title: { ...STR, description: "En rad, t.ex. \"Trappräcke i rostfritt till entrén\"." },
    intro: { ...STR, description: "3–6 meningar till kunden om vad som ingår och inte ingår. Inga interna siffror." },
    work: { type: "array", items: obj({ desc: STR, hours: NUM, price: { ...NUM, description: "Timpris kr exkl. moms" } }) },
    material: { type: "array", items: obj({
      desc: STR, qty: NUM, unit: { ...STR, description: "st, m, kg eller post" },
      cost: { ...NUM, description: "Inköpspris per enhet kr exkl. moms" },
      markup: { ...NUM, description: "Påslag i procent" },
      source: { ...STR, description: "Leverantör eller länk och datum, eller hur uppskattningen gjorts" },
      estimated: { type: "boolean" }
    }) },
    travel: { type: "array", items: obj({ desc: STR, mil: NUM, price: { ...NUM, description: "Pris per mil kr exkl. moms" } }) },
    assumptions: { type: "array", items: STR },
    questions: { type: "array", items: STR, description: "Högst sex frågor till kunden, formulerade för ett mejl." },
    risks: { type: "array", items: STR },
    sanity: { ...STR, description: "Rimlighetskontrollen: lågt, normalt eller högt jämfört med liknande jobb, och varför." },
    mail_text: { ...STR, description: "Kort, vänligt mejl till kunden som följer med offerten. Nämn giltighetstiden och de viktigaste antagandena, och ställ de kritiska frågorna. Nämn inte totalbeloppet med siffror – offertverktyget lägger till det." }
  })
};

function firmText(f) {
  const v = (x, unit) => (+x ? x + " " + unit : "ej angivet");
  const addr = f.workshop || [f.address, [f.zip, f.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [
    "Firma: " + (f.name || "Ellinge Smidesservice AB"),
    "Timpris arbete, exkl. moms: " + v(f.rate, "kr/tim"),
    "Påslag på material: " + (f.markup != null && f.markup !== "" ? f.markup + " %" : "15 %"),
    "Milersättning resor: " + v(f.milPrice, "kr/mil"),
    "Verkstadens adress: " + (addr || "ej angiven"),
    "Offertens giltighet: " + (f.validDays || 30) + " dagar",
    "Betalningsvillkor: " + (f.payTerms || "30 dagar netto"),
    f.aiHints ? "\nFirmans egna anvisningar till kalkylen:\n" + f.aiHints : ""
  ].join("\n");
}

/* ------------------------------- Gemini -------------------------------- */

const JSON_SHAPE = `{"summary":"","confidence":"låg|medel|hög","customer":{"name":"","contact":"","address":"","email":"","phone":""},"title":"","intro":"","work":[{"desc":"","hours":0,"price":0}],"material":[{"desc":"","qty":0,"unit":"st","cost":0,"markup":0,"source":"","estimated":false}],"travel":[{"desc":"","mil":0,"price":0}],"assumptions":[""],"questions":[""],"risks":[""],"sanity":"","mail_text":""}`;

function fieldNotes(props, prefix) {
  return Object.keys(props).flatMap(k => {
    const p = props[k], name = prefix + k;
    const own = p.description ? ["- " + name + ": " + p.description] : [];
    const inner = p.type === "object" ? fieldNotes(p.properties, name + ".")
      : (p.type === "array" && p.items && p.items.type === "object") ? fieldNotes(p.items.properties, name + "[].") : [];
    return own.concat(inner);
  });
}

const JSON_RULE = "- När du är klar: svara med enbart ett JSON-objekt med exakt den här formen (inga andra fält, ingen text före eller efter):\n"
  + JSON_SHAPE + "\n\nFälten:\n" + fieldNotes(SAVE_TOOL.input_schema.properties, "").join("\n")
  + "\n- confidence är ett av låg, medel, hög. Belopp och antal är tal utan enhet och utan mellanslag.";
const SYSTEM_GEMINI = SYSTEM.replace(
  "- När du är klar: anropa verktyget spara_kalkyl exakt en gång med hela kalkylen. Skriv ingen annan slutsammanfattning.", JSON_RULE);

const str = v => (v == null ? "" : String(v)).trim();
const num = v => { const n = typeof v === "number" ? v : parseFloat(String(v || "").replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
const strs = a => (Array.isArray(a) ? a : []).map(str).filter(Boolean);

/* Gemini följer formen ungefär – den här ser till att appen får exakt den. */
function normalize(r) {
  const c = r.customer || {};
  return {
    summary: str(r.summary),
    confidence: ["låg", "medel", "hög"].includes(str(r.confidence)) ? str(r.confidence) : "låg",
    customer: { name: str(c.name), contact: str(c.contact), address: str(c.address), email: str(c.email), phone: str(c.phone) },
    title: str(r.title), intro: str(r.intro),
    work: (Array.isArray(r.work) ? r.work : []).map(w => ({ desc: str(w.desc), hours: num(w.hours), price: num(w.price) })).filter(w => w.desc || w.hours),
    material: (Array.isArray(r.material) ? r.material : []).map(m => ({
      desc: str(m.desc), qty: num(m.qty), unit: str(m.unit) || "st", cost: num(m.cost), markup: num(m.markup),
      source: str(m.source), estimated: m.estimated === true || m.estimated === "true" })).filter(m => m.desc || m.qty),
    travel: (Array.isArray(r.travel) ? r.travel : []).map(t => ({ desc: str(t.desc), mil: num(t.mil), price: num(t.price) })).filter(t => t.desc || t.mil),
    assumptions: strs(r.assumptions), questions: strs(r.questions).slice(0, 6), risks: strs(r.risks),
    sanity: str(r.sanity), mail_text: str(r.mail_text)
  };
}

async function runGemini(env, userText, send) {
  const onModel = m => send({ status: "Räknar med " + m + " och söker priser med Google …" });
  let res;
  try {
    res = await geminiJson(env, { system: SYSTEM_GEMINI, parts: [{ text: userText }], search: true, temperature: 0.3, maxTokens: 32768 }, onModel);
  } catch (e) {
    /* Googlesökningen har en egen kvot – räkna utan den hellre än inte alls. */
    if (!(e instanceof GeminiError) || e.status === 503) throw e;
    send({ status: "Prissökningen är inte tillgänglig just nu – räknar med uppskattade priser …" });
    res = await geminiJson(env, { system: SYSTEM_GEMINI + "\n\nWebbsökning är inte tillgänglig: uppskatta alla priser och sätt estimated=true.",
      parts: [{ text: userText }], temperature: 0.3, maxTokens: 32768 });
  }
  if (res.queries.length) send({ status: "Sökte: " + res.queries.slice(0, 4).join(" · ") });
  let r = res.json;
  if (!r) {
    if (!res.text) throw new Error("AI:n gav inget svar" + (res.finish ? " (" + res.finish + ")" : "") + ". Försök igen.");
    send({ status: "Ställer upp raderna …" });
    const fix = await geminiJson(env, { system: JSON_RULE.replace(/^- /, ""), temperature: 0, task: "format",
      parts: [{ text: "Gör om kalkylen nedan till JSON-objektet. Ändra inga siffror och hitta inte på något.\n\n" + res.text }] });
    r = fix.json;
  }
  if (!r) throw new Error("AI:n svarade i fel form. Försök igen.");
  const out = normalize(r);
  /* Länkarna Google faktiskt använde, så att priserna går att kontrollera. */
  if (res.sources.length) out.assumptions.push("Källor från prissökningen: " + res.sources.slice(0, 8).map(s => s.title || s.uri).join(", ") + ".");
  out.assumptions.push("Räknad med Google Gemini (" + res.model + ", gratisnivå). Kontrollera priserna innan offerten skickas.");
  return out;
}

/* ------------------------------- anropet ------------------------------- */

export async function onRequestPost({ request, env, waitUntil }) {
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT;
  const json = (status, body) => new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });

  if (!env.ANTHROPIC_API_KEY && !env.GEMINI_API_KEY)
    return json(503, { error: "AI-kalkylen är inte påslagen: lägg in GEMINI_API_KEY (gratis) i Cloudflare." });

  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  try {
    const uid = await verifyFirebaseToken(token, projectId);
    const role = await roleOf(uid, token, projectId);
    if (role !== "admin" && role !== "support") return json(403, { error: "Bara superadmin kan använda AI-kalkylen." });
  } catch (e) {
    return json(401, { error: e.message || "Ogiltig inloggning." });
  }

  let body;
  try { body = await request.json(); } catch { return json(400, { error: "Felaktig förfrågan." }); }
  const mail = String(body.mail || "").trim().slice(0, 30000);
  if (!mail) return json(400, { error: "Klistra in kundens förfrågan först." });
  const firm = body.firm && typeof body.firm === "object" ? body.firm : {};
  const today = String(body.today || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const knowledge = String(body.knowledge || "").trim().slice(0, 40000);

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = (o) => writer.write(enc.encode(JSON.stringify(o) + "\n")).catch(() => {});
  const beat = setInterval(() => send({ status: "" }), 10000);

  const work = (async () => {
    try {
      const userText = "Dagens datum: " + today + "\n\n" + firmText(firm)
        + (knowledge ? "\n\nFIRMANS KUNSKAP (inlärd av firman själv):\n<kunskap>\n" + knowledge + "\n</kunskap>" : "")
        + "\n\nKundens förfrågan:\n<forfragan>\n" + mail + "\n</forfragan>";
      send({ status: "Läser förfrågan …" });
      if (!env.ANTHROPIC_API_KEY) { send({ result: await runGemini(env, userText, send) }); return; }

      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
      const messages = [{ role: "user", content: userText }];

      let result = null;
      for (let round = 0; round <= MAX_CONTINUATIONS && !result; round++) {
        const stream = client.beta.messages.stream({
          model: MODEL,
          max_tokens: 64000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          thinking: { type: "adaptive" },
          output_config: { effort: "high" },
          system: SYSTEM,
          tools: [
            { type: "web_search_20260209", name: "web_search", max_uses: 15, user_location: { type: "approximate", country: "SE" } },
            SAVE_TOOL
          ],
          tool_choice: { type: "auto" },
          messages
        });
        stream.on("contentBlock", (block) => {
          if (block.type === "server_tool_use" && block.name === "web_search" && block.input && block.input.query) {
            send({ status: "Söker: " + block.input.query });
          }
        });
        const msg = await stream.finalMessage();

        if (msg.stop_reason === "refusal") throw new Error("AI:n avböjde att räkna på förfrågan.");
        const call = msg.content.find(b => b.type === "tool_use" && b.name === "spara_kalkyl");
        if (call) { result = call.input; break; }

        messages.push({ role: "assistant", content: msg.content });
        if (msg.stop_reason === "pause_turn") { send({ status: "Fortsätter räkna …" }); continue; }
        if (msg.stop_reason === "max_tokens") throw new Error("Kalkylen blev för lång. Försök med en kortare förfrågan.");
        /* Slutade utan att spara – be om att få kalkylen sparad. */
        messages.push({ role: "user", content: "Anropa spara_kalkyl med hela kalkylen nu." });
      }
      if (!result) throw new Error("AI:n blev inte klar med kalkylen. Försök igen.");
      send({ result });
    } catch (e) {
      let msg = "Något gick fel i AI-kalkylen. Försök igen om en stund.";
      if (e instanceof GeminiError) {
        msg = e.status === 429 ? "Dagens gratiskvot hos Google är slut. Försök igen i morgon eller om en stund."
          : e.status === 400 || e.status === 403 ? "Gemini-nyckeln i Cloudflare fungerar inte (" + e.message + ")."
          : "Google Gemini svarade med fel " + (e.status || "") + ". Försök igen.";
      }
      else if (e instanceof Anthropic.AuthenticationError) msg = "API-nyckeln i Cloudflare fungerar inte.";
      else if (e instanceof Anthropic.RateLimitError) msg = "AI-tjänsten är upptagen just nu. Försök igen om en minut.";
      else if (e instanceof Anthropic.APIError) msg = "AI-tjänsten svarade med fel " + (e.status || "") + ". Försök igen.";
      else if (e && e.message) msg = e.message;
      send({ error: msg });
    } finally {
      clearInterval(beat);
      writer.close().catch(() => {});
    }
  })();
  waitUntil(work);

  return new Response(readable, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }
  });
}
