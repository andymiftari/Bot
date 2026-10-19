/* Gemensam inloggningskontroll för serverfunktionerna i functions/api.
   Kontrollerar Firebase-inloggningens ID-token och läser användarens roll. */

export const DEFAULT_PROJECT = "tidsrapportering-ellingesmide";

const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
let jwksCache = { keys: null, until: 0 };

function b64urlToBytes(s) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}
const b64urlJson = s => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function googleKeys() {
  if (jwksCache.keys && Date.now() < jwksCache.until) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error("Kunde inte hämta Googles nycklar.");
  const body = await res.json();
  const age = /max-age=(\d+)/.exec(res.headers.get("cache-control") || "");
  jwksCache = { keys: body.keys || [], until: Date.now() + (age ? +age[1] * 1000 : 3600e3) };
  return jwksCache.keys;
}

/* Kontrollerar Firebase-inloggningens ID-token och returnerar användarens uid. */
export async function verifyFirebaseToken(token, projectId) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("Ogiltig inloggning.");
  const header = b64urlJson(parts[0]);
  const claims = b64urlJson(parts[1]);
  if (header.alg !== "RS256") throw new Error("Ogiltig inloggning.");
  const jwk = (await googleKeys()).find(k => k.kid === header.kid);
  if (!jwk) throw new Error("Inloggningen har gått ut. Logga in igen.");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1]));
  const now = Math.floor(Date.now() / 1000);
  if (!ok || claims.aud !== projectId || claims.iss !== "https://securetoken.google.com/" + projectId
      || !claims.sub || claims.exp <= now || claims.iat > now + 300) {
    throw new Error("Inloggningen har gått ut. Logga in igen.");
  }
  return claims.sub;
}

/* Läser användarens roll i Firestore med användarens egen inloggning. */
export async function roleOf(uid, token, projectId) {
  const url = "https://firestore.googleapis.com/v1/projects/" + projectId
    + "/databases/(default)/documents/employees/" + encodeURIComponent(uid);
  const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) return "";
  const doc = await res.json();
  return (((doc.fields || {}).role || {}).stringValue) || "";
}
