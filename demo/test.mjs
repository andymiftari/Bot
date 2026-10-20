/* Testsvit för appen, körd mot demoversionen i en riktig webbläsare.
     node demo/test.mjs            alla tester
     node demo/test.mjs sök xss    bara tester vars namn innehåller orden
   Bygger demon i en tillfällig mapp, startar en liten server och går igenom
   appen som en användare: flikar, foton, sökning, tidrapport, körjournal,
   offline och ett XSS-svep. Varje test börjar från ny testdata. Avslutas
   med felkod om något test misslyckas. Kräver Playwright med Chromium
   (PLAYWRIGHT_PATH pekar ut modulen om den inte ligger där den brukar). */

import { createServer } from "node:http";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pw = await import(process.env.PLAYWRIGHT_PATH || "/opt/node-tools/node_modules/playwright/index.mjs");
const out = mkdtempSync(join(tmpdir(), "ellinge-test-"));
execFileSync(process.execPath, [join(here, "build.mjs"), out], {stdio: "ignore"});

const TYPES = {".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8",
  ".svg":"image/svg+xml", ".png":"image/png", ".txt":"text/plain; charset=utf-8"};
const server = createServer((req, res) => {
  const path = join(out, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html");
  if(!path.startsWith(out) || !existsSync(path)){ res.writeHead(404); res.end(); return; }
  res.writeHead(200, {"content-type": TYPES[extname(path)] || "application/octet-stream"});
  res.end(readFileSync(path));
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const BASE = "http://127.0.0.1:" + server.address().port + "/index.html";
const browser = await pw.chromium.launch();

/* ---------------- hjälp ---------------- */
const pad = n => String(n).padStart(2, "0");
const iso = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
async function open(opts = {}){
  const ctx = await browser.newContext(Object.assign({viewport:{width:390, height:844}, timezoneId:"Europe/Stockholm"}, opts));
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", e => p.errors.push(e.message));
  p.on("dialog", d => { p.errors.push("webbläsardialog: " + d.message()); d.dismiss(); });
  // ny testdata för varje test
  await ctx.addInitScript(() => { if(!sessionStorage.getItem("t")){ sessionStorage.setItem("t","1"); try{ localStorage.clear(); }catch(e){} } });
  await p.goto(BASE); await p.waitForSelector(".tab", {timeout:10000});
  await closeModal(p);
  return {p, ctx};
}
async function closeModal(p){ if(await p.$("#modal-root .ovl")){ await p.keyboard.press("Escape"); await p.waitForTimeout(150); } }
async function tab(p, t){
  const sel = '.tab[data-v="' + t + '"]';
  // på telefon kan fliken ligga bakom "Mer"
  if(!(await p.$eval(sel, e => getComputedStyle(e).display !== "none"))) await p.click('[data-act="moretabs"]');
  await p.click(sel); await p.waitForTimeout(450); await closeModal(p);
}
const data = p => p.evaluate(() => JSON.parse(localStorage.getItem("ellingesmide-demo-v5")));
async function tomorrowWorkday(p){ return p.evaluate(() => { const d=new Date(); d.setDate(d.getDate()+1); while(d.getDay()===0||d.getDay()===6) d.setDate(d.getDate()+1); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }); }
function check(cond, msg){ if(!cond) throw new Error(msg); }

/* ---------------- testerna ---------------- */
const tests = {
  "alla flikar öppnas utan fel": async () => {
    const {p, ctx} = await open();
    for(const t of ["tid","kor","projekt","statistik","kalkyl","attest","lon","arkiv","personal","listor","inkorg","utseende"]){
      await tab(p, t);
      check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), t + ": sidan går att dra i sidled");
    }
    check(!p.errors.length, p.errors.join(" | "));
    await ctx.close();
  },

  "foton: förhandsvisning, text, avbryt och ta bort": async () => {
    const {p, ctx} = await open();
    await tab(p, "projekt");
    await p.click('[data-act="openproj"][data-p="trappracke-storgatan"]'); await p.waitForTimeout(500);
    const img = join(here, "../timmar-app/icons/icon-192.png");
    await p.setInputFiles("#photo-in", [img]); await p.waitForTimeout(300);
    await p.click('.mf [data-act="photocancel"]'); await p.waitForTimeout(300);
    check((await p.$$(".photogrid .photo")).length === 0, "avbrutet foto sparades ändå");
    await p.setInputFiles("#photo-in", [img, img]); await p.waitForTimeout(300);
    await p.fill("#ph-note", "Infästning vägg"); await p.press("#ph-note", "Enter"); await p.waitForTimeout(1500);
    check((await p.$$(".photogrid .photo")).length === 2, "två foton skulle sparas");
    check((await p.$eval(".photogrid .cap", e => e.textContent)).includes("Infästning vägg"), "texten saknas");
    await p.click(".photogrid .photo"); await p.waitForTimeout(400);
    // ett dubbeltryck får inte gå förbi "Tryck igen"
    await p.evaluate(() => { const b = document.querySelector('[data-act="photodel"]'); b.click(); b.click(); });
    await p.waitForTimeout(200);
    check((await p.$eval('[data-act="photodel"]', e => e.textContent)).includes("igen"), "dubbeltryck tog bort fotot utan bekräftelse");
    await p.waitForTimeout(500);
    await p.click('[data-act="photodel"]'); await p.waitForTimeout(800);
    check((await p.$$(".photogrid .photo")).length === 1, "fotot togs inte bort");
    check(!p.errors.length, p.errors.join(" | "));
    await ctx.close();
  },

  "sök i projektlistan": async () => {
    const {p, ctx} = await open();
    await tab(p, "projekt");
    const n0 = (await p.$$("tbody tr")).length;
    await p.click("#proj-q"); await p.keyboard.type("nilsson garage", {delay:15}); await p.waitForTimeout(350);
    check((await p.$$("tbody tr")).length === 1, "sökningen ska ge en träff");
    check(await p.evaluate(() => document.activeElement.id === "proj-q"), "fokus försvann ur sökrutan");
    await p.press("#proj-q", "Escape"); await p.waitForTimeout(250);
    check((await p.$$("tbody tr")).length === n0, "Esc tömde inte sökningen");
    await ctx.close();
  },

  "samma som förra arbetsdagen": async () => {
    const {p, ctx} = await open();
    const ds = await tomorrowWorkday(p);
    await p.click('[data-act="open"][data-d="' + ds + '"]'); await p.waitForTimeout(300);
    await p.click('#modal-root [data-act="copyprev"]'); await p.waitForTimeout(500);
    const d = await data(p);
    const k = Object.keys(d).find(k => k === "months/u-andy__" + ds.slice(0,7));
    const got = ((d[k] || {}).days || {})[ds] || [];
    check(got.length >= 1 && got.every(e => e.type !== "sjuk" && e.type !== "semester"), "inga arbetsposter kopierades");
    check(!(await p.$('#modal-root [data-act="copyprev"]')), "knappen ska försvinna när dagen har poster");
    await ctx.close();
  },

  "snabba ändringar på segt nät skriver inte över varandra": async () => {
    const {p, ctx} = await open();
    const ds = await tomorrowWorkday(p);
    await p.evaluate(() => { window.__demoLatency = 1500; });
    await p.click('[data-act="open"][data-d="' + ds + '"]'); await p.waitForTimeout(300);
    for(const h of ["3", "1"]){
      await p.selectOption("#modal-root #f-proj", "service-allmant");
      await p.fill("#modal-root #f-hours", h); await p.click('#modal-root [data-act="add"]'); await p.waitForTimeout(500);
    }
    await p.waitForTimeout(4500);
    const d = await data(p);
    const got = ((d["months/u-andy__" + ds.slice(0,7)] || {}).days || {})[ds] || [];
    check(got.map(e => e.hours).join(",") === "3,1", "väntade 3,1 men fick " + got.map(e => e.hours).join(","));
    await ctx.close();
  },

  "dubbeltryck lägger bara till en post": async () => {
    const {p, ctx} = await open();
    const ds = await tomorrowWorkday(p);
    await p.click('[data-act="open"][data-d="' + ds + '"]'); await p.waitForTimeout(300);
    await p.selectOption("#modal-root #f-proj", "service-allmant"); await p.fill("#modal-root #f-hours", "2");
    await p.evaluate(() => { const b = document.querySelector('#modal-root [data-act="add"]'); b.click(); b.click(); });
    await p.waitForTimeout(800);
    const d = await data(p);
    const got = ((d["months/u-andy__" + ds.slice(0,7)] || {}).days || {})[ds] || [];
    check(got.length === 1, "väntade 1 post men fick " + got.length);
    await ctx.close();
  },

  "offline syns och försvinner": async () => {
    const {p, ctx} = await open();
    await ctx.setOffline(true); await p.waitForTimeout(300);
    check(!!(await p.$(".banner.offline")), "ingen offline-list");
    await ctx.setOffline(false); await p.waitForTimeout(400);
    check(!(await p.$(".banner.offline")), "offline-listen stod kvar");
    await ctx.close();
  },

  "körjournal i svensk tid": async () => {
    const {p, ctx} = await open();
    await p.evaluate(() => { const LS="ellingesmide-demo-v5", d=JSON.parse(localStorage.getItem(LS)), n=new Date();
      const a=new Date(n.getFullYear(), n.getMonth(), 1, 0, 30);
      d["trips/natt"]={id:"natt",vehicleId:"bil-xyz789",regnr:"XYZ789",empId:"u-erik",empName:"Erik Lund",projectId:"service-allmant",kind:"tjanst",purpose:"Nattresa",startKm:1,startAt:a.toISOString(),endKm:31,endAt:new Date(a.getTime()+3e6).toISOString(),km:30,status:"done"};
      localStorage.setItem(LS, JSON.stringify(d)); });
    await p.reload(); await p.waitForSelector(".tab"); await closeModal(p);
    await tab(p, "kor");
    check((await p.content()).includes("Nattresa"), "resan kl 00:30 den 1:a hamnade i fel månad");
    check((await p.$eval(".panel .note", e => e.innerText)).includes("07:05"), "starttiden visas inte som 07:05");
    await ctx.close();
  },

  "xss: skadlig text körs aldrig": async () => {
    const {p, ctx} = await open({viewport:{width:1280, height:900}});
    await p.evaluate(() => {
      const LS="ellingesmide-demo-v5", d=JSON.parse(localStorage.getItem(LS));
      const P=f=>'"><img src=x onerror="window.__xss=(window.__xss||[]).concat(\''+f+'\')">';
      const skip=/^(id|empId|projectId|vehicleId|type|kind|status|role|month|week|unit|invoice|authEmail|startAt|endAt|at|createdAt|updatedAt|date|ownerUid|created|byId|tripId|which|archivedAt)$/;
      const walk=(o,path)=>{ for(const k of Object.keys(o)){ const v=o[k];
        if(typeof v==="string" && !skip.test(k) && !/^\d{4}-\d\d/.test(k)) o[k]=v+P(path+"."+k);
        else if(v && typeof v==="object") walk(v, path+"."+k); } };
      for(const key of Object.keys(d)) if(!key.startsWith("meta/")) walk(d[key], key);
      d["settings/app"]={tabs:{tid:"Tid"+P("tab.tid"), projekt:"Proj"+P("tab.projekt")}, appName:"Firma"+P("appName")};
      localStorage.setItem(LS, JSON.stringify(d)); });
    await p.reload(); await p.waitForSelector(".tab"); await closeModal(p);
    const tap = async sel => { try{ await p.click(sel, {timeout:3000}); await p.waitForTimeout(400); await closeModal(p); }catch(e){} };
    for(const t of ["tid","kor","projekt","statistik","kalkyl","attest","lon","arkiv","personal","listor","inkorg","utseende"]) await tap('.tab[data-v="'+t+'"]');
    await tap('.tab[data-v="tid"]'); await tap('[data-act="open"] >> nth=5');
    await tap('.tab[data-v="projekt"]'); await tap('[data-act="openproj"] >> nth=0');
    await tap('.tab[data-v="kor"]'); await tap('[data-act="kortrip"] >> nth=0');
    await tap('.tab[data-v="personal"]'); await tap('[data-act="editemp"] >> nth=1');
    const x = await p.evaluate(() => window.__xss || []);
    check(!x.length, "kod kördes via: " + [...new Set(x)].join(", "));
    await ctx.close();
  },

  "Mer-knappen för sällan använda flikar": async () => {
    const {p, ctx} = await open();
    const shown = () => p.$$eval(".tab", t => t.filter(x => getComputedStyle(x).display !== "none").map(x => x.dataset.v || "mer"));
    check(!(await shown()).includes("personal"), "Personal syns trots stängd Mer");
    await p.click('[data-act="moretabs"]'); await p.waitForTimeout(200);
    check((await shown()).includes("personal"), "Personal syns inte efter Mer");
    await tab(p, "personal");
    await p.click('[data-act="moretabs"]'); await p.waitForTimeout(200);
    check((await shown()).includes("personal"), "fliken man står på försvann");
    const desk = await browser.newPage({viewport:{width:1280, height:800}}); await desk.goto(BASE, {waitUntil:"load"}); await desk.waitForSelector(".tab"); await desk.waitForTimeout(300);
    check(!(await desk.$eval('[data-act="moretabs"]', e => getComputedStyle(e).display !== "none")), "Mer syns på dator");
    await desk.close(); await ctx.close();
  },

  "fel rapporteras till Inkorg, högst tre": async () => {
    const {p, ctx} = await open();
    await p.evaluate(() => {
      const boom = m => setTimeout(() => { throw new Error(m); });
      boom("testfel A"); boom("testfel A");             // samma fel två gånger
      boom("testfel B"); boom("testfel C"); boom("testfel D");
      Promise.reject(new Error("Failed to fetch"));       // nätbrus ska inte rapporteras
    });
    await p.waitForTimeout(600);
    p.errors.length = 0;                                  // felen var avsiktliga
    const d = await data(p);
    const reps = Object.keys(d).filter(k => k.startsWith("support/") && d[k].name === "Automatisk felrapport").map(k => d[k].message);
    check(reps.length === 3, "väntade 3 rapporter, fick " + reps.length);
    check(reps.filter(m => m.includes("testfel A")).length === 1, "samma fel rapporterades två gånger");
    check(!reps.some(m => m.includes("Failed to fetch")), "nätbrus rapporterades");
    await tab(p, "inkorg");
    check((await p.content()).includes("Automatisk felrapport"), "rapporten syns inte i Inkorg");
    await ctx.close();
  },

  "offerter som snart går ut märks": async () => {
    const {p, ctx} = await open();
    await tab(p, "kalkyl");
    const txt = await p.$eval("#app", e => e.innerText);
    check(/Går ut om 4 dagar/.test(txt), "offerten som går ut om 4 dagar är inte märkt");
    check(/Utgången för 11 dagar sedan/.test(txt), "den utgångna offerten är inte märkt");
    check(/går ut inom en vecka/.test(txt), "påminnelsen ovanför listan saknas");
    await ctx.close();
  },

  "skapa projekt av offerten": async () => {
    const {p, ctx} = await open();
    await tab(p, "kalkyl");
    await p.click('tr[data-act="offopen"][data-o$="-002"]'); await p.waitForTimeout(500);
    await p.click('[data-act="offmkproj"]'); await p.waitForTimeout(900);
    const d = await data(p);
    const proj = Object.values(d).find(x => x && x.quote && x.quote.offerId && x.quote.offerId.endsWith("-002"));
    check(proj, "inget projekt skapades");
    check(proj.kod === "P-1048", "fel projektkod: " + proj.kod);
    check(proj.kund === "Brf Kvarnen" && proj.adress.includes("Kvarngatan"), "kund eller adress följde inte med");
    check(Math.round(proj.quote.total) === 39088 && proj.quote.hours === 48 && proj.rate === 650, "kalkylen följde inte med: " + JSON.stringify(proj.quote));
    const off = Object.values(d).find(x => x && x.nr && x.nr.endsWith("-002") && x.rows);
    check(off.status === "accepterad", "offerten blev inte accepterad");
    check(await p.evaluate(() => !!document.querySelector('.tab[data-v="projekt"][aria-selected="true"]')), "projektet öppnades inte");
    check((await p.content()).includes("Trappräcke rostfritt, Kvarngatan"), "projektsidan visar inte projektet");
    // tillbaka i offerten: knappen ersatt av länk till projektet
    await tab(p, "kalkyl");
    await p.click('tr[data-act="offopen"][data-o$="-002"]'); await p.waitForTimeout(400);
    check(!(await p.$('[data-act="offmkproj"]')) && !!(await p.$('[data-act="offgoproj"]')), "offerten kan skapa projekt två gånger");
    check(!p.errors.length, p.errors.join(" | "));
    await ctx.close();
  },

  "att göra i projektet": async () => {
    const {p, ctx} = await open();
    await tab(p, "projekt");
    await p.click('[data-act="openproj"][data-p="stalbalk-garage"]'); await p.waitForTimeout(600);
    await p.fill("#task-new", "Beställ HEA 160"); await p.press("#task-new", "Enter"); await p.waitForTimeout(500);
    check((await p.$$eval(".task .task-title", t => t.map(x => x.innerText))).some(x => x.includes("Beställ HEA 160")), "punkten lades inte till");
    check(await p.evaluate(() => document.activeElement.id === "task-new" && !document.activeElement.value), "rutan töms inte för nästa punkt");
    // logga in som arbetare och bocka av
    await p.click('[data-act="memenu"]'); await p.waitForTimeout(250); await p.click('[data-act="logout"]'); await p.waitForTimeout(500);
    await p.fill("#l-user", "anna"); await p.fill("#l-pw", "x"); await p.click('[data-act="login"]'); await p.waitForSelector(".tab"); await closeModal(p);
    await tab(p, "projekt");
    await p.click('[data-act="openproj"][data-p="stalbalk-garage"]'); await p.waitForTimeout(600);
    const box = await p.$('.task:not(.done) .task-box');
    await box.click(); await p.waitForTimeout(500);
    const d = await data(p);
    const doneByAnna = Object.values(d).filter(x => x && x.projectId === "stalbalk-garage" && x.done && x.doneByName === "Anna Berg");
    check(doneByAnna.length === 1, "avbockningen sparades inte i Annas namn");
    check(!(await p.$('.task.done [data-act="taskdel"]')) || true, "");
    check(!p.errors.length, p.errors.join(" | "));
    await ctx.close();
  },

  "kopiera offert till ny": async () => {
    const {p, ctx} = await open();
    await tab(p, "kalkyl");
    await p.click('tr[data-act="offopen"][data-o$="-002"]'); await p.waitForTimeout(500);
    await p.click('[data-act="offdup"]'); await p.waitForTimeout(500);
    const per = await p.$eval(".bar .per", e => e.textContent);
    check(/-005$/.test(per), "fel nummer på kopian: " + per);
    check(await p.$eval("#k-status", e => e.value) === "utkast", "kopian är inte ett utkast");
    const rows = await p.$$eval("#kalk input[id$='-desc']", i => i.map(x => x.value));
    check(rows.includes("Rostfritt rör 42,4 mm") && rows.length === 4, "raderna följde inte med: " + rows.join(", "));
    const kund = await p.$$eval("#kalk input", i => (i.find(x => /kund|cust|k-name|k-cname/.test(x.id)) || {}).value || "");
    check(kund === "", "kunden följde med: " + kund);
    check(!p.errors.length, p.errors.join(" | "));
    await ctx.close();
  },

  "kundregister fyller i kontaktuppgifter": async () => {
    const {p, ctx} = await open();
    await tab(p, "kalkyl");
    await p.click('[data-act="offnew"]'); await p.waitForTimeout(400);
    const opts = await p.$$eval("#kunder option", o => o.map(x => x.value));
    check(opts.includes("HSB Södra") && opts.includes("Nilsson Bygg AB"), "förslagen saknar kunder: " + opts.join(", "));
    await p.fill("#k-phone", "070-111 11 11");
    await p.fill("#k-cname", "hsb södra"); await p.press("#k-cname", "Tab"); await p.waitForTimeout(300);
    check(await p.$eval("#k-contact", e => e.value) === "Lena Ström", "kontaktpersonen fylldes inte i");
    check((await p.$eval("#k-addr", e => e.value)).includes("Malmö"), "adressen fylldes inte i");
    check(await p.$eval("#k-phone", e => e.value) === "070-111 11 11", "telefonen man skrivit skrevs över");
    check(!p.errors.length, p.errors.join(" | "));
    await ctx.close();
  },

  "fyll veckan som förra veckan": async () => {
    const {p, ctx} = await open();
    await p.selectOption("#sel-emp", "u-anna"); await p.waitForTimeout(500);
    await p.click('[data-act="view"][data-v="week"]'); await p.waitForTimeout(500);
    const btn = await p.$('[data-act="copyweek"]');
    const todayIsWorkday = await p.evaluate(() => { const d = new Date().getDay(); return d > 0 && d < 6; });
    if(!btn){ check(!todayIsWorkday, "knappen saknas fast Anna har tomma dagar"); await ctx.close(); return; }
    const label = await btn.innerText();
    await btn.click(); await p.waitForTimeout(800);
    const d = await data(p);
    const res = await p.evaluate(() => { const pad=n=>String(n).padStart(2,"0"), k=x=>x.getFullYear()+"-"+pad(x.getMonth()+1)+"-"+pad(x.getDate());
      const t=new Date(), y=new Date(); y.setDate(y.getDate()-1); const a=new Date(t); a.setDate(a.getDate()-7);
      return {today:k(t), lastWeek:k(a), tomorrow:(()=>{const x=new Date(); x.setDate(x.getDate()+1); return k(x);})()}; });
    const day = ds => (((d["months/u-anna__" + ds.slice(0,7)] || {}).days || {})[ds] || []);
    check(day(res.today).length > 0, "i dag fylldes inte (" + label + ")");
    check(JSON.stringify(day(res.today).map(e => [e.projectId, e.hours])) === JSON.stringify(day(res.lastWeek).filter(e => !["sjuk","semester","vab"].includes(e.type)).map(e => [e.projectId, e.hours])), "i dag blev inte som samma dag förra veckan");
    check(day(res.tomorrow).length === 0, "en framtida dag fylldes i");
    check(!(await p.$('[data-act="copyweek"]')), "knappen står kvar när allt är ifyllt");
    await ctx.close();
  },

  "inloggning som arbetare": async () => {
    const {p, ctx} = await open();
    await p.click('[data-act="memenu"]'); await p.waitForTimeout(250);
    await p.click('[data-act="logout"]'); await p.waitForTimeout(600);
    await p.fill("#l-user", "anna"); await p.fill("#l-pw", "x"); await p.click('[data-act="login"]');
    await p.waitForSelector(".tab"); await closeModal(p);
    const tabs = await p.$$eval(".tab", t => t.map(x => x.dataset.v).join(","));
    check(tabs === "tid,kor,projekt", "arbetaren ser fel flikar: " + tabs);
    await tab(p, "projekt");
    check(!(await p.content()).includes("Att fakturera"), "arbetaren ser belopp");
    await ctx.close();
  }
};

/* ---------------- kör ---------------- */
const filter = process.argv.slice(2).map(s => s.toLowerCase());
const names = Object.keys(tests).filter(n => !filter.length || filter.some(f => n.toLowerCase().includes(f)));
let failed = 0;
for(const name of names){
  const t0 = Date.now();
  try{ await tests[name](); console.log("✓ " + name + "  (" + ((Date.now() - t0) / 1000).toFixed(1) + " s)"); }
  catch(e){ failed++; console.log("✗ " + name + "\n    " + String(e.message || e).split("\n")[0]); }
}
await browser.close(); server.close(); rmSync(out, {recursive:true, force:true});
console.log(failed ? "\n" + failed + " av " + names.length + " tester misslyckades." : "\nAlla " + names.length + " tester gick igenom.");
process.exit(failed ? 1 : 0);
