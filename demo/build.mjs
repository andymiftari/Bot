/* Bygger demoversionen av appen som artifakt.
     node demo/build.mjs [utmapp]
   Kopierar timmar-app/ som den står på grenen och byter bara ut det som
   pratar med omvärlden: Firebase-importerna pekas på demo/fakefb.js,
   inställningsfilen töms på adresser, service workern stängs av och sidan
   får en demoskylt. All annan kod är exakt den som ligger på grenen. */

import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../timmar-app");
const out = resolve(process.argv[2] || join(here, "../demo-out"));

rmSync(out, {recursive:true, force:true});
mkdirSync(out, {recursive:true});
cpSync(src, out, {recursive:true, filter: p => !/[\\/](sw\.js|_headers|manifest\.webmanifest)$/.test(p)});
copyFileSync(join(here, "fakefb.js"), join(out, "fakefb.js"));
copyFileSync(join(here, "seed.js"), join(out, "seed.js"));

function patch(file, pairs){
  const p = join(out, file);
  let s = readFileSync(p, "utf8");
  for(const [from, to] of pairs){
    if(!s.includes(from)) throw new Error(file + ": hittar inte «" + String(from).slice(0, 70) + "»");
    s = s.split(from).join(to);
  }
  writeFileSync(p, s);
}

const FB = "https://www.gstatic.com/firebasejs/10.12.5/";
patch("app.js", [
  [FB + "firebase-app.js", "./fakefb.js"],
  [FB + "firebase-auth.js", "./fakefb.js"],
  [FB + "firebase-firestore.js", "./fakefb.js"],
  ['if("serviceWorker" in navigator){', 'if(false){ /* ingen service worker i demon */']
]);

writeFileSync(join(out, "firebase-config.js"), `/* Demoläge – inga riktiga adresser. */
export const firebaseConfig = {apiKey:"demo", authDomain:"demo", projectId:"demo", appId:"demo"};
export const ACCOUNT_DOMAIN = "timmar.app";
export const SUPPORT_ENDPOINT = "";
export const SUPPORT_KEY = "";
export const SYNC_URL = "";
export const SYNC_TOKEN = "";
`);

const appVersion = (/APP_VERSION = "([^"]+)"/.exec(readFileSync(join(out, "app.js"), "utf8")) || [])[1] || "";
const built = new Date().toLocaleString("sv-SE", {timeZone:"Europe/Stockholm"}).slice(0, 16);
patch("index.html", [
  ["<title>Ellingesmide</title>", "<title>Ellingesmide demo</title>"],
  ['<link rel="manifest" href="manifest.webmanifest">\n', ""],
  ['<link rel="preconnect" href="https://www.gstatic.com" crossorigin>\n', ""],
  ['<link rel="stylesheet" href="styles.css">', `<link rel="stylesheet" href="styles.css">
<style>
.demo-flag{position:fixed;right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));z-index:70;
  display:flex;align-items:center;gap:8px;padding:6px 6px 6px 12px;border-radius:999px;
  background:var(--straw);color:#1D2A33;font:600 12px/1.2 var(--f-body);box-shadow:var(--shadow)}
.demo-flag button{font:inherit;border:0;border-radius:999px;padding:5px 10px;background:#1D2A33;color:#F8F9F8;cursor:pointer;min-height:28px}
@media print{.demo-flag{display:none}}
</style>`],
  ['<script type="module" src="app.js"></script>', `<div class="demo-flag" role="note">
  <span title="Sandbox ${appVersion}, byggd ${built}. All data är påhittad och sparas bara i din webbläsare.">Demo · testdata · ${built.slice(5)}</span>
  <button type="button" id="demo-reset" title="Lägg tillbaka testdatan som den var från början">Börja om</button>
</div>
<script type="module">
import { demoReset } from "./fakefb.js";
/* Artifakten visar inga confirm()-rutor – andra trycket bekräftar. */
const rb = document.getElementById("demo-reset");
let armed = null;
rb.addEventListener("click", () => {
  if(armed){ clearTimeout(armed); demoReset(); return; }
  rb.textContent = "Tryck igen";
  armed = setTimeout(() => { armed = null; rb.textContent = "Börja om"; }, 3000);
});
</script>
<script type="module" src="app.js"></script>`]
]);

/* Artifakten tar inte emot filer med råa styrtecken eller ogiltig UTF-8.
   I biblioteken står sådant bara inuti textsträngar (teckentabeller). Filen
   läses som webbläsaren läser den (UTF-8, ogiltiga bytes blir U+FFFD) och
   varje tecken utanför vanlig ASCII skrivs som \uXXXX – samma värde, bara
   skrivet med vanliga tecken. Står ett sådant tecken direkt efter ett
   bakvänt snedstreck skulle det få ny betydelse; då avbryts bygget hellre. */
for(const f of ["lib/xlsx.full.min.js", "lib/pdf.worker.min.js", "lib/pdf.min.js"]){
  const p = join(out, f);
  const s = readFileSync(p, "utf8");
  let res = "", n = 0;
  for(let i = 0; i < s.length; i++){
    const c = s.charCodeAt(i);
    if((c < 32 && c !== 9 && c !== 10 && c !== 13) || c > 126){
      let bs = 0; for(let j = i - 1; j >= 0 && s[j] === "\\"; j--) bs++;
      if(bs % 2) throw new Error(f + ": specialtecken efter snedstreck vid " + i);
      res += "\\u" + c.toString(16).padStart(4, "0"); n++;
    } else res += s[i];
  }
  if(n) writeFileSync(p, res, "utf8");
}

/* Artifakten lägger själv runt doctype, head och body – sidan ska bara
   ha innehållet: titel, länkar, stilar och kroppens innehåll. */
{
  const p = join(out, "index.html");
  const html = readFileSync(p, "utf8");
  const head = (/<head>([\s\S]*?)<\/head>/.exec(html) || [])[1] || "";
  const body = (/<body>([\s\S]*?)<\/body>/.exec(html) || [])[1] || "";
  const keep = head.split("\n").filter(l => !/<meta charset|<meta name="viewport"/.test(l)).join("\n");
  if(!head || !body) throw new Error("index.html: hittar inte head/body");
  const page = keep.replace("<title>", '<meta name="claude:viewport-fit-sides" content="cover">\n<title>') + "\n" + body;
  /* Specialtecken skrivs som koder, så att sidan ser rätt ut oavsett vilken
     teckenkodning den serveras med: &#NNN; i HTML, \\uXXXX inne i skript. */
  const ascii = page.split(/(<script[\s\S]*?<\/script>)/).map((part, i) => part.replace(/[^\x00-\x7f]/g,
    ch => i % 2 ? "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0") : "&#" + ch.charCodeAt(0) + ";")).join("");
  writeFileSync(p, ascii);
}

console.log("Demo byggd i " + out + " (app " + appVersion + ")");
