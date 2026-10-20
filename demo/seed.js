/* Testdata för demoläget. Allt är påhittat: personer, kunder, adresser och
   bilar. Datumen räknas från dagens datum, så att det alltid finns en
   pågående vecka, förra veckans attest och resor i körjournalen. */

const pad = n => String(n).padStart(2, "0");
const dkey = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const mkey = d => d.getFullYear() + "-" + pad(d.getMonth() + 1);
function isoWeek(d){
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  return {y, w: Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7)};
}
const wkey = d => { const x = isoWeek(d); return x.y + "-W" + pad(x.w); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const iso = d => d.toISOString();

/* Samma "slump" varje gång, så att demon ser likadan ut för alla. */
function rng(seedNr){
  let a = seedNr >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function seed(){
  const r = rng(42), today = new Date(); today.setHours(12, 0, 0, 0);
  const D = {};
  const created = iso(addDays(today, -400));

  const people = [
    {id:"u-andy", name:"Andy Miftari", username:"andy", role:"support"},
    {id:"u-sara", name:"Sara Holm", username:"sara", role:"admin"},
    {id:"u-erik", name:"Erik Lund", username:"erik", role:"arbetare"},
    {id:"u-anna", name:"Anna Berg", username:"anna", role:"arbetare"},
    {id:"u-mats", name:"Mats Ek", username:"mats", role:"arbetare"}
  ];
  D["meta/app"] = {ownerUid:"u-andy", created, locksV:1};
  people.forEach(p => {
    const authEmail = p.username + "@timmar.app";
    D["employees/" + p.id] = {name:p.name, username:p.username, role:p.role, authEmail,
      email:"", phone:"", createdAt:created};
    D["usernames/" + p.username] = {email:authEmail, name:p.name};
  });

  const projects = [
    {id:"trappracke-storgatan", kod:"P-1042", name:"Trappräcke rostfritt", kund:"Brf Linden", adress:"Storgatan 12, Lund", status:"aktiv", invoice:"ej", rate:650,
      quote:{total:120000, hours:160, labour:104000, material:12500, travel:3500, other:0, offerId:"", offerNr:""}},
    {id:"grind-uppfart", kod:"P-1039", name:"Grind till uppfart", kund:"Karlsson", adress:"Ängsvägen 4, Dalby", status:"vilande", invoice:"skapad", rate:650,
      quote:{total:18000, hours:20, labour:13000, material:4500, travel:500, other:0, offerId:"", offerNr:""}},
    {id:"balkong-sodra", kod:"P-1045", name:"Balkongräcken 12 st", kund:"HSB Södra", adress:"Södra Esplanaden 8, Malmö", status:"aktiv", invoice:"ej", rate:620,
      quote:{total:450000, hours:620, labour:384400, material:52000, travel:13600, other:0, offerId:"", offerNr:""}},
    {id:"stalbalk-garage", kod:"P-1047", name:"Stålbalk garage", kund:"Nilsson Bygg AB", adress:"Industrigatan 3, Staffanstorp", status:"aktiv", invoice:"ej", rate:680,
      quote:{total:185000, hours:240, labour:163200, material:18800, travel:3000, other:0, offerId:"", offerNr:""}},
    {id:"spiraltrappa-villa", kod:"P-1031", name:"Spiraltrappa villa", kund:"Fam. Persson", adress:"Bokvägen 19, Lomma", status:"avslutad", invoice:"fakturerad", rate:650,
      quote:{total:95000, hours:110, labour:71500, material:21000, travel:2500, other:0, offerId:"", offerNr:""},
      archivedAt:iso(addDays(today, -45)), archivedBy:"Andy Miftari"},
    {id:"service-allmant", kod:"P-1000", name:"Service och småjobb", kund:"Diverse", adress:"", status:"aktiv", invoice:"ej", rate:650}
  ];
  projects.forEach(p => { D["projects/" + p.id] = Object.assign({notes:"", updatedAt:iso(addDays(today, -3))}, p); });

  /* Tidrapporter: förra månaden och den här, fram till i dag. */
  const workers = ["u-andy", "u-erik", "u-anna", "u-mats", "u-sara"];
  const active = ["trappracke-storgatan", "balkong-sodra", "stalbalk-garage", "balkong-sodra", "service-allmant"];
  const notes = ["Svetsning", "Montering på plats", "Kapning och borrning", "Slipning och ytbehandling", "Mätning hos kund", ""];
  const start = new Date(today.getFullYear(), today.getMonth() - 1, 1, 12);
  const months = {};
  workers.forEach((emp, wi) => {
    for(let d = new Date(start); d <= today; d = addDays(d, 1)){
      const dow = d.getDay();
      if(dow === 0 || dow === 6) continue;
      /* Anna har inte hunnit fylla i de två senaste dagarna – syns som påminnelse. */
      if(emp === "u-anna" && (today - d) / 864e5 < 2) continue;
      const ds = dkey(d), ym = mkey(d);
      const k = emp + "__" + ym;
      months[k] = months[k] || {empId:emp, month:ym, days:{}, updatedAt:iso(d)};
      let entries;
      const x = r();
      if(x < 0.04) entries = [{type:"sjuk", hours:8, projectId:"", note:""}];
      else if(x < 0.07) entries = [{type:"semester", hours:8, projectId:"", note:""}];
      else {
        const p1 = active[(wi + d.getDate()) % active.length];
        if(r() < 0.3){
          const p2 = active[(wi + d.getDate() + 2) % active.length];
          entries = [{type:"arbete", hours:5, projectId:p1, note:notes[Math.floor(r() * notes.length)]},
                     {type:"arbete", hours:3, projectId:p2, note:notes[Math.floor(r() * notes.length)]}];
        } else entries = [{type:"arbete", hours:8, projectId:p1, note:notes[Math.floor(r() * notes.length)]}];
        if(r() < 0.08) entries.push({type:"overtid", hours:2, projectId:p1, note:"Brådskande leverans"});
      }
      months[k].days[ds] = entries;
    }
  });
  Object.keys(months).forEach(k => { D["months/" + k] = months[k]; });

  /* Attest: tidigare veckor godkända, förra veckan inskickad men inte attesterad. */
  const thisWeek = wkey(today);
  workers.forEach(emp => {
    for(let i = 1; i <= 5; i++){
      const wk = wkey(addDays(today, -7 * i));
      if(wk === thisWeek) continue;
      const status = i === 1 ? "inskickad" : "godkand";
      D["approvals/" + emp + "__" + wk] = {empId:emp, week:wk, status, comment:"",
        by: status === "godkand" ? "Andy Miftari" : D["employees/" + emp].name, at:iso(addDays(today, -7 * i + 5))};
    }
  });

  /* Bilar och körjournal. */
  const vehicles = [
    {id:"bil-abc123", regnr:"ABC123", name:"Ford Transit"},
    {id:"bil-xyz789", regnr:"XYZ789", name:"VW Caddy"}
  ];
  vehicles.forEach(v => { D["vehicles/" + v.id] = Object.assign({note:"", unit:"km", active:true, createdAt:created}, v); });
  const meter = {"bil-abc123":84210, "bil-xyz789":52890};
  const drivers = [["u-erik", "Erik Lund"], ["u-mats", "Mats Ek"], ["u-anna", "Anna Berg"]];
  let tripNr = 0;
  for(let i = 40; i >= 1; i--){
    const d = addDays(today, -i);
    if(d.getDay() === 0 || d.getDay() === 6 || r() < 0.35) continue;
    const v = vehicles[tripNr % 2], drv = drivers[tripNr % 3];
    const km = 12 + Math.round(r() * 60);
    const s = new Date(d); s.setHours(7, 10 + (tripNr % 40), 0, 0);
    const e = new Date(s); e.setMinutes(e.getMinutes() + 25 + km);
    const id = "resa-" + v.regnr.toLowerCase() + "-" + (++tripNr);
    const priv = r() < 0.08;
    D["trips/" + id] = {id, vehicleId:v.id, regnr:v.regnr, empId:drv[0], empName:drv[1],
      projectId: priv ? "" : active[tripNr % active.length], kind: priv ? "privat" : "tjanst",
      purpose: priv ? "" : "Till arbetsplatsen", startKm:meter[v.id], startAt:iso(s),
      photoStart:"", hasStart:false, endKm:meter[v.id] + km, endAt:iso(e), km,
      photoEnd:"", hasEnd:false, status:"done"};
    meter[v.id] += km;
  }
  /* En resa som Mats glömt att avsluta – ska gå att avsluta av någon annan. */
  const open = new Date(today); open.setHours(7, 5, 0, 0);
  D["trips/resa-abc123-oppen"] = {id:"resa-abc123-oppen", vehicleId:"bil-abc123", regnr:"ABC123",
    empId:"u-mats", empName:"Mats Ek", projectId:"balkong-sodra", kind:"tjanst", purpose:"Leverans av räcken",
    startKm:meter["bil-abc123"], startAt:iso(open), photoStart:"", hasStart:false,
    endKm:0, endAt:"", km:0, photoEnd:"", hasEnd:false, status:"open"};

  /* Kostnader på projekten. */
  const costs = [
    ["trappracke-storgatan", "material", "Rostfritt rör 42,4 mm, 24 m", "Tibnor", 24, "m", 185],
    ["trappracke-storgatan", "material", "Handledarhållare", "Beslag & Co", 16, "st", 95],
    ["balkong-sodra", "material", "Plattstång 40x8, 120 m", "Stena Stål", 120, "m", 62],
    ["balkong-sodra", "underlev", "Varmförzinkning", "Zinkverket", 1, "st", 14800],
    ["stalbalk-garage", "material", "HEA 160, 6 m", "Stena Stål", 2, "st", 4150],
    ["stalbalk-garage", "maskin", "Saxlift", "Ramirent", 2, "dag", 1150]
  ];
  costs.forEach((c, i) => {
    const id = "kost-" + (i + 1);
    D["costs/" + id] = {id, projectId:c[0], kind:c[1], date:dkey(addDays(today, -3 * (i + 1))), desc:c[2], supplier:c[3],
      qty:c[4], unit:c[5], unitPrice:c[6], amount:c[4] * c[6], byId:"u-andy", byName:"Andy Miftari",
      createdAt:iso(addDays(today, -3 * (i + 1)))};
  });

  D["settings/app"] = {};
  D["settings/lists"] = {};
  return D;
}
