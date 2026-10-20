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

  /* Kalkyl: firmauppgifter (påhittade nummer), tre offerter och AI-kunskap. */
  D["settings/offert"] = {name:"Ellinge Smidesservice AB", address:"Verkstadsvägen 1", zip:"247 00", city:"Ellinge",
    phone:"070-000 00 00", email:"info@exempel.se", web:"", orgnr:"559000-0000", vatnr:"SE559000000001",
    bankgiro:"0000-0000", fskatt:true, payTerms:"30 dagar netto", validDays:30, rate:650, markup:15, milPrice:65,
    terms:"Priserna gäller under förutsättning att arbetet kan utföras i en följd. Ställning och lyft ingår inte om inget annat anges.",
    signature:"Med vänliga hälsningar\nAndy Miftari", workshop:"Verkstadsvägen 1, 247 00 Ellinge", aiHints:""};
  const r2 = n => Math.round(n * 100) / 100;
  function offer(id, nr, status, daysAgo, title, cust, rows, mail){
    const calc = rows.map(r => Object.assign({}, r, {unitPrice: r.kind === "material" ? r2(r.cost * (1 + r.markup / 100)) : r.price}));
    const by = k => r2(calc.filter(r => r.kind === k).reduce((a, r) => a + r.qty * r.unitPrice, 0));
    const net = r2(calc.reduce((a, r) => a + r.qty * r.unitPrice, 0)), vat = r2(net * 0.25);
    const matCost = r2(rows.filter(r => r.kind === "material").reduce((a, r) => a + r.qty * r.cost, 0));
    const date = dkey(addDays(today, -daysAgo));
    D["offers/" + id] = {id, nr, status, date, validDays:30, title, intro:"", mail, terms:"", ref:"Andy Miftari",
      customer:cust, rows, mailText:"", mailEdited:false, byName:"Andy Miftari", updatedAt:iso(addDays(today, -daysAgo)),
      validTo:dkey(addDays(today, 30 - daysAgo)),
      sums:{arbete:by("arbete"), material:by("material"), resa:by("resa"), net, vat, gross:r2(net + vat), vatRate:25,
        matCost, matMarkup:r2(by("material") - matCost), hours:r2(rows.filter(r => r.kind === "arbete").reduce((a, r) => a + r.qty, 0))}};
  }
  const y = today.getFullYear();
  offer("offert-" + y + "-001", y + "-001", "accepterad", 60, "Balkongräcken 12 st, Södra Esplanaden 8",
    {name:"HSB Södra", contact:"Lena Ström", address:"Box 1, 200 00 Malmö", email:"lena@exempel.se", phone:""},
    [{kind:"arbete", desc:"Tillverkning räcken i verkstad", qty:420, unit:"tim", price:620},
     {kind:"arbete", desc:"Montering på plats", qty:200, unit:"tim", price:620},
     {kind:"material", desc:"Plattstång 40x8, S355", qty:480, unit:"m", cost:62, markup:15},
     {kind:"material", desc:"Varmförzinkning", qty:1, unit:"st", cost:14800, markup:10},
     {kind:"resa", desc:"Resor Ellinge–Malmö", qty:40, unit:"mil", price:65}],
    "Hej! Vi behöver nya balkongräcken till 12 balkonger på Södra Esplanaden 8. Ritningar bifogas.");
  offer("offert-" + y + "-002", y + "-002", "skickad", 26, "Trappräcke rostfritt, Kvarngatan",
    {name:"Brf Kvarnen", contact:"Olle Lind", address:"Kvarngatan 3, 222 22 Lund", email:"olle@exempel.se", phone:""},
    [{kind:"arbete", desc:"Tillverkning och montering", qty:48, unit:"tim", price:650},
     {kind:"material", desc:"Rostfritt rör 42,4 mm", qty:26, unit:"m", cost:185, markup:15},
     {kind:"material", desc:"Handledarhållare", qty:18, unit:"st", cost:95, markup:15},
     {kind:"resa", desc:"Resor", qty:6, unit:"mil", price:65}],
    "Hej, vi vill ha offert på ett rostfritt trappräcke i trapphuset, ca 12 meter.");
  offer("offert-" + y + "-004", y + "-004", "skickad", 41, "Ståltrappa till loft",
    {name:"Jonas Berg", contact:"", address:"Lönnvägen 2, 247 00 Ellinge", email:"jonas@exempel.se", phone:""},
    [{kind:"arbete", desc:"Tillverkning och montering", qty:30, unit:"tim", price:650},
     {kind:"material", desc:"UPE 160 och trappsteg", qty:1, unit:"st", cost:9800, markup:15}],
    "Hej, jag funderar på en ståltrappa upp till loftet i garaget.");
  offer("offert-" + y + "-003", y + "-003", "utkast", 1, "Grind och staket, Åkervägen",
    {name:"Karin Nyström", contact:"", address:"Åkervägen 7, 247 00 Ellinge", email:"karin@exempel.se", phone:""},
    [{kind:"arbete", desc:"Grind 3,5 m med motor förberedelse", qty:22, unit:"tim", price:650},
     {kind:"material", desc:"VKR 60x60x3", qty:30, unit:"m", cost:88, markup:15},
     {kind:"resa", desc:"Resor", qty:2, unit:"mil", price:65}],
    "Hej! Kan ni göra en skjutgrind till uppfarten? Öppningen är ca 3,5 meter.");
  D["projects/balkong-sodra"].quote.offerId = "offert-" + y + "-001";
  D["projects/balkong-sodra"].quote.offerNr = y + "-001";
  D["settings/aikunskap"] = {
    prices:[{name:"Plattstång 40x8 S355", unit:"m", cost:62, note:"Stena Stål"},
            {name:"VKR 40x40x3", unit:"m", cost:55, note:"Tibnor"},
            {name:"Rostfritt rör 42,4x2", unit:"m", cost:185, note:"Tibnor"},
            {name:"Varmförzinkning", unit:"kg", cost:14, note:"Zinkverket, två veckors ledtid"}],
    norms:[{task:"Montering av räcke", unit:"meter", hours:0.75},
           {task:"Svetsning av grindram", unit:"st", hours:6}],
    rules:"Vi räknar alltid minst 4 timmar för montering. Lägg 1 timme ritning på allt."};

  D["settings/app"] = {};
  D["settings/lists"] = {};
  return D;
}
