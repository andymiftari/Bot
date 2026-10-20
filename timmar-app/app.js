/* Timmar – tidrapportering per projekt med veckoattest.
   Fristående app: Firebase Authentication + Firestore. */

import { initializeApp, getApps, getApp }
  from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, setPersistence, browserLocalPersistence, browserSessionPersistence,
  updatePassword, updateEmail, reauthenticateWithCredential, EmailAuthProvider, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig, ACCOUNT_DOMAIN, SUPPORT_ENDPOINT, SUPPORT_KEY, SYNC_URL, SYNC_TOKEN }
  from "./firebase-config.js";
import { qrSvg } from "./qr.js";

export const APP_VERSION = "2.12.1";
const BOOT_AT = Date.now();

/* Rollerna. Support kan allt en superadmin kan, plus utseende, texter och inkorg. */
const ROLES = {
  arbetare: {label:"Arbetare", rank:1},
  admin:    {label:"Superadmin", rank:2},
  support:  {label:"Support", rank:3}
};
/* Standardtexter – supportrollen kan ändra dem i appen. */
const DEFAULTS = {
  appName:"Ellingesmide",
  tagline:"Tidrapportering",
  company:"",
  loginHelp:"Kontonamn och lösenord får du av din arbetsledare.",
  supportLabel:"Behöver du hjälp? Skicka en supportförfrågan",
  tabs:{tid:"Tidrapport", mitt:"Min tidrapport", kor:"Körjournal", projekt:"Projekt", attest:"Veckoattest",
        arkiv:"Arkiv", personal:"Personal & konton", listor:"Listor", kalkyl:"Kalkyl",
        inkorg:"Inkorg", utseende:"Utseende & texter", statistik:"Statistik", lon:"Löneunderlag"},
  roles:{arbetare:"Arbetare", admin:"Superadmin", support:"Support"},
  theme:{mode:"auto", ink:"", ground:""},
  vat:25
};

/* ============================ typer ============================ */
const BUILTIN_TYPES = {
  arbete:    {label:"Arbetstid",   short:"ARB", cls:"work", proj:true,  bill:true,  abs:false},
  overtid:   {label:"Övertid",     short:"ÖT",  cls:"ot",   proj:true,  bill:true,  abs:false},
  sjuk:      {label:"Sjukfrånvaro",short:"SJK", cls:"abs",  proj:false, bill:false, abs:true},
  vab:       {label:"VAB",         short:"VAB", cls:"abs",  proj:false, bill:false, abs:true},
  semester:  {label:"Semester",    short:"SEM", cls:"abs",  proj:false, bill:false, abs:true},
  utbildning:{label:"Utbildning",  short:"UTB", cls:"abs",  proj:true,  bill:false, abs:false},
  tjledig:   {label:"Tjänstledig", short:"TJL", cls:"abs",  proj:false, bill:false, abs:true}
};
/* Typerna och kostnadsslagen går att ändra i appen (fliken Listor).
   Saknas egna listor används de inbyggda. */
function typeMap(){
  const L=(S.lists&&Array.isArray(S.lists.types))?S.lists.types:null;
  if(!L||!L.length) return BUILTIN_TYPES;
  const m={};
  L.forEach(function(t){
    if(!t||!t.key) return;
    m[t.key]={label:t.label||t.key, short:(t.short||String(t.label||t.key).slice(0,3)).toUpperCase(),
              cls:t.cls||(t.bill?"work":"abs"), proj:!!t.proj, bill:!!t.bill, abs:!!t.abs};
  });
  return Object.keys(m).length?m:BUILTIN_TYPES;
}
const typeKeys = () => Object.keys(typeMap());
const typeOf = k => typeMap()[k] || {label:String(k||"Okänd"), short:"?", cls:"abs", proj:false, bill:false, abs:false};
const STATUS = {
  utkast:    {label:"Utkast",     cls:""},
  inskickad: {label:"Inskickad",  cls:"dash"},
  godkand:   {label:"Attesterad", cls:"solid"},
  retur:     {label:"Returnerad", cls:"dash"}
};
const PSTATUS = {aktiv:"Aktivt", vilande:"Vilande", avslutad:"Avslutat"};
/* Fakturastatus per projekt. "Ej skapad faktura" är förvalet. */
const INVSTATUS = {ej:"Ej skapad faktura", skapad:"Faktura skapad", fakturerad:"Fakturerad"};
const pStatus = p => (p && p.status) || "aktiv";
/* Aktivt = grönt, vilande = gult, avslutat = neutralt. */
const pStatusPill = p => '<span class="pill'+(({aktiv:" ok", vilande:" warn"})[pStatus(p)]||"")+'">'+PSTATUS[pStatus(p)]+'</span>';
const invSelect = p => '<select class="inv inv-'+esc(p.invoice||"ej")+'" data-p="'+esc(p.id)+'" aria-label="Fakturastatus för '+esc(p.name)+'">'
  + Object.keys(INVSTATUS).map(k=>'<option value="'+k+'"'+((p.invoice||"ej")===k?" selected":"")+'>'+INVSTATUS[k]+'</option>').join("")+'</select>';
const BUILTIN_COSTS = {
  material:  {label:"Material",        unit:"st",  price:0,  bill:true},
  mil:       {label:"Milersättning",   unit:"mil", price:25, bill:true},
  underlev:  {label:"Underleverantör", unit:"st",  price:0,  bill:true},
  utlagg:    {label:"Utlägg",          unit:"st",  price:0,  bill:true},
  maskin:    {label:"Maskin/hyra",     unit:"dag", price:0,  bill:true}
};
function costMap(){
  const L=(S.lists&&Array.isArray(S.lists.costs))?S.lists.costs:null;
  if(!L||!L.length) return BUILTIN_COSTS;
  const m={};
  L.forEach(function(c){
    if(!c||!c.key) return;
    m[c.key]={label:c.label||c.key, unit:c.unit||"st", price:+c.price||0, bill:c.bill!==false};
  });
  return Object.keys(m).length?m:BUILTIN_COSTS;
}
const costKeys = () => Object.keys(costMap());
const costOf = k => costMap()[k] || {label:String(k||"Övrigt"), unit:"st", price:0, bill:true};

/* ============================ hjälpare ============================ */
const nf = new Intl.NumberFormat("sv-SE",{minimumFractionDigits:2,maximumFractionDigits:2});
const mfm = new Intl.NumberFormat("sv-SE",{maximumFractionDigits:0});
const fmt = n => nf.format(Math.round(((+n||0)+Number.EPSILON)*100)/100);
const kr  = n => mfm.format(Math.round(+n||0))+" kr";
const pad = n => String(n).padStart(2,"0");
const dkey = d => d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const mkey = d => d.getFullYear()+"-"+pad(d.getMonth()+1);
const fromKey = s => { const p=String(s).split("-").map(Number); return new Date(p[0],p[1]-1,p[2]); };
const esc = s => String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const MONTHS = ["januari","februari","mars","april","maj","juni","juli","augusti","september","oktober","november","december"];
const DAYS = ["måndag","tisdag","onsdag","torsdag","fredag","lördag","söndag"];
const DAYS_S = ["Mån","Tis","Ons","Tor","Fre","Lör","Sön"];
const isoDow = d => (d.getDay()+6)%7;
const monthName = ym => { const p=ym.split("-"); return MONTHS[+p[1]-1]+" "+p[0]; };
const r2 = n => Math.round(((+n||0)+Number.EPSILON)*100)/100;
const uid = () => Math.random().toString(36).slice(2,9);
const cap = s => String(s).replace(/^./,c=>c.toUpperCase());

function isoWeek(d){
  const t=new Date(d.getFullYear(),d.getMonth(),d.getDate());
  t.setDate(t.getDate()-isoDow(t)+3);
  const first=new Date(t.getFullYear(),0,4);
  return 1+Math.round(((t-first)/86400000-3+((first.getDay()+6)%7))/7);
}
function isoWeekYear(d){
  const t=new Date(d.getFullYear(),d.getMonth(),d.getDate());
  t.setDate(t.getDate()-isoDow(t)+3);
  return t.getFullYear();
}
const wkey = d => isoWeekYear(d)+"-W"+pad(isoWeek(d));
const wkNo = wk => +String(wk).slice(6);
function weekMonday(wk){
  const y=+wk.slice(0,4), w=wkNo(wk);
  const jan4=new Date(y,0,4), mon=new Date(jan4);
  mon.setDate(jan4.getDate()-isoDow(jan4)+(w-1)*7);
  return mon;
}
function weekDates(wk){
  const m=weekMonday(wk), out=[];
  for(let i=0;i<7;i++){ const d=new Date(m); d.setDate(m.getDate()+i); out.push(dkey(d)); }
  return out;
}
function weeksInMonth(ym){
  const y=+ym.slice(0,4), mo=+ym.slice(5,7)-1, last=new Date(y,mo+1,0).getDate(), out=[];
  for(let d=1;d<=last;d++){ const k=wkey(new Date(y,mo,d)); if(out.indexOf(k)<0) out.push(k); }
  return out;
}
function monthDates(ym){
  const y=+ym.slice(0,4), mo=+ym.slice(5,7)-1, last=new Date(y,mo+1,0).getDate(), out=[];
  for(let d=1;d<=last;d++) out.push(y+"-"+pad(mo+1)+"-"+pad(d));
  return out;
}
function weekSpan(wk){
  const ds=weekDates(wk), a=fromKey(ds[0]), b=fromKey(ds[6]);
  return a.getDate()+" "+MONTHS[a.getMonth()].slice(0,3)+" – "+b.getDate()+" "+MONTHS[b.getMonth()].slice(0,3);
}
function parseHours(v){
  if(v==null) return NaN;
  const s=String(v).trim().replace(/\s/g,"");
  if(!s) return NaN;
  const m=s.replace(",",".").match(/^(\d{1,2})[:h](\d{1,2})$/i);
  if(m) return +m[1] + (+m[2])/60;
  const n=parseFloat(s.replace(",","."));
  return isNaN(n)?NaN:n;
}
function slug(s){
  return (String(s).toLowerCase().replace(/å|ä/g,"a").replace(/ö/g,"o").replace(/é/g,"e")
    .replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"") || "post") + "-" + uid().slice(0,4);
}
const uname = s => String(s||"").trim().toLowerCase().replace(/[^a-z0-9._-]/g,"");
const emailFor = u => uname(u)+"@"+ACCOUNT_DOMAIN;
const looksReal = e => !!e && String(e).indexOf("@"+ACCOUNT_DOMAIN)<0;
/* Kontonamnet kan peka på en riktig e-postadress – då fungerar återställning via mejl. */
async function loginEmail(u){
  /* Den som kopplat en riktig e-postadress kan alltid logga in med den direkt,
     även om uppslaget för kontonamnet av någon anledning inte pekar rätt. */
  const raw=String(u||"").trim().toLowerCase();
  if(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw)) return raw;
  const key=uname(u);
  try{
    const d=await getDoc(doc(db,"usernames",key));
    if(d.exists() && d.data().email) return String(d.data().email);
  }catch(e){}
  return emailFor(key);
}
const initials = n => String(n||"?").split(/\s+/).filter(Boolean).slice(0,2).map(s=>s[0].toUpperCase()).join("");

/* ---- svenska helgdagar ---- */
const holCache = {};
function easter(y){
  const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),
        g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,
        l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),
        mo=Math.floor((h+l-7*m+114)/31),da=((h+l-7*m+114)%31)+1;
  return new Date(y,mo-1,da);
}
function holidays(y){
  if(holCache[y]) return holCache[y];
  const h={}, add=(d,n)=>{h[dkey(d)]=n;};
  const off=(base,n)=>{const d=new Date(base); d.setDate(d.getDate()+n); return d;};
  const E=easter(y);
  add(new Date(y,0,1),"Nyårsdagen"); add(new Date(y,0,6),"Trettondedag jul");
  add(off(E,-2),"Långfredag"); add(E,"Påskdagen"); add(off(E,1),"Annandag påsk");
  add(new Date(y,4,1),"Första maj"); add(off(E,39),"Kristi himmelsfärd"); add(off(E,49),"Pingstdagen");
  add(new Date(y,5,6),"Nationaldagen");
  for(let d=19;d<=25;d++){const x=new Date(y,5,d); if(x.getDay()===5){add(x,"Midsommarafton"); add(off(x,1),"Midsommardagen");}}
  for(let d=31;d<=37;d++){const x=new Date(y,9,d); if(x.getDay()===6){add(x,"Alla helgons dag"); break;}}
  add(new Date(y,11,24),"Julafton"); add(new Date(y,11,25),"Juldagen");
  add(new Date(y,11,26),"Annandag jul"); add(new Date(y,11,31),"Nyårsafton");
  holCache[y]=h; return h;
}
const holidayName = ds => holidays(+String(ds).slice(0,4))[ds] || null;
const isWorkday = ds => isoDow(fromKey(ds))<5 && !holidayName(ds);

/* ============================ firebase ============================ */
const configured = !!(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId);
let fbApp=null, auth=null, db=null;
if(configured){
  fbApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
  auth = getAuth(fbApp);
  try{
    db = initializeFirestore(fbApp, {localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})});
  }catch(e){ db = getFirestore(fbApp); }
}
function authMsg(code){
  const m={
    "auth/invalid-credential":"Fel kontonamn eller lösenord.",
    "auth/invalid-login-credentials":"Fel kontonamn eller lösenord.",
    "auth/wrong-password":"Fel kontonamn eller lösenord.",
    "auth/user-not-found":"Fel kontonamn eller lösenord.",
    "auth/invalid-email":"Kontonamnet innehåller tecken som inte fungerar. Använd bokstäver och siffror.",
    "auth/too-many-requests":"För många försök. Vänta en stund och prova igen.",
    "auth/network-request-failed":"Ingen anslutning. Kontrollera nätet och försök igen.",
    "auth/email-already-in-use":"Kontonamnet är redan taget.",
    "auth/weak-password":"Lösenordet måste vara minst sex tecken.",
    "auth/operation-not-allowed":"Inloggning med lösenord är inte påslaget i Firebase. Slå på E-post/lösenord under Authentication → Sign-in method.",
    "auth/requires-recent-login":"Logga ut och in igen innan du byter lösenord."
  };
  return m[code] || "Något gick fel. Försök igen.";
}
/* Om den lokala offline-cachen inte går att använda i den här webbläsaren
   (privat läge, blockerad IndexedDB) svarar Firestore med failed-precondition
   eller unavailable. Då kopplar vi om till en instans utan cache och provar igen. */
let dbFallbackTried = false;
function canFallback(err){
  const c = err && err.code;
  return !dbFallbackTried && (c==="failed-precondition" || c==="unavailable");
}
function useDbFallback(){
  dbFallbackTried = true;
  try{
    const alt = getApps().find(a=>a.name==="nocache") || initializeApp(firebaseConfig, "nocache");
    db = getFirestore(alt);
    console.warn("Ellingesmide: kopplade om till Firestore utan lokal cache.");
    return true;
  }catch(e){ console.error(e); return false; }
}

const Store = {
  async get(path){ const s=await getDoc(doc(db,path)); return s.exists()?s.data():null; },
  async set(path,data){ await setDoc(doc(db,path), data); },
  async del(path){ await deleteDoc(doc(db,path)); },
  async list(coll, field, value){
    const c=collection(db,coll);
    const q=field?query(c,where(field,"==",value)):c;
    const s=await getDocs(q);
    return s.docs.map(d=>Object.assign({_id:d.id, id:d.id}, d.data()));
  },
  /* Allt från ett visst värde och uppåt – används för att bara hämta den
     senaste tidens resor i stället för hela historiken. */
  async listFrom(coll, field, value){
    const c=collection(db,coll);
    const s=await getDocs(query(c,where(field,">=",value)));
    return s.docs.map(d=>Object.assign({_id:d.id, id:d.id}, d.data()));
  },
  watch(coll, field, value, cb){
    try{
      const c=collection(db,coll);
      const q=field?query(c,where(field,"==",value)):c;
      return onSnapshot(q, s=>cb(s.docs.map(d=>Object.assign({_id:d.id, id:d.id}, d.data()))), ()=>{});
    }catch(e){ return ()=>{}; }
  }
};

/* ============================ state ============================ */
const S = {
  phase:"boot", me:null, employees:[], projects:[], months:[], approvals:[],
  allApprovals:[], everyMonth:[], loginErr:"", busy:false, creating:false, dbErr:"", metaExists:false,
  pendingUser:null, fixErr:"", fixMsg:"", fixRaw:"", ownerUid:"",
  costs:[], from:"", to:"", vat:25,
  archive:[], arkFilter:"alla", importRows:[], importPid:"",
  backups:[], backupState:null, backupRunning:false,
  vehicles:[], trips:[], korVeh:"", korWho:"alla", scan:null, deepKor:"",
  reminders:[], lwApprovals:[], settings:{}, lists:{}, inbox:[], inboxFilter:"oppna",
  view:"month", tab:"tid", cursor:new Date(), targetEmp:null,
  projSel:null, projPeriod:"month", lastProj:null, unsubs:[], installEvt:null,
  offers:[], off:null, offSel:null, firm:{}
};
/* QR-koderna i bilarna pekar på #kor=<bilens id>. Adressen läses av innan
   inloggningen, så att rätt bil öppnas så fort föraren är inne. */
function parseKorHash(){
  try{
    const dm=/[#&]kor=([A-Za-z0-9_.~:@+-]+)/.exec(location.hash||"");
    return dm ? dm[1] : "";
  }catch(e){ return ""; }
}
S.deepKor = parseKorHash();

const app = document.getElementById("app");
const modalRoot = document.getElementById("modal-root");
const toastRoot = document.getElementById("toast-root");
let toastTimer=null;
function toast(msg){
  toastRoot.innerHTML='<div class="toast">'+esc(msg)+'</div>';
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{toastRoot.innerHTML="";},3400);
}
function prefsSave(){
  try{ localStorage.setItem("timmar:prefs", JSON.stringify({
    view:S.view, tab:S.tab, cursor:dkey(S.cursor), lastProj:S.lastProj
  })); }catch(e){}
}
function prefsLoad(){
  try{ return JSON.parse(localStorage.getItem("timmar:prefs")||"{}"); }catch(e){ return {}; }
}

/* ============================ beräkningar ============================ */
function monthDoc(empId, ym, src){
  return (src||S.months).find(m=>m.empId===empId && m.month===ym) || {empId:empId, month:ym, days:{}};
}
function entriesFor(empId, ds, src){
  return (monthDoc(empId, mkey(fromKey(ds)), src).days||{})[ds] || [];
}
function approvalOf(empId, wk){
  return S.approvals.find(a=>a.empId===empId && a.week===wk) || {empId:empId, week:wk, status:"utkast"};
}
function dayStats(ds, entries){
  let total=0, ot=0, bill=0, abs=0;
  (entries||[]).forEach(e=>{
    const t=typeOf(e.type), h=+e.hours||0;
    total+=h;
    if(e.type==="overtid") ot+=h;
    if(t.bill) bill+=h;
    if(t.abs) abs+=h;
  });
  return {total:r2(total), ot:r2(ot), bill:r2(bill), abs:r2(abs), has:(entries||[]).length>0};
}
function rangeStats(empId, dates, src){
  const today=dkey(new Date());
  let worked=0, ot=0, bill=0, abs=0, regDays=0;
  const byType={}, byProj={}, missing=[];
  dates.forEach(ds=>{
    const es=entriesFor(empId, ds, src);
    const st=dayStats(ds, es);
    worked+=st.total; ot+=st.ot; bill+=st.bill; abs+=st.abs;
    es.forEach(e=>{
      byType[e.type]=(byType[e.type]||0)+(+e.hours||0);
      const p=e.projectId||"_"; byProj[p]=(byProj[p]||0)+(+e.hours||0);
    });
    if(st.has) regDays++;
    else if(isWorkday(ds) && ds<=today) missing.push(ds);
  });
  return {worked:r2(worked), ot:r2(ot), bill:r2(bill), abs:r2(abs),
          byType:byType, byProj:byProj, missing:missing, regDays:regDays};
}
const monthStats = (empId, ym, src) => rangeStats(empId, monthDates(ym), src);
const weekStats  = (empId, wk, src) => rangeStats(empId, weekDates(wk), src);

function isLocked(empId, ds){
  if(isAdmin()) return false;
  const st=approvalOf(empId, wkey(fromKey(ds))).status;
  return st==="inskickad" || st==="godkand";
}
const projById = id => S.projects.find(p=>p.id===id) || null;
const projLabel = id => { const p=projById(id); return p ? (p.kod||p.name) : "Utan projekt"; };
/* Superadmin och support har samma befogenheter i tidrapporteringen. */
const isOwner = () => !!(S.me && S.ownerUid && S.me.id===S.ownerUid);
/* Den som satte upp firman räknas alltid som superadmin, även om rollen
   blivit fel i databasen. Annars kan ingen rätta till något. */
const isAdmin = () => !!(S.me && (S.me.role==="admin" || S.me.role==="support" || isOwner()));
const isSupport = () => !!(S.me && S.me.role==="support");
/* Inställningar med standardvärden som fallback. */
function cfg(path, fallback){
  const parts=String(path).split(".");
  let a=S.settings, b=DEFAULTS;
  for(const k of parts){
    a = (a && typeof a==="object") ? a[k] : undefined;
    b = (b && typeof b==="object") ? b[k] : undefined;
  }
  if(a===undefined || a===null || a==="") return (b===undefined?fallback:b);
  return a;
}
const roleLabel = r => cfg("roles."+r, (ROLES[r]||{}).label||r);
function applySettings(){
  const mode=cfg("theme.mode","auto");
  const root=document.documentElement;
  if(mode==="light"||mode==="dark") root.setAttribute("data-theme",mode);
  else root.removeAttribute("data-theme");
  const ink=cfg("theme.ink",""), ground=cfg("theme.ground","");
  if(ink) root.style.setProperty("--ink",ink); else root.style.removeProperty("--ink");
  if(ground) root.style.setProperty("--ground",ground); else root.style.removeProperty("--ground");
  S.vat=cfg("vat",25);
  const name=cfg("appName","Ellingesmide");
  try{ document.title = name; }catch(e){}
}

/* ============================ data ============================ */
async function loadAll(){
  /* Arbetare får bara läsa sin egen profil – säkerhetsreglerna nekar resten,
     och appen visar ändå aldrig andras uppgifter för dem. */
  S.employees = isAdmin()
    ? (await Store.list("employees")).sort((a,b)=>String(a.name).localeCompare(String(b.name),"sv"))
    : [S.me];
  S.projects=(await Store.list("projects")).sort((a,b)=>String(a.kod||"").localeCompare(String(b.kod||""),"sv"));
  try{ S.settings=(await Store.get("settings/app"))||{}; }catch(e){ S.settings={}; }
  try{ S.lists=(await Store.get("settings/lists"))||{}; }catch(e){ S.lists={}; }
  applySettings();
}
const loadInbox = async () => {
  const rows=await Store.list("support");
  S.inbox=rows.sort((a,b)=>String(b.at||"").localeCompare(String(a.at||"")));
};
async function selectEmployee(empId){
  S.targetEmp=empId;
  S.unsubs.forEach(u=>{try{u();}catch(e){}}); S.unsubs=[];
  S.months=await Store.list("months","empId",empId);
  S.approvals=await Store.list("approvals","empId",empId);
  S.unsubs.push(Store.watch("months","empId",empId,rows=>{S.months=rows;scheduleRender();}));
  S.unsubs.push(Store.watch("approvals","empId",empId,rows=>{S.approvals=rows;scheduleRender();}));
}
const loadWeekApprovals = async () => { S.allApprovals=await Store.list("approvals","week",wkey(S.cursor)); };
const loadEveryMonth = async () => { S.everyMonth=await Store.list("months"); };
/* Månaderna som en vecka berör – oftast en, ibland två. */
const weekMonths = wk => weekDates(wk).map(ds=>ds.slice(0,7)).filter((m,i,a)=>a.indexOf(m)===i);
/* Hämtar bara de månader som behövs och lägger in dem bland de redan hämtade.
   Attest, personal och påminnelser tittar på en vecka i taget, så de behöver
   inte hela historiken – den växer med varje månad appen används. */
async function loadMonthsFor(yms){
  if(!isAdmin()) return;
  for(const ym of yms){
    const rows=await Store.list("months","month",ym);
    S.everyMonth=S.everyMonth.filter(m=>m.month!==ym).concat(rows);
  }
}
const loadCosts = async () => { S.costs=await Store.list("costs"); };
/* Projektfliken. Superadmin ser allas timmar och alla kostnader. En arbetare
   ser bara sina egna timmar – andras får hen inte läsa. */
async function loadProjectData(){
  if(isAdmin()){ await loadEveryMonth(); await loadCosts(); }
  else { S.everyMonth=S.months.slice(); S.costs=[]; }
}

/* Markerar veckans dagar som låsta (eller olåsta) i månadsdokumenten. Det är
   den markeringen säkerhetsreglerna tittar på: en arbetare kan inte ändra en
   dag som är låst, och bara superadmin kan ta bort ett lås. */
async function setWeekLock(empId, wk, lock){
  const dates=weekDates(wk);
  for(const ym of weekMonths(wk)){
    const path="months/"+empId+"__"+ym;
    let cur=null; try{ cur=await Store.get(path); }catch(e){}
    cur=cur||{empId:empId, month:ym, days:{}};
    const locked=Object.assign({}, cur.locked||{});
    let changed=false;
    dates.filter(ds=>ds.slice(0,7)===ym).forEach(function(ds){
      if(lock && !locked[ds]){ locked[ds]=true; changed=true; }
      if(!lock && locked[ds]){ delete locked[ds]; changed=true; }
    });
    if(!changed) continue;
    const body=Object.assign({}, cur, {empId:empId, month:ym, locked:locked});
    delete body._id; delete body.id;
    await Store.set(path, body);
    [S.months, S.everyMonth].forEach(function(arr){
      const i=arr.findIndex(m=>m.empId===empId&&m.month===ym);
      if(i>=0) arr[i]=Object.assign({}, arr[i], {locked:locked});
    });
  }
}
/* En gång: lås dagarna i veckor som redan var inskickade eller attesterade
   innan låsmarkeringen fanns. Körs av superadmin i bakgrunden. */
async function backfillLocks(){
  if(!isAdmin()) return;
  let meta=null; try{ meta=await Store.get("meta/app"); }catch(e){ return; }
  if(!meta || meta.locksV>=1) return;
  const rows=await Store.list("approvals");
  for(const a of rows){
    if(a.status==="inskickad"||a.status==="godkand"){
      try{ await setWeekLock(a.empId, a.week, true); }catch(e){ console.error("lås", a.empId, a.week, e); return; }
    }
  }
  await Store.set("meta/app", Object.assign({}, meta, {locksV:1}));
}
async function saveDay(empId, ds, entries){
  const ym=mkey(fromKey(ds));
  const days=Object.assign({}, monthDoc(empId,ym).days||{});
  if(entries && entries.length) days[ds]=entries; else delete days[ds];
  const body={empId:empId, month:ym, days:days, updatedAt:new Date().toISOString()};
  /* Låsta dagar (inskickad eller attesterad vecka) följer med. Utan dem kan
     databasen inte neka ändringar i en attesterad vecka. */
  const lk=monthDoc(empId,ym).locked;
  if(lk && Object.keys(lk).length) body.locked=lk;
  await Store.set("months/"+empId+"__"+ym, body);
  const i=S.months.findIndex(m=>m.empId===empId&&m.month===ym);
  if(i>=0) S.months[i]=Object.assign({},S.months[i],body); else S.months.push(body);
}
async function setApproval(empId, wk, status, comment){
  const body={empId:empId, week:wk, status:status, comment:comment||"",
              by:S.me?S.me.name:"", at:new Date().toISOString()};
  await Store.set("approvals/"+empId+"__"+wk, body);
  await setWeekLock(empId, wk, status==="inskickad"||status==="godkand");
  const i=S.approvals.findIndex(a=>a.empId===empId&&a.week===wk);
  if(i>=0) S.approvals[i]=body; else S.approvals.push(body);
  const j=S.allApprovals.findIndex(a=>a.empId===empId&&a.week===wk);
  if(j>=0) S.allApprovals[j]=body; else if(wk===wkey(S.cursor)) S.allApprovals.push(body);
}

/* ============================ körjournal ============================ */
/* Mätarställningen läses alltid i kilometer – det är vad totalmätaren visar.
   Milen räknas fram ur den, eftersom milersättningen går per mil. */
const TRIPKIND = {tjanst:"Tjänsteresa", privat:"Privat resa"};
const KOR_DAGAR = 200;            /* så långt bakåt superadmin hämtar resor */
const milOf = km => r2((+km||0)/10);
const vehById = id => S.vehicles.find(v=>v.id===id) || null;
const vehLabel = v => v ? (v.regnr + (v.name?" · "+v.name:"")) : "Okänd bil";
const openTrip = (vehId, empId) =>
  S.trips.find(t=>t.vehicleId===vehId && t.empId===empId && t.status==="open") || null;
/* Den påbörjade resa som avslutas i bilen. I första hand sin egen. Har någon
   annan glömt att avsluta sin resa i bilen kan nästa förare avsluta den –
   annars blir den hängande och bilen går inte att använda igen. */
function openTripHere(vehId){
  return openTrip(vehId, S.me.id)
      || S.trips.find(t=>t.vehicleId===vehId && t.status==="open") || null;
}
/* Adressen som QR-koden i bilen pekar på. */
function korUrl(vehId){
  const base = location.origin + location.pathname.replace(/index\.html$/, "");
  return base + "#kor=" + vehId;
}

async function loadKor(){
  try{ S.vehicles=(await Store.list("vehicles")).sort((a,b)=>String(a.regnr||"").localeCompare(String(b.regnr||""),"sv")); }
  catch(e){ console.error(e); S.vehicles=[]; }
  try{
    /* Arbetare hämtar bara sina egna resor. Det är också vad säkerhetsreglerna
       tillåter – en bredare fråga skulle nekas av databasen.
       Superadmin ser allas, men bara det senaste halvåret: hela historiken
       skulle växa utan tak och laddas om varje gång fliken öppnas. Äldre resor
       finns kvar i databasen och i de dagliga säkerhetskopiorna. */
    if(isAdmin()){
      const cut=new Date(); cut.setDate(cut.getDate()-KOR_DAGAR);
      S.trips = await Store.listFrom("trips","startAt",cut.toISOString());
    }else{
      S.trips = await Store.list("trips","empId",S.me.id);
    }
    /* Påbörjade resor i alla bilar, även andras och äldre än perioden, så att
       en resa någon glömt att avsluta syns på bilen och går att avsluta. */
    try{
      const open=await Store.list("trips","status","open");
      open.forEach(function(t){ if(!S.trips.some(x=>x.id===t.id)) S.trips.push(t); });
    }catch(e){ console.warn("påbörjade resor", e); }
    S.trips.sort((a,b)=>String(b.startAt||"").localeCompare(String(a.startAt||"")));
    if(isAdmin()) moveTripPhotos().catch(function(e){ console.error("fotoflytt", e); });
  }catch(e){ console.error(e); S.trips=[]; }
}

/* Resorna som hör till perioden som visas, efter valt filter. */
function korRows(){
  const ym = mkey(S.cursor);
  return S.trips.filter(function(t){
    /* En påbörjad resa visas alltid, även om den startades en tidigare månad.
       Annars ser det ut som att den försvunnit när klockan slår midnatt den
       sista i månaden och föraren fortfarande är ute. */
    if(t.status!=="open" && String(t.startAt||"").slice(0,7)!==ym) return false;
    if(S.korVeh && t.vehicleId!==S.korVeh) return false;
    if(isAdmin() && S.korWho!=="alla" && t.empId!==S.korWho) return false;
    if(!isAdmin() && t.empId!==S.me.id) return false;
    return true;
  });
}

function viewKor(){
  const rows=korRows();
  const mine=S.vehicles.map(function(v){
    const op=openTripHere(v.id);
    return '<div class="panel" style="padding:14px">'
      + '<div class="hd" style="margin:0 0 10px"><div>'
      + '<span class="eyebrow">'+esc(v.name||"Fordon")+'</span>'
      + '<h3 style="margin-top:2px"><span class="code">'+esc(v.regnr)+'</span></h3></div>'
      + (op?'<span class="pill dash">Resa igång</span>':'')+'</div>'
      + (op
        ? '<p class="note" style="margin-bottom:10px">Startad '+esc(tidText(op.startAt))+' vid '
          + '<b>'+mfm.format(op.startKm)+' km</b>'
          + (op.empId!==S.me.id?' av <b>'+esc(op.empName||"annan förare")+'</b>':'')
          + (op.projectId?' · '+esc(projName(op.projectId)):'')+'</p>'
          + '<button class="btn primary block" data-act="korscan" data-v="'+v.id+'" data-p="slut">Avsluta resa – läs av mätaren</button>'
        : '<button class="btn primary block" data-act="korscan" data-v="'+v.id+'" data-p="start">Starta resa – läs av mätaren</button>')
      + (isAdmin()?'<div class="form even" style="margin-top:10px">'
          + '<button class="btn sm" data-act="korqr" data-v="'+v.id+'">QR att sätta i bilen</button>'
          + '<button class="btn sm ghost" data-act="korveh" data-v="'+v.id+'">Ändra bil</button></div>':'')
      + '</div>';
  }).join("");

  /* summering per projekt för perioden */
  const perProj={}; let sumTj=0, sumPriv=0;
  rows.forEach(function(t){
    if(t.status!=="done") return;
    const km=+t.km||0;
    if(t.kind==="privat"){ sumPriv+=km; return; }
    sumTj+=km;
    const k=t.projectId||"";
    perProj[k]=(perProj[k]||0)+km;
  });
  const projRows=Object.keys(perProj).sort(function(a,b){return perProj[b]-perProj[a];}).map(function(k){
    return '<tr><td>'+(k?esc(projName(k)):'<span class="note">Utan projekt</span>')+'</td>'
      + '<td class="r">'+mfm.format(perProj[k])+'</td>'
      + '<td class="r">'+fmt(milOf(perProj[k]))+'</td>'
      + (isAdmin()?'<td class="r">'+(k?'<button class="btn sm" data-act="korbook" data-p="'+esc(k)+'">Bokför milersättning</button>':'')+'</td>':'')
      + '</tr>';
  }).join("");

  const tripRows=rows.map(function(t){
    const open=t.status==="open";
    return '<tr>'
      + '<td>'+esc(dagText(t.startAt))+'</td>'
      + '<td><span class="code">'+esc(t.regnr||"—")+'</span></td>'
      + (isAdmin()?'<td>'+esc(t.empName||"—")+'</td>':'')
      + '<td>'+(t.projectId?esc(projName(t.projectId)):'<span class="note">—</span>')+'</td>'
      + '<td><span class="pill'+(t.kind==="privat"?"":" solid")+'">'+esc(TRIPKIND[t.kind]||"—")+'</span>'
      + (t.purpose?'<div class="note">'+esc(t.purpose)+'</div>':'')+'</td>'
      + '<td class="r">'+mfm.format(t.startKm||0)+'</td>'
      + '<td class="r">'+(open?'<span class="note">pågår</span>':mfm.format(t.endKm||0))+'</td>'
      + '<td class="r"><b>'+(open?"—":mfm.format(t.km||0))+'</b></td>'
      + '<td class="r">'+(open?"—":fmt(milOf(t.km)))+'</td>'
      + '<td class="r"><button class="btn sm ghost" data-act="kortrip" data-t="'+esc(t.id)+'">Öppna</button></td></tr>';
  }).join("");

  const whoSel = isAdmin()
    ? '<label class="fld" style="min-width:160px"><span class="eyebrow">Förare</span><select id="kor-who">'
      + '<option value="alla">Alla förare</option>'
      + S.employees.map(e=>'<option value="'+e.id+'"'+(S.korWho===e.id?" selected":"")+'>'+esc(e.name)+'</option>').join("")
      + '</select></label>' : "";

  return '<div class="bar">'
    + '<div class="navgroup">'
    + '<button class="btn sm" data-act="prev" aria-label="Föregående">‹</button>'
    + '<div class="per">'+esc(cap(monthName(mkey(S.cursor))))+'</div>'
    + '<button class="btn sm" data-act="next" aria-label="Nästa">›</button>'
    + '<button class="btn sm ghost" data-act="today">Idag</button></div>'
    + '<div class="form" style="gap:10px">'
    + '<label class="fld" style="min-width:160px"><span class="eyebrow">Bil</span><select id="kor-veh">'
    + '<option value="">Alla bilar</option>'
    + S.vehicles.map(v=>'<option value="'+v.id+'"'+(S.korVeh===v.id?" selected":"")+'>'+esc(vehLabel(v))+'</option>').join("")
    + '</select></label>'
    + whoSel
    + (isAdmin()?'<button class="btn sm" data-act="korxls">Excel</button>':'')
    + '</div></div>'

    + (S.vehicles.length
      ? '<div class="grid2" style="margin-top:6px">'+mine+'</div>'
      : '<div class="panel" style="padding:16px;margin-top:6px"><h3>Inga bilar upplagda</h3>'
        + '<p class="note" style="margin:6px 0 0">'
        + (isAdmin()
           ? 'Lägg upp firmans bilar nedan. För varje bil får du en QR-kod att skriva ut och sätta i bilen – den öppnar körjournalen direkt i rätt bil.'
           : 'Din arbetsledare lägger upp bilarna. Hör av dig när du behöver kunna rapportera körning.')
        + '</p></div>')

    + (isAdmin()?'<div class="panel" style="padding:14px;margin-top:12px">'
      + '<div class="hd" style="margin:0"><div><h3>Bilar</h3>'
      + '<span class="note">Varje bil får en egen QR-kod att sätta i rutan</span></div>'
      + '<button class="btn primary" data-act="korveh">Lägg till bil</button></div></div>':'')

    + '<div class="panel" style="margin-top:12px">'
    + '<div class="hd"><div><h3>Resor i '+esc(monthName(mkey(S.cursor)))+'</h3>'
    + '<span class="note">'+(isAdmin()?'Alla förare':'Dina egna resor')+' · '+rows.length+' st</span></div></div>'
    + '<div class="tblwrap" style="border:0"><table class="tbl"><thead><tr>'
    + '<th>Datum</th><th>Bil</th>'+(isAdmin()?'<th>Förare</th>':'')+'<th>Projekt</th><th>Typ</th>'
    + '<th class="r">Mätare start</th><th class="r">Mätare slut</th><th class="r">Km</th><th class="r">Mil</th><th></th>'
    + '</tr></thead><tbody>'
    + (tripRows||'<tr><td colspan="'+(isAdmin()?10:9)+'"><span class="note">Inga resor den här månaden.</span></td></tr>')
    + '</tbody></table></div></div>'

    + (projRows?'<div class="panel" style="margin-top:12px">'
      + '<div class="hd"><div><h3>Tjänstekörning per projekt</h3>'
      + '<span class="note">Privat körning ingår inte i summan</span></div></div>'
      + '<div class="tblwrap" style="border:0"><table class="tbl"><thead><tr>'
      + '<th>Projekt</th><th class="r">Km</th><th class="r">Mil</th>'+(isAdmin()?'<th></th>':'')+'</tr></thead>'
      + '<tbody>'+projRows+'</tbody>'
      + '<tfoot><tr><th>Summa tjänsteresor</th><th class="r">'+mfm.format(sumTj)+'</th>'
      + '<th class="r">'+fmt(milOf(sumTj))+'</th>'+(isAdmin()?'<th></th>':'')+'</tr>'
      + (sumPriv?'<tr><th><span class="note">Varav privat (utanför summan)</span></th>'
        + '<th class="r"><span class="note">'+mfm.format(sumPriv)+'</span></th>'
        + '<th class="r"><span class="note">'+fmt(milOf(sumPriv))+'</span></th>'+(isAdmin()?'<th></th>':'')+'</tr>':'')
      + '</tfoot></table></div></div>':'');
}
const projName = pid => { const p=projById(pid); return p ? (p.kod?p.kod+" · ":"")+p.name : "Okänt projekt"; };
const dagText = iso => { const d=String(iso||"").slice(0,10); return d||"—"; };
const tidText = iso => {
  const s=String(iso||""); if(s.length<16) return "—";
  return s.slice(8,10)+"/"+s.slice(5,7)+" "+s.slice(11,16);
};

/* ============================ topbar ============================ */
function topbar(){
  const me=S.me;
  /* Körjournalen ligger direkt efter tidrapporten och finns för alla roller. */
  const tabs = isAdmin()
    ? [["tid",cfg("tabs.tid")],["kor",cfg("tabs.kor")],["projekt",cfg("tabs.projekt")],["statistik",cfg("tabs.statistik")],["kalkyl",cfg("tabs.kalkyl")],["attest",cfg("tabs.attest")],["lon",cfg("tabs.lon")],
       ["arkiv",cfg("tabs.arkiv")],["personal",cfg("tabs.personal")],["listor",cfg("tabs.listor")]]
      .concat(isSupport()?[["inkorg",cfg("tabs.inkorg")],["utseende",cfg("tabs.utseende")]]:[])
    : [["tid",cfg("tabs.mitt")],["kor",cfg("tabs.kor")],["projekt",cfg("tabs.projekt")]];
  return '<div class="topbar">'
    + '<div class="brand"><span class="logo-mark" aria-hidden="true"></span><h1>'+esc(cfg("appName"))+'</h1>'
    + '</div>'
    + (S.installEvt?'<button class="btn sm" data-act="install">Installera appen</button>':'')
    + (S.updateReady?'<button class="btn sm primary" data-act="doupdate" title="En ny version av appen finns">Uppdatera appen</button>':'')
    + '<button class="userchip" data-act="memenu"><span class="avatar">'+esc(initials(me.name))+'</span>'
    + '<span><span class="nm">'+esc(me.name)+'</span> <span class="note">· '+esc(roleLabel(me.role))+'</span></span>'
    + '<span class="eyebrow">Konto</span></button>'
    + '</div>'
    + '<div class="tabs" role="tablist">'
    + tabs.map(t=>'<button class="tab" role="tab" aria-selected="'+(S.tab===t[0])+'" data-act="tab" data-v="'+t[0]+'">'+t[1]+'</button>').join("")
    + '</div><div class="temper" aria-hidden="true"></div>';
}

/* ============================ tidrapport ============================ */
function viewTid(){
  const emp=(isAdmin() ? S.employees.find(e=>e.id===S.targetEmp) : null) || S.me;
  let head='<div class="bar">'
    + '<div class="navgroup">'
    + '<button class="btn sm" data-act="prev" aria-label="Föregående">‹</button>'
    + '<div class="per">'+periodLabel()+'</div>'
    + '<button class="btn sm" data-act="next" aria-label="Nästa">›</button>'
    + '<button class="btn sm ghost" data-act="today">Idag</button></div>'
    + '<div class="seg" role="group" aria-label="Vy">'
    + '<button data-act="view" data-v="month" aria-pressed="'+(S.view==="month")+'">Månad</button>'
    + '<button data-act="view" data-v="week" aria-pressed="'+(S.view==="week")+'">Vecka</button>'
    + '<button data-act="view" data-v="day" aria-pressed="'+(S.view==="day")+'">Dag</button>'
    + '</div>';
  if(isAdmin()){
    head+='<label class="fld" style="margin-left:auto;min-width:210px"><span class="eyebrow">Rapporterar för</span>'
      + '<select data-act="noop" id="sel-emp">'+S.employees.map(e=>'<option value="'+e.id+'"'+(e.id===emp.id?" selected":"")+'>'+esc(e.name)+(e.id===S.me.id?" (du)":"")+'</option>').join("")+'</select></label>';
  }
  head+='</div>' + remindBanner() + nudge(emp);
  const body = S.view==="month" ? calMonth(emp) : S.view==="week" ? calWeek(emp) : calDay(emp);
  return head + '<div class="layout"><div>'+body+'</div>'+ rail(emp) +'</div>';
}
/* Påminnelser i appen, utan stämpling: igår saknar tid, och från fredag lunch
   tills veckan är inskickad en påminnelse om att skicka in den innan helgen. */
function nudge(emp){
  return nudgeLastWeek(emp) + nudgeThisWeek(emp) + nudgeYesterday(emp);
}
function nudgeYesterday(emp){
  const now=new Date(), y=new Date(now); y.setDate(now.getDate()-1);
  /* på måndagen gäller det fredagen */
  while(!isWorkday(dkey(y))) y.setDate(y.getDate()-1);
  const ds=dkey(y);
  if(now-y > 4*86400000) return "";
  const st=approvalOf(emp.id,wkey(y)).status;
  if(st==="inskickad"||st==="godkand") return "";
  if(entriesFor(emp.id, ds).length) return "";
  const mine=S.me.id===emp.id;
  return '<div class="banner"><span class="eyebrow">Påminnelse</span>'
    + '<span>'+(mine?"Du har":esc(emp.name)+" har")+' ingen tid registrerad för '+DAYS[isoDow(y)]+' '+y.getDate()+' '+MONTHS[y.getMonth()]+'.</span>'
    + '<button class="btn sm" style="margin-left:auto" data-act="nudgeday" data-d="'+ds+'">Fyll i '+DAYS[isoDow(y)]+'</button></div>';
}
function nudgeThisWeek(emp){
  const now=new Date(), dow=isoDow(now);
  if(dow<4 || (dow===4 && now.getHours()<12)) return "";
  const wk=wkey(now), st=approvalOf(emp.id,wk).status;
  if(st==="inskickad"||st==="godkand") return "";
  const s=weekStats(emp.id,wk), mine=S.me.id===emp.id;
  const miss=s.missing.length;
  return '<div class="banner"><span class="eyebrow">Vecka '+wkNo(wk)+'</span>'
    + '<span>Dags att skicka in '+(mine?"din":esc(emp.name)+"s")+' tidrapport för veckan'
    + (miss?' – '+miss+' arbetsdag'+(miss>1?"ar":"")+' saknar tid':'')+'. Kontrollera timmarna och skicka in innan helgen.</span>'
    + '<button class="btn sm primary" style="margin-left:auto" data-act="submitwk" data-w="'+wk+'">Skicka in vecka '+wkNo(wk)+'</button></div>';
}
function nudgeLastWeek(emp){
  const prev=new Date(); prev.setDate(prev.getDate()-7);
  const wk=wkey(prev), st=approvalOf(emp.id,wk).status;
  if(st==="inskickad"||st==="godkand") return "";
  const s=weekStats(emp.id,wk);
  if(!s.regDays && !s.missing.length) return "";
  const mine=S.me.id===emp.id;
  return '<div class="banner"><span class="eyebrow">Vecka '+wkNo(wk)+'</span>'
    + '<span>'+(mine?"Din tidrapport":esc(emp.name)+"s tidrapport")+' för förra veckan är inte inskickad. Veckan stänger på måndagen.</span>'
    + '<button class="btn sm primary" style="margin-left:auto" data-act="submitwk" data-w="'+wk+'">'
    + (mine?"Skicka in vecka "+wkNo(wk):"Skicka in åt "+esc(String(emp.name).split(" ")[0]))+'</button></div>';
}
function periodLabel(){
  if(S.view==="month"){
    const ym=mkey(S.cursor);
    return cap(monthName(ym))
      +'<small>v '+isoWeek(new Date(S.cursor.getFullYear(),S.cursor.getMonth(),1))+'–'+isoWeek(new Date(S.cursor.getFullYear(),S.cursor.getMonth()+1,0))+'</small>';
  }
  if(S.view==="week"){ const wk=wkey(S.cursor); return 'Vecka '+wkNo(wk)+'<small>'+weekSpan(wk)+'</small>'; }
  return cap(DAYS[isoDow(S.cursor)])+'<small>'+S.cursor.getDate()+' '+MONTHS[S.cursor.getMonth()]+' '+S.cursor.getFullYear()+'</small>';
}
function entryChip(e, long){
  const t=typeOf(e.type);
  const lbl = t.proj && e.projectId
    ? (long ? (projById(e.projectId)?projById(e.projectId).name:"Projekt") : projLabel(e.projectId))
    : (long ? t.label : t.short);
  const title = t.label + (e.projectId?" · "+(projById(e.projectId)?projById(e.projectId).name:"okänt projekt"):"") + (e.note?" · "+e.note:"");
  return '<span class="chip '+t.cls+'" title="'+esc(title)+'"><span>'+esc(lbl)+'</span><span class="num">'+fmt(e.hours)+'</span></span>';
}
function cellHTML(emp, ds, outside){
  const entries=entriesFor(emp.id, ds);
  const st=dayStats(ds,entries);
  const hol=holidayName(ds), d=fromKey(ds);
  const today=dkey(new Date())===ds;
  const free=isoDow(d)>=5 || !!hol;
  const cls=["cell"]; if(outside)cls.push("out"); if(free)cls.push("free"); if(today)cls.push("today");
  let chips=entries.slice(0,3).map(e=>entryChip(e,false)).join("");
  if(entries.length>3) chips+='<span class="miss">+'+(entries.length-3)+' till</span>';
  let bottom="";
  if(st.has) bottom='<span>'+fmt(st.total)+'<span class="unit"> h</span></span>'+(st.ot?'<b>ÖT '+fmt(st.ot)+'</b>':'');
  else if(outside) bottom='';
  else if(isWorkday(ds) && ds<=dkey(new Date())) bottom='<span class="warn">Ej rapporterad</span>';
  return '<button class="'+cls.join(" ")+'" data-act="open" data-d="'+ds+'">'
    + '<span class="daynum"><span>'+d.getDate()+'</span>'+(today?'<span class="eyebrow">idag</span>':'')+'</span>'
    + (hol?'<span class="hol">'+esc(hol)+'</span>':'')
    + '<span class="chips">'+chips+'</span>'
    + '<span class="delta">'+bottom+'</span></button>';
}
function calMonth(emp){
  const ym=mkey(S.cursor), y=+ym.slice(0,4), mo=+ym.slice(5,7)-1;
  const first=new Date(y,mo,1), last=new Date(y,mo+1,0);
  let cur=new Date(first); cur.setDate(cur.getDate()-isoDow(cur));
  let html='<div class="panel"><div class="calhead"><div>v</div>'+DAYS_S.map(d=>'<div>'+d+'</div>').join("")+'</div><div class="calgrid">';
  while(true){
    const wk=wkey(cur), ap=approvalOf(emp.id,wk).status;
    html+='<div class="wk"><span>'+wkNo(wk)+'</span>'
      + (ap==="godkand"?'<span class="lock">✓</span>':ap==="inskickad"?'<span class="lock">→</span>':'')+'</div>';
    for(let i=0;i<7;i++){ html+=cellHTML(emp, dkey(cur), cur.getMonth()!==mo); cur.setDate(cur.getDate()+1); }
    if(cur>last) break;
  }
  return html+'</div></div>';
}
function dayRow(emp, ds){
  const d=fromKey(ds);
  const entries=entriesFor(emp.id, ds);
  const st=dayStats(ds,entries);
  const hol=holidayName(ds);
  const inline = entries.length
    ? entries.map(e=>entryChip(e,true)).join("")
    : '<span class="note">'+(isWorkday(ds)?(ds<=dkey(new Date())?"Ingen tid rapporterad":"—"):(hol?esc(hol):"Ledig"))+'</span>';
  return '<button class="dayrow'+(isWorkday(ds)?'':' free')+'" data-act="open" data-d="'+ds+'">'
    + '<span class="dl"><b>'+cap(DAYS[isoDow(d)])+' '+d.getDate()+'</b>'
    + '<small>'+MONTHS[d.getMonth()].slice(0,3)+(hol?' · '+esc(hol):'')+'</small></span>'
    + '<span class="inline">'+inline+'</span>'
    + '<span class="rt"><b>'+fmt(st.total)+'</b><small>'+(st.ot?'varav ÖT '+fmt(st.ot):'h')+'</small></span></button>';
}
function calWeek(emp){
  const wk=wkey(S.cursor), st=weekStats(emp.id,wk), ap=approvalOf(emp.id,wk);
  return '<div class="panel"><div class="hd"><div><h3>Vecka '+wkNo(wk)+'</h3>'
    + '<span class="note num">'+weekSpan(wk)+' · '+fmt(st.worked)+' h rapporterat</span></div>'
    + '<span class="pill '+STATUS[ap.status].cls+'">'+STATUS[ap.status].label+'</span></div>'
    + '<div class="daylist">'+weekDates(wk).map(ds=>dayRow(emp,ds)).join("")+'</div></div>';
}
const calDay = emp => '<div class="panel">'+dayEditor(emp, dkey(S.cursor))+'</div>';

function projectOptions(sel){
  return '<option value="">— inget projekt —</option>'
    + S.projects.filter(p=>p.status!=="avslutad")
        .map(p=>'<option value="'+p.id+'"'+(p.id===sel?" selected":"")+'>'+esc((p.kod?p.kod+" · ":"")+p.name)+'</option>').join("");
}
function dayEditor(emp, ds){
  const d=fromKey(ds), wk=wkey(d);
  const entries=entriesFor(emp.id, ds);
  const st=dayStats(ds,entries);
  const hol=holidayName(ds);
  const locked=isLocked(emp.id, ds);
  const ap=approvalOf(emp.id,wk);
  const rows = entries.length ? entries.map((e,i)=>{
    const t=typeOf(e.type);
    return '<tr><td>'+esc(t.label)+'</td>'
      + '<td>'+(t.proj&&e.projectId
          ? '<span class="code">'+esc(projLabel(e.projectId))+'</span> '+esc(projById(e.projectId)?projById(e.projectId).name:"")
          : '<span class="note">'+(t.proj?"Inget projekt":"—")+'</span>')+'</td>'
      + '<td class="note">'+esc(e.note||"")+'</td>'
      + '<td class="r">'+fmt(e.hours)+'</td>'
      + '<td class="r">'+(locked?"":'<button class="btn sm ghost" data-act="del" data-d="'+ds+'" data-i="'+i+'">Ta bort</button>')+'</td></tr>';
  }).join("") : '<tr><td colspan="5" class="empty">Inget registrerat den här dagen.</td></tr>';

  const noProj = S.projects.filter(p=>p.status!=="avslutad").length===0;
  const form = locked
    ? '<p class="note">Vecka '+wkNo(wk)+' är '+STATUS[ap.status].label.toLowerCase()+' och kan inte ändras. Be din arbetsledare öppna upp veckan.</p>'
    : '<div class="form">'
      + '<label class="fld" style="grid-column:1/-1"><span class="eyebrow">Projekt</span>'
      + '<select id="f-proj">'+projectOptions(S.lastProj)+'</select></label>'
      + '<label class="fld"><span class="eyebrow">Typ</span><select id="f-type">'
      + typeKeys().map(k=>'<option value="'+k+'">'+esc(typeOf(k).label)+'</option>').join("")+'</select></label>'
      + '<label class="fld"><span class="eyebrow">Timmar</span><input id="f-hours" type="text" inputmode="decimal" placeholder="0,00" autocomplete="off"></label>'
      + '<label class="fld" style="grid-column:1/-1"><span class="eyebrow">Notering (valfritt)</span>'
      + '<input id="f-note" type="text" autocomplete="off" placeholder="T.ex. montage räcke plan 3"></label>'
      + '<button class="btn primary" style="grid-column:1/-1" data-act="add" data-d="'+ds+'">Lägg till post</button>'
      + (noProj?'<p class="note" style="grid-column:1/-1">Inga projekt upplagda ännu. En superadmin skapar dem under fliken Projekt.</p>':'')
      + '</div>'
      + '<div class="quick"><span class="eyebrow">Snabbval</span>'
      + [["arbete",8,"8 h"],["arbete",4,"4 h"],["overtid",2,"2 h övertid"],["sjuk",8,"Sjuk hel dag"],["semester",8,"Semester"]]
          .map(q=>'<button class="btn sm" data-act="quick" data-d="'+ds+'" data-t="'+q[0]+'" data-h="'+q[1]+'">'+q[2]+'</button>').join("")
      + '</div>';

  return '<div class="hd"><div><h3>'+cap(DAYS[isoDow(d)])+' '+d.getDate()+' '+MONTHS[d.getMonth()]+'</h3>'
    + '<span class="note num">v '+wkNo(wk)+(hol?' · '+esc(hol):(isWorkday(ds)?'':' · helg'))+'</span></div>'
    + '<div style="text-align:right"><div class="num" style="font-size:22px">'+fmt(st.total)+' h</div>'
    + '<div class="note num">'+(st.ot?'varav '+fmt(st.ot)+' övertid':'&nbsp;')+'</div></div></div>'
    + '<div class="tblwrap" style="border:0"><table class="entrytable"><thead><tr><th>Typ</th><th>Projekt</th><th>Notering</th>'
    + '<th class="r">Timmar</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>'
    + '<div style="padding:14px;border-top:1px solid var(--line)">'+form+'</div>';
}

/* ============================ högerpanel ============================ */
function rail(emp){
  const isWeekish = S.view!=="month";
  const wk=wkey(S.cursor), ym=mkey(S.cursor);
  const st = isWeekish ? weekStats(emp.id,wk) : monthStats(emp.id,ym);
  const ap=approvalOf(emp.id,wk);
  const periodName = isWeekish ? "vecka "+wkNo(wk) : monthName(ym);

  const tKeys=Object.keys(st.byType);
  const totT=tKeys.reduce((a,k)=>a+st.byType[k],0)||1;
  const brkT=tKeys.length ? tKeys.sort((a,b)=>st.byType[b]-st.byType[a]).map(k=>
    '<div class="brkrow"><span>'+esc(typeOf(k).label)+'</span><span class="num">'+fmt(st.byType[k])+'</span>'
    + '<span class="meter'+(k==="overtid"?" alt":"")+'"><i style="width:'+Math.max(2,Math.round(st.byType[k]/totT*100))+'%"></i></span></div>').join("")
    : '<p class="note">Ingen tid registrerad.</p>';

  const pKeys=Object.keys(st.byProj).sort((a,b)=>st.byProj[b]-st.byProj[a]);
  const totP=pKeys.reduce((a,k)=>a+st.byProj[k],0)||1;
  const brkP=pKeys.length ? pKeys.map(k=>
    '<div class="brkrow"><span>'+esc(k==="_"?"Utan projekt":(projById(k)?projById(k).name:"Borttaget projekt"))+'</span>'
    + '<span class="num">'+fmt(st.byProj[k])+'</span>'
    + '<span class="meter"><i style="width:'+Math.max(2,Math.round(st.byProj[k]/totP*100))+'%"></i></span></div>').join("")
    : '<p class="note">Ingen tid fördelad på projekt.</p>';

  const weeks = isWeekish ? [wk] : weeksInMonth(ym);
  const wkRows=weeks.map(w=>{
    const ws=weekStats(emp.id,w), a=approvalOf(emp.id,w);
    const mine=S.me.id===emp.id;
    const started = weekDates(w)[0] <= dkey(new Date());
    let btn='<span class="pill '+STATUS[a.status].cls+'">'+STATUS[a.status].label+'</span>';
    if(!started && !ws.regDays && a.status==="utkast") btn='<span class="note">kommande</span>';
    else if(isAdmin()) btn = a.status==="godkand"
        ? '<button class="btn sm ghost" data-act="reopenwk" data-w="'+w+'">Öppna</button>'
        : '<button class="btn sm primary" data-act="approvewk" data-w="'+w+'">Attestera</button>';
    else if(mine && (a.status==="utkast"||a.status==="retur"))
      btn = '<button class="btn sm primary" data-act="submitwk" data-w="'+w+'">Skicka in</button>';
    return '<div class="wkrow'+(w===wk?' cur':'')+'"><span class="w">v'+wkNo(w)+'</span>'
      + '<span class="n"><b>'+fmt(ws.worked)+' h</b>'+ws.regDays+' dagar'
      + (ws.missing.length?' · '+ws.missing.length+' saknas':'')+'</span>'+btn+'</div>';
  }).join("");

  let acts='<div class="actions">';
  if(isAdmin()){
    acts += '<button class="btn" data-act="submitwk" data-w="'+wk+'">Skicka in v'+wkNo(wk)+' åt '+esc(String(emp.name).split(" ")[0])+'</button>'
         + (ap.status!=="godkand"?'<button class="btn" data-act="returnwk" data-w="'+wk+'">Returnera v'+wkNo(wk)+'</button>':'');
  }else if(ap.status==="utkast"||ap.status==="retur"){
    acts += '<button class="btn primary" data-act="submitwk" data-w="'+wk+'">Skicka in vecka '+wkNo(wk)+'</button>';
  }
  if(isAdmin()) acts += '<button class="btn" data-act="csv">Exportera '+(isWeekish?'veckan':'månaden')+' (Excel)</button>';
  acts += '</div>';

  return '<aside class="rail">'
    + '<div class="panel">'
    + '<div class="railhead"><h3>'+esc(emp.name)+'</h3><span class="pill '+STATUS[ap.status].cls+'">v'+wkNo(wk)+' · '+STATUS[ap.status].label+'</span></div>'
    + '<div class="hero"><span class="eyebrow">Rapporterat '+esc(periodName)+'</span>'
    + '<div class="v">'+fmt(st.worked)+'<s>h</s></div>'
    + '<div class="sub">'+st.regDays+(st.regDays===1?' rapporterad dag':' rapporterade dagar')
    + (st.missing.length?' · '+st.missing.length+(st.missing.length===1?' arbetsdag utan tid':' arbetsdagar utan tid'):'')+'</div></div>'
    + '<div class="big"><span class="k">Varav övertid</span><span class="v">'+fmt(st.ot)+'</span></div>'
    + '<div class="big"><span class="k">Fakturerbart</span><span class="v">'+fmt(st.bill)+'</span></div>'
    + '<div class="big"><span class="k">Frånvaro</span><span class="v">'+fmt(st.abs)+'</span></div>'
    + acts + '</div>'
    + '<div class="panel"><span class="eyebrow">Veckoattest</span><div style="margin-top:6px">'+wkRows+'</div>'
    + (ap.comment?'<p class="note" style="margin-top:10px"><b>Kommentar:</b> '+esc(ap.comment)+'</p>':'')
    + '</div>'
    + '<div class="panel"><span class="eyebrow">Timmar per projekt</span><div class="brk">'+brkP+'</div></div>'
    + '<div class="panel"><span class="eyebrow">Timmar per typ</span><div class="brk">'+brkT+'</div></div>'
    + '</aside>';
}

/* ============================ veckoattest ============================ */
function viewAttest(){
  const wk=wkey(S.cursor);
  const rows=S.employees.map(e=>{
    const st=weekStats(e.id,wk,S.everyMonth);
    const ap=S.allApprovals.find(a=>a.empId===e.id)||{status:"utkast"};
    return '<tr><td><b>'+esc(e.name)+'</b><div class="note">'+esc(roleLabel(e.role))+'</div></td>'
      + '<td class="r">'+fmt(st.worked)+'</td><td class="r">'+fmt(st.bill)+'</td>'
      + '<td class="r">'+fmt(st.ot)+'</td><td class="r">'+fmt(st.abs)+'</td>'
      + '<td class="r">'+st.regDays+'</td><td class="r">'+st.missing.length+'</td>'
      + '<td><span class="pill '+STATUS[ap.status].cls+'">'+STATUS[ap.status].label+'</span></td>'
      + '<td class="r" style="white-space:nowrap">'
      + '<button class="btn sm" data-act="gotoemp" data-e="'+e.id+'">Öppna</button> '
      + (ap.status==="utkast"||ap.status==="retur"?'<button class="btn sm" data-act="submitfor" data-e="'+e.id+'" data-w="'+wk+'">Skicka in åt</button> ':'')
      + (ap.status==="godkand"
          ? '<button class="btn sm ghost" data-act="reopenfor" data-e="'+e.id+'" data-w="'+wk+'">Öppna upp</button>'
          : '<button class="btn sm primary" data-act="approvefor" data-e="'+e.id+'" data-w="'+wk+'">Attestera</button>')
      + ' <button class="btn sm ghost" data-act="returnfor" data-e="'+e.id+'" data-w="'+wk+'">Returnera</button>'
      + '</td></tr>';
  }).join("");
  const done=S.allApprovals.filter(a=>a.status==="godkand").length;
  const pend=S.allApprovals.filter(a=>a.status==="inskickad").length;
  const missing=pendingFor(lastWeekKey()).length;
  return remindBanner() + '<div class="bar"><div class="navgroup">'
    + '<button class="btn sm" data-act="prev" aria-label="Föregående">‹</button>'
    + '<div class="per">Vecka '+wkNo(wk)+'<small>'+weekSpan(wk)+'</small></div>'
    + '<button class="btn sm" data-act="next" aria-label="Nästa">›</button>'
    + '<button class="btn sm ghost" data-act="today">Denna vecka</button></div>'
    + '<span class="note" style="margin-left:auto">'+done+' attesterade · '+pend+' inskickade · '+S.employees.length+' anställda</span>'
    + '<button class="btn" data-act="remind">Påminnelser'+(missing?" ("+missing+")":"")+'</button>'
    + '<button class="btn" data-act="approveall" data-w="'+wk+'">Attestera alla inskickade</button>'
    + '<button class="btn" data-act="csvweek">Exportera veckan (Excel)</button></div>'
    + '<div class="tblwrap"><table class="tbl"><thead><tr><th>Anställd</th><th class="r">Rapporterat</th>'
    + '<th class="r">Fakturerbart</th><th class="r">Övertid</th><th class="r">Frånvaro</th>'
    + '<th class="r">Dagar</th><th class="r">Saknas</th><th>Status</th><th></th></tr></thead>'
    + '<tbody>'+(rows||'<tr><td colspan="9" class="empty">Inga anställda upplagda.</td></tr>')+'</tbody></table></div>'
    + '<p class="note" style="margin-top:10px">Attesten sker per vecka. Attest låser veckan för den anställde – du som superadmin kan alltid öppna upp den igen, lägga in tid åt någon annan och skicka in åt dem.</p>';
}

/* ============================ projekt ============================ */
function datesBetween(a,b){
  const out=[]; if(!a||!b) return out;
  let s=fromKey(a), e=fromKey(b);
  if(s>e){ const t=s; s=e; e=t; }
  const cur=new Date(s);
  let guard=0;
  while(cur<=e && guard++<3660){ out.push(dkey(cur)); cur.setDate(cur.getDate()+1); }
  return out;
}
function periodDates(){
  if(S.projPeriod==="range") return (S.from&&S.to) ? datesBetween(S.from,S.to) : null;
  if(S.projPeriod==="week") return weekDates(wkey(S.cursor));
  if(S.projPeriod==="month") return monthDates(mkey(S.cursor));
  return null;
}
function periodLabelProj(){
  if(S.projPeriod==="range"&&S.from&&S.to) return S.from+" – "+S.to;
  if(S.projPeriod==="week") return "Vecka "+wkNo(wkey(S.cursor));
  if(S.projPeriod==="month") return cap(monthName(mkey(S.cursor)));
  return "Hela projektet";
}
function costsFor(pid, dates){
  return S.costs.filter(c=>c.projectId===pid && (!dates || dates.indexOf(c.date)>=0))
                .sort((a,b)=> a.date<b.date?1:a.date>b.date?-1:0);
}
function costTotals(rows){
  const byKind={}; let sum=0;
  rows.forEach(c=>{ const a=+c.amount||0; sum+=a; byKind[c.kind]=(byKind[c.kind]||0)+a; });
  return {sum:r2(sum), byKind:byKind};
}
/* ---- kalkyl mot utfall ----
   Varje projekt kan ha en kalkyl: offererat pris och, om man vill, uppdelning
   på timmar, arbete, material och körning (hämtas ur en offert eller skrivs in).
   Utfallet räknas på all tid och alla kostnader i projektet, samma som
   "Att fakturera totalt". */
const QUOTE_PARTS = [["labour","Arbete"],["material","Material"],["travel","Körning"],["other","Övrigt"]];
function projQuote(p){
  const q=(p&&p.quote)||{};
  const parts={labour:+q.labour||0, material:+q.material||0, travel:+q.travel||0, other:+q.other||0};
  const partSum=r2(parts.labour+parts.material+parts.travel+parts.other);
  return {total:+q.total||partSum, hours:+q.hours||0, parts:parts, partSum:partSum, offerId:q.offerId||"", offerNr:q.offerNr||""};
}
function projActual(p){
  const all=projectTotals(p.id,null), rate=+p.rate||0;
  const c=costTotals(costsFor(p.id,null)).byKind;
  let material=0, travel=0, other=0;
  Object.keys(c).forEach(function(k){
    if(k==="material") material+=c[k]; else if(k==="mil") travel+=c[k]; else other+=c[k];
  });
  const labour=r2(all.bill*rate);
  return {hours:r2(all.hours), billHours:r2(all.bill), parts:{labour:labour, material:r2(material), travel:r2(travel), other:r2(other)},
    total:r2(labour+material+travel+other)};
}
/* Grön upp till 90 %, gul upp till 100 %, röd över. */
const budgetClass = pct => pct>100 ? "over" : pct>90 ? "near" : "ok";
function budgetBar(actual, total, compact){
  if(!(total>0)) return compact?'<span class="note">Ingen kalkyl</span>':'';
  const pct=actual/total*100, cls=budgetClass(pct);
  return '<div class="budget '+cls+(compact?' compact':'')+'" role="img" aria-label="'+esc(Math.round(pct)+" procent av offererat pris")+'">'
    + '<div class="track"><i style="width:'+Math.min(100,Math.max(0,pct)).toFixed(1)+'%"></i></div>'
    + '<div class="lbl"><b>'+kr(actual)+'</b> / '+kr(total)+' <span>'+Math.round(pct)+' %</span></div></div>';
}
/* Tabell med kalkyl, utfall och skillnad per del. */
function quoteCompareTable(p){
  const q=projQuote(p), a=projActual(p);
  const cell=(act, plan, fmtf)=>{
    if(!(plan>0)) return '<td class="r">'+fmtf(act)+'</td><td class="r note">—</td><td class="r note">—</td>';
    const pct=act/plan*100;
    return '<td class="r">'+fmtf(act)+'</td><td class="r">'+fmtf(plan)+'</td>'
      + '<td class="r"><span class="dev '+budgetClass(pct)+'">'+Math.round(pct)+' %</span></td>';
  };
  const krf=v=>kr(v), hf=v=>fmt(v)+' h';
  return '<div class="tblwrap" style="border:0"><table class="tbl"><thead><tr><th>Del</th><th class="r">Utfall</th><th class="r">Kalkyl</th><th class="r">Av kalkyl</th></tr></thead><tbody>'
    + '<tr><td>Arbetstimmar</td>'+cell(a.hours, q.hours, hf)+'</tr>'
    + QUOTE_PARTS.map(x=>'<tr><td>'+x[1]+'</td>'+cell(a.parts[x[0]], q.parts[x[0]], krf)+'</tr>').join("")
    + '<tr class="sumrow"><th>Totalt exkl. moms</th>'+cell(a.total, q.total, krf).replace(/<td/g,'<th').replace(/<\/td>/g,'</th>')+'</tr>'
    + '</tbody></table></div>';
}
function projectTotals(pid, dates, onlyEmp){
  let hours=0, bill=0, ot=0;
  const byEmp={}, byMonth={}, rows=[];
  S.everyMonth.forEach(docm=>{
    if(onlyEmp && docm.empId!==onlyEmp) return;
    const days=docm.days||{};
    Object.keys(days).forEach(ds=>{
      if(dates && dates.indexOf(ds)<0) return;
      days[ds].forEach(e=>{
        if((e.projectId||"")!==pid) return;
        const h=+e.hours||0, t=typeOf(e.type);
        hours+=h;
        if(t.bill) bill+=h;
        if(e.type==="overtid") ot+=h;
        byEmp[docm.empId]=(byEmp[docm.empId]||0)+h;
        byMonth[mkey(fromKey(ds))]=(byMonth[mkey(fromKey(ds))]||0)+h;
        rows.push({ds:ds, empId:docm.empId, type:e.type, hours:h, note:e.note||""});
      });
    });
  });
  rows.sort((a,b)=> a.ds<b.ds?1:a.ds>b.ds?-1:0);
  return {hours:r2(hours), bill:r2(bill), ot:r2(ot), byEmp:byEmp, byMonth:byMonth, rows:rows};
}
function periodControl(){
  let html='<div class="seg" role="group" aria-label="Period">'
    + '<button data-act="pp" data-v="week" aria-pressed="'+(S.projPeriod==="week")+'">Vecka</button>'
    + '<button data-act="pp" data-v="month" aria-pressed="'+(S.projPeriod==="month")+'">Månad</button>'
    + '<button data-act="pp" data-v="range" aria-pressed="'+(S.projPeriod==="range")+'">Datum</button>'
    + '<button data-act="pp" data-v="all" aria-pressed="'+(S.projPeriod==="all")+'">Allt</button></div>';
  if(S.projPeriod==="range"){
    html+='<div class="range">'
      + '<label class="fld"><span class="eyebrow">Från</span><input id="r-from" type="date" value="'+esc(S.from)+'"></label>'
      + '<label class="fld"><span class="eyebrow">Till</span><input id="r-to" type="date" value="'+esc(S.to)+'"></label>'
      + '<div class="presets">'
      + '<button class="btn sm" data-act="preset" data-v="thisweek">Denna vecka</button>'
      + '<button class="btn sm" data-act="preset" data-v="lastweek">Förra veckan</button>'
      + '<button class="btn sm" data-act="preset" data-v="thismonth">Denna månad</button>'
      + '<button class="btn sm" data-act="preset" data-v="lastmonth">Förra månaden</button>'
      + '</div></div>';
  }
  return html;
}
/* ============================ statistik ============================ */
/* Kalkyl mot utfall för alla projekt på en gång. */
function viewStatistik(){
  const scope=S.statScope||"oppna";
  const list=S.projects.filter(p=>scope==="alla" || (scope==="avslutade" ? pStatus(p)==="avslutad" : pStatus(p)!=="avslutad"));
  let sumQ=0, sumA=0, over=0, near=0, withQ=0;
  const rows=list.map(function(p){
    const q=projQuote(p), a=projActual(p);
    if(q.total>0){ withQ++; sumQ+=q.total; sumA+=a.total; const pc=a.total/q.total*100; if(pc>100) over++; else if(pc>90) near++; }
    const dev=(act,plan,f)=>plan>0
      ? '<td class="r">'+f(act)+'<div class="note">av '+f(plan)+' · <span class="dev '+budgetClass(act/plan*100)+'">'+Math.round(act/plan*100)+' %</span></div></td>'
      : '<td class="r">'+f(act)+'<div class="note">ingen kalkyl</div></td>';
    return '<tr class="p-'+pStatus(p)+'"><td><span class="code">'+esc(p.kod||"—")+'</span></td>'
      + '<td><b>'+esc(p.name)+'</b><div class="note">'+esc(p.kund||"")+'</div></td>'
      + '<td>'+pStatusPill(p)+'</td>'
      + '<td style="min-width:180px">'+budgetBar(a.total, q.total, true)+'</td>'
      + dev(a.hours, q.hours, v=>fmt(v)+" h")
      + dev(a.parts.labour, q.parts.labour, kr)
      + dev(a.parts.material, q.parts.material, kr)
      + dev(a.parts.travel, q.parts.travel, kr)
      + dev(a.parts.other, q.parts.other, kr)
      + '<td class="r"><button class="btn sm" data-act="openarkproj" data-p="'+esc(p.id)+'">Öppna</button></td></tr>';
  }).join("");
  sumQ=r2(sumQ); sumA=r2(sumA);
  return '<div class="bar"><span class="note">Kalkyl mot utfall på alla projekt. Utfallet räknas på all registrerad tid (fakturerbara timmar × timpris) och alla bokförda kostnader. '
    + 'Körning är bokförd milersättning.</span>'
    + '<label class="fld" style="margin-left:auto"><select id="st-scope">'
    + [["oppna","Aktiva och vilande"],["avslutade","Avslutade"],["alla","Alla projekt"]].map(x=>'<option value="'+x[0]+'"'+(scope===x[0]?" selected":"")+'>'+x[1]+'</option>').join("")
    + '</select></label></div>'
    + '<div class="kpis" style="margin-bottom:14px">'
    + '<div class="kpi"><span class="eyebrow">Offererat (projekt med kalkyl)</span><div class="v">'+kr(sumQ)+'</div></div>'
    + '<div class="kpi"><span class="eyebrow">Uppnått på dem</span><div class="v">'+kr(sumA)+'</div></div>'
    + '<div class="kpi"><span class="eyebrow">Över 90 %</span><div class="v"><span class="dev near">'+near+'</span></div></div>'
    + '<div class="kpi"><span class="eyebrow">Över kalkyl</span><div class="v"><span class="dev over">'+over+'</span></div></div>'
    + '</div>'
    + '<div class="tblwrap"><table class="tbl"><thead><tr><th>Kod</th><th>Projekt</th><th>Status</th><th>Uppnått / offererat</th>'
    + '<th class="r">Timmar</th><th class="r">Arbete</th><th class="r">Material</th><th class="r">Körning</th><th class="r">Övrigt</th><th></th></tr></thead>'
    + '<tbody>'+(rows||'<tr><td colspan="10" class="empty">Inga projekt i urvalet.</td></tr>')+'</tbody></table></div>'
    + (withQ<list.length?'<p class="note" style="margin-top:10px">'+(list.length-withQ)+' projekt saknar kalkyl. Lägg in offererat pris under Projekt → Ändra projekt.</p>':'');
}
/* ============================ löneunderlag ============================ */
/* En månad i taget: arbetad tid, övertid och frånvaro per medarbetare, och
   samma timmar fördelade på projekt. Ingen stämpling – allt räknas på det
   som är registrerat i tidrapporten. */
const lonYm = () => S.lonMonth || mkey(new Date());
async function loadLon(){
  if(!isAdmin()) return;
  const ym=lonYm();
  await loadMonthsFor([ym]);
  const appr=[];
  for(const wk of weeksInMonth(ym)){
    try{ (await Store.list("approvals","week",wk)).forEach(a=>appr.push(a)); }catch(e){ console.error(e); }
  }
  S.lonAppr=appr;
}
const absKeys = () => typeKeys().filter(k=>typeOf(k).abs);
/* Arbetad tid är allt som inte är frånvaro, utom övertiden som redovisas för sig. */
function lonRow(empId, ym){
  const st=monthStats(empId, ym, S.everyMonth);
  const abs={}; let absSum=0, ot=0, work=0;
  Object.keys(st.byType).forEach(function(k){
    const h=st.byType[k];
    if(typeOf(k).abs){ abs[k]=r2((abs[k]||0)+h); absSum+=h; }
    else if(k==="overtid") ot+=h;
    else work+=h;
  });
  const weeks=weeksInMonth(ym);
  const okW=weeks.filter(wk=>(S.lonAppr||[]).some(a=>a.empId===empId && a.week===wk && a.status==="godkand")).length;
  return {work:r2(work), ot:r2(ot), abs:abs, absSum:r2(absSum), total:r2(work+ot+absSum),
          missing:st.missing, weeks:weeks.length, okWeeks:okW};
}
/* Timmar per medarbetare och projekt, med övertiden för sig. */
function lonProjRows(ym){
  const out=[];
  S.employees.forEach(function(e){
    const by={};
    monthDates(ym).forEach(function(ds){
      entriesFor(e.id, ds, S.everyMonth).forEach(function(x){
        if(typeOf(x.type).abs) return;
        const k=x.projectId||"_";
        const r=by[k]||(by[k]={work:0, ot:0});
        if(x.type==="overtid") r.ot+=+x.hours||0; else r.work+=+x.hours||0;
      });
    });
    Object.keys(by).forEach(function(k){
      const p=k==="_"?null:projById(k);
      out.push({empId:e.id, empName:e.name, projectId:k==="_"?"":k,
        kod:p?(p.kod||""):"", proj:p?p.name:(k==="_"?"Utan projekt":"Okänt projekt"),
        work:r2(by[k].work), ot:r2(by[k].ot), total:r2(by[k].work+by[k].ot)});
    });
  });
  return out.sort((a,b)=>String(a.empName).localeCompare(String(b.empName),"sv") || b.total-a.total);
}
function viewLon(){
  const ym=lonYm(), ak=absKeys();
  const rows=S.employees.map(e=>Object.assign({emp:e}, lonRow(e.id, ym)));
  const tot={work:0, ot:0, absSum:0, total:0, abs:{}};
  rows.forEach(function(r){
    tot.work+=r.work; tot.ot+=r.ot; tot.absSum+=r.absSum; tot.total+=r.total;
    ak.forEach(k=>{ tot.abs[k]=(tot.abs[k]||0)+(r.abs[k]||0); });
  });
  const h=v=>v?fmt(v):'<span class="note">–</span>';
  const body=rows.map(r=>'<tr><td><b>'+esc(r.emp.name)+'</b></td>'
    + '<td class="r">'+h(r.work)+'</td><td class="r">'+h(r.ot)+'</td>'
    + ak.map(k=>'<td class="r">'+h(r.abs[k])+'</td>').join("")
    + '<td class="r"><b>'+fmt(r.total)+'</b></td>'
    + '<td class="r">'+(r.missing.length?'<span class="dev near" title="'+esc(r.missing.join(", "))+'">'+r.missing.length+'</span>':'<span class="note">0</span>')+'</td>'
    + '<td class="r">'+(r.okWeeks===r.weeks?'<span class="pill ok">'+r.okWeeks+'/'+r.weeks+'</span>':'<span class="note">'+r.okWeeks+'/'+r.weeks+'</span>')+'</td></tr>').join("");
  const pr=lonProjRows(ym);
  const pbody=pr.map(r=>'<tr><td>'+esc(r.empName)+'</td><td><span class="code">'+esc(r.kod||"—")+'</span> '+esc(r.proj)+'</td>'
    + '<td class="r">'+h(r.work)+'</td><td class="r">'+h(r.ot)+'</td><td class="r"><b>'+fmt(r.total)+'</b></td></tr>').join("");
  const allOk=rows.every(r=>r.okWeeks===r.weeks || !r.total);
  return '<div class="bar"><div class="navgroup"><button class="btn sm" data-act="lonprev">‹</button>'
    + '<div class="per">'+cap(monthName(ym))+'<small>'+weeksInMonth(ym).map(wkNo).map(n=>"v"+n).join(" · ")+'</small></div>'
    + '<button class="btn sm" data-act="lonnext">›</button></div>'
    + '<button class="btn sm" data-act="lonnow">Denna månad</button>'
    + '<div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-act="xlslon">Exportera till Excel</button></div></div>'
    + (allOk?'':'<div class="banner"><span class="eyebrow">Obs</span><span>Alla veckor i månaden är inte attesterade än. Siffrorna kan ändras tills de är det.</span></div>')
    + '<div class="kpis" style="margin-bottom:14px">'
    + '<div class="kpi"><span class="eyebrow">Arbetad tid</span><div class="v">'+fmt(r2(tot.work))+'<s>h</s></div></div>'
    + '<div class="kpi"><span class="eyebrow">Övertid</span><div class="v">'+fmt(r2(tot.ot))+'<s>h</s></div></div>'
    + '<div class="kpi"><span class="eyebrow">Frånvaro</span><div class="v">'+fmt(r2(tot.absSum))+'<s>h</s></div></div>'
    + '<div class="kpi"><span class="eyebrow">Totalt registrerat</span><div class="v">'+fmt(r2(tot.total))+'<s>h</s></div></div>'
    + '</div>'
    + '<div class="panel" style="margin-bottom:14px"><div class="hd"><h3>Per medarbetare</h3><span class="note">Arbetad tid är allt utom övertid och frånvaro</span></div>'
    + '<div class="tblwrap" style="border:0"><table class="tbl"><thead><tr><th>Namn</th><th class="r">Arbetad tid</th><th class="r">Övertid</th>'
    + ak.map(k=>'<th class="r">'+esc(typeOf(k).label)+'</th>').join("")
    + '<th class="r">Totalt</th><th class="r">Saknade dagar</th><th class="r">Attesterade veckor</th></tr></thead><tbody>'
    + (body||'<tr><td colspan="'+(6+ak.length)+'" class="empty">Ingen personal.</td></tr>')
    + '</tbody><tfoot><tr><td><b>Summa</b></td><td class="r"><b>'+fmt(r2(tot.work))+'</b></td><td class="r"><b>'+fmt(r2(tot.ot))+'</b></td>'
    + ak.map(k=>'<td class="r"><b>'+fmt(r2(tot.abs[k]||0))+'</b></td>').join("")
    + '<td class="r"><b>'+fmt(r2(tot.total))+'</b></td><td></td><td></td></tr></tfoot></table></div></div>'
    + '<div class="panel"><div class="hd"><h3>Arbetade timmar per projekt</h3><span class="note">'+esc(cap(monthName(ym)))+'</span></div>'
    + '<div class="tblwrap" style="border:0"><table class="tbl"><thead><tr><th>Medarbetare</th><th>Projekt</th><th class="r">Arbetad tid</th><th class="r">Övertid</th><th class="r">Totalt</th></tr></thead><tbody>'
    + (pbody||'<tr><td colspan="5" class="empty">Ingen arbetad tid den här månaden.</td></tr>')
    + '</tbody></table></div></div>';
}
function lonWorkbook(ym){
  const wb=XLSX.utils.book_new(), ak=absKeys();
  const head=["Medarbetare","Arbetad tid (h)","Övertid (h)"].concat(ak.map(k=>typeOf(k).label+" (h)"))
    .concat(["Frånvaro totalt (h)","Totalt (h)","Saknade dagar","Attesterade veckor"]);
  const rows=[head];
  S.employees.forEach(function(e){
    const r=lonRow(e.id, ym);
    rows.push([e.name, r.work, r.ot].concat(ak.map(k=>r.abs[k]||0)).concat([r.absSum, r.total, r.missing.length, r.okWeeks+"/"+r.weeks]));
  });
  const fm={}; for(let c=1;c<=ak.length+4;c++) fm[c]=H2;
  XLSX.utils.book_append_sheet(wb, sheetFrom(rows,[24,14,12].concat(ak.map(()=>14)).concat([16,12,14,18]),fm), "Löneunderlag");
  const pr=[["Medarbetare","Projektkod","Projekt","Arbetad tid (h)","Övertid (h)","Totalt (h)"]]
    .concat(lonProjRows(ym).map(r=>[r.empName, r.kod, r.proj, r.work, r.ot, r.total]));
  XLSX.utils.book_append_sheet(wb, sheetFrom(pr,[24,12,30,14,12,12],{3:H2,4:H2,5:H2}), "Per projekt");
  const dr=[["Medarbetare","Datum","Vecka","Veckodag","Typ","Projektkod","Projekt","Timmar","Notering"]];
  S.employees.forEach(function(e){
    monthDates(ym).forEach(function(ds){
      entriesFor(e.id, ds, S.everyMonth).forEach(function(x){
        const p=x.projectId?projById(x.projectId):null, d=fromKey(ds);
        dr.push([e.name, ds, isoWeek(d), DAYS[isoDow(d)], typeOf(x.type).label, p?(p.kod||""):"", p?p.name:"", +x.hours||0, x.note||""]);
      });
    });
  });
  XLSX.utils.book_append_sheet(wb, sheetFrom(dr,[24,12,7,10,16,12,30,9,34],{7:H2}), "Alla poster");
  return wb;
}

/* ============================ projektfoton ============================ */
/* Montörerna fotar på plats. Varje foto sparas som en liten bild för listan
   (projphotos) och en större för att titta på (projphotodata), så att listan
   går fort att hämta även när ett projekt har många foton. */
async function loadProjPhotos(pid){
  try{
    const rows=await Store.list("projphotos","projectId",pid);
    S.projPhotos=rows.sort((a,b)=>String(b.at).localeCompare(String(a.at)));
  }catch(e){ console.error(e); S.projPhotos=[]; }
  S.projPhotosFor=pid;
}
function shrinkImage(file, max, q){
  return new Promise(function(res, rej){
    const url=URL.createObjectURL(file), img=new Image();
    img.onload=function(){
      const k=Math.min(1, max/Math.max(img.naturalWidth, img.naturalHeight));
      const cv=document.createElement("canvas");
      cv.width=Math.round(img.naturalWidth*k); cv.height=Math.round(img.naturalHeight*k);
      cv.getContext("2d").drawImage(img,0,0,cv.width,cv.height);
      URL.revokeObjectURL(url);
      res(cv.toDataURL("image/jpeg", q));
    };
    img.onerror=function(){ URL.revokeObjectURL(url); rej(new Error("Bilden gick inte att läsa.")); };
    img.src=url;
  });
}
function photoPanel(pid){
  if(S.projPhotosFor!==pid){
    S.projPhotosFor=pid; S.projPhotos=null;
    loadProjPhotos(pid).then(()=>{ if(S.projSel===pid) render(); });
  }
  const list=S.projPhotos;
  const grid = list===null ? '<p class="note">Hämtar foton…</p>'
    : list.length ? '<div class="photogrid">'+list.map(f=>'<button class="photo" data-act="photoview" data-f="'+esc(f.id)+'" title="'+esc((f.note||"")+" · "+(f.byName||"")+" · "+String(f.at).slice(0,10))+'">'
        + '<img src="'+esc(f.thumb)+'" alt="'+esc(f.note||"Foto")+'" loading="lazy">'
        + '<span class="cap">'+esc(String(f.at).slice(0,10))+(f.note?' · '+esc(f.note):'')+'</span></button>').join("")+'</div>'
    : '<p class="note">Inga foton än. Fota före, under och efter jobbet – infästningar, mått, skador och det färdiga resultatet.</p>';
  return '<div class="panel" style="margin-top:14px"><div class="hd"><h3>Foton</h3>'
    + '<label class="btn sm primary" style="cursor:pointer">Lägg till foto'
    + '<input type="file" id="photo-in" data-p="'+esc(pid)+'" accept="image/*" capture="environment" multiple hidden></label></div>'
    + '<div style="padding:12px 16px 16px">'+grid+'</div></div>';
}
/* Valda foton visas först i ett eget fönster: man ser vad som laddas upp,
   kan skriva en kort text och kan ångra sig innan något sparas. */
let pendingPhotos=null;
function dropPendingPhotos(){
  if(!pendingPhotos) return;
  pendingPhotos.urls.forEach(function(u){ try{ URL.revokeObjectURL(u); }catch(e){} });
  pendingPhotos=null;
}
function photoNoteModal(pid, files){
  dropPendingPhotos();
  pendingPhotos={pid:pid, files:files, urls:files.map(function(f){ return URL.createObjectURL(f); })};
  const n=files.length, one=n===1;
  openModal('<div class="mh"><div><span class="eyebrow">'+n+(one?' foto':' foton')+'</span>'
    + '<h3 style="margin-top:2px">Text till '+(one?'fotot':'fotona')+'</h3></div><button class="btn sm ghost" data-act="photocancel">Avbryt</button></div>'
    + '<div class="mb"><div class="photogrid">'+pendingPhotos.urls.slice(0,8).map(u=>'<div class="photo"><img src="'+esc(u)+'" alt=""></div>').join("")+'</div>'
    + (n>8?'<p class="note">… och '+(n-8)+' till.</p>':'')
    + '<label class="fld" style="margin-top:12px"><span class="eyebrow">Kort text (valfritt)</span>'
    + '<input type="text" id="ph-note" maxlength="200" placeholder="T.ex. Infästning vägg" enterkeyhint="done"></label></div>'
    + '<div class="mf"><button class="btn" data-act="photocancel">Avbryt</button>'
    + '<button class="btn primary" data-act="photoup">Spara '+(one?'fotot':n+' foton')+'</button></div>',
    function(){ const i=document.getElementById("ph-note"); if(i) i.focus(); });
}
async function uploadPhotos(pid, files, note){
  note=String(note||"").trim().slice(0,200);
  let ok=0;
  for(const file of files){
    try{
      let full=await shrinkImage(file, 1600, 0.72);
      if(full.length>850000) full=await shrinkImage(file, 1200, 0.6);
      if(full.length>850000) full=await shrinkImage(file, 900, 0.55);
      const thumb=await shrinkImage(file, 320, 0.6);
      const id=String(Date.now())+"-"+uid();
      const meta={id:id, projectId:pid, thumb:thumb, note:note, byId:S.me.id, byName:S.me.name, at:new Date().toISOString()};
      await Store.set("projphotodata/"+id, {id:id, projectId:pid, byId:S.me.id, data:full});
      await Store.set("projphotos/"+id, meta);
      (S.projPhotos||(S.projPhotos=[])).unshift(meta);
      ok++;
    }catch(e){ console.error(e); toast("Ett foto kunde inte sparas: "+(e.message||e)); }
  }
  if(ok) toast(ok===1?"Fotot är sparat i projektet.":ok+" foton är sparade i projektet.");
  render();
}
async function viewPhoto(id){
  const f=(S.projPhotos||[]).find(x=>x.id===id); if(!f) return;
  const canDel=isAdmin() || f.byId===S.me.id;
  openModal('<div class="mh"><div><span class="eyebrow">'+esc(String(f.at).slice(0,16).replace("T"," "))+' · '+esc(f.byName||"")+'</span>'
    + '<h3 style="margin-top:2px">'+esc(f.note||"Foto")+'</h3></div><button class="btn sm ghost" data-act="close">Stäng</button></div>'
    + '<div class="mb"><img id="pv-img" src="'+esc(f.thumb)+'" alt="" style="width:100%;height:auto;display:block;background:var(--sunken)">'
    + '<div class="actions">'+(canDel?'<button class="btn ghost" data-act="photodel" data-f="'+esc(f.id)+'">Ta bort fotot</button>':'')
    + '<a class="btn" id="pv-dl" download="foto-'+esc(String(f.at).slice(0,10))+'.jpg" href="'+esc(f.thumb)+'">Spara bilden</a></div></div>');
  try{
    const d=await Store.get("projphotodata/"+id);
    const img=document.getElementById("pv-img"), a=document.getElementById("pv-dl");
    if(d && d.data){ if(img) img.src=d.data; if(a) a.href=d.data; }
  }catch(e){ console.error(e); }
}

function viewProjekt(){
  if(S.projSel) return projectDetail(S.projSel);
  const dates=periodDates(), admin=isAdmin();
  /* Superadmin och support ser pengar: timmar gånger timpris plus kostnader.
     Arbetare ser bara timmar, aldrig vad projektet är värt. */
  let sumPeriod=0, sumAll=0;
  /* Avslutade projekt ligger i Arkiv, inte i listan. */
  const open=S.projects.filter(p=>pStatus(p)!=="avslutad");
  const archived=S.projects.length-open.length;
  const q=String(S.projQ||"").trim();
  const list=q?open.filter(p=>projMatches(p,q)):open;
  const rows=list.map(p=>{
    const tp=projectTotals(p.id,dates), all=projectTotals(p.id,null);
    const rate=+p.rate||0;
    const cP=costTotals(costsFor(p.id,dates)).sum, cA=costTotals(costsFor(p.id,null)).sum;
    const amtP=r2(tp.bill*rate+cP), amtA=r2(all.bill*rate+cA);
    sumPeriod+=amtP; sumAll+=amtA;
    const cols = admin
      ? '<td class="r">'+kr(amtP)+'</td><td class="r"><b>'+kr(amtA)+'</b>'+(projQuote(p).total>0?budgetBar(amtA, projQuote(p).total, true):'')+'</td>'
      : '<td class="r">'+fmt(tp.hours)+'</td><td class="r">'+fmt(all.hours)+'</td>';
    return '<tr class="p-'+pStatus(p)+'"><td><span class="code">'+esc(p.kod||"—")+'</span></td>'
      + '<td><b>'+esc(p.name)+'</b>'+(p.adress?'<div class="note">'+esc(p.adress)+'</div>':'')+'</td>'
      + '<td>'+esc(p.kund||"—")+'</td>'
      + '<td>'+pStatusPill(p)+'</td>'
      + (admin?'<td>'+invSelect(p)+'</td>':'')
      + cols
      + (admin?'<td class="r">'+fmt(tp.hours)+'</td>':'')
      + '<td class="r" style="white-space:nowrap"><button class="btn sm" data-act="openproj" data-p="'+p.id+'">Öppna</button>'
      + (admin?' <button class="btn sm ghost" data-act="editproj" data-p="'+p.id+'">Ändra</button>':'')+'</td></tr>';
  }).join("");
  sumPeriod=r2(sumPeriod); sumAll=r2(sumAll);
  const totalAll=list.reduce((a,p)=>a+projectTotals(p.id,dates).hours,0);
  const search = open.length>1
    ? '<div class="projsearch"><input type="search" id="proj-q" value="'+esc(S.projQ||"")+'" placeholder="Sök på projekt, kund, kod eller adress"'
      + ' autocomplete="off" spellcheck="false" enterkeyhint="search" aria-label="Sök projekt">'
      + (q?'<span class="note">'+list.length+' av '+open.length+' projekt</span><button class="btn sm ghost" data-act="projqclear">Rensa</button>':'')
      + '</div>'
    : '';
  const emptyMsg = q
    ? 'Inga projekt matchar ”'+esc(q)+'”. <button class="btn sm" data-act="projqclear">Rensa sökningen</button>'
    : (archived?'Inga aktiva eller vilande projekt.':'Inga projekt upplagda ännu.')+(admin?' Skapa ett nytt med knappen ovan.':'');
  return '<div class="bar">'
    + (S.projPeriod==="range"?''
       :'<div class="navgroup"><button class="btn sm" data-act="prev">‹</button>'
        + '<div class="per">'+periodLabelProj()
        + '<small>'+(S.projPeriod==="all"?'alla registrerade timmar':fmt(totalAll)+' h i period')+'</small></div>'
        + '<button class="btn sm" data-act="next">›</button></div>')
    + periodControl()
    + (admin?'<button class="btn primary" style="margin-left:auto" data-act="newproj">Nytt projekt</button>'
            :'<span class="note" style="margin-left:auto">Endast superadmin kan skapa projekt</span>')
    + '</div>'
    + search
    + '<div class="tblwrap"><table class="tbl"><thead><tr><th>Kod</th><th>Projekt</th><th>Kund</th><th>Status</th>'
    + (admin?'<th>Faktura</th><th class="r">Att fakturera i period</th><th class="r">Att fakturera totalt</th><th class="r">Timmar i period</th>'
            :'<th class="r">Mina timmar i period</th><th class="r">Mina timmar totalt</th>')
    + '<th></th></tr>'
    + (admin&&list.length?'<tr class="sumrow"><th colspan="5">'+(q?'Summa sökträffar':'Summa alla projekt')+'</th>'
        + '<th class="r">'+kr(sumPeriod)+'</th><th class="r">'+kr(sumAll)+'</th><th></th><th></th></tr>':'')
    + '</thead>'
    + '<tbody>'+(rows||'<tr><td colspan="'+(admin?9:7)+'" class="empty">'+emptyMsg+'</td></tr>')+'</tbody></table>'
    + '</div>'
    + (admin&&archived?'<p class="note" style="margin-top:10px">'+archived+' avslutade projekt ligger i arkivet med all tid och alla kostnader kvar. '
      + '<button class="btn sm" data-act="tab" data-v="arkiv">Öppna arkivet</button></p>':'');
}
/* Sökningen i projektlistan: varje ord ska finnas någonstans i kod, namn,
   kund eller adress. Stora och små bokstäver spelar ingen roll. */
function projMatches(p, q){
  const hay=[p.kod, p.name, p.kund, p.adress].map(x=>String(x||"").toLowerCase()).join(" ");
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w=>hay.indexOf(w)>=0);
}
let projQTimer=null;
function projectDetail(pid){
  const p=projById(pid);
  if(!p){ S.projSel=null; return viewProjekt(); }
  const admin=isAdmin(), dates=periodDates();
  const t=projectTotals(pid,dates), all=projectTotals(pid,null);
  const src=admin?t:projectTotals(pid,dates,S.me.id);

  const empRows=admin ? (Object.keys(t.byEmp).sort((a,b)=>t.byEmp[b]-t.byEmp[a]).map(id=>{
    const e=S.employees.find(x=>x.id===id);
    return '<tr><td>'+esc(e?e.name:"Okänd")+'</td><td class="r">'+fmt(t.byEmp[id])+'</td>'
      + '<td class="r">'+(p.rate?kr(t.byEmp[id]*p.rate):"—")+'</td></tr>';
  }).join("") || '<tr><td colspan="3" class="empty">Ingen tid i vald period.</td></tr>') : "";

  const entRows=src.rows.slice(0,40).map(r=>{
    const e=S.employees.find(x=>x.id===r.empId);
    return '<tr><td class="num">'+r.ds+'</td><td class="num">v'+isoWeek(fromKey(r.ds))+'</td>'
      + (admin?'<td>'+esc(e?e.name:"Okänd")+'</td>':'')
      + '<td>'+esc(typeOf(r.type).label)+'</td>'
      + '<td class="note">'+esc(r.note)+'</td><td class="r">'+fmt(r.hours)+'</td></tr>';
  }).join("") || '<tr><td colspan="'+(admin?6:5)+'" class="empty">Inga poster i vald period.</td></tr>';

  const monthRows=Object.keys(all.byMonth).sort().reverse().slice(0,12).map(m=>
    '<tr><td>'+monthName(m)+'</td><td class="r">'+fmt(all.byMonth[m])+'</td></tr>').join("")
    || '<tr><td colspan="2" class="empty">—</td></tr>';

  const cRows=costsFor(pid,dates), cTot=costTotals(cRows);
  const labour = p.rate ? r2(src.bill*p.rate) : 0;
  const net = r2(labour + cTot.sum);
  const vat = r2(net*(S.vat/100));

  return '<div class="bar"><button class="btn sm ghost" data-act="backproj">‹ Alla projekt</button>'
    + periodControl()
    + (admin?'<div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">'
            +'<button class="btn primary" data-act="xlsproj" data-p="'+pid+'">Excel för perioden</button>'
            +(window.showSaveFilePicker?'<button class="btn" data-act="xlsprojsame" data-p="'+pid+'">Uppdatera samma fil</button>':'')
            +'<button class="btn" data-act="newcost" data-p="'+pid+'">Lägg till kostnad</button>'
            +'<button class="btn" data-act="importlocal" data-p="'+pid+'">Läs in kostnader från Excel</button>'
            +'<button class="btn" data-act="editproj" data-p="'+pid+'">Ändra projekt</button></div>':'')
    + '</div>'
    + '<div class="panel" style="padding:16px;margin-bottom:14px">'
    + '<span class="code">'+esc(p.kod||"—")+'</span>'
    + '<h2 style="font-size:24px;margin:8px 0 4px">'+esc(p.name)+'</h2>'
    + '<p class="note">'+esc(p.kund||"Ingen kund angiven")+(p.adress?' · '+esc(p.adress):'')
    + (admin&&p.rate?' · '+kr(p.rate)+'/h':'')+'</p>'
    + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">'+pStatusPill(p)
    + (admin?invSelect(p):'')
    + (pStatus(p)==="avslutad"?'<span class="note">Avslutat'+(p.archivedAt?' '+esc(String(p.archivedAt).slice(0,10)):'')+' · ligger i arkivet</span>':'')+'</div>'
    + (p.notes?'<p style="margin-top:8px">'+esc(p.notes)+'</p>':'')
    + (admin?(projQuote(p).total>0
        ? '<div style="margin-top:14px"><span class="eyebrow">Uppnått av offererat pris'+(projQuote(p).offerNr?' · offert '+esc(projQuote(p).offerNr):'')+'</span>'
          + budgetBar(projActual(p).total, projQuote(p).total, false)+'</div>'
        : '<p class="note" style="margin-top:10px">Inget offererat pris inlagt. Tryck på <b>Ändra projekt</b> för att lägga in kalkylen.</p>'):'')
    + '</div>'
    + (admin&&projQuote(p).total>0?'<div class="panel" style="margin-bottom:14px"><div class="hd"><h3>Kalkyl mot utfall</h3>'
      + '<span class="note">Hela projektet, oavsett vald period</span></div>'+quoteCompareTable(p)+'</div>':'')
    + '<div class="kpis" style="margin-bottom:14px">'
    + '<div class="kpi"><span class="eyebrow">'+(admin?'Timmar i period':'Mina timmar i period')+'</span><div class="v">'+fmt(src.hours)+'<s>h</s></div></div>'
    + '<div class="kpi"><span class="eyebrow">Fakturerbart i period</span><div class="v">'+fmt(src.bill)+'<s>h</s></div></div>'
    + '<div class="kpi"><span class="eyebrow">Varav övertid</span><div class="v">'+fmt(src.ot)+'<s>h</s></div></div>'
    + '<div class="kpi"><span class="eyebrow">Timmar totalt i projektet</span><div class="v">'+fmt(all.hours)+'<s>h</s></div></div>'
    + (admin?'<div class="kpi"><span class="eyebrow">Kostnader i period</span><div class="v">'+kr(cTot.sum)+'</div></div>'
            +'<div class="kpi"><span class="eyebrow">Att fakturera i period</span><div class="v">'+kr(net)+'<s>exkl moms</s></div></div>':'')
    + '</div>'
    + (admin?'<div class="grid2" style="margin-bottom:14px">'
      + '<div class="panel"><div class="hd"><h3>Kostnader</h3>'
      + '<button class="btn sm" data-act="newcost" data-p="'+pid+'">Lägg till</button></div>'
      + '<div class="tblwrap" style="border:0"><table class="tbl"><thead><tr><th>Datum</th><th>Typ</th><th>Beskrivning</th>'
      + '<th class="r">Antal</th><th class="r">À-pris</th><th class="r">Belopp</th><th></th></tr></thead><tbody>'
      + (cRows.length?cRows.map(c=>'<tr><td class="num">'+esc(c.date)+'</td><td>'+esc(costOf(c.kind).label)+'</td>'
          + '<td>'+esc(c.desc||"")+(c.supplier?'<div class="note">'+esc(c.supplier)+'</div>':'')+'</td>'
          + '<td class="r">'+fmt(c.qty)+' '+esc(c.unit||"")+'</td><td class="r">'+fmt(c.unitPrice)+'</td>'
          + '<td class="r">'+fmt(c.amount)+'</td>'
          + '<td class="r"><button class="btn sm ghost" data-act="editcost" data-c="'+esc(c.id)+'">Ändra</button></td></tr>').join("")
          :'<tr><td colspan="7" class="empty">Inga kostnader i vald period.</td></tr>')
      + '</tbody></table></div></div>'
      + '<div class="panel" style="padding:16px"><h3>Jobbet i period</h3>'
      + '<div class="sum" style="margin-top:12px">'
      + '<span class="k">Fakturerbara timmar</span><span class="v">'+fmt(src.bill)+' h</span>'
      + '<span class="k">Timpris</span><span class="v">'+(p.rate?fmt(p.rate)+' kr':"—")+'</span>'
      + '<span class="k">Arbete</span><span class="v">'+kr(labour)+'</span>'
      + costKeys().filter(k=>cTot.byKind[k]).map(k=>'<span class="k">'+esc(costOf(k).label)+'</span><span class="v">'+kr(cTot.byKind[k])+'</span>').join("")
      + '<span class="k tot">Summa exkl moms</span><span class="v tot">'+kr(net)+'</span>'
      + '<span class="k">Moms '+S.vat+' %</span><span class="v">'+kr(vat)+'</span>'
      + '<span class="k tot">Att fakturera</span><span class="v tot">'+kr(net+vat)+'</span>'
      + '</div>'
      + (p.rate?'':'<p class="note" style="margin-top:10px">Sätt ett timpris på projektet för att få fram arbetskostnaden.</p>')
      + '<div class="actions"><button class="btn" data-act="xlsproj" data-p="'+pid+'">Exportera fakturaunderlag</button></div>'
      + '</div></div>':'')
    + '<div class="grid2">'
    + (admin?'<div class="panel"><div class="hd"><h3>Per medarbetare</h3><span class="note">vald period</span></div>'
      + '<table class="tbl"><thead><tr><th>Namn</th><th class="r">Timmar</th><th class="r">Belopp</th></tr></thead><tbody>'+empRows+'</tbody></table></div>':'')
    + '<div class="panel"><div class="hd"><h3>Per månad</h3><span class="note">hela projektet</span></div>'
    + '<table class="tbl"><thead><tr><th>Månad</th><th class="r">Timmar</th></tr></thead><tbody>'+monthRows+'</tbody></table></div>'
    + '</div>'
    + '<div class="panel" style="margin-top:14px"><div class="hd"><h3>'+(admin?'Tidposter':'Mina tidposter')+'</h3><span class="note">senaste 40 i vald period</span></div>'
    + '<div class="tblwrap" style="border:0"><table class="tbl"><thead><tr><th>Datum</th><th>V</th>'
    + (admin?'<th>Medarbetare</th>':'')+'<th>Typ</th><th>Notering</th><th class="r">Timmar</th></tr></thead>'
    + '<tbody>'+entRows+'</tbody></table></div></div>'
    + photoPanel(pid);
}

/* ============================ personal & konton ============================ */
function viewPersonal(){
  const rows=S.employees.map(e=>{
    const st=weekStats(e.id, wkey(S.cursor), S.everyMonth);
    const owner = S.ownerUid && e.id===S.ownerUid;
    const shownRole = owner ? "admin" : e.role;
    return '<tr><td><b>'+esc(e.name)+'</b>'
      + (owner?'<div class="note">satte upp firman – alltid superadmin</div>':'')+'</td>'
      + '<td><span class="code">'+esc(e.username||"—")+'</span></td>'
      + '<td><span class="pill'+(shownRole==="arbetare"?"":" solid")+'">'+esc(roleLabel(shownRole))+'</span>'
      + (owner&&e.role!=="admin"&&e.role!=="support"?'<div class="note">rollen i databasen står som '+esc(roleLabel(e.role))+'</div>':'')+'</td>'
      + '<td>'+(looksReal(e.authEmail)
          ? '<span class="note">'+esc(e.authEmail)+'</span>'
          : '<span class="note">kontonamn, inget återställningsmejl</span>')+'</td>'
      + '<td class="r">'+fmt(st.worked)+'</td>'
      + '<td class="r" style="white-space:nowrap"><button class="btn sm" data-act="editemp" data-e="'+e.id+'">Redigera</button></td></tr>';
  }).join("");
  /* Om ingen alls står som superadmin i databasen har en rollskrivning gått fel.
     Den som satte upp firman kommer ändå in och kan rätta till det här. */
  const noAdmin = S.employees.length && !S.employees.some(e=>e.role==="admin"||e.role==="support");
  return '<div class="grid2" style="margin-top:6px">'
    + (noAdmin?'<div class="panel" style="grid-column:1/-1;padding:16px;border-color:var(--warn,#b45309)">'
      + '<h3>Ingen profil står som superadmin</h3>'
      + '<p class="note" style="margin-top:6px">Alla konton i listan nedan har rollen arbetare i databasen. Du kommer ändå in eftersom '
      + 'du satte upp firman. Öppna <b>Redigera</b> på de personer som ska vara superadmin eller support och spara om rollen. '
      + 'Går det inte att spara är säkerhetsreglerna i Firestore inte publicerade ännu.</p></div>':'')
    + '<div class="panel" style="grid-column:1/-1">'
    + '<div class="hd"><div><h3>Personal &amp; konton</h3><span class="note">Kontonamn och lösenord skapas här</span></div>'
    + '<button class="btn primary" data-act="newemp">Skapa profil</button></div>'
    + '<div class="tblwrap" style="border:0"><table class="tbl"><thead><tr><th>Namn</th><th>Kontonamn</th><th>Roll</th><th>Inloggning</th>'
    + '<th class="r">Timmar v'+wkNo(wkey(S.cursor))+'</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div></div>'
    + '<div class="panel" style="padding:16px"><h3>Konton och behörighet</h3>'
    + '<div class="stack" style="margin-top:10px">'
    + '<p class="note">Varje profil loggar in med kontonamn och lösenord. Lösenordet hanteras av Google Firebase och kan inte läsas av någon – inte heller av dig.</p>'
    + '<p class="note"><b>Arbetare</b> ser bara sin egen tidrapport och projektlistan. <b>Superadmin</b> skapar projekt och profiler, rapporterar åt andra, skickar in och attesterar.</p>'
    + '<p class="note">Glömt lösenord: har profilen en riktig e-postadress skickar du en återställningslänk direkt från <b>Redigera</b>. Saknas e-postadress måste du skapa en ny profil åt personen (t.ex. <code>lina2</code>) och stänga av den gamla. Var och en kan byta sitt eget lösenord under Konto uppe till höger.</p>'
    + '<p class="note">Man loggas ut när appen stängs, om man inte kryssat i <i>Håll mig inloggad</i>.</p>'
    + '</div></div>'
    + '<div class="panel" style="padding:16px"><h3>Så fungerar tiden</h3>'
    + '<div class="stack" style="margin-top:10px">'
    + '<p class="note">Varje post läggs på ett projekt med antal timmar – samma dag kan delas fritt, 2 timmar här och 5 där.</p>'
    + '<p class="note">Arbetstid och övertid är fakturerbara. Övertid väljs i typmenyn, till exempel för arbete efter 16:00, och särredovisas i alla summeringar.</p>'
    + '<p class="note">Attesten sker per vecka. Arbetaren skickar in veckan, den låses, och superadmin attesterar, returnerar med kommentar eller öppnar upp den igen.</p>'
    + '</div></div></div>';
}

/* ============================ listor (admin & support) ============================ */
function listKey(label, taken){
  let base=String(label||"post").toLowerCase()
    .replace(/å|ä/g,"a").replace(/ö/g,"o").replace(/é/g,"e")
    .replace(/[^a-z0-9]+/g,"").slice(0,18) || "post";
  let k=base, n=2;
  while(taken.indexOf(k)>=0){ k=base+n; n++; }
  return k;
}
function viewListor(){
  const types=typeKeys().map(k=>Object.assign({key:k}, typeOf(k)));
  const costs=costKeys().map(k=>Object.assign({key:k}, costOf(k)));
  const tRows=types.map(function(t,i){
    return '<tr><td><input data-lst="t" data-f="label" data-i="'+i+'" type="text" value="'+esc(t.label)+'"></td>'
      + '<td style="width:90px"><input data-lst="t" data-f="short" data-i="'+i+'" type="text" value="'+esc(t.short)+'" maxlength="4"></td>'
      + '<td style="width:74px" class="r"><input data-lst="t" data-f="proj" data-i="'+i+'" type="checkbox"'+(t.proj?" checked":"")+'></td>'
      + '<td style="width:74px" class="r"><input data-lst="t" data-f="bill" data-i="'+i+'" type="checkbox"'+(t.bill?" checked":"")+'></td>'
      + '<td style="width:74px" class="r"><input data-lst="t" data-f="abs" data-i="'+i+'" type="checkbox"'+(t.abs?" checked":"")+'></td>'
      + '<td class="r"><button class="btn sm ghost" data-act="lstdel" data-lst="t" data-i="'+i+'">Ta bort</button></td></tr>';
  }).join("");
  const cRows=costs.map(function(c,i){
    return '<tr><td><input data-lst="c" data-f="label" data-i="'+i+'" type="text" value="'+esc(c.label)+'"></td>'
      + '<td style="width:100px"><input data-lst="c" data-f="unit" data-i="'+i+'" type="text" value="'+esc(c.unit)+'" maxlength="8"></td>'
      + '<td style="width:120px"><input data-lst="c" data-f="price" data-i="'+i+'" type="text" inputmode="decimal" value="'+esc(fmt(c.price))+'"></td>'
      + '<td style="width:90px" class="r"><input data-lst="c" data-f="bill" data-i="'+i+'" type="checkbox"'+(c.bill?" checked":"")+'></td>'
      + '<td class="r"><button class="btn sm ghost" data-act="lstdel" data-lst="c" data-i="'+i+'">Ta bort</button></td></tr>';
  }).join("");
  return '<div class="bar"><span class="note">Ändra namnen, lägg till egna rader eller ta bort sådant ni inte använder. '
    + 'Redan registrerad tid och kostnader ligger kvar även om du tar bort en rad.</span>'
    + '<button class="btn primary" style="margin-left:auto" data-act="lstsave">Spara listorna</button>'
    + '<button class="btn" data-act="lstreset">Återställ standard</button></div>'
    + '<div class="panel" style="margin-bottom:14px"><div class="hd"><div><h3>Tidtyper</h3>'
    + '<span class="note">Menyn när man rapporterar en dag</span></div>'
    + '<button class="btn sm" data-act="lstadd" data-lst="t">Lägg till rad</button></div>'
    + '<div class="tblwrap" style="border:0"><table class="tbl"><thead><tr><th>Namn</th><th>Kort</th>'
    + '<th class="r">Projekt</th><th class="r">Fakturerbart</th><th class="r">Frånvaro</th><th></th></tr></thead>'
    + '<tbody>'+tRows+'</tbody></table></div>'
    + '<p class="note" style="padding:10px 14px"><b>Projekt</b> = posten måste läggas på ett projekt. '
    + '<b>Fakturerbart</b> = timmarna räknas med i fakturaunderlaget. <b>Frånvaro</b> = räknas som frånvaro i summeringarna.</p></div>'
    + '<div class="panel"><div class="hd"><div><h3>Kostnadsslag</h3>'
    + '<span class="note">Menyn när man lägger till en kostnad på ett projekt</span></div>'
    + '<button class="btn sm" data-act="lstadd" data-lst="c">Lägg till rad</button></div>'
    + '<div class="tblwrap" style="border:0"><table class="tbl"><thead><tr><th>Namn</th><th>Enhet</th>'
    + '<th>Förslag à-pris</th><th class="r">Fakturerbart</th><th></th></tr></thead>'
    + '<tbody>'+cRows+'</tbody></table></div>'
    + '<p class="note" style="padding:10px 14px">Enheten är bara en etikett – st, mil, timme, meter, kg. '
    + 'À-priset fylls i automatiskt när man väljer slaget, men går alltid att ändra på posten.</p></div>';
}
function readLists(){
  const types=[], costs=[];
  const cur={t:typeKeys().map(k=>Object.assign({key:k}, typeOf(k))),
             c:costKeys().map(k=>Object.assign({key:k}, costOf(k)))};
  const takenT=[], takenC=[];
  document.querySelectorAll('[data-lst="t"][data-f="label"]').forEach(function(el){
    const i=+el.dataset.i, old=cur.t[i]||{};
    const label=String(el.value||"").trim();
    if(!label) return;
    const g=f=>document.querySelector('[data-lst="t"][data-f="'+f+'"][data-i="'+i+'"]');
    const key=old.key||listKey(label,takenT);
    takenT.push(key);
    types.push({key:key, label:label,
      short:String((g("short")||{}).value||label.slice(0,3)).toUpperCase().slice(0,4),
      proj:!!(g("proj")||{}).checked, bill:!!(g("bill")||{}).checked, abs:!!(g("abs")||{}).checked,
      cls:(g("bill")||{}).checked ? (old.cls==="ot"?"ot":"work") : "abs"});
  });
  document.querySelectorAll('[data-lst="c"][data-f="label"]').forEach(function(el){
    const i=+el.dataset.i, old=cur.c[i]||{};
    const label=String(el.value||"").trim();
    if(!label) return;
    const g=f=>document.querySelector('[data-lst="c"][data-f="'+f+'"][data-i="'+i+'"]');
    const key=old.key||listKey(label,takenC);
    takenC.push(key);
    const pr=parseHours((g("price")||{}).value);
    costs.push({key:key, label:label, unit:String((g("unit")||{}).value||"st").trim(),
      price:isNaN(pr)?0:r2(pr), bill:!!(g("bill")||{}).checked});
  });
  return {types:types, costs:costs};
}

/* ============================ inkorg (support) ============================ */
function viewInkorg(){
  const f=S.inboxFilter;
  const rows=S.inbox.filter(function(x){
    return f==="alla" || (f==="klara" ? x.done : !x.done);
  });
  const list=rows.map(function(x){
    const när=String(x.at||"").slice(0,16).replace("T"," ");
    const mail=/@/.test(String(x.contact||""));
    return '<tr><td class="num">'+esc(när)+'</td>'
      + '<td><b>'+esc(x.name||"—")+'</b>'+(x.account?'<div class="note">'+esc(x.account)+'</div>':'')+'</td>'
      + '<td>'+esc(x.contact||"—")+'</td>'
      + '<td style="max-width:420px">'+esc(x.message||"")+'</td>'
      + '<td class="note">'+esc(x.page||"")+'</td>'
      + '<td class="r" style="white-space:nowrap">'
      + (mail?'<a class="btn sm" href="mailto:'+esc(x.contact)+'?subject='+encodeURIComponent("Svar på din supportförfrågan")+'">Svara</a> ':'')
      + '<button class="btn sm ghost" data-act="inbdone" data-i="'+esc(x.id||x._id)+'">'+(x.done?"Öppna igen":"Klar")+'</button> '
      + '<button class="btn sm ghost" data-act="inbdel" data-i="'+esc(x.id||x._id)+'">Ta bort</button></td></tr>';
  }).join("");
  const open=S.inbox.filter(x=>!x.done).length;
  return '<div class="bar">'
    + '<div class="seg" role="group" aria-label="Filter">'
    + '<button data-act="inbf" data-v="oppna" aria-pressed="'+(f==="oppna")+'">Öppna ('+open+')</button>'
    + '<button data-act="inbf" data-v="klara" aria-pressed="'+(f==="klara")+'">Klara</button>'
    + '<button data-act="inbf" data-v="alla" aria-pressed="'+(f==="alla")+'">Alla</button></div>'
    + '<span class="note" style="margin-left:auto">'+S.inbox.length+' förfrågningar totalt</span>'
    + '<button class="btn" data-act="inbreload">Uppdatera</button></div>'
    + '<div class="tblwrap"><table class="tbl"><thead><tr><th>Inkom</th><th>Från</th><th>Kontakt</th>'
    + '<th>Ärende</th><th>Sida</th><th></th></tr></thead>'
    + '<tbody>'+(list||'<tr><td colspan="6" class="empty">Inga förfrågningar här.</td></tr>')+'</tbody></table></div>'
    + '<p class="note" style="margin-top:10px">Varje supportförfrågan från appen hamnar här direkt, oavsett om mejlutskicket är inkopplat. '
    + (SUPPORT_KEY?'Mejlkopia skickas också.':'Mejlkopia är inte inkopplad – fyll i SUPPORT_KEY i firebase-config.js om du vill ha det.')+'</p>';
}

/* ============================ utseende & texter (support) ============================ */
function viewUtseende(){
  const inks=[["","Standard (svart)"],["#1B4965","Mörkblå"],["#2F5D3A","Mörkgrön"],["#6B2737","Vinröd"],["#3A3A3A","Grafit"]];
  const cur=cfg("theme.ink","");
  return '<div class="grid2" style="margin-top:6px">'
    + '<div class="panel" style="padding:16px"><h3>Namn och texter</h3><div class="stack" style="margin-top:12px">'
    + '<label class="fld"><span class="eyebrow">Appens namn</span><input id="b-name" type="text" value="'+esc(cfg("appName"))+'"></label>'
    + '<label class="fld"><span class="eyebrow">Företagsnamn (visas i exporter)</span><input id="b-comp" type="text" value="'+esc(cfg("company"))+'"></label>'
    + '<label class="fld"><span class="eyebrow">Hjälptext på inloggningen</span><input id="b-login" type="text" value="'+esc(cfg("loginHelp"))+'"></label>'
    + '<label class="fld"><span class="eyebrow">Text på supportlänken</span><input id="b-sup" type="text" value="'+esc(cfg("supportLabel"))+'"></label>'
    + '<label class="fld"><span class="eyebrow">Moms i fakturaunderlag (%)</span><input id="b-vat" type="text" inputmode="decimal" value="'+esc(String(cfg("vat",25)))+'"></label>'
    + '</div></div>'
    + '<div class="panel" style="padding:16px"><h3>Namn på flikarna</h3><div class="stack" style="margin-top:12px">'
    + [["tid","Tidrapport (superadmin)"],["mitt","Tidrapport (arbetare)"],["projekt","Projekt"],
       ["statistik","Statistik"],["kalkyl","Kalkyl"],["attest","Veckoattest"],["lon","Löneunderlag"],["arkiv","Arkiv"],["personal","Personal"],["inkorg","Inkorg"],["utseende","Utseende"]]
       .map(function(t){ return '<label class="fld"><span class="eyebrow">'+t[1]+'</span>'
         + '<input id="b-tab-'+t[0]+'" type="text" value="'+esc(cfg("tabs."+t[0]))+'"></label>'; }).join("")
    + '</div></div>'
    + '<div class="panel" style="padding:16px"><h3>Roller</h3><div class="stack" style="margin-top:12px">'
    + ["arbetare","admin","support"].map(function(r){
        return '<label class="fld"><span class="eyebrow">'+ROLES[r].label+' kallas</span>'
          + '<input id="b-role-'+r+'" type="text" value="'+esc(roleLabel(r))+'"></label>'; }).join("")
    + '<p class="note">Namnen är bara etiketter. Behörigheterna sitter kvar som de är.</p>'
    + '</div></div>'
    + '<div class="panel" style="padding:16px"><h3>Färger</h3><div class="stack" style="margin-top:12px">'
    + '<label class="fld"><span class="eyebrow">Färgläge</span><select id="b-mode">'
    + [["auto","Följ telefonen/datorn"],["light","Alltid ljust"],["dark","Alltid mörkt"]]
        .map(function(m){ return '<option value="'+m[0]+'"'+(cfg("theme.mode")===m[0]?" selected":"")+'>'+m[1]+'</option>'; }).join("")
    + '</select></label>'
    + '<label class="fld"><span class="eyebrow">Profilfärg</span><select id="b-ink">'
    + inks.map(function(i){ return '<option value="'+i[0]+'"'+(cur===i[0]?" selected":"")+'>'+i[1]+'</option>'; }).join("")
    + '<option value="custom"'+(cur&&!inks.some(i=>i[0]===cur)?" selected":"")+'>Egen färgkod</option>'
    + '</select></label>'
    + '<label class="fld"><span class="eyebrow">Egen färgkod (t.ex. #1B4965)</span>'
    + '<input id="b-inkhex" type="text" value="'+esc(cur)+'" placeholder="#121417"></label>'
    + '<p class="note">Profilfärgen används på knappar, rubriker och markeringar. Lämna tomt för svart.</p>'
    + '<button class="btn" data-act="brandpreview">Förhandsgranska</button>'
    + '</div></div>'
    + '<div class="panel" style="padding:16px;grid-column:1/-1"><div class="stack">'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
    + '<button class="btn primary" data-act="brandsave">Spara för alla</button>'
    + '<button class="btn" data-act="brandreset">Återställ till standard</button></div>'
    + '<p class="note">Ändringarna gäller alla i firman så fort de laddar om appen. Bara supportrollen kommer åt den här sidan.</p>'
    + '</div></div></div>';
}

/* ============================ dialoger ============================ */
let modalSeq=0;
function openModal(html, onMount){
  modalSeq++;
  modalRoot.innerHTML='<div class="ovl" data-act="ovl"><div class="modal" role="dialog" aria-modal="true">'+html+'</div></div>';
  if(onMount) onMount();
  return modalSeq;
}
const closeModal = () => { stopScan(); S.scan=null; modalRoot.innerHTML=""; };
const inModal = () => !!modalRoot.innerHTML;

function dayModal(emp, ds){
  openModal('<div class="mh"><div><span class="eyebrow">Registrera tid</span><h3 style="margin-top:2px">'+esc(emp.name)+'</h3></div>'
    + '<button class="btn sm ghost" data-act="close">Stäng</button></div>'
    + '<div class="mb" style="padding:0">'+dayEditor(emp, ds)+'</div>', function(){
      const h=document.getElementById("f-hours"); if(h) h.focus();
      syncProjField();
    });
}
function empModal(empId, err){
  const e = empId ? S.employees.find(x=>x.id===empId) : {name:"",username:"",role:"arbetare"};
  /* Kontonamnet är själva inloggningen. Har personen en riktig e-postadress
     slås kontonamnet bara upp i tabellen usernames och går därför att byta.
     Saknas e-postadress är kontonamnet inbakat i inloggningsadressen och
     kan inte ändras i efterhand. */
  const canRename = !!(empId && looksReal(e.authEmail));
  openModal('<div class="mh"><h3>'+(empId?"Redigera profil":"Skapa profil")+'</h3><button class="btn sm ghost" data-act="close">Stäng</button></div>'
    + '<div class="mb"><div class="stack">'
    + '<label class="fld"><span class="eyebrow">Namn</span><input id="e-name" type="text" value="'+esc(e.name)+'" placeholder="Lina Ek"></label>'
    + '<div class="form even">'
    + '<label class="fld"><span class="eyebrow">E-post (för påminnelser)</span>'
    + '<input id="e-mail" type="text" autocapitalize="none" spellcheck="false" value="'+esc(e.email||"")+'" placeholder="lina@firman.se"></label>'
    + '<label class="fld"><span class="eyebrow">Mobil (för sms)</span>'
    + '<input id="e-phone" type="text" value="'+esc(e.phone||"")+'" placeholder="070-123 45 67"></label></div>'
    + '<div class="form even">'
    + '<label class="fld"><span class="eyebrow">Kontonamn</span><input id="e-user" type="text" autocapitalize="none" autocomplete="off" spellcheck="false" value="'+esc(e.username||"")+'"'+(empId&&!canRename?" disabled":"")+' placeholder="lina"></label>'
    + '<label class="fld"><span class="eyebrow">Roll</span><select id="e-role">'
    + '<option value="arbetare"'+(e.role==="arbetare"?" selected":"")+'>'+esc(roleLabel("arbetare"))+'</option>'
    + '<option value="admin"'+(e.role==="admin"?" selected":"")+'>'+esc(roleLabel("admin"))+'</option>'
    + '<option value="support"'+(e.role==="support"?" selected":"")+'>'+esc(roleLabel("support"))+' – kan även ändra utseende och texter</option>'
    + '</select></label></div>'
    + (empId?(looksReal(e.authEmail)
        ? '<div class="panel" style="padding:12px">'
          +'<span class="eyebrow">Inloggning</span>'
          +'<p class="note" style="margin:4px 0 10px">Inloggningsadress: <b>'+esc(e.authEmail)+'</b>. '
          +'Lösenord kan återställas via mejl, och kontonamnet går att byta här ovanför.</p>'
          +'<button class="btn block" data-act="sendreset" data-e="'+empId+'">Skicka återställningslänk</button>'
          +'<p class="note" style="margin-top:8px">Personen får ett mejl från Google och väljer ett nytt lösenord själv. Du ser aldrig lösenordet.</p>'
          +'</div>'
        : '<div class="panel" style="padding:12px">'
          +'<span class="eyebrow">Inloggning</span>'
          +'<p class="note" style="margin:4px 0 10px">Kontot loggar in med kontonamn utan e-postadress. Därför går det inte att '
          +'skicka någon återställningslänk, och kontonamnet kan inte bytas.</p>'
          +'<p class="note" style="margin:0 0 10px"><b>Du kan inte lägga in adressen åt personen.</b> Inloggningsadressen ligger hos '
          +'Google, och bara den som är inloggad får byta sin egen. Skriver vi in den bara i databasen slutar kontot fungera.</p>'
          +'<p class="note" style="margin:0">Två vägar som fungerar: personen loggar in och lägger till sin adress själv under '
          +'<b>Konto</b> uppe till höger – eller så skapar du en ny profil med e-postadressen ifylld från början och stänger av den gamla.</p>'
          +'</div>')
            :'<label class="fld"><span class="eyebrow">Lösenord (minst 6 tecken)</span><input id="e-pw" type="password" autocomplete="new-password"></label>'
             +'<p class="note">Fyll i e-postadressen ovan om personen ska kunna återställa sitt lösenord själv. '
             +'Då blir e-postadressen inloggningsadress och kontonamnet går att byta senare.</p>')
    + (err?'<div class="err">'+esc(err)+'</div>':'')
    + '</div></div>'
    + '<div class="mf">'+(empId&&empId!==S.me.id?'<button class="btn ghost" data-act="delemp" data-e="'+empId+'">Stäng av profil</button>':'')
    + '<button class="btn" data-act="close">Avbryt</button>'
    + '<button class="btn primary" data-act="saveemp" data-e="'+(empId||"")+'">Spara</button></div>', function(){
      const n=document.getElementById("e-name"); if(n) n.focus();
    });
}
function projModal(pid){
  const p = pid ? projById(pid) : {name:"",kod:"",kund:"",adress:"",status:"aktiv",rate:"",notes:"",invoice:"ej"};
  const q=(p.quote)||{}, qv=k=>esc(+q[k]?numOut(q[k]):"");
  const offers=(S.offers||[]).filter(o=>o.sums&&o.sums.net);
  openModal('<div class="mh"><h3>'+(pid?"Redigera projekt":"Nytt projekt")+'</h3><button class="btn sm ghost" data-act="close">Stäng</button></div>'
    + '<div class="mb"><div class="stack">'
    + '<label class="fld"><span class="eyebrow">Projektnamn</span><input id="p-name" type="text" value="'+esc(p.name)+'" placeholder="Räcken Kv. Smedjan"></label>'
    + '<div class="form even"><label class="fld"><span class="eyebrow">Projektkod / nummer</span><input id="p-kod" type="text" value="'+esc(p.kod||"")+'" placeholder="P-104"></label>'
    + '<label class="fld"><span class="eyebrow">Timpris (kr)</span><input id="p-rate" type="text" inputmode="numeric" value="'+esc(p.rate||"")+'" placeholder="850"></label></div>'
    + '<label class="fld"><span class="eyebrow">Kund</span><input id="p-kund" type="text" value="'+esc(p.kund||"")+'" placeholder="Byggbolaget AB"></label>'
    + '<label class="fld"><span class="eyebrow">Arbetsplats / adress</span><input id="p-adress" type="text" value="'+esc(p.adress||"")+'"></label>'
    + '<label class="fld"><span class="eyebrow">Status</span><select id="p-status">'
    + Object.keys(PSTATUS).map(k=>'<option value="'+k+'"'+((p.status||"aktiv")===k?" selected":"")+'>'+PSTATUS[k]+'</option>').join("")+'</select></label>'
    + '<label class="fld"><span class="eyebrow">Faktura</span><select id="p-invoice">'
    + Object.keys(INVSTATUS).map(k=>'<option value="'+k+'"'+((p.invoice||"ej")===k?" selected":"")+'>'+INVSTATUS[k]+'</option>').join("")+'</select></label>'
    + '<p class="note">Avslutade projekt flyttas till Arkiv. All tid och alla kostnader ligger kvar och kan alltid tas fram igen.</p>'
    + '<h4 style="margin-top:6px">Kalkyl och offererat pris</h4>'
    + (offers.length?'<label class="fld"><span class="eyebrow">Hämta från offert</span><select id="p-offer"><option value="">Välj offert …</option>'
      + offers.map(o=>'<option value="'+esc(o.id)+'"'+(q.offerId===o.id?" selected":"")+'>'+esc((o.nr||"")+" · "+((o.customer||{}).name||"")+(o.title?" – "+o.title:"")+" · "+kr(o.sums.net))+'</option>').join("")
      + '</select></label>':'')
    + '<label class="fld"><span class="eyebrow">Offererat pris för hela projektet (kr exkl. moms)</span><input id="p-qtotal" type="text" inputmode="decimal" value="'+qv("total")+'" placeholder="T.ex. 150 000"></label>'
    + '<div class="form even">'
    + '<label class="fld"><span class="eyebrow">Timmar i kalkylen</span><input id="p-qhours" type="text" inputmode="decimal" value="'+qv("hours")+'"></label>'
    + '<label class="fld"><span class="eyebrow">Arbete (kr)</span><input id="p-qlabour" type="text" inputmode="decimal" value="'+qv("labour")+'"></label></div>'
    + '<div class="form even">'
    + '<label class="fld"><span class="eyebrow">Material (kr)</span><input id="p-qmat" type="text" inputmode="decimal" value="'+qv("material")+'"></label>'
    + '<label class="fld"><span class="eyebrow">Körning (kr)</span><input id="p-qtravel" type="text" inputmode="decimal" value="'+qv("travel")+'"></label></div>'
    + '<label class="fld"><span class="eyebrow">Övrigt (kr)</span><input id="p-qother" type="text" inputmode="decimal" value="'+qv("other")+'"></label>'
    + '<p class="note">Uppdelningen behövs för Statistik. Lämnar du offererat pris tomt räknas det som summan av delarna.</p>'
    + '<label class="fld"><span class="eyebrow">Anteckning</span><textarea id="p-notes" rows="3">'+esc(p.notes||"")+'</textarea></label>'
    + '</div></div>'
    + '<div class="mf">'+(pid&&pStatus(p)!=="avslutad"?'<button class="btn ghost" data-act="delproj" data-p="'+pid+'">Ta bort</button>':'')
    + '<button class="btn" data-act="close">Avbryt</button>'
    + '<button class="btn primary" data-act="saveproj" data-p="'+(pid||"")+'">Spara projekt</button></div>', function(){
      const n=document.getElementById("p-name"); if(n) n.focus();
    });
}
function costModal(pid, cid, err){
  const c = cid ? S.costs.find(x=>x.id===cid) : null;
  const p = projById(cid?c.projectId:pid);
  const k = c?c.kind:(costKeys()[0]||"material");
  return openModal('<div class="mh"><div><span class="eyebrow">'+esc(p?(p.kod||p.name):"Projekt")+'</span>'
    + '<h3 style="margin-top:2px">'+(cid?"Ändra kostnad":"Lägg till kostnad")+'</h3></div>'
    + '<button class="btn sm ghost" data-act="close">Stäng</button></div>'
    + '<div class="mb"><div class="stack">'
    + '<div class="form even">'
    + '<label class="fld"><span class="eyebrow">Typ</span><select id="c-kind">'
    + costKeys().map(x=>'<option value="'+x+'"'+(k===x?" selected":"")+'>'+esc(costOf(x).label)+'</option>').join("")+'</select></label>'
    + '<label class="fld"><span class="eyebrow">Datum</span><input id="c-date" type="date" value="'+esc(c?c.date:dkey(new Date()))+'"></label>'
    + '</div>'
    + '<label class="fld"><span class="eyebrow">Beskrivning</span>'
    + '<input id="c-desc" type="text" value="'+esc(c?c.desc:"")+'" placeholder="T.ex. VKR-rör 60x60, 6 m"></label>'
    + '<label class="fld"><span class="eyebrow">Leverantör (valfritt)</span>'
    + '<input id="c-sup" type="text" value="'+esc(c?c.supplier:"")+'" placeholder="Stålgrossisten"></label>'
    + '<div class="form even">'
    + '<label class="fld"><span class="eyebrow">Antal</span><input id="c-qty" type="text" inputmode="decimal" value="'+esc(c?fmt(c.qty):"1,00")+'"></label>'
    + '<label class="fld"><span class="eyebrow">À-pris (kr)</span><input id="c-price" type="text" inputmode="decimal" value="'+esc(c?fmt(c.unitPrice):fmt(costOf(k).price))+'"></label>'
    + '</div>'
    + '<p class="note">Milersättning: skriv antal mil (1 mil = 10 km) och à-priset per mil. Beloppet räknas ut automatiskt.</p>'
    + (err?'<div class="err">'+esc(err)+'</div>':'')
    + '</div></div>'
    + '<div class="mf">'+(cid?'<button class="btn ghost" data-act="delcost" data-c="'+esc(cid)+'">Ta bort</button>':'')
    + '<button class="btn" data-act="close">Avbryt</button>'
    + '<button class="btn primary" data-act="savecost" data-p="'+esc(p?p.id:"")+'" data-c="'+esc(cid||"")+'">Spara</button></div>', function(){
      const d=document.getElementById("c-desc"); if(d) d.focus();
    });
}
function meModal(err, ok){
  openModal('<div class="mh"><div><span class="eyebrow">Inloggad som</span><h3 style="margin-top:2px">'+esc(S.me.name)+'</h3>'
    + '<span class="note">Kontonamn: '+esc(S.me.username||"—")+'</span></div>'
    + '<button class="btn sm ghost" data-act="close">Stäng</button></div>'
    + '<div class="mb"><div class="stack">'
    + '<h4>Byt lösenord</h4>'
    + '<label class="fld"><span class="eyebrow">Nuvarande lösenord</span><input id="m-old" type="password" autocomplete="current-password"></label>'
    + '<label class="fld"><span class="eyebrow">Nytt lösenord (minst 6 tecken)</span><input id="m-new" type="password" autocomplete="new-password"></label>'
    + '<button class="btn" data-act="changepw">Spara nytt lösenord</button>'
    + (err?'<div class="err">'+esc(err)+'</div>':'')
    + (ok?'<div class="err">'+esc(ok)+'</div>':'')
    + (looksReal(S.me.authEmail)
      ? '<p class="note" style="margin-top:6px">Inloggningsadress: <b>'+esc(S.me.authEmail)+'</b>. '
        +'Glömmer du lösenordet kan du be om en återställningslänk på inloggningssidan.</p>'
      : '<hr style="border:0;border-top:1px solid var(--line);margin:6px 0">'
        +'<h4>Koppla en e-postadress</h4>'
        +'<p class="note">Kontot loggar bara in med kontonamn. Lägger du till din e-postadress kan du '
        +'återställa lösenordet själv om du glömmer det. Du loggar in med kontonamnet som vanligt.</p>'
        +'<label class="fld"><span class="eyebrow">Din e-postadress</span>'
        +'<input id="m-mail" type="text" autocapitalize="none" spellcheck="false" placeholder="andy@ellingesmide.se"></label>'
        +'<label class="fld"><span class="eyebrow">Nuvarande lösenord</span>'
        +'<input id="m-mailpw" type="password" autocomplete="current-password"></label>'
        +'<button class="btn" data-act="addmail">Koppla e-postadressen</button>')
    + '</div></div>'
    + '<div class="mf"><button class="btn" data-act="close">Stäng</button>'
    + '<button class="btn primary" data-act="logout">Logga ut</button></div>', function(){
      const i=document.getElementById("m-old"); if(i) i.focus();
    });
}
function forgotModal(err, ok){
  return openModal('<div class="mh"><div><span class="eyebrow">Inloggning</span>'
    + '<h3 style="margin-top:2px">Glömt lösenord</h3></div>'
    + '<button class="btn sm ghost" data-act="close">Stäng</button></div>'
    + '<div class="mb"><div class="stack">'
    + '<p class="note">Skriv ditt kontonamn så skickar vi en återställningslänk om kontot har en e-postadress. '
    + 'Annars går begäran till supporten, som ordnar ett nytt lösenord åt dig.</p>'
    + '<label class="fld"><span class="eyebrow">Kontonamn</span>'
    + '<input id="fg-user" type="text" autocapitalize="none" spellcheck="false" placeholder="lina"></label>'
    + '<label class="fld"><span class="eyebrow">Meddelande (valfritt)</span>'
    + '<input id="fg-note" type="text" placeholder="T.ex. ring mig på 070-…"></label>'
    + (err?'<div class="err">'+esc(err)+'</div>':'')
    + (ok?'<div class="err"><b>'+esc(ok)+'</b></div>':'')
    + '</div></div>'
    + '<div class="mf"><button class="btn" data-act="close">Stäng</button>'
    + '<button class="btn primary" data-act="doforgot"'+(S.busy?" disabled":"")+'>'+(S.busy?"Skickar…":"Skicka")+'</button></div>', function(){
      const i=document.getElementById("fg-user"); if(i) i.focus();
    });
}
/* ---- körjournal: bilar, skanner, resor ---- */
function vehModal(vehId, err){
  const v = vehId ? vehById(vehId) : {regnr:"",name:"",note:"",active:true};
  if(!v) return;
  openModal('<div class="mh"><h3>'+(vehId?"Ändra bil":"Lägg till bil")+'</h3>'
    + '<button class="btn sm ghost" data-act="close">Stäng</button></div>'
    + '<div class="mb"><div class="stack">'
    + '<label class="fld"><span class="eyebrow">Registreringsnummer</span>'
    + '<input id="v-reg" type="text" autocapitalize="characters" spellcheck="false" value="'+esc(v.regnr||"")+'" placeholder="ABC12X"></label>'
    + '<label class="fld"><span class="eyebrow">Benämning (valfritt)</span>'
    + '<input id="v-name" type="text" value="'+esc(v.name||"")+'" placeholder="Servicebil Volvo V90"></label>'
    + '<label class="fld"><span class="eyebrow">Anteckning</span>'
    + '<textarea id="v-note" rows="2">'+esc(v.note||"")+'</textarea></label>'
    + '<p class="note">Mätarställningen läses alltid i kilometer. Milen räknas fram automatiskt.</p>'
    + (err?'<div class="err">'+esc(err)+'</div>':'')
    + '</div></div>'
    + '<div class="mf">'+(vehId?'<button class="btn ghost" data-act="delveh" data-v="'+vehId+'">Ta bort</button>':'')
    + '<button class="btn" data-act="close">Avbryt</button>'
    + '<button class="btn primary" data-act="saveveh" data-v="'+(vehId||"")+'">Spara</button></div>', function(){
      const n=document.getElementById("v-reg"); if(n) n.focus();
    });
}

function qrModal(vehId){
  const v=vehById(vehId); if(!v) return;
  const url=korUrl(vehId);
  openModal('<div class="mh noprint"><div><span class="eyebrow">Att sätta i bilen</span>'
    + '<h3 style="margin-top:2px">QR-kod för '+esc(v.regnr)+'</h3></div>'
    + '<button class="btn sm ghost" data-act="close">Stäng</button></div>'
    + '<div class="mb"><div class="qrsheet" style="text-align:center;padding:10px 6px">'
    + '<div style="font-size:13px;letter-spacing:.18em;text-transform:uppercase;opacity:.65">Körjournal</div>'
    + '<div style="font-size:34px;font-weight:700;margin:6px 0 2px;letter-spacing:.06em">'+esc(v.regnr)+'</div>'
    + (v.name?'<div style="font-size:14px;opacity:.7;margin-bottom:12px">'+esc(v.name)+'</div>':'<div style="height:10px"></div>')
    + '<div style="display:inline-block;padding:12px;background:#fff;border:1px solid #ddd;border-radius:10px">'
    + qrSvg(url,{size:260,quiet:4})+'</div>'
    + '<div style="margin-top:14px;font-size:14px;line-height:1.6;max-width:330px;margin-left:auto;margin-right:auto;text-align:left">'
    + '<b>Före körning:</b> skanna koden, fotografera mätaren, välj projekt.<br>'
    + '<b>Efter körning:</b> skanna koden igen och fotografera mätaren. Sträckan räknas ut automatiskt.'
    + '</div>'
    + '<div style="margin-top:10px;font-size:11px;opacity:.55;word-break:break-all">'+esc(url)+'</div>'
    + '</div>'
    + '<p class="note noprint" style="margin-top:14px">Skriv ut, klipp till och sätt i vindrutan eller handskfacket. '
    + 'Koden öppnar appen direkt i rätt bil – föraren loggar in en gång och slipper leta sig fram.</p>'
    + '</div>'
    + '<div class="mf noprint"><button class="btn" data-act="close">Stäng</button>'
    + '<button class="btn primary" data-act="korprint">Skriv ut</button></div>');
}

/* Kameraskanner för mätarställningen. Fotot sparas som bevis och
   sifferavläsningen är ett förslag som föraren alltid får bekräfta. */
function stopScan(){
  if(S.scan && S.scan.stream){
    try{ S.scan.stream.getTracks().forEach(t=>t.stop()); }catch(e){}
    S.scan.stream=null;
  }
}
function scanModal(vehId, phase, err){
  const v=vehById(vehId); if(!v) return;
  const prev = phase==="slut" ? openTripHere(vehId) : null;
  if(phase==="slut" && !prev) return toast("Den här bilen har ingen påbörjad resa.");
  /* dialogen kan ritas om vid fel – då byts video-elementet ut och den gamla
     strömmen måste stängas, annars ligger kameran kvar och lyser */
  const keep = (S.scan && S.scan.vehId===vehId && S.scan.phase===phase) ? S.scan : null;
  stopScan();
  S.scan = {vehId:vehId, phase:phase, stream:null,
            photo:(keep&&keep.photo)||"", km:(keep&&keep.km)||"", cells:(keep&&keep.cells)||null};
  /* bilens mallbank hämtas i bakgrunden medan kameran startar */
  if(S.ocrBanks) delete S.ocrBanks[vehId];   /* färsk lastKm varje gång */
  loadOcrBank(vehId).catch(function(){});

  const projOpts = '<option value="">Inget projekt</option>'
    + S.projects.filter(p=>(p.status||"aktiv")!=="avslutad")
        .map(p=>'<option value="'+p.id+'"'+(S.lastProj===p.id?" selected":"")+'>'+esc(projName(p.id))+'</option>').join("");

  openModal('<div class="mh"><div><span class="eyebrow">'+esc(vehLabel(v))+'</span>'
    + '<h3 style="margin-top:2px">'+(phase==="start"?"Starta resa":"Avsluta resa")+'</h3></div>'
    + '<button class="btn sm ghost" data-act="close">Stäng</button></div>'
    + '<div class="mb"><div class="stack">'

    + '<div id="sc-cam" class="panel" style="padding:0;overflow:hidden;position:relative;background:#111;min-height:150px">'
    + '<video id="sc-video" playsinline muted autoplay style="width:100%;display:block;max-height:280px;object-fit:cover"></video>'
    + '<div id="sc-guide" style="position:absolute;left:8%;right:8%;top:50%;transform:translateY(-50%);height:74px;'
    + 'border:2px solid rgba(255,255,255,.9);border-radius:8px;box-shadow:0 0 0 2000px rgba(0,0,0,.35);pointer-events:none"></div>'
    + '<img id="sc-shot" alt="" style="display:none;width:100%;max-height:280px;object-fit:contain;background:#111">'
    + '</div>'
    + '<div id="sc-camnote" class="note" style="display:none"></div>'
    + '<div class="form even">'
    + '<button class="btn" data-act="scshoot">Fotografera mätaren</button>'
    + '<button class="btn ghost" data-act="scretake">Ta om</button></div>'

    + '<label class="fld"><span class="eyebrow">Mätarställning i kilometer</span>'
    + '<input id="sc-km" type="text" inputmode="numeric" autocomplete="off" '
    + 'style="font-size:28px;font-weight:600;letter-spacing:.04em;text-align:center" '
    + 'value="'+esc(S.scan.km||"")+'" placeholder="0"></label>'
    + '<p class="note" id="sc-hint">Lägg <b>bara totalmätarens siffror</b> i den vita ramen – inte trippmätaren, klockan eller räckvidden – och fotografera. Kontrollera alltid siffrorna och rätta i rutan om det behövs. Appen lär sig bilens siffror varje gång du sparar.</p>'

    + (phase==="start"
      ? '<label class="fld"><span class="eyebrow">Projekt (valfritt)</span><select id="sc-proj">'+projOpts+'</select></label>'
        + '<label class="fld"><span class="eyebrow">Typ av resa</span><select id="sc-kind">'
        + '<option value="tjanst">Tjänsteresa</option><option value="privat">Privat resa</option></select></label>'
        + '<label class="fld"><span class="eyebrow">Ärende / vart (valfritt)</span>'
        + '<input id="sc-purpose" type="text" placeholder="T.ex. montage Smedjegatan 12"></label>'
      : '<div class="panel" style="padding:12px">'
        + '<span class="eyebrow">Resan startade</span>'
        + '<p class="note" style="margin:4px 0 0">'+esc(tidText(prev.startAt))+' vid <b>'+mfm.format(prev.startKm)+' km</b>'
        + (prev.empId!==S.me.id?' av <b>'+esc(prev.empName||"annan förare")+'</b>':'')
        + (prev.projectId?' · '+esc(projName(prev.projectId)):'')
        + (prev.purpose?'<br>'+esc(prev.purpose):'')+'</p>'
        + '<p class="note" id="sc-calc" style="margin:8px 0 0"></p></div>')

    + (err?'<div class="err">'+esc(err)+'</div>':'')
    + '</div></div>'
    + '<div class="mf"><button class="btn" data-act="close">Avbryt</button>'
    + '<button class="btn primary" data-act="scsave" data-v="'+vehId+'" data-p="'+phase+'">'
    + (phase==="start"?"Starta resan":"Spara resan")+'</button></div>', function(){
      if(S.scan.photo){ showShot(S.scan.photo); }
      else beginCamera();
      const k=document.getElementById("sc-km");
      if(k) k.addEventListener("input", updateCalc);
      updateCalc();
    });
}
function showShot(dataUrl){
  const img=document.getElementById("sc-shot"), vid=document.getElementById("sc-video"),
        guide=document.getElementById("sc-guide");
  if(!img) return;
  img.src=dataUrl; img.style.display="block";
  if(vid) vid.style.display="none";
  if(guide) guide.style.display="none";
}
function updateCalc(){
  const el=document.getElementById("sc-calc"); if(!el || !S.scan) return;
  const prev=openTripHere(S.scan.vehId); if(!prev) return;
  const now=parseInt(String((document.getElementById("sc-km")||{}).value||"").replace(/\D/g,""),10);
  if(!now || isNaN(now)){ el.innerHTML=""; return; }
  const diff=now-(+prev.startKm||0);
  el.innerHTML = diff>0
    ? 'Sträcka: <b>'+mfm.format(diff)+' km</b> ('+fmt(milOf(diff))+' mil)'
    : '<span style="color:var(--bad,#b91c1c)">Slutvärdet måste vara högre än '+mfm.format(prev.startKm)+' km.</span>';
}
async function beginCamera(){
  const note=document.getElementById("sc-camnote"), cam=document.getElementById("sc-cam");
  const fail=function(msg){
    if(cam) cam.style.display="none";
    if(note){ note.style.display="block"; note.textContent=msg; }
  };
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
    return fail("Den här webbläsaren kan inte öppna kameran. Skriv in mätarställningen för hand nedan.");
  try{
    const stream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:"environment"}, width:{ideal:1920}, height:{ideal:1080}}, audio:false});
    if(!S.scan){ stream.getTracks().forEach(t=>t.stop()); return; }
    S.scan.stream=stream;
    const vid=document.getElementById("sc-video");
    if(!vid){ stopScan(); return; }
    vid.srcObject=stream;
    try{ await vid.play(); }catch(e){}
  }catch(e){
    console.error(e);
    fail(e && e.name==="NotAllowedError"
      ? "Kameran är blockerad. Tillåt kameran för den här sidan, eller skriv in mätarställningen för hand nedan."
      : "Ingen kamera hittades. Skriv in mätarställningen för hand nedan.");
  }
}
/* Klipper ut siktrutan ur videobilden, ljusar upp och förstorar den,
   så att sifferavläsningen får något rent att arbeta med. */
function grabFrame(){
  const vid=document.getElementById("sc-video");
  if(!vid || !vid.videoWidth) return null;
  const vw=vid.videoWidth, vh=vid.videoHeight;
  const x=Math.round(vw*0.08), w=Math.round(vw*0.84);
  const h=Math.round(vh*0.22), y=Math.round(vh*0.5-h/2);
  const scale=Math.min(3, Math.max(1, 900/w));
  const cv=document.createElement("canvas");
  cv.width=Math.round(w*scale); cv.height=Math.round(h*scale);
  const ctx=cv.getContext("2d");
  ctx.drawImage(vid, x, y, w, h, 0, 0, cv.width, cv.height);
  return cv;
}
/* Hela kamerabilden, för AI-avläsningen: den behöver se etiketter som TRIP
   och ODO runt siffrorna, inte bara bandet i ramen. */
function grabWide(){
  const vid=document.getElementById("sc-video");
  if(!vid || !vid.videoWidth) return "";
  const k=Math.min(1, 1280/Math.max(vid.videoWidth, vid.videoHeight));
  const cv=document.createElement("canvas");
  cv.width=Math.round(vid.videoWidth*k); cv.height=Math.round(vid.videoHeight*k);
  cv.getContext("2d").drawImage(vid,0,0,cv.width,cv.height);
  try{ return cv.toDataURL("image/jpeg",0.85); }catch(e){ return ""; }
}
/* AI-avläsning via /api/miltal (Google Gemini, gratisnivå). Ett andra öga –
   svarar servern inte, eller är funktionen avstängd, används bara
   telefonens egen avläsning. */
async function aiMeter(image, scan){
  if(!image || S.aiMeterOff || !auth.currentUser) return null;
  const v=vehById(scan.vehId)||{};
  const ctl=new AbortController(), timer=setTimeout(()=>ctl.abort(), 25000);
  try{
    const token=await auth.currentUser.getIdToken();
    const res=await fetch("api/miltal", {method:"POST", signal:ctl.signal,
      headers:{"content-type":"application/json", authorization:"Bearer "+token},
      body:JSON.stringify({image:image, context:{model:v.name||"", regnr:v.regnr||"", phase:scan.phase,
        startKm:scan.phase==="slut" ? (+(openTripHere(scan.vehId)||{}).startKm||0) : 0, lastKm:vehLastKm(scan.vehId)}})});
    if(res.status===503 || res.status===404){ S.aiMeterOff=true; return null; }
    if(!res.ok) return null;
    return await res.json();
  }catch(e){ console.warn("AI-avläsning:", (e&&e.message)||e); return null; }
  finally{ clearTimeout(timer); }
}
function boostContrast(cv){
  const ctx=cv.getContext("2d");
  const img=ctx.getImageData(0,0,cv.width,cv.height), d=img.data;
  let min=255, max=0;
  for(let i=0;i<d.length;i+=4){
    const g=(d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114)|0;
    d[i]=d[i+1]=d[i+2]=g;
    if(g<min) min=g; if(g>max) max=g;
  }
  const span=Math.max(1,max-min);
  for(let i=0;i<d.length;i+=4){
    const g=Math.max(0,Math.min(255,((d[i]-min)*255/span)|0));
    d[i]=d[i+1]=d[i+2]=g;
  }
  ctx.putImageData(img,0,0);
  return cv;
}
/* ---- mätaravläsning i telefonen, utan någon extern tjänst ----
   1. Bilens egen mallbank (ocr.js): varje gång en mätarställning sparas lär sig
      appen hur just den bilens siffror ser ut. Efter några resor känns de igen.
   2. Tills banken räcker: allmän sifferavläsning (Tesseract) på ramen.
   3. Rimlighet: förra ställningen (vid start) eller startvärdet (vid slut) låser
      de första siffrorna, så att trippmätare, klocka och räckvidd sorteras bort.
   Föraren bekräftar alltid värdet innan det sparas. */
let ocrMod=null;
async function ocrLib(){ if(!ocrMod) ocrMod=await import("./ocr.js"); return ocrMod; }
/* Laddningen cachas som löfte så att samtidiga anrop delar på samma läsning.
   Misslyckas den cachas inget, och banken skrivs då aldrig över. */
function loadOcrBank(vid){
  S.ocrBanks=S.ocrBanks||{};
  if(S.ocrBanks[vid]) return S.ocrBanks[vid];
  const p=(async function(){
    const O=await ocrLib();
    let d=null;
    try{ d=await Store.get("ocrbanks/"+vid); }
    catch(e){ delete S.ocrBanks[vid]; return {bank:O.bankFromDoc(null), lastKm:0, failed:true}; }
    return {bank:O.bankFromDoc(d), lastKm:+(d&&d.lastKm)||0};
  })();
  S.ocrBanks[vid]=p;
  return p;
}
/* Senast kända mätarställning för bilen: egna resor och bilens delade senaste värde. */
function vehLastKm(vid){
  let m=0;
  (S.trips||[]).forEach(function(t){ if(t.vehicleId===vid) m=Math.max(m, +t.endKm||0, +t.startKm||0); });
  const ob=(S.ocrBanksReady||{})[vid]; if(ob && ob.lastKm) m=Math.max(m, ob.lastKm);
  return m;
}
function copyCanvas(cv){
  const c=document.createElement("canvas"); c.width=cv.width; c.height=cv.height;
  c.getContext("2d").drawImage(cv,0,0); return c;
}
async function readMeter(cv, scan){
  let O=null; try{ O=await ocrLib(); }catch(e){ O=null; }
  let ob=null; try{ ob=await loadOcrBank(scan.vehId); }catch(e){ ob=null; }
  if(ob){ S.ocrBanksReady=S.ocrBanksReady||{}; S.ocrBanksReady[scan.vehId]=ob; }
  /* referensen räknas först när bilens delade senaste värde är laddat */
  const ref = scan.phase==="slut" ? (+(openTripHere(scan.vehId)||{}).startKm||0) : vehLastKm(scan.vehId);
  const refTxt = ref ? mfm.format(ref)+" km" : "";
  /* 1. mallbanken */
  let r=null;
  try{ if(O) r=O.readOdometer(copyCanvas(cv), ob?ob.bank:{}, ref); }catch(e){ console.warn("ocr.js", e); r=null; }
  scan.cells = (r && r.cells && r.cells.length) ? r.cells : null;
  scan.readText = "";
  if(r && r.source==="bank" && r.ok && r.confidence>=0.2 && /^\d{4,7}$/.test(r.text)){
    scan.readText = r.text;
    return {value:r.text, hint:"Avläst: "+mfm.format(+r.text)+" km. Känd från bilens tidigare avläsningar. Stämmer det med mätaren?"};
  }
  /* 2. allmän sifferavläsning, rättad mot referensen */
  let raw="";
  try{ raw=await ocrDigits(boostContrast(cv)); }catch(e){ raw=""; if(!r) throw e; }
  scan.readText = raw;
  /* en siffra för mycket sist är oftast tiondelen */
  if(ref && raw.length===String(ref).length+1 && O && O.plausible(+raw.slice(0,-1), ref)) raw=raw.slice(0,-1);
  const fix=O ? O.repairPlain(raw, ref) : null;
  const trained = (ob && O) ? O.bankSize(ob.bank) : 0;
  const learnNote = trained<10 ? " Appen lär sig bilens siffror när du sparar." : "";
  if(fix && fix.ok && /^\d{4,7}$/.test(fix.text)){
    if(fix.rattad) return {value:fix.text, hint:"Förslag: "+mfm.format(fix.value)+" km. "+(fix.avstand===1?"En siffra":"Två siffror")
      +" är justerade mot "+(scan.phase==="slut"?"startvärdet ":"förra ställningen ")+refTxt+". Kontrollera noga mot mätaren."+learnNote};
    return {value:fix.text, hint:"Avläst: "+mfm.format(fix.value)+" km. Stämmer det med mätaren? Rätta annars i rutan."+learnNote};
  }
  if(raw && ref && /^\d+$/.test(raw) && +raw<ref)
    return {value:"", hint:"Läste "+raw+", som är lägre än "+(scan.phase==="slut"?"startvärdet ":"förra ställningen ")+refTxt
      +". Det är troligen trippmätaren eller klockan. Lägg bara totalmätaren i ramen och fota igen, eller skriv in värdet."};
  return {value:"", hint:"Kunde inte läsa siffrorna säkert. Lägg bara totalmätarens siffror i ramen och fota igen, eller skriv in värdet."+learnNote};
}
/* Lär banken det bekräftade värdet. Rutorna kommer från fotot i den här
   dialogen; finns en ruta för mycket sist är det tiondelen, som hoppas över. */
/* Lär in bara när fotot faktiskt visade det sparade värdet: samma antal
   siffror och högst en som skiljer. Banken läses färskt precis innan, så
   andra förares inlärning inte skrivs över. */
async function ocrLearnAfterSave(vid, km, cells, readText){
  try{
    const O=await ocrLib();
    let d; try{ d=await Store.get("ocrbanks/"+vid); }catch(e){ return; }
    const bank=O.bankFromDoc(d), oldLast=+(d&&d.lastKm)||0;
    const txt=String(km), seen=String(readText||"");
    const close = seen.length===txt.length && [...txt].filter((c,i)=>c!==seen[i]).length<=1;
    let learned=false;
    if(close && cells && cells.length===txt.length){ O.learn(bank, cells, txt); learned=true; }
    else if(close && cells && cells.length===txt.length+1){ O.learn(bank, cells.slice(0, txt.length), txt); learned=true; }
    /* ett skrivfel får inte bli alla förares referens */
    const newLast = (!oldLast || O.plausible(km, oldLast)) ? km : oldLast;
    if(!learned && newLast===oldLast) return;
    await Store.set("ocrbanks/"+vid, Object.assign(O.bankToDoc(bank), {vehicleId:vid, lastKm:newLast}));
    if(S.ocrBanks) delete S.ocrBanks[vid];
  }catch(e){ console.warn("Körjournal: kunde inte spara mallbanken –", (e&&e.message)||e); }
}
let ocrWorker=null;
async function ocrDigits(canvas){
  if(!window.Tesseract){
    await new Promise(function(res,rej){
      const s=document.createElement("script");
      s.src="https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js";
      s.onload=res;
      s.onerror=function(){ rej(new Error("Tesseract (sifferavläsningen) kunde inte hämtas.")); };
      document.head.appendChild(s);
    });
  }
  if(!ocrWorker){
    ocrWorker=await window.Tesseract.createWorker("eng");
    await ocrWorker.setParameters({tessedit_char_whitelist:"0123456789", tessedit_pageseg_mode:"7"});
  }
  const out=await ocrWorker.recognize(canvas);
  return String((out && out.data && out.data.text)||"").replace(/\D/g,"");
}

/* Mätarfotona ligger i tripphotos/<resa>__start|end, inte i själva resan.
   Listan i körjournalen blir då liten, och fotot hämtas när resan öppnas. */
async function saveTripPhoto(tripId, empId, which, data){
  await Store.set("tripphotos/"+tripId+"__"+which, {tripId:tripId, empId:empId, which:which, data:data});
}
async function loadTripPhotos(t){
  for(const w of ["start","end"]){
    if(w==="start" ? (t.photoStart || !t.hasStart) : (t.photoEnd || !t.hasEnd)) continue;
    try{
      const d=await Store.get("tripphotos/"+t.id+"__"+w);
      const img=document.getElementById(w==="start"?"tp-start":"tp-end");
      if(img && d && d.data) img.src=d.data;
    }catch(e){ console.error(e); }
  }
}
let movingTrips=false;
async function moveTripPhotos(){
  if(movingTrips || !isAdmin()) return;
  const todo=S.trips.filter(t=>t.photoStart||t.photoEnd);
  if(!todo.length) return;
  movingTrips=true;
  try{
    for(const t of todo){
      if(t.photoStart) await saveTripPhoto(t.id, t.empId, "start", t.photoStart);
      if(t.photoEnd)   await saveTripPhoto(t.id, t.empId, "end", t.photoEnd);
      const body=Object.assign({}, t, {photoStart:"", photoEnd:"", hasStart:!!(t.photoStart||t.hasStart), hasEnd:!!(t.photoEnd||t.hasEnd)});
      delete body._id;
      await Store.set("trips/"+t.id, body);
      Object.assign(t, body);
    }
  }finally{ movingTrips=false; }
}
function tripModal(tripId, err){
  const t=S.trips.find(x=>x.id===tripId); if(!t) return;
  const own = t.empId===S.me.id;
  const editable = isAdmin() || own;
  const projOpts='<option value="">Inget projekt</option>'
    + S.projects.map(p=>'<option value="'+p.id+'"'+(t.projectId===p.id?" selected":"")+'>'+esc(projName(p.id))+'</option>').join("");
  openModal('<div class="mh"><div><span class="eyebrow">'+esc(t.regnr||"")+' · '+esc(dagText(t.startAt))+'</span>'
    + '<h3 style="margin-top:2px">'+(t.status==="open"?"Pågående resa":"Resa")+'</h3></div>'
    + '<button class="btn sm ghost" data-act="close">Stäng</button></div>'
    + '<div class="mb"><div class="stack">'
    + (isAdmin()?'<p class="note">Förare: <b>'+esc(t.empName||"—")+'</b></p>':'')
    + '<div class="form even">'
    + '<label class="fld"><span class="eyebrow">Mätare start (km)</span>'
    + '<input id="t-start" type="text" inputmode="numeric" value="'+esc(t.startKm||"")+'"'+(editable?"":" disabled")+'></label>'
    + '<label class="fld"><span class="eyebrow">Mätare slut (km)</span>'
    + '<input id="t-end" type="text" inputmode="numeric" value="'+esc(t.endKm||"")+'"'
    + (t.status==="open"?' placeholder="Fyll i för att avsluta"':'')+(editable?"":" disabled")+'></label>'
    + '</div>'
    + '<label class="fld"><span class="eyebrow">Projekt</span><select id="t-proj"'+(editable?"":" disabled")+'>'+projOpts+'</select></label>'
    + '<label class="fld"><span class="eyebrow">Typ av resa</span><select id="t-kind"'+(editable?"":" disabled")+'>'
    + '<option value="tjanst"'+(t.kind!=="privat"?" selected":"")+'>Tjänsteresa</option>'
    + '<option value="privat"'+(t.kind==="privat"?" selected":"")+'>Privat resa</option></select></label>'
    + '<label class="fld"><span class="eyebrow">Ärende / vart</span>'
    + '<input id="t-purpose" type="text" value="'+esc(t.purpose||"")+'"'+(editable?"":" disabled")+'></label>'
    + (t.status==="done"?'<p class="note">Sträcka: <b>'+mfm.format(t.km||0)+' km</b> ('+fmt(milOf(t.km))+' mil)'
      + (t.closedByName&&t.closedById!==t.empId?' · avslutad av '+esc(t.closedByName):'')+'</p>'
      : (editable?'<p class="note">Resan pågår. Fyll i mätaren vid slut och tryck på <b>Avsluta resan</b>'
        + (t.empId!==S.me.id?' – resan står kvar på '+esc(t.empName||"föraren som startade den"):'')+'.</p>':''))
    + (t.photoStart||t.photoEnd||t.hasStart||t.hasEnd
      ? '<div><span class="eyebrow">Foto på mätaren</span><div class="form even" style="margin-top:6px">'
        + (t.photoStart||t.hasStart?'<img id="tp-start" src="'+esc(t.photoStart||"")+'" alt="Mätare vid start" style="width:100%;min-height:40px;border-radius:8px;border:1px solid var(--line)">':'')
        + (t.photoEnd||t.hasEnd?'<img id="tp-end" src="'+esc(t.photoEnd||"")+'" alt="Mätare vid slut" style="width:100%;min-height:40px;border-radius:8px;border:1px solid var(--line)">':'')
        + '</div></div>' : '')
    + (err?'<div class="err">'+esc(err)+'</div>':'')
    + '</div></div>'
    + '<div class="mf">'
    + (editable?'<button class="btn ghost" data-act="deltrip" data-t="'+esc(tripId)+'">Ta bort</button>':'')
    + '<button class="btn" data-act="close">Stäng</button>'
    + (editable?'<button class="btn'+(t.status==="open"?"":" primary")+'" data-act="savetrip" data-t="'+esc(tripId)+'">Spara</button>':'')
    + (editable&&t.status==="open"?'<button class="btn primary" data-act="savetrip" data-end="1" data-t="'+esc(tripId)+'">Avsluta resan</button>':'')
    + '</div>');
}

function confirmModal(title, text, act, data, key){
  openModal('<div class="mh"><h3>'+esc(title)+'</h3><button class="btn sm ghost" data-act="close">Stäng</button></div>'
    + '<div class="mb"><p class="note">'+esc(text)+'</p></div>'
    + '<div class="mf"><button class="btn" data-act="close">Avbryt</button>'
    + '<button class="btn primary" data-act="'+act+'" data-'+(key||"e")+'="'+esc(data)+'">Ja, fortsätt</button></div>');
}
function textModal(title, text){
  openModal('<div class="mh"><h3>'+esc(title)+'</h3><button class="btn sm ghost" data-act="close">Stäng</button></div>'
    + '<div class="mb"><p class="note">Markera allt och kopiera, klistra sedan in i Excel.</p>'
    + '<textarea rows="12" readonly style="font-family:monospace;font-size:12px">'+esc(text)+'</textarea></div>'
    + '<div class="mf"><button class="btn" data-act="close">Stäng</button></div>', function(){
      const t=modalRoot.querySelector("textarea"); if(t){t.focus();t.select();}
    });
}
function returnModal(empId, wk){
  openModal('<div class="mh"><h3>Returnera vecka '+wkNo(wk)+'</h3><button class="btn sm ghost" data-act="close">Stäng</button></div>'
    + '<div class="mb"><label class="fld"><span class="eyebrow">Kommentar till den anställde</span>'
    + '<textarea id="r-note" rows="4" placeholder="T.ex. Onsdagens 6 timmar saknar projekt"></textarea></label></div>'
    + '<div class="mf"><button class="btn" data-act="close">Avbryt</button>'
    + '<button class="btn primary" data-act="doreturn" data-e="'+empId+'" data-w="'+wk+'">Returnera</button></div>', function(){
      const t=document.getElementById("r-note"); if(t) t.focus();
    });
}
function syncProjField(){
  const ty=document.getElementById("f-type"), pr=document.getElementById("f-proj");
  if(!ty||!pr) return;
  const needs=typeOf(ty.value).proj;
  pr.disabled=!needs;
  if(!needs) pr.value="";
  else if(!pr.value && S.lastProj) pr.value=S.lastProj;
}

/* ============================ export ============================ */

/* ============================ excel ============================ */
function sheetFrom(rows, widths, fmtMap){
  const ws=XLSX.utils.aoa_to_sheet(rows);
  if(widths) ws["!cols"]=widths.map(w=>({wch:w}));
  if(fmtMap){
    const range=XLSX.utils.decode_range(ws["!ref"]);
    for(let R=1;R<=range.e.r;R++){
      Object.keys(fmtMap).forEach(function(c){
        const cell=ws[XLSX.utils.encode_cell({r:R,c:+c})];
        if(cell && cell.t==="n") cell.z=fmtMap[c];
      });
    }
  }
  return ws;
}
const H2 = "#,##0.00";
const KR = "#,##0.00\\ \"kr\"";
function projectWorkbook(pid){
  const p=projById(pid), dates=periodDates();
  const t=projectTotals(pid,dates);
  const cRows=costsFor(pid,dates), cTot=costTotals(cRows);
  const rate=+p.rate||0;
  const labour=r2(t.bill*rate), net=r2(labour+cTot.sum), vat=r2(net*(S.vat/100));
  const per=periodLabelProj();
  const wb=XLSX.utils.book_new();

  /* 1. Sammanställning */
  const sum=[
    ["Fakturaunderlag"],[],
    ["Projekt", p.name],
    ["Projektkod", p.kod||""],
    ["Kund", p.kund||""],
    ["Arbetsplats", p.adress||""],
    ["Period", per],
    ["Uttagen", new Date().toLocaleString("sv-SE")],
    [],
    ["Timmar", "", ""],
    ["Rapporterade timmar", t.hours],
    ["Fakturerbara timmar", t.bill],
    ["Varav övertid", t.ot],
    ["Timpris", rate],
    ["Arbete", labour],
    [],
    ["Kostnader", "", ""]
  ];
  costKeys().forEach(function(k){ if(cTot.byKind[k]) sum.push([costOf(k).label, cTot.byKind[k]]); });
  sum.push(["Summa kostnader", cTot.sum]);
  sum.push([]);
  sum.push(["Summa exkl moms", net]);
  sum.push(["Moms "+S.vat+" %", vat]);
  sum.push(["Att fakturera", r2(net+vat)]);
  XLSX.utils.book_append_sheet(wb, sheetFrom(sum,[26,20,14],{1:H2}), "Sammanställning");

  /* 2. Timmar */
  const hr=[["Datum","Vecka","Veckodag","Medarbetare","Typ","Fakturerbart","Timmar","Timpris","Belopp","Notering"]];
  t.rows.slice().reverse().forEach(function(r){
    const e=S.employees.find(x=>x.id===r.empId), ty=typeOf(r.type);
    hr.push([r.ds, isoWeek(fromKey(r.ds)), DAYS[isoDow(fromKey(r.ds))], e?e.name:"Okänd", ty.label,
             ty.bill?"Ja":"Nej", r.hours, ty.bill?rate:0, ty.bill?r2(r.hours*rate):0, r.note||""]);
  });
  hr.push([]);
  hr.push(["","","","","","Summa", t.hours, "", labour, ""]);
  XLSX.utils.book_append_sheet(wb, sheetFrom(hr,[12,7,11,20,16,12,9,9,12,34],{6:H2,7:H2,8:H2}), "Timmar");

  /* 3. Per medarbetare */
  const em=[["Medarbetare","Timmar","Varav övertid","Belopp"]];
  Object.keys(t.byEmp).sort(function(a,b){return t.byEmp[b]-t.byEmp[a];}).forEach(function(id){
    const e=S.employees.find(x=>x.id===id);
    let ot=0, bill=0;
    t.rows.forEach(function(r){ if(r.empId!==id) return; if(r.type==="overtid") ot+=r.hours; if(typeOf(r.type).bill) bill+=r.hours; });
    em.push([e?e.name:"Okänd", r2(t.byEmp[id]), r2(ot), r2(bill*rate)]);
  });
  XLSX.utils.book_append_sheet(wb, sheetFrom(em,[24,10,14,14],{1:H2,2:H2,3:H2}), "Per medarbetare");

  /* 4. Per vecka */
  const byW={};
  t.rows.forEach(function(r){
    const w=wkey(fromKey(r.ds));
    byW[w]=byW[w]||{h:0,b:0};
    byW[w].h+=r.hours;
    if(typeOf(r.type).bill) byW[w].b+=r.hours;
  });
  const wr=[["Vecka","Period","Timmar","Fakturerbart","Belopp"]];
  Object.keys(byW).sort().forEach(function(w){
    wr.push(["v"+wkNo(w)+" "+w.slice(0,4), weekSpan(w), r2(byW[w].h), r2(byW[w].b), r2(byW[w].b*rate)]);
  });
  XLSX.utils.book_append_sheet(wb, sheetFrom(wr,[12,22,10,14,14],{2:H2,3:H2,4:H2}), "Per vecka");

  /* 5. Kostnader */
  const cr=[["Datum","Typ","Beskrivning","Leverantör","Antal","Enhet","À-pris","Belopp","Noterat av"]];
  cRows.slice().reverse().forEach(function(c){
    cr.push([c.date, costOf(c.kind).label, c.desc||"", c.supplier||"", +c.qty||0, c.unit||"", +c.unitPrice||0, +c.amount||0, c.byName||""]);
  });
  cr.push([]);
  cr.push(["","","","","","","Summa", cTot.sum, ""]);
  XLSX.utils.book_append_sheet(wb, sheetFrom(cr,[12,17,30,20,9,8,11,12,18],{4:H2,6:H2,7:H2}), "Kostnader");

  /* 6. Fakturarader */
  const fr=[["Beskrivning","Antal","Enhet","À-pris","Belopp"]];
  if(t.bill) fr.push(["Arbete – "+p.name+" ("+per+")", t.bill, "tim", rate, labour]);
  costKeys().forEach(function(k){
    if(!cTot.byKind[k]) return;
    const rows=cRows.filter(c=>c.kind===k);
    const qty=rows.reduce(function(a,c){return a+(+c.qty||0);},0);
    fr.push([costOf(k).label, r2(qty), costOf(k).unit, rows.length===1?(+rows[0].unitPrice||0):"", cTot.byKind[k]]);
  });
  fr.push([]);
  fr.push(["Summa exkl moms","","","",net]);
  fr.push(["Moms "+S.vat+" %","","","",vat]);
  fr.push(["Att betala","","","",r2(net+vat)]);
  XLSX.utils.book_append_sheet(wb, sheetFrom(fr,[46,10,9,12,14],{1:H2,3:H2,4:H2}), "Fakturarader");

  return wb;
}
function timeWorkbook(emp, dates, label){
  const st=rangeStats(emp.id, dates, S.months);
  const wb=XLSX.utils.book_new();
  const rows=[["Anställd","Datum","Vecka","Veckodag","Projektkod","Projekt","Kund","Typ","Fakturerbart","Timmar","Notering"]];
  dates.forEach(function(ds){
    entriesFor(emp.id, ds, S.months).forEach(function(en){
      const p=projById(en.projectId), ty=typeOf(en.type);
      rows.push([emp.name, ds, isoWeek(fromKey(ds)), DAYS[isoDow(fromKey(ds))],
        p?(p.kod||""):"", p?p.name:"", p?(p.kund||""):"", ty.label, ty.bill?"Ja":"Nej", en.hours, en.note||""]);
    });
  });
  rows.push([]);
  rows.push(["","","","","","","","","Summa", st.worked, ""]);
  XLSX.utils.book_append_sheet(wb, sheetFrom(rows,[20,12,7,11,12,26,20,16,12,9,30],{9:H2}), "Tidposter");

  const ty=[["Typ","Timmar"]];
  Object.keys(st.byType).sort(function(a,b){return st.byType[b]-st.byType[a];}).forEach(function(k){
    ty.push([typeOf(k).label, r2(st.byType[k])]);
  });
  ty.push([]); ty.push(["Summa", st.worked]);
  ty.push(["Varav övertid", st.ot]); ty.push(["Frånvaro", st.abs]); ty.push(["Fakturerbart", st.bill]);
  XLSX.utils.book_append_sheet(wb, sheetFrom(ty,[24,12],{1:H2}), "Per typ");

  const pr=[["Projektkod","Projekt","Timmar"]];
  Object.keys(st.byProj).sort(function(a,b){return st.byProj[b]-st.byProj[a];}).forEach(function(k){
    const p=projById(k);
    pr.push([p?(p.kod||""):"", p?p.name:"Utan projekt", r2(st.byProj[k])]);
  });
  XLSX.utils.book_append_sheet(wb, sheetFrom(pr,[12,30,12],{2:H2}), "Per projekt");
  return wb;
}
function wbBlob(wb){
  const out=XLSX.write(wb,{bookType:"xlsx",type:"array"});
  return new Blob([out],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}
function downloadBlob(blob, name){
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download=name; document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); },1500);
}
/* Håll reda på vald fil så att samma fil kan skrivas om */
function idbOpen(){
  return new Promise(function(res,rej){
    const r=indexedDB.open("timmar-files",1);
    r.onupgradeneeded=function(){ r.result.createObjectStore("h"); };
    r.onsuccess=function(){ res(r.result); };
    r.onerror=function(){ rej(r.error); };
  });
}
async function idbGet(k){
  const d=await idbOpen();
  return new Promise(function(res,rej){
    const q=d.transaction("h").objectStore("h").get(k);
    q.onsuccess=function(){ res(q.result); }; q.onerror=function(){ rej(q.error); };
  });
}
async function idbSet(k,v){
  const d=await idbOpen();
  return new Promise(function(res,rej){
    const tx=d.transaction("h","readwrite");
    tx.objectStore("h").put(v,k);
    tx.oncomplete=function(){ res(); }; tx.onerror=function(){ rej(tx.error); };
  });
}
async function writeSameFile(key, blob, suggestedName){
  let h=null;
  try{ h=await idbGet(key); }catch(e){}
  if(h){
    let perm="denied";
    try{ perm=await h.queryPermission({mode:"readwrite"}); }catch(e){}
    if(perm!=="granted"){
      try{ perm=await h.requestPermission({mode:"readwrite"}); }catch(e){}
    }
    if(perm!=="granted") h=null;
  }
  if(!h){
    h=await window.showSaveFilePicker({
      suggestedName:suggestedName,
      types:[{description:"Excel", accept:{"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":[".xlsx"]}}]
    });
    try{ await idbSet(key,h); }catch(e){}
  }
  const w=await h.createWritable();
  await w.write(blob);
  await w.close();
  return h.name||suggestedName;
}

/* ============================ måndagspåminnelse ============================ */
function lastWeekKey(){
  const d=new Date(); d.setDate(d.getDate()-7);
  return wkey(d);
}
/* Vilka har inte skickat in förra veckan? Bara de som faktiskt har något att skicka. */
function pendingFor(wk){
  const weekEnd=weekDates(wk)[6];
  return S.employees.filter(function(e){
    /* den som anställdes efter veckan ska inte påminnas om den */
    if(e.createdAt && String(e.createdAt).slice(0,10) > weekEnd) return false;
    const ap=S.lwApprovals.find(a=>a.empId===e.id) || {status:"utkast"};
    if(ap.status==="inskickad"||ap.status==="godkand") return false;
    const st=weekStats(e.id, wk, S.everyMonth.length?S.everyMonth:S.months);
    return st.regDays>0 || st.missing.length>0;
  }).map(function(e){
    const st=weekStats(e.id, wk, S.everyMonth.length?S.everyMonth:S.months);
    const r=S.reminders.find(x=>x.empId===e.id && x.week===wk);
    return {emp:e, hours:st.worked, days:st.regDays, missing:st.missing.length,
            remindedAt:r?r.at:"", remindedBy:r?r.byName:""};
  });
}
function reminderText(emp, wk){
  const first=String(emp.name||"").split(" ")[0];
  return "Hej "+first+"! Din tidrapport för vecka "+wkNo(wk)+" är inte inskickad. "
       + "Gå in i "+cfg("appName")+", kontrollera dina timmar och tryck Skicka in vecka "+wkNo(wk)+". Tack!";
}
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent||"");
function mailLink(list, wk){
  const to=list.map(function(x){ return x.emp.email; }).filter(Boolean).join(",");
  const subject="Tidrapport vecka "+wkNo(wk)+" saknas";
  const body="Hej!\n\nDin tidrapport för vecka "+wkNo(wk)+" är inte inskickad än.\n"
    + "Gå in i "+cfg("appName")+", kontrollera dina timmar och tryck Skicka in vecka "+wkNo(wk)+".\n\nTack!\n";
  return "mailto:?bcc="+encodeURIComponent(to)+"&subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(body);
}
function smsLink(emp, wk){
  const num=String(emp.phone||"").replace(/[^\d+]/g,"");
  const txt=encodeURIComponent(reminderText(emp,wk));
  return "sms:"+num+(isIOS()?"&":"?")+"body="+txt;
}
async function markReminded(list, wk, channel){
  for(const x of list){
    const id=x.emp.id+"__"+wk;
    const body={empId:x.emp.id, empName:x.emp.name, week:wk, at:new Date().toISOString(),
                byName:S.me?S.me.name:"", channel:channel||"mejl"};
    try{
      await Store.set("reminders/"+id, body);
      const i=S.reminders.findIndex(r=>r.empId===x.emp.id&&r.week===wk);
      if(i>=0) S.reminders[i]=body; else S.reminders.push(body);
    }catch(e){ console.error(e); }
  }
}
async function loadReminderData(){
  const wk=lastWeekKey();
  try{
    await loadMonthsFor(weekMonths(wk));
    S.lwApprovals=await Store.list("approvals","week",wk);
    S.reminders=await Store.list("reminders","week",wk);
  }catch(e){ console.error(e); }
}
function remindModal(){
  const wk=lastWeekKey();
  const list=pendingFor(wk);
  const withMail=list.filter(x=>x.emp.email);
  const rows=list.map(function(x){
    const e=x.emp;
    return '<tr><td><b>'+esc(e.name)+'</b>'
      + '<div class="note">'+(e.email?esc(e.email):'<i>ingen e-post</i>')+(e.phone?' · '+esc(e.phone):'')+'</div></td>'
      + '<td class="r">'+fmt(x.hours)+' h</td>'
      + '<td class="r" style="white-space:nowrap">'+x.days+' d'+(x.missing?' · '+x.missing+' saknas':'')+'</td>'
      + '<td>'+(x.remindedAt?'<span class="pill">Påmind '+esc(String(x.remindedAt).slice(5,10))+'</span>':'<span class="note">—</span>')+'</td>'
      + '<td class="r" style="white-space:nowrap">'
      + (e.email?'<a class="btn sm" href="'+esc(mailLink([x],wk))+'" data-act="remone" data-e="'+esc(e.id)+'" data-ch="mejl">Mejla</a> ':'')
      + (e.phone?'<a class="btn sm" href="'+esc(smsLink(e,wk))+'" data-act="remone" data-e="'+esc(e.id)+'" data-ch="sms">Sms</a> ':'')
      + '<button class="btn sm ghost" data-act="remopen" data-e="'+esc(e.id)+'">Öppna</button>'
      + '</td></tr>';
  }).join("");
  openModal('<div class="mh"><div><span class="eyebrow">Vecka '+wkNo(wk)+' · '+esc(weekSpan(wk))+'</span>'
    + '<h3 style="margin-top:2px">'+(list.length?list.length+' har inte skickat in':'Alla har skickat in')+'</h3></div>'
    + '<button class="btn sm ghost" data-act="close">Stäng</button></div>'
    + '<div class="mb" style="padding:0">'
    + (list.length
        ? '<div class="tblwrap" style="border:0"><table class="tbl"><thead><tr><th>Anställd</th>'
          + '<th class="r">Rapporterat</th><th class="r">Dagar</th><th>Påminnelse</th><th></th></tr></thead>'
          + '<tbody>'+rows+'</tbody></table></div>'
          + '<p class="note" style="padding:12px 16px">Knapparna öppnar din vanliga mejl eller sms med texten färdigskriven – du trycker skicka. '
          + 'Saknas e-post eller mobil lägger du in det under Personal &amp; konton.</p>'
        : '<p class="note" style="padding:20px 16px">Ingen påminnelse behövs. Alla veckorapporter är inskickade eller attesterade.</p>')
    + '</div>'
    + '<div class="mf"><button class="btn" data-act="close">Stäng</button>'
    + (withMail.length?'<a class="btn primary" href="'+esc(mailLink(withMail,wk))+'" data-act="remall">Mejla alla '+withMail.length+'</a>':'')
    + '</div>');
}
/* Öppnar listan av sig själv en gång per dag i början av veckan. */
function maybeAutoRemind(){
  if(!isAdmin()) return;
  const day=isoDow(new Date());
  if(day>2) return;                       /* bara måndag–onsdag */
  if(!pendingFor(lastWeekKey()).length) return;
  const key="timmar:remind:"+dkey(new Date());
  try{
    if(localStorage.getItem(key)) return;
    localStorage.setItem(key,"1");
  }catch(e){}
  setTimeout(function(){ if(!inModal()) remindModal(); }, 900);
}
function remindBanner(){
  if(!isAdmin()) return "";
  const wk=lastWeekKey();
  const list=pendingFor(wk);
  if(!list.length) return "";
  const day=isoDow(new Date());
  const strong = day<=2;   /* måndag–onsdag */
  return '<div class="banner"><span class="eyebrow">Vecka '+wkNo(wk)+'</span>'
    + '<span>'+list.length+' '+(list.length===1?"anställd har":"anställda har")+' inte skickat in förra veckans tidrapport.'
    + (strong?' Veckan stänger på måndagen.':'')+'</span>'
    + '<button class="btn sm primary" style="margin-left:auto" data-act="remind">Påminn</button></div>';
}

/* ============================ daglig säkerhetskopia ============================ */
/* En gång per dygn tas en komplett kopia av allt i databasen: personal, projekt,
   tidrapporter, kostnader, attester, listor och inställningar. Kopian läggs i
   databasen under backups, och på er egen server om en sådan är inkopplad.
   Kopiorna sparas i 60 dagar, men den första kopian varje månad sparas för alltid.
   Kopian tas av den som är superadmin eller support, första gången någon av dem
   öppnar appen på dygnet. Ingen behöver komma ihåg något. */
const BACKUP_KEEP_DAYS = 60;
const BACKUP_CHUNK = 700000;
const BACKUP_COLLS = ["employees","projects","months","costs","approvals","archive","reminders","vehicles","trips","offers"];

async function snapshotAll(){
  const data={};
  for(const c of BACKUP_COLLS){
    try{
      const rows=await Store.list(c);
      /* själva excelfilerna i arkivet är stora och finns redan som filer –
         kopian tar med uppgifterna om dem, inte innehållet */
      /* mätarfotona i körjournalen är bilder och hör inte hemma i kopian –
         uppgifterna om resan följer med, bilderna gör det inte */
      if(c==="archive") data[c]=rows.map(function(r){ const o=Object.assign({},r); o.data=""; return o; });
      else if(c==="trips") data[c]=rows.map(function(r){ const o=Object.assign({},r); o.photoStart=""; o.photoEnd=""; return o; });
      else data[c]=rows;
    }catch(e){ console.error("backup: "+c, e); data[c]=[]; }
  }
  data.settings=[];
  for(const d of ["app","lists","offert"]){
    try{ const v=await Store.get("settings/"+d); if(v) data.settings.push(Object.assign({id:d}, v)); }catch(e){}
  }
  try{ const m=await Store.get("meta/app"); if(m) data.meta=m; }catch(e){}
  return data;
}
function backupCounts(data){
  const c={};
  Object.keys(data).forEach(function(k){ if(Array.isArray(data[k])) c[k]=data[k].length; });
  return c;
}
function backupText(snap, date){
  return JSON.stringify({app:cfg("appName","Ellingesmide"), version:APP_VERSION,
    date:date, takenAt:new Date().toISOString(),
    byName:S.me?S.me.name:"", project:(firebaseConfig&&firebaseConfig.projectId)||"",
    data:snap}, null, 0);
}
async function writeBackup(date, text, counts, forever){
  const parts=[];
  for(let i=0;i<text.length;i+=BACKUP_CHUNK) parts.push(text.slice(i,i+BACKUP_CHUNK));
  for(let i=0;i<parts.length;i++) await Store.set("backups/"+date+"-p"+i, {date:date, part:i, data:parts[i]});
  const head={id:date, date:date, parts:parts.length, size:text.length, counts:counts,
    createdAt:new Date().toISOString(), byName:S.me?S.me.name:"", keep:!!forever,
    synced:false, serverPath:"", version:APP_VERSION};
  if(SYNC_URL){
    try{
      const b64=btoa(unescape(encodeURIComponent(text)));
      const r=await syncCall("upload",{folder:"sakerhetskopior/"+date.slice(0,7), filename:"backup-"+date+".json", data:b64});
      head.synced=true; head.serverPath=(r&&r.path)||"";
    }catch(e){ console.error("backup upload", e); }
  }
  await Store.set("backups/"+date, head);
  return head;
}
async function readBackup(date, parts){
  let text="";
  for(let i=0;i<parts;i++){
    const p=await Store.get("backups/"+date+"-p"+i);
    if(!p) throw new Error("Del "+(i+1)+" av kopian saknas.");
    text+=p.data||"";
  }
  return text;
}
async function deleteBackup(head){
  for(let i=0;i<(head.parts||0);i++){ try{ await Store.del("backups/"+head.date+"-p"+i); }catch(e){} }
  await Store.del("backups/"+head.date);
}
async function pruneBackups(){
  const cut=new Date(); cut.setDate(cut.getDate()-BACKUP_KEEP_DAYS);
  const limit=dkey(cut);
  const old=S.backups.filter(function(b){ return !b.keep && String(b.date)<limit; });
  for(const b of old){ try{ await deleteBackup(b); }catch(e){ console.error(e); } }
  if(old.length) S.backups=S.backups.filter(function(b){ return old.indexOf(b)<0; });
}
const loadBackups = async () => {
  try{
    /* Bara listhuvudena – de har fältet "parts". Själva innehållet ligger i
       delarna (-p0, -p1 …) och hämtas först när någon återställer eller laddar
       ner. Förut hämtades allt, vilket blev ~30 MB vid varje start efter ett år. */
    const rows=await Store.listFrom("backups","parts",0);
    S.backups=rows.filter(function(r){ return r.parts!==undefined; })
                  .sort(function(a,b){ return String(b.date).localeCompare(String(a.date)); });
  }catch(e){ console.error(e); S.backups=[]; }
};
/* Tar dagens kopia om den inte redan är tagen. Körs i bakgrunden och får aldrig
   störa den som arbetar i appen – går något fel syns det bara i arkivet. */
async function runDailyBackup(force){
  if(!isAdmin() || S.backupRunning) return null;
  const date=dkey(new Date());
  S.backupRunning=true;
  if(S.tab==="arkiv") render();
  try{
    if(!force){
      const head=await Store.get("backups/"+date);
      if(head){ S.backupState={date:date, ok:true, msg:"Dagens kopia är redan tagen."}; return head; }
    }
    const snap=await snapshotAll();
    const text=backupText(snap, date);
    /* första kopian varje månad sparas för alltid */
    const forever = date.slice(8)==="01";
    const head=await writeBackup(date, text, backupCounts(snap), forever);
    const i=S.backups.findIndex(function(b){ return b.date===date; });
    if(i>=0) S.backups[i]=head; else S.backups.unshift(head);
    S.backupState={date:date, ok:true, msg:"Säkerhetskopia tagen "+date+"."};
    try{ await pruneBackups(); }catch(e){ console.error(e); }
    return head;
  }catch(e){
    console.error("backup", e);
    S.backupState={date:date, ok:false, msg:"Kunde inte ta säkerhetskopian: "+(e.message||e)};
    return null;
  }finally{ S.backupRunning=false; }
}

/* ============================ arkiv & filserver ============================ */
function blobToB64(blob){
  return new Promise(function(res,rej){
    const r=new FileReader();
    r.onload=function(){ res(String(r.result).split(",")[1]||""); };
    r.onerror=function(){ rej(r.error); };
    r.readAsDataURL(blob);
  });
}
function b64ToBlob(b64, type){
  const bin=atob(b64||"");
  const u=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
  return new Blob([u],{type:type||"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}
async function syncCall(action, payload){
  if(!SYNC_URL) return null;
  const res=await fetch(SYNC_URL,{
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify(Object.assign({token:SYNC_TOKEN, action:action}, payload||{}))
  });
  const j=await res.json();
  if(!j || !j.ok) throw new Error((j&&j.error)||"Servern svarade inte som väntat.");
  return j;
}
/* Sparar en uttagen fil i arkivet – i databasen, och på servern om den är inkopplad. */
async function archiveFile(meta, blob, filename){
  const b64=await blobToB64(blob);
  const big=b64.length>900000;
  const id=String(Date.now())+"-"+uid();
  const doc={
    id:id, kind:meta.kind||"vecka", label:meta.label||filename,
    period:meta.period||"", from:meta.from||"", to:meta.to||"",
    projectId:meta.projectId||"", projectName:meta.projectName||"",
    empId:meta.empId||"", empName:meta.empName||"",
    filename:filename, size:blob.size, createdAt:new Date().toISOString(),
    byId:S.me?S.me.id:"", byName:S.me?S.me.name:"",
    keep:false, stored:!big, data:"", synced:false, serverPath:""
  };
  /* Själva filen ligger för sig i archivedata/<id>. Listan i Arkiv hämtar då
     bara uppgifterna om filerna, inte innehållet – det hämtas vid nedladdning. */
  if(SYNC_URL){
    try{
      const folder=meta.kind==="projekt" ? ("projekt/"+(meta.projectKod||meta.projectId||"projekt"))
                 : meta.kind==="lon" ? ("loneunderlag/"+(meta.period||"").replace(/[^\w-]/g,""))
                                     : ("tidrapporter/"+(meta.period||"").replace(/[^\w-]/g,""));
      const r=await syncCall("upload",{folder:folder, filename:filename, data:b64});
      doc.synced=true; doc.serverPath=(r&&r.path)||"";
    }catch(e){ console.error(e); toast("Filen sparades i arkivet, men kunde inte läggas på servern."); }
  }
  try{
    if(!big) await Store.set("archivedata/"+id, {id:id, byId:doc.byId, data:b64});
    await Store.set("archive/"+id, doc);
    S.archive.unshift(doc);
  }catch(e){ console.error(e); toast("Kunde inte spara i arkivet."); }
  return doc;
}
const loadArchive = async () => {
  const rows=await Store.list("archive");
  S.archive=rows.sort(function(a,b){ return String(b.createdAt).localeCompare(String(a.createdAt)); });
  /* Äldre arkivposter har filen inbakad. Flytta ut den en gång, i bakgrunden,
     så att nästa öppning av Arkiv blir lätt. */
  if(isAdmin()) moveArchiveData().catch(function(e){ console.error("arkivflytt", e); });
};
let movingArchive=false;
async function moveArchiveData(){
  if(movingArchive) return;
  const todo=S.archive.filter(a=>a.data);
  if(!todo.length) return;
  movingArchive=true;
  try{
    for(const a of todo){
      await Store.set("archivedata/"+a.id, {id:a.id, byId:a.byId||"", data:a.data});
      const meta=Object.assign({}, a, {data:""}); delete meta._id;
      await Store.set("archive/"+a.id, meta);
      a.data="";
    }
  }finally{ movingArchive=false; }
}
/* Har projektet tid eller kostnader? Då får det aldrig tas bort, bara avslutas. */
function projectHasHistory(pid){
  const p=projById(pid);
  if(p && pStatus(p)==="avslutad") return true;
  try{ if(projectTotals(pid,null).hours>0) return true; }catch(e){ return true; }
  return (S.costs||[]).some(c=>c.projectId===pid);
}
/* Avslutade projekt, överst i arkivet. */
function archivedProjectsPanel(){
  const done=S.projects.filter(p=>pStatus(p)==="avslutad")
    .sort((a,b)=>String(b.archivedAt||"").localeCompare(String(a.archivedAt||"")));
  const rows=done.map(function(p){
    let h=0; try{ h=projectTotals(p.id,null).hours; }catch(e){}
    return '<tr><td><span class="code">'+esc(p.kod||"—")+'</span></td>'
      + '<td><b>'+esc(p.name)+'</b>'+(p.adress?'<div class="note">'+esc(p.adress)+'</div>':'')+'</td>'
      + '<td>'+esc(p.kund||"—")+'</td>'
      + '<td class="num">'+esc(p.archivedAt?String(p.archivedAt).slice(0,10):"—")+'</td>'
      + '<td>'+invSelect(p)+'</td>'
      + '<td class="r">'+fmt(h)+'</td>'
      + '<td class="r" style="white-space:nowrap"><button class="btn sm" data-act="openarkproj" data-p="'+esc(p.id)+'">Öppna</button> '
      + '<button class="btn sm ghost" data-act="editproj" data-p="'+esc(p.id)+'">Ändra</button></td></tr>';
  }).join("");
  return '<div class="panel" style="margin-bottom:16px"><div class="hd"><div><h3>Avslutade projekt</h3>'
    + '<span class="note">All tid, alla kostnader och all historik ligger kvar. Avslutade projekt kan inte tas bort. Sätt status Aktivt eller Vilande för att ta tillbaka ett projekt till listan.</span></div></div>'
    + '<div class="tblwrap" style="border:0"><table class="tbl"><thead><tr><th>Kod</th><th>Projekt</th><th>Kund</th><th>Avslutat</th><th>Faktura</th><th class="r">Timmar totalt</th><th></th></tr></thead>'
    + '<tbody>'+(rows||'<tr><td colspan="7" class="empty">Inga avslutade projekt ännu. När ett projekt får status Avslutat hamnar det här.</td></tr>')+'</tbody></table></div></div>';
}
function viewArkiv(){
  const f=S.arkFilter;
  const rows=S.archive.filter(function(a){ return f==="alla" || a.kind===f; });
  const list=rows.map(function(a){
    const when=String(a.createdAt).slice(0,16).replace("T"," ");
    return '<tr><td class="num">'+esc(when)+'</td>'
      + '<td><b>'+esc(a.label)+'</b><div class="note">'+esc(a.filename)+'</div></td>'
      + '<td>'+(a.kind==="projekt"?"Projekt":a.kind==="lon"?"Löneunderlag":"Tidrapport")+'</td>'
      + '<td>'+esc(a.projectName||a.empName||"—")+'</td>'
      + '<td class="r">'+Math.max(1,Math.round((a.size||0)/1024))+' kB</td>'
      + '<td>'+(a.synced?'<span class="pill">På servern</span>':'<span class="note">—</span>')+'</td>'
      + '<td>'+(a.keep?'<span class="pill solid">Låst</span>':'<span class="note">—</span>')+'</td>'
      + '<td class="r" style="white-space:nowrap">'
      + (a.stored?'<button class="btn sm" data-act="arkdl" data-a="'+esc(a.id)+'">Hämta</button> ':'')
      + '<button class="btn sm ghost" data-act="arkkeep" data-a="'+esc(a.id)+'">'+(a.keep?"Lås upp":"Behåll")+'</button> '
      + (a.keep?'':'<button class="btn sm ghost" data-act="arkdel" data-a="'+esc(a.id)+'">Ta bort</button>')
      + '</td></tr>';
  }).join("");
  const kept=S.archive.filter(a=>a.keep).length;
  return archivedProjectsPanel()
    + '<h3 style="margin:4px 0 10px">Sparade rapporter</h3>'
    + '<div class="bar">'
    + '<div class="seg" role="group" aria-label="Filter">'
    + '<button data-act="arkf" data-v="alla" aria-pressed="'+(f==="alla")+'">Alla</button>'
    + '<button data-act="arkf" data-v="vecka" aria-pressed="'+(f==="vecka")+'">Tidrapporter</button>'
    + '<button data-act="arkf" data-v="projekt" aria-pressed="'+(f==="projekt")+'">Projekt</button></div>'
    + '<span class="note" style="margin-left:auto">'+S.archive.length+' filer · '+kept+' låsta'
    + (SYNC_URL?' · server inkopplad':'')+'</span>'
    + (SYNC_URL?'<button class="btn" data-act="serverfiles">Filer på servern</button>':'')
    + '<button class="btn" data-act="arkpurge">Rensa olåsta äldre än 90 dagar</button></div>'
    + '<div class="tblwrap"><table class="tbl"><thead><tr><th>Uttagen</th><th>Rapport</th><th>Typ</th>'
    + '<th>Gäller</th><th class="r">Storlek</th><th>Server</th><th>Status</th><th></th></tr></thead>'
    + '<tbody>'+(list||'<tr><td colspan="8" class="empty">Inga sparade rapporter ännu. Varje gång du exporterar en vecka eller ett projekt hamnar filen här.</td></tr>')+'</tbody></table></div>'
    + '<p class="note" style="margin-top:10px">Filerna sparas som riktiga Excel-filer. Låsta filer går inte att ta bort av misstag och hoppas över när du rensar.'
    + (SYNC_URL?' Varje fil läggs också i mappstrukturen på er server.':' Kopplar du in en egen server i inställningsfilen läggs varje fil även där, i mappar per projekt och vecka.')+'</p>'
    + backupPanel();
}
/* ---- säkerhetskopiorna, längst ned i arkivet ---- */
function backupPanel(){
  const today=dkey(new Date());
  const last=S.backups[0];
  const okToday=!!S.backups.find(function(b){ return b.date===today; });
  const rows=S.backups.slice(0,40).map(function(b){
    const c=b.counts||{};
    const inneh=["employees","projects","months","costs"].map(function(k){
      const n=c[k]; if(n===undefined) return null;
      return n+" "+({employees:"personer",projects:"projekt",months:"tidrapporter",costs:"kostnader"})[k];
    }).filter(Boolean).join(" · ");
    return '<tr><td class="num">'+esc(b.date)+'</td>'
      + '<td><span class="note">'+esc(inneh||"—")+'</span></td>'
      + '<td class="r">'+Math.max(1,Math.round((b.size||0)/1024))+' kB</td>'
      + '<td>'+(b.synced?'<span class="pill">På servern</span>':'<span class="note">i databasen</span>')+'</td>'
      + '<td>'+(b.keep?'<span class="pill solid">Sparas alltid</span>':'<span class="note">'+BACKUP_KEEP_DAYS+' dagar</span>')+'</td>'
      + '<td class="r" style="white-space:nowrap">'
      + '<button class="btn sm" data-act="bkdl" data-b="'+esc(b.date)+'">Hämta</button> '
      + '<button class="btn sm ghost" data-act="bkkeep" data-b="'+esc(b.date)+'">'+(b.keep?"Släpp":"Spara alltid")+'</button> '
      + '<button class="btn sm ghost" data-act="bkrestore" data-b="'+esc(b.date)+'">Återställ</button>'
      + '</td></tr>';
  }).join("");
  return '<div class="panel" style="margin-top:22px">'
    + '<div class="hd"><div><h3>Säkerhetskopior</h3>'
    + '<span class="note">'+(okToday?'Dagens kopia är tagen':'Ingen kopia tagen i dag ännu')
    + (last?' · senaste '+esc(last.date):'')+'</span></div>'
    + '<button class="btn'+(S.backupRunning?"":" primary")+'" data-act="bknow"'+(S.backupRunning?" disabled":"")+'>'
    + (S.backupRunning?"Tar kopia…":"Ta en kopia nu")+'</button></div>'
    + (S.backupState&&!S.backupState.ok?'<div style="padding:12px 14px 0"><div class="err">'+esc(S.backupState.msg)+'</div></div>':'')
    + '<div class="tblwrap" style="border:0"><table class="tbl"><thead><tr><th>Dag</th><th>Innehåll</th>'
    + '<th class="r">Storlek</th><th>Var</th><th>Sparas</th><th></th></tr></thead>'
    + '<tbody>'+(rows||'<tr><td colspan="6" class="empty">Ingen kopia tagen ännu. Den första tas automatiskt nästa gång appen öppnas.</td></tr>')+'</tbody></table></div>'
    + '<div style="padding:12px 14px"><p class="note">Kopian tas automatiskt en gång per dygn, första gången en superadmin öppnar appen, och innehåller '
    + 'personal, projekt, alla tidrapporter, kostnader, attester, listor och inställningar. '
    + 'Den ligger kvar i '+BACKUP_KEEP_DAYS+' dagar, och den första kopian varje månad sparas för alltid. '
    + (SYNC_URL?'Varje kopia läggs också som en fil på er egen server.':'Kopplar du in en egen server i inställningsfilen läggs varje kopia även där, som en fil.')
    + '</p><p class="note" style="margin-top:6px"><b>Hämta</b> ger dig kopian som en fil du kan spara på datorn. '
    + '<b>Återställ</b> lägger tillbaka allt som stod i databasen den dagen – allt som lagts in senare skrivs över.</p></div>'
    + '</div>';
}
async function restoreBackup(date){
  const head=S.backups.find(function(b){ return b.date===date; });
  if(!head) return;
  toast("Läser säkerhetskopian…");
  let snap;
  try{
    const text=await readBackup(date, head.parts||0);
    snap=JSON.parse(text).data||{};
  }catch(e){ toast("Kunde inte läsa kopian: "+(e.message||e)); return; }
  let n=0;
  try{
    for(const c of BACKUP_COLLS){
      const rows=snap[c]||[];
      for(const r of rows){
        const id=r.id||r._id; if(!id) continue;
        const body=Object.assign({}, r); delete body._id;
        await Store.set(c+"/"+id, body); n++;
      }
    }
    for(const s of (snap.settings||[])){
      const body=Object.assign({}, s); const id=body.id; delete body.id; delete body._id;
      if(id) { await Store.set("settings/"+id, body); n++; }
    }
  }catch(e){ console.error(e); toast("Återställningen avbröts efter "+n+" poster: "+(e.message||e)); return; }
  toast(n+" poster är återställda från "+date+". Appen laddas om.");
  setTimeout(function(){ location.reload(); }, 1600);
}
async function serverFilesModal(){
  openModal('<div class="mh"><h3>Filer på servern</h3><button class="btn sm ghost" data-act="close">Stäng</button></div>'
    + '<div class="mb"><p class="note">Hämtar…</p></div>');
  let files=[];
  try{ const r=await syncCall("list",{}); files=(r&&r.files)||[]; }
  catch(e){
    openModal('<div class="mh"><h3>Filer på servern</h3><button class="btn sm ghost" data-act="close">Stäng</button></div>'
      + '<div class="mb"><div class="err">Kunde inte läsa från servern: '+esc(e.message)+'</div>'
      + '<p class="note" style="margin-top:10px">Kontrollera att sync.php ligger på plats och att adressen och det hemliga ordet stämmer i firebase-config.js.</p></div>'
      + '<div class="mf"><button class="btn" data-act="close">Stäng</button></div>');
    return;
  }
  const rows=files.map(function(f){
    return '<tr><td class="num">'+esc(String(f.modified||"").slice(0,16).replace("T"," "))+'</td>'
      + '<td>'+esc(f.path)+'</td><td class="r">'+Math.max(1,Math.round((f.size||0)/1024))+' kB</td>'
      + '<td class="r" style="white-space:nowrap">'
      + '<button class="btn sm" data-act="srvdl" data-f="'+esc(f.path)+'">Hämta</button> '
      + '<button class="btn sm" data-act="srvimport" data-f="'+esc(f.path)+'">Läs in kostnader</button></td></tr>';
  }).join("");
  openModal('<div class="mh"><div><span class="eyebrow">'+esc(SYNC_URL)+'</span><h3 style="margin-top:2px">Filer på servern</h3></div>'
    + '<button class="btn sm ghost" data-act="close">Stäng</button></div>'
    + '<div class="mb" style="padding:0"><div class="tblwrap" style="border:0"><table class="tbl">'
    + '<thead><tr><th>Ändrad</th><th>Fil</th><th class="r">Storlek</th><th></th></tr></thead>'
    + '<tbody>'+(rows||'<tr><td colspan="4" class="empty">Inga filer i mappen ännu.</td></tr>')+'</tbody></table></div></div>'
    + '<div class="mf"><button class="btn" data-act="close">Stäng</button></div>');
}
/* ---- Excel-biblioteket ----
   Ligger på den egna sajten (lib/) och laddas först när någon exporterar eller
   läser in en fil. Förut hämtades ~900 kB från en extern server vid varje start,
   också för arbetare som aldrig exporterar. */
let xlsxLoading=null;
function ensureXLSX(){
  if(window.XLSX) return Promise.resolve(true);
  if(!xlsxLoading){
    xlsxLoading=new Promise(function(res){
      const sc=document.createElement("script");
      sc.src="lib/xlsx.full.min.js";
      sc.onload=function(){ res(!!window.XLSX); };
      sc.onerror=function(){ xlsxLoading=null; res(false); };
      document.head.appendChild(sc);
    });
  }
  return xlsxLoading;
}
/* ---- läsa in kostnader från en Excel-fil ---- */
function parseCostSheet(ab){
  const wb=XLSX.read(ab,{type:"array"});
  const name=wb.SheetNames.indexOf("Kostnader")>=0?"Kostnader":wb.SheetNames[0];
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{defval:""});
  const pick=function(o,names){
    const keys=Object.keys(o);
    for(const n of names){
      const k=keys.find(function(x){ return String(x).toLowerCase().replace(/[^a-zåäö]/g,"")===n; });
      if(k!==undefined) return o[k];
    }
    return "";
  };
  const kindOf=function(v){
    const s=String(v||"").toLowerCase();
    if(s.indexOf("mil")===0) return "mil";
    if(s.indexOf("underlev")>=0) return "underlev";
    if(s.indexOf("utlägg")>=0||s.indexOf("utlagg")>=0) return "utlagg";
    if(s.indexOf("maskin")>=0||s.indexOf("hyra")>=0) return "maskin";
    return "material";
  };
  const out=[];
  rows.forEach(function(r){
    const desc=String(pick(r,["beskrivning","text","artikel"])||"").trim();
    const qty=parseHours(pick(r,["antal","mängd","mangd","kvantitet"]));
    const price=parseHours(pick(r,["àpris","apris","pris","styckpris","àprisk"]));
    let amount=parseHours(pick(r,["belopp","summa","kostnad"]));
    if(!desc) return;
    const q=isNaN(qty)?1:qty;
    const p=isNaN(price)?(isNaN(amount)?0:r2(amount/(q||1))):price;
    if(isNaN(amount)) amount=r2(q*p);
    let date=pick(r,["datum","date"]);
    if(typeof date==="number"){
      const d=new Date(Math.round((date-25569)*86400000));
      date=dkey(new Date(d.getFullYear(),d.getMonth(),d.getDate()));
    }else{
      date=String(date||"").slice(0,10);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) date=dkey(new Date());
    }
    out.push({kind:kindOf(pick(r,["typ","kategori","slag"])), date:date, desc:desc,
      supplier:String(pick(r,["leverantör","leverantor","företag","foretag"])||"").trim(),
      qty:r2(q), unitPrice:r2(p), amount:r2(amount)});
  });
  return out;
}
function importModal(pid, rows, source){
  const p=projById(pid);
  const sum=rows.reduce(function(a,r){ return a+(+r.amount||0); },0);
  const list=rows.slice(0,40).map(function(r,i){
    return '<tr><td class="num">'+esc(r.date)+'</td><td>'+esc(costOf(r.kind).label)+'</td>'
      + '<td>'+esc(r.desc)+'</td><td class="r">'+fmt(r.qty)+'</td><td class="r">'+fmt(r.unitPrice)+'</td>'
      + '<td class="r">'+fmt(r.amount)+'</td></tr>';
  }).join("");
  S.importRows=rows; S.importPid=pid;
  openModal('<div class="mh"><div><span class="eyebrow">'+esc(source)+'</span>'
    + '<h3 style="margin-top:2px">Läs in '+rows.length+' kostnadsrader</h3></div>'
    + '<button class="btn sm ghost" data-act="close">Stäng</button></div>'
    + '<div class="mb" style="padding:0">'
    + '<div style="padding:12px 16px"><label class="fld"><span class="eyebrow">Lägg raderna på projekt</span>'
    + '<select id="im-proj">'+S.projects.map(function(x){ return '<option value="'+x.id+'"'+(x.id===pid?" selected":"")+'>'+esc((x.kod?x.kod+" · ":"")+x.name)+'</option>'; }).join("")+'</select></label></div>'
    + '<div class="tblwrap" style="border:0;max-height:300px"><table class="tbl">'
    + '<thead><tr><th>Datum</th><th>Typ</th><th>Beskrivning</th><th class="r">Antal</th><th class="r">À-pris</th><th class="r">Belopp</th></tr></thead>'
    + '<tbody>'+(list||'<tr><td colspan="6" class="empty">Hittade inga rader med beskrivning och belopp.</td></tr>')+'</tbody></table></div>'
    + '<p class="note" style="padding:10px 16px">Summa '+kr(sum)+(rows.length>40?" · visar de 40 första":"")+'. Inget skrivs förrän du trycker Lägg till.</p>'
    + '</div>'
    + '<div class="mf"><button class="btn" data-act="close">Avbryt</button>'
    + '<button class="btn primary" data-act="doimport"'+(rows.length?"":" disabled")+'>Lägg till '+rows.length+' rader</button></div>');
}

/* ============================ support ============================ */
function supportBar(){
  return '<div class="supportbar">'
    + '<span class="note">'+esc(cfg("appName"))+' '+APP_VERSION+'</span><span class="dotsep">·</span>'
    + '<button class="lnk" data-act="support">'+esc(cfg("supportLabel"))+'</button>'
    + '</div>';
}
function supportModal(msg, ok){
  const me=S.me||{};
  return openModal('<div class="mh"><div><span class="eyebrow">Support</span>'
    + '<h3 style="margin-top:2px">Be om hjälp</h3></div>'
    + '<button class="btn sm ghost" data-act="close">Stäng</button></div>'
    + '<div class="mb"><div class="stack">'
    + '<p class="note">Beskriv vad som händer så återkommer vi. Vi ser automatiskt vilken sida du var på.</p>'
    + '<label class="fld"><span class="eyebrow">Ditt namn</span><input id="sp-name" type="text" value="'+esc(me.name||"")+'"></label>'
    + '<label class="fld"><span class="eyebrow">Så når vi dig (telefon eller mejl)</span><input id="sp-contact" type="text" placeholder="070-123 45 67"></label>'
    + '<label class="fld"><span class="eyebrow">Vad gäller det?</span><textarea id="sp-msg" rows="5" placeholder="T.ex. Jag kan inte skicka in vecka 38"></textarea></label>'
    + (msg?'<div class="err">'+esc(msg)+'</div>':'')
    + (ok?'<div class="err"><b>Tack!</b> Förfrågan är skickad.</div>':'')
    + '</div></div>'
    + '<div class="mf"><button class="btn" data-act="close">Avbryt</button>'
    + '<button class="btn primary" data-act="sendsupport"'+(S.busy?" disabled":"")+'>'+(S.busy?"Skickar…":"Skicka")+'</button></div>', function(){
      const t=document.getElementById("sp-msg"); if(t) t.focus();
    });
}
async function sendSupport(){
  const name=(document.getElementById("sp-name").value||"").trim();
  const contact=(document.getElementById("sp-contact").value||"").trim();
  const message=(document.getElementById("sp-msg").value||"").trim();
  if(message.length<5){ supportModal("Skriv några ord om vad som hänt.",""); return; }
  const sid=String(Date.now())+"-"+uid();
  const payload={
    id:sid, done:false,
    name:name||"(namn saknas)", contact:contact, message:message,
    page:S.tab+(S.projSel?" / projekt":""), role:(S.me&&S.me.role)||"okänd",
    account:(S.me&&S.me.username)||"", project:firebaseConfig.projectId||"",
    app:cfg("appName","Ellingesmide"), version:APP_VERSION, at:new Date().toISOString(),
    agent:(navigator.userAgent||"").slice(0,180)
  };
  S.busy=true; supportModal("","");
  let stored=false, mailed=false;
  try{ await Store.set("support/"+sid, payload); stored=true; }catch(e){ console.error(e); }
  if(SUPPORT_KEY){
    try{
      const res=await fetch(SUPPORT_ENDPOINT,{
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify(Object.assign({access_key:SUPPORT_KEY, subject:cfg("appName")+" – supportförfrågan från "+payload.name}, payload))
      });
      mailed=res.ok;
    }catch(e){ console.error(e); }
  }
  S.busy=false;
  if(stored||mailed){
    const seq=supportModal("", "ok");
    /* stäng bara om det fortfarande är den här dialogen som står öppen */
    setTimeout(function(){ if(modalSeq===seq) closeModal(); }, 1800);
  }
  else supportModal("Kunde inte skicka just nu. Kontrollera nätet och försök igen.","");
}

/* ============================ inloggning & uppstart ============================ */
function viewSetup(){
  return '<div class="setup">'
    + '<div class="brand" style="margin-bottom:18px"><span class="dot"></span><h1>'+esc(cfg("appName"))+'</h1></div>'
    + '<div class="panel" style="padding:20px">'
    + '<span class="eyebrow">Ett steg kvar</span>'
    + '<h2 style="font-size:22px;margin:6px 0 8px">Appen är inte kopplad till någon databas ännu</h2>'
    + '<p class="note">Öppna filen <code>firebase-config.js</code> och klistra in konfigurationen från ditt Firebase-projekt. Ladda sedan upp filerna igen. Hela gången beskrivs i installationsguiden du fick tillsammans med appen.</p>'
    + '<div class="steps" style="margin-top:14px">'
    + '<div class="step"><span class="n">01</span><div><b>Skapa ett Firebase-projekt</b><p class="note">console.firebase.google.com → Add project. Gratisnivån räcker.</p></div></div>'
    + '<div class="step"><span class="n">02</span><div><b>Slå på Authentication</b><p class="note">Build → Authentication → Sign-in method → E-post/lösenord → Enable.</p></div></div>'
    + '<div class="step"><span class="n">03</span><div><b>Skapa databasen</b><p class="note">Build → Firestore Database → Create database → region europe-north1 (Finland).</p></div></div>'
    + '<div class="step"><span class="n">04</span><div><b>Klistra in säkerhetsreglerna</b><p class="note">Firestore → Rules → klistra in innehållet i filen firestore.rules → Publish.</p></div></div>'
    + '<div class="step"><span class="n">05</span><div><b>Kopiera konfigurationen</b><p class="note">Project settings → Your apps → Web app → Config, och in i firebase-config.js.</p></div></div>'
    + '</div></div></div>';
}
function viewLogin(){
  return '<div class="login"><span class="watermark" aria-hidden="true"></span><div class="loginbox">'
    + '<div class="loginbrand"><span class="logo-full" role="img" aria-label="'+esc(cfg("appName"))+'"></span></div>'
    + '<div class="panel">'
    + '<h3 style="font-size:18px">Logga in</h3>'
    + '<p class="note" style="margin:4px 0 14px">'+esc(cfg("loginHelp"))+'</p>'
    + '<div class="stack">'
    + '<label class="fld"><span class="eyebrow">Kontonamn</span>'
    + '<input id="l-user" type="text" autocapitalize="none" autocomplete="username" spellcheck="false"></label>'
    + '<label class="fld"><span class="eyebrow">Lösenord</span>'
    + '<input id="l-pw" type="password" autocomplete="current-password"></label>'
    + '<label class="check"><input id="l-keep" type="checkbox"><span>Håll mig inloggad på den här telefonen</span></label>'
    + '<button class="btn primary block" data-act="login"'+(S.busy?" disabled":"")+'>'+(S.busy?"Loggar in…":"Logga in")+'</button>'
    + '<button class="lnk" data-act="forgot" style="align-self:center">Glömt lösenord?</button>'
    + '</div>'
    + (S.loginErr?'<div class="err">'+esc(S.loginErr)+'</div>':'')
    + (S.dbErr?'<div class="err"><b>Appen når inte databasen.</b><br>Vanligaste orsaken: säkerhetsreglerna är inte publicerade i Firestore, '
      + 'eller så saknas adressen under Authentication → Settings → Authorized domains i Firebase. '
      + 'Felkod: '+esc(S.dbErr)+'</div>':'')
    + '</div>'
    + (!S.metaExists?'<div class="panel" style="margin-top:12px;padding:16px">'
      + '<span class="eyebrow">Första gången</span>'
      + '<p class="note" style="margin:4px 0 10px">Finns det inget konto ännu? Skapa firmans superadmin här.</p>'
      + '<button class="btn block" data-act="goonboarding">Skapa superadmin-kontot</button></div>':'')
    + (S.installEvt?'<button class="btn block" style="margin-top:12px" data-act="install">Installera '+esc(cfg("appName"))+' på hemskärmen</button>':'')
    + '</div></div>';
}
function viewFixup(){
  const u=S.pendingUser||{};
  const localPart=String(u.email||"").split("@")[0]||"admin";
  const code=S.fixErr;
  let diag, hint;
  if(code==="no-profile"){
    diag="Inloggningen fungerar, men kontot saknar profil i databasen.";
    hint="Det händer om uppsättningen avbröts halvvägs – kontot hann skapas men profilen inte sparas. Är du firmans superadmin: tryck på knappen nedan så skapas den nu. Är du montör har din profil tagits bort – kontakta din arbetsledare.";
  }else if(code==="permission-denied"){
    diag="Databasen nekar åtkomst.";
    hint="Säkerhetsreglerna är med största sannolikhet inte publicerade. Gå till Firestore Database → Rules i Firebase, klistra in reglerna från guiden och tryck Publish. Kom tillbaka hit och tryck Försök igen.";
  }else if(code==="unavailable"||code==="failed-precondition"){
    diag="Databasen svarar inte.";
    hint="Gå igenom i tur och ordning: 1) Är Firestore Database verkligen skapad i projektet? Det räcker inte att Authentication är på. "
       + "2) Heter databasen (default) och är av typen Native mode – inte Datastore mode? 3) Har du precis skapat den, vänta en minut och tryck Försök igen. "
       + "4) Prova en annan webbläsare, utan privat läge och utan annonsblockerare – de stoppar ibland trafiken till Google.";
  }else if(code==="not-found"){
    diag="Hittar ingen databas i projektet.";
    hint="Projektets id i firebase-config.js pekar på ett projekt där Firestore inte är skapad. Skapa databasen, eller kontrollera att projectId stämmer.";
  }else{
    diag="Kunde inte hämta din profil.";
    hint="Kontrollera att Firestore är skapad och att säkerhetsreglerna är publicerade. Felkoden nedan säger vad databasen svarade.";
  }
  return '<div class="login"><div class="loginbox">'
    + '<div class="brand"><span class="dot"></span><h1>'+esc(cfg("appName"))+'</h1><span class="eyebrow">Nästan klart</span></div>'
    + '<div class="panel">'
    + '<h3 style="font-size:18px">'+esc(diag)+'</h3>'
    + '<p class="note" style="margin:6px 0 14px">'+esc(hint)+'</p>'
    + (code==="no-profile"||code==="permission-denied"
        ? '<div class="stack">'
          + '<label class="fld"><span class="eyebrow">Ditt namn</span>'
          + '<input id="fx-name" type="text" value="'+esc(localPart)+'"></label>'
          + '<button class="btn primary block" data-act="repairprofile"'+(S.busy?" disabled":"")+'>'
          + (S.busy?"Skapar…":"Skapa min profil som superadmin")+'</button></div>'
        : '')
    + '<div class="stack" style="margin-top:10px">'
    + '<button class="btn block" data-act="retryprofile">Försök igen</button>'
    + '<button class="btn ghost block" data-act="logout">Logga ut</button></div>'
    + (S.fixMsg?'<div class="err">'+esc(S.fixMsg)+'</div>':'')
    + '<p class="note" style="margin-top:14px"><b>Teknisk information</b><br>'
    + 'Felkod: <code>'+esc(code)+'</code><br>'
    + 'Projekt: <code>'+esc(firebaseConfig.projectId||"saknas")+'</code><br>'
    + 'Konto: <code>'+esc(u.email||"okänt")+'</code><br>'
    + 'Id: <code>'+esc(u.uid||"okänt")+'</code>'
    + (S.fixRaw?'<br>Svar: <code>'+esc(S.fixRaw)+'</code>':'')+'</p>'
    + '</div></div></div>';
}
function viewOnboarding(){
  return '<div class="login"><div class="loginbox">'
    + '<div class="brand"><span class="dot"></span><h1>'+esc(cfg("appName"))+'</h1></div>'
    + '<div class="panel">'
    + '<span class="eyebrow">Första gången</span>'
    + '<h3 style="font-size:18px;margin-top:4px">Skapa superadmin-kontot</h3>'
    + '<p class="note" style="margin:4px 0 14px">Uppgifterna nedan är förifyllda – tryck bara på knappen, eller ändra dem först. '
    + 'Skriv upp kontonamn och lösenord, det är dem du loggar in med.</p>'
    + '<div class="stack">'
    + '<label class="fld"><span class="eyebrow">Ditt namn</span><input id="o-name" type="text" value="Andy Miftari"></label>'
    + '<label class="fld"><span class="eyebrow">Kontonamn</span><input id="o-user" type="text" autocapitalize="none" spellcheck="false" value="admin"></label>'
    + '<label class="fld"><span class="eyebrow">Lösenord (minst 6 tecken)</span>'
    + '<input id="o-pw" type="text" autocapitalize="none" spellcheck="false" autocomplete="off" value="Smide2026"></label>'
    + '<label class="check"><input id="o-demo" type="checkbox" checked><span>Lägg till tre exempelprojekt att utgå från</span></label>'
    + '<button class="btn primary block" data-act="setupadmin"'+(S.busy?" disabled":"")+'>'+(S.busy?"Skapar…":"Skapa konto och starta")+'</button>'
    + '</div>'
    + (S.loginErr?'<div class="err">'+esc(S.loginErr)+'</div>':'')
    + (S.dbErr?'<div class="err"><b>Appen når inte databasen.</b><br>Kontrollera att säkerhetsreglerna är publicerade i Firestore och att adressen ligger under Authorized domains i Firebase. Felkod: '+esc(S.dbErr)+'</div>':'')
    + '</div>'
    + (S.metaExists?'<button class="btn block" style="margin-top:12px" data-act="gologin">‹ Tillbaka till inloggning</button>':'')
    + '</div></div>';
}

/* ============================ kalkyl / offert ============================ */
/* Bara superadmin och support. Man klistrar in kundens mejl som underlag,
   fyller i arbete, material (inköpspris + påslag) och resor, och appen
   räknar fram offerten med moms. Ut kommer en PDF och en färdig mejltext.
   Kunden ser bara försäljningspriser – aldrig inköpspris eller påslag. */
const OFFER_STATUS = {utkast:"Utkast", skickad:"Skickad", accepterad:"Accepterad", nekad:"Nekad"};
const OFFER_KINDS = [["arbete","Arbete","tim"],["material","Material","st"],["resa","Resor","mil"]];
const FIRM_DEFAULTS = {name:"Ellinge Smidesservice AB", address:"", zip:"", city:"", phone:"", email:"", web:"",
  orgnr:"", vatnr:"", bankgiro:"", fskatt:true, payTerms:"30 dagar netto", validDays:30,
  rate:0, markup:15, milPrice:0, terms:"", signature:"", workshop:"", aiHints:""};
const firm = () => Object.assign({}, FIRM_DEFAULTS, S.firm||{});
const addDays = (ds, n) => { const d=fromKey(ds); d.setDate(d.getDate()+(+n||0)); return dkey(d); };
const numIn = v => { const n=parseHours(String(v==null?"":v)); return isNaN(n)?0:n; };
const numOut = n => (+n||0) ? String(r2(n)).replace(".",",") : "";

async function loadOffers(){
  S.offers=(await Store.list("offers")).sort((a,b)=>String(b.nr||"").localeCompare(String(a.nr||"")));
  try{ S.firm=(await Store.get("settings/offert"))||{}; }catch(e){ S.firm={}; }
  try{ S.aiKnow=Object.assign({prices:[], norms:[], rules:""}, (await Store.get("settings/aikunskap"))||{}); }
  catch(e){ S.aiKnow={prices:[], norms:[], rules:""}; }
  try{ S.aiExamples=(await Store.list("aiexempel")).sort((a,b)=>String(b.at).localeCompare(String(a.at))); }
  catch(e){ S.aiExamples=[]; }
  try{ S.aiFiles=(await Store.list("aifiles")).sort((a,b)=>String(a.at).localeCompare(String(b.at))); }
  catch(e){ S.aiFiles=[]; }
}
function nextOfferNr(){
  const y=String(new Date().getFullYear());
  const max=(S.offers||[]).reduce(function(m,o){
    const p=String(o.nr||"").split("-"); return p[0]===y ? Math.max(m, +p[1]||0) : m;
  },0);
  return y+"-"+String(max+1).padStart(3,"0");
}
function newOffer(){
  const f=firm(), today=dkey(new Date());
  return {id:"", nr:nextOfferNr(), status:"utkast", date:today, validDays:+f.validDays||30,
    title:"", intro:"", mail:"", terms:f.terms||"", ref:S.me?S.me.name:"",
    customer:{name:"", contact:"", address:"", email:"", phone:""},
    rows:[{kind:"arbete", desc:"", qty:0, unit:"tim", price:+f.rate||0}],
    mailText:"", mailEdited:false};
}
/* Räknar ut varje rad och summorna. Material: à-pris = inköpspris + påslag. */
function offerCalc(o){
  const vat=25;   /* Moms på offerter är alltid 25 %. */
  const rows=(o.rows||[]).map(function(r){
    const qty=+r.qty||0;
    const unitPrice = r.kind==="material" ? r2((+r.cost||0)*(1+(+r.markup||0)/100)) : r2(+r.price||0);
    return Object.assign({}, r, {qty:qty, unitPrice:unitPrice, amount:r2(qty*unitPrice)});
  });
  const by=k=>r2(rows.filter(r=>r.kind===k).reduce((a,r)=>a+r.amount,0));
  const net=r2(rows.reduce((a,r)=>a+r.amount,0));
  const matCost=r2(rows.filter(r=>r.kind==="material").reduce((a,r)=>a+(+r.qty||0)*(+r.cost||0),0));
  const hours=r2(rows.filter(r=>r.kind==="arbete").reduce((a,r)=>a+(+r.qty||0),0));
  const v=r2(net*vat/100);
  return {rows:rows, sums:{arbete:by("arbete"), material:by("material"), resa:by("resa"),
    net:net, vat:v, gross:r2(net+v), vatRate:vat, matCost:matCost, matMarkup:r2(by("material")-matCost), hours:hours},
    validTo:addDays(o.date||dkey(new Date()), o.validDays||30)};
}
function offerSubject(o){ return "Offert "+(o.nr||"")+(o.title?" – "+o.title:""); }
function offerMailText(o){
  const f=firm(), c=offerCalc(o), cu=o.customer||{};
  const first=String(cu.contact||"").trim().split(/\s+/)[0] || "";
  const kr2=v=>nf.format(r2(v)).replace(/ /g," ")+" kr";
  return "Hej"+(first?" "+first:"")+",\n\n"
    + "Tack för din förfrågan. Här kommer vår offert"+(o.title?" på "+o.title.charAt(0).toLowerCase()+o.title.slice(1):"")+".\n\n"
    + "Totalt "+kr2(c.sums.gross)+" inklusive moms ("+kr2(c.sums.net)+" exklusive moms). "
    + "Offerten gäller till och med "+c.validTo+".\n\n"
    + "Hela offerten med alla poster finns i den bifogade PDF-filen. Hör gärna av dig om du har frågor "
    + "eller vill att vi justerar något.\n\n"
    + "Med vänliga hälsningar\n"
    + [f.signature||(S.me?S.me.name:""), f.name, f.phone, f.email].filter(Boolean).join("\n");
}
/* Plockar ut e-post, telefon, namn och adress ur ett inklistrat mejl.
   Fyller bara i fält som är tomma – det man skrivit själv skrivs aldrig över. */
function parseCustomerMail(text){
  const t=String(text||""), f=firm(), out={};
  const own=String(f.email||"").toLowerCase();
  const from=t.match(/^(?:Från|From|Avsändare)\s*:\s*"?([^"<\n]+?)"?\s*<([^>\s]+@[^>\s]+)>/mi);
  if(from){ out.contact=from[1].trim(); out.email=from[2].trim(); }
  if(!out.email){
    const mails=(t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)||[]).filter(m=>m.toLowerCase()!==own);
    if(mails.length) out.email=mails[0];
  }
  const tel=t.match(/(?:\+46|0)\s?\d{1,3}[\s-]?\d{2,3}[\s-]?\d{2}[\s-]?\d{2,3}/);
  if(tel) out.phone=tel[0].trim();
  const lines=t.split(/\r?\n/).map(s=>s.trim());
  const zi=lines.findIndex(s=>/^\d{3}\s?\d{2}\s+\p{L}/u.test(s));
  if(zi>0 && lines[zi-1] && /\d/.test(lines[zi-1])) out.address=lines[zi-1]+"\n"+lines[zi];
  if(!out.contact){
    const gi=lines.findIndex(s=>/^(mvh|med vänlig(a)? hälsning(ar)?|vänliga hälsningar|hälsningar|tack på förhand)[,.!]?$/i.test(s));
    if(gi>=0){ const nm=lines.slice(gi+1).find(Boolean); if(nm && nm.length<50 && !/@|\d{3}/.test(nm)) out.contact=nm; }
  }
  return out;
}

function viewKalkyl(){
  if(S.offSel==="learn") return viewAiLearn();
  if(S.offSel) return viewOffer();
  const f=firm(), list=S.offers||[];
  const saknas=!f.orgnr||!f.bankgiro;
  const rows=list.map(function(o){
    const c=offerCalc(o);
    return '<tr class="click" data-act="offopen" data-o="'+esc(o.id)+'"><td class="r">'+esc(o.nr)+'</td>'
      + '<td>'+esc((o.customer||{}).name||"—")+'</td><td>'+esc(o.title||"—")+'</td>'
      + '<td class="r">'+esc(kr(c.sums.gross))+'</td>'
      + '<td><span class="pill'+(o.status==="accepterad"?" solid":o.status==="utkast"?" dash":"")+'">'+esc(OFFER_STATUS[o.status]||o.status)+'</span></td>'
      + '<td class="r">'+esc(o.date||"")+'</td></tr>';
  }).join("");
  return '<div class="bar"><span class="note">Klistra in kundens mejl, fyll i arbete, material och resor – appen räknar '
    + 'fram offerten med moms och gör en PDF och en färdig mejltext.</span>'
    + '<button class="btn primary" style="margin-left:auto" data-act="offnew">Ny offert</button>'
    + '<button class="btn" data-act="offlearn">Lär upp AI:n</button>'
    + '<button class="btn" data-act="offfirm">Firmauppgifter</button></div>'
    + (saknas?'<div class="panel" style="padding:12px 14px;margin-bottom:14px"><b>Fyll i firmauppgifterna först.</b> '
      + '<span class="note">Organisationsnummer, bankgiro, adress och telefon står längst ner på varje offert. '
      + 'Tryck på <b>Firmauppgifter</b>.</span></div>':'')
    + (list.length
      ? '<div class="tblwrap"><table class="tbl"><thead><tr><th class="r">Nr</th><th>Kund</th><th>Avser</th>'
        + '<th class="r">Inkl. moms</th><th>Status</th><th class="r">Datum</th></tr></thead><tbody>'+rows+'</tbody></table></div>'
      : '<div class="panel" style="padding:18px"><p class="note">Inga offerter ännu. Tryck på <b>Ny offert</b>.</p></div>');
}
function offRowHtml(r, i){
  const id="k-r"+i;
  const LBL={desc:"Beskrivning",qty:r.kind==="arbete"?"Timmar":"Antal",unit:"Enhet",cost:"Inköpspris",markup:"Påslag %",price:"À-pris"};
  const inp=(f,v,w,ph,mode)=>'<td data-l="'+LBL[f]+'" class="k-'+f+'"'+(w?' style="width:'+w+'px"':'')+'><input id="'+id+'-'+f+'" type="text"'
    +(mode?' inputmode="decimal"':'')+' value="'+esc(v)+'"'+(ph?' placeholder="'+esc(ph)+'"':'')+'></td>';
  let h='<tr>'+inp("desc",r.desc||"",0,r.kind==="arbete"?"T.ex. tillverkning och svetsning":r.kind==="material"?"T.ex. plattstång 50×5":"T.ex. resor till arbetsplatsen")
    + inp("qty",numOut(r.qty),80,"0",1) + inp("unit",r.unit||"",70);
  if(r.kind==="material") h+=inp("cost",numOut(r.cost),100,"inköp",1)+inp("markup",numOut(r.markup),70,"%",1);
  else h+=inp("price",numOut(r.price),100,"à-pris",1);
  h+='<td class="r k-amt" id="'+id+'-amt" style="width:120px">'+esc(kr2(0))+'</td>'
    + '<td class="r k-del" style="width:60px"><button class="btn sm ghost" data-act="offrowdel" data-i="'+i+'" aria-label="Ta bort raden">✕</button></td></tr>';
  return h;
}
const kr2 = v => nf.format(r2(v))+" kr";
/* AI-kalkylens underlag: bara för den som gör offerten, kommer aldrig med i PDF:en. */
function aiPanel(o){
  const a=o.ai; if(!a) return "";
  const list=(h,arr,ol)=>arr&&arr.length?'<h4 style="margin:10px 0 4px">'+h+'</h4><'+(ol?'ol':'ul')+' style="margin:0;padding-left:20px">'
    + arr.map(x=>'<li>'+esc(x)+'</li>').join("")+'</'+(ol?'ol':'ul')+'>':"";
  const src=(a.sources||[]).length?'<h4 style="margin:10px 0 4px">Priskällor</h4><ul style="margin:0;padding-left:20px">'
    + a.sources.map(s=>'<li>'+esc(s.desc)+': '+esc(s.source)+(s.estimated?' <b>(uppskattat)</b>':'')+'</li>').join("")+'</ul>':"";
  return '<div class="panel" style="padding:14px;margin-bottom:14px"><div class="hd" style="padding:0;border:0">'
    + '<div><span class="eyebrow">Bara för dig – kommer inte med i offerten</span><h3 style="margin-top:2px">AI-kalkylens underlag</h3></div>'
    + '<span class="pill'+(a.confidence==="hög"?" solid":a.confidence==="låg"?" dash":"")+'" style="margin-left:auto">Säkerhet: '+esc(a.confidence||"–")+'</span></div>'
    + '<p style="margin:8px 0 0">'+esc(a.summary||"")+'</p>'
    + (a.sanity?'<p class="note" style="margin:6px 0 0"><b>Rimlighet:</b> '+esc(a.sanity)+'</p>':'')
    + list("Antaganden",a.assumptions,true) + list("Frågor till kunden",a.questions,true) + list("Risker",a.risks,false) + src
    + '<p class="note" style="margin-top:10px">Räknad '+esc(a.at||"")+'. Kontrollera priser märkta uppskattat innan offerten skickas.</p></div>';
}
/* Skickar förfrågan till /api/kalkyl och läser svaret rad för rad. */
async function runAiKalkyl(o){
  const f=firm();
  const user=auth.currentUser;
  if(!user) throw new Error("Du är inte inloggad.");
  const token=await user.getIdToken();
  const att=await aiFilesPayload(o);
  if(att.skipped.length) toast("För mycket att skicka på en gång – hoppar över: "+att.skipped.join(", "));
  const res=await fetch("api/kalkyl", {method:"POST",
    headers:{"content-type":"application/json", authorization:"Bearer "+token},
    body:JSON.stringify({mail:o.mail, today:dkey(new Date()), firm:{name:f.name, address:f.address, zip:f.zip, city:f.city,
      workshop:f.workshop, rate:f.rate, markup:f.markup, milPrice:f.milPrice, validDays:f.validDays, payTerms:f.payTerms, aiHints:f.aiHints},
      knowledge:knowledgeText(o.mail), files:att.files, attachText:att.attachText})});
  const ct=res.headers.get("content-type")||"";
  if(!res.ok || !/ndjson/.test(ct)){
    let msg="AI-kalkylen svarade inte ("+res.status+").";
    try{ const j=await res.json(); if(j.error) msg=j.error; }catch(e){}
    if(res.status===404) msg="AI-kalkylen finns inte på servern ännu.";
    throw new Error(msg);
  }
  const reader=res.body.getReader(), dec=new TextDecoder();
  let buf="", result=null;
  for(;;){
    const {value, done}=await reader.read();
    if(value) buf+=dec.decode(value, {stream:true});
    let i;
    while((i=buf.indexOf("\n"))>=0){
      const line=buf.slice(0,i).trim(); buf=buf.slice(i+1);
      if(!line) continue;
      let m; try{ m=JSON.parse(line); }catch(e){ continue; }
      if(m.error) throw new Error(m.error);
      if(m.result) result=m.result;
      if(m.status){ S.aiStatus=m.status; const el=document.getElementById("k-ai-status"); if(el) el.textContent=m.status; }
    }
    if(done) break;
  }
  if(!result) throw new Error("AI-kalkylen avbröts innan den blev klar. Försök igen.");
  return result;
}
/* För in AI:ns kalkyl i offerten. Kunduppgifter fylls bara i där fälten är tomma. */
function applyAiKalkyl(o, r){
  const cu=o.customer=o.customer||{};
  ["name","contact","address","email","phone"].forEach(function(k){
    const v=String(((r.customer||{})[k])||"").trim();
    if(v && v.toLowerCase()!=="saknas" && !String(cu[k]||"").trim()) cu[k]=v;
  });
  if(r.title) o.title=r.title;
  if(r.intro) o.intro=r.intro;
  const rows=[];
  (r.work||[]).forEach(w=>rows.push({kind:"arbete", desc:w.desc||"", qty:+w.hours||0, unit:"tim", price:+w.price||0}));
  (r.material||[]).forEach(m=>rows.push({kind:"material", desc:m.desc||"", qty:+m.qty||0, unit:m.unit||"st", cost:+m.cost||0, markup:+m.markup||0}));
  (r.travel||[]).forEach(t=>rows.push({kind:"resa", desc:t.desc||"", qty:+t.mil||0, unit:"mil", price:+t.price||0}));
  if(rows.length) o.rows=rows;
  const first=offerCalc(o).sums;
  o.ai={orig:{net:first.net, hours:first.hours, matCost:first.matCost||0},
    summary:r.summary||"", confidence:r.confidence||"", sanity:r.sanity||"",
    assumptions:r.assumptions||[], questions:r.questions||[], risks:r.risks||[],
    sources:(r.material||[]).map(m=>({desc:m.desc||"", source:m.source||"", estimated:!!m.estimated})),
    at:new Date().toLocaleString("sv-SE",{dateStyle:"short",timeStyle:"short"})};
  if(r.mail_text){
    const c=offerCalc(o), f=firm();
    const tot="Totalt "+kr2(c.sums.gross)+" inklusive moms ("+kr2(c.sums.net)+" exklusive moms). Offerten gäller till och med "+c.validTo+".";
    const sign=[f.signature||(S.me?S.me.name:""), f.name, f.phone, f.email].filter(Boolean).join("\n");
    o.mailText=String(r.mail_text).trim()+"\n\n"+tot+(sign && String(r.mail_text).indexOf(f.name||"\u0000")<0?"\n\n"+sign:"");
    o.mailEdited=true;
  }
}
function viewOffer(){
  const o=S.off, cu=o.customer||{};
  const fld=(id,label,v,type,extra)=>'<label class="fld"><span class="eyebrow">'+label+'</span>'
    + (type==="area" ? '<textarea id="'+id+'" rows="'+(extra||3)+'">'+esc(v||"")+'</textarea>'
       : '<input id="'+id+'" type="'+(type||"text")+'" value="'+esc(v||"")+'"'+(extra||"")+'>')+'</label>';
  const sections=OFFER_KINDS.map(function(k){
    const idx=[]; (o.rows||[]).forEach(function(r,i){ if(r.kind===k[0]) idx.push(i); });
    const mat=k[0]==="material";
    return '<div class="panel" style="margin-bottom:14px"><div class="hd"><div><h3>'+k[1]+'</h3>'
      + '<span class="note">'+(k[0]==="arbete"?"Timmar × timpris":mat?"Antal × inköpspris + påslag – kunden ser bara slutpriset":"Mil, resor eller fast belopp")+'</span></div>'
      + '<span class="note" id="k-sum-'+k[0]+'" style="margin-left:auto;margin-right:10px"></span>'
      + '<button class="btn sm" data-act="offrowadd" data-k="'+k[0]+'">Lägg till rad</button></div>'
      + (idx.length
        ? '<div class="tblwrap" style="border:0"><table class="tbl kalk"><thead><tr><th>Beskrivning</th><th>'+(k[0]==="arbete"?"Timmar":"Antal")+'</th><th>Enhet</th>'
          + (mat?'<th>Inköpspris</th><th>Påslag %</th>':'<th>À-pris</th>')+'<th class="r">Belopp</th><th></th></tr></thead><tbody>'
          + idx.map(i=>offRowHtml(o.rows[i], i)).join("")+'</tbody></table></div>'
        : '<p class="note" style="padding:10px 14px">Inga rader.</p>')
      + '</div>';
  }).join("");
  return '<div id="kalk">'
    + '<div class="bar"><button class="btn sm ghost" data-act="offback">‹ Alla offerter</button>'
    + '<div class="per">Offert '+esc(o.nr)+'</div>'
    + '<label class="fld" style="margin-left:auto"><select id="k-status">'
    + Object.keys(OFFER_STATUS).map(k=>'<option value="'+k+'"'+(o.status===k?" selected":"")+'>'+OFFER_STATUS[k]+'</option>').join("")
    + '</select></label>'
    + '<button class="btn primary" data-act="offsave">Spara</button>'
    + '<button class="btn" data-act="offpdf">Ladda ner PDF</button>'
    + (o.id?'<button class="btn ghost" data-act="offdel">Ta bort</button>':'')
    + '</div>'
    + '<div class="grid2" style="margin-bottom:14px">'
    + '<div class="panel" style="padding:14px"><h3 style="margin-bottom:8px">Kundens förfrågan</h3>'
    + fld("k-mail","Klistra in kundens mejl (underlag – syns inte i offerten)",o.mail,"area",9)
    + '<div class="bar" style="margin:8px 0 0">'
    + '<button class="btn sm primary" data-act="offai"'+(S.aiBusy?' disabled':'')+'>'+(S.aiBusy?'Räknar …':'Räkna med AI')+'</button>'
    + '<button class="btn sm" data-act="offparse">Hämta kontaktuppgifter ur mejlet</button></div>'
    + '<p class="note" id="k-ai-status" style="margin-top:6px">'+esc(S.aiStatus||"")+'</p>'
    + filesPanel(o.id?"offer:"+o.id:"offer:", "Bilagor till förfrågan", "Ritningar, foton, PDF och Excel från kunden, även stora filer – AI:n läser dem när du räknar. Syns inte i offerten.")
    + '</div>'
    + '<div class="panel" style="padding:14px"><h3 style="margin-bottom:8px">Kund</h3><div class="stack">'
    + fld("k-cname","Namn eller företag",cu.name)
    + fld("k-contact","Kontaktperson",cu.contact)
    + fld("k-addr","Adress",cu.address,"area",2)
    + fld("k-email","E-post",cu.email,"email",' autocapitalize="none" spellcheck="false"')
    + fld("k-phone","Telefon",cu.phone,"tel")
    + '</div></div></div>'
    + '<div class="panel" style="padding:14px;margin-bottom:14px"><h3 style="margin-bottom:8px">Offerten</h3><div class="stack">'
    + fld("k-title","Avser (rubrik i offerten)",o.title,"text",' placeholder="T.ex. Trappräcke i rostfritt till entrén"')
    + fld("k-intro","Beskrivning av arbetet (står i offerten)",o.intro,"area",4)
    + '<div class="grid2">'
    + fld("k-date","Datum",o.date,"date")
    + fld("k-valid","Giltig antal dagar",String(o.validDays||30),"text",' inputmode="numeric"')
    + fld("k-ref","Vår referens",o.ref)
    + '</div></div></div>'
    + aiPanel(o)
    + learnPanel(o)
    + sections
    + '<div class="kpis" style="margin-bottom:6px">'
    + '<div class="kpi"><span class="eyebrow">Summa exkl. moms</span><div class="v" id="k-net"></div></div>'
    + '<div class="kpi"><span class="eyebrow">Moms 25 %</span><div class="v" id="k-vat"></div></div>'
    + '<div class="kpi"><span class="eyebrow">Att betala inkl. moms</span><div class="v" id="k-gross"></div></div>'
    + '</div><p class="note" id="k-internal" style="margin-bottom:14px"></p>'
    + '<div class="panel" style="padding:14px;margin-bottom:14px"><h3 style="margin-bottom:8px">Villkor</h3>'
    + fld("k-terms","Står sist i offerten, efter giltighetstid och betalningsvillkor",o.terms,"area",3)+'</div>'
    + '<div class="panel" style="padding:14px"><h3 style="margin-bottom:8px">Mejl till kunden</h3><div class="stack">'
    + fld("k-subj","Ämnesrad",offerSubject(o),"text",' readonly')
    + fld("k-mailtext","Mejltext – ändra fritt",o.mailEdited?o.mailText:offerMailText(o),"area",12)
    + '<div class="bar" style="margin:0">'
    + '<button class="btn primary" data-act="offshare">'+(navigator.share?"Dela PDF och text":"Öppna i mejlprogrammet")+'</button>'
    + '<button class="btn" data-act="offcopy">Kopiera mejltexten</button>'
    + (o.mailEdited?'<button class="btn ghost" data-act="offmailreset">Skriv om mejltexten automatiskt</button>':'')
    + '</div><p class="note">'+(navigator.share
      ? "Dela öppnar telefonens delningsmeny – välj Mail så kommer PDF:en med som bilaga och texten in i mejlet."
      : "Mejlprogrammet öppnas med ämne och text ifyllt. Bifoga PDF:en du laddat ner innan du skickar.")+'</p>'
    + '</div></div></div>';
}
/* Läser av formuläret till S.off. Körs vid varje tangenttryckning och före
   varje knapptryck, så att inget man skrivit tappas när vyn ritas om. */
function offerRead(){
  const o=S.off; if(!o || !document.getElementById("kalk")) return o;
  const v=id=>{ const e=document.getElementById(id); return e?e.value:null; };
  const set=(k,id,fn)=>{ const x=v(id); if(x!==null) o[k]=fn?fn(x):x; };
  set("status","k-status"); set("mail","k-mail"); set("title","k-title"); set("intro","k-intro");
  set("date","k-date"); set("validDays","k-valid",x=>Math.max(1,Math.round(numIn(x))||30)); set("ref","k-ref"); set("terms","k-terms");
  const cu=o.customer=o.customer||{};
  [["name","k-cname"],["contact","k-contact"],["address","k-addr"],["email","k-email"],["phone","k-phone"]]
    .forEach(function(p){ const x=v(p[1]); if(x!==null) cu[p[0]]=x; });
  (o.rows||[]).forEach(function(r,i){
    const id="k-r"+i;
    if(v(id+"-desc")===null) return;
    r.desc=v(id+"-desc"); r.qty=numIn(v(id+"-qty")); r.unit=v(id+"-unit");
    if(r.kind==="material"){ r.cost=numIn(v(id+"-cost")); r.markup=numIn(v(id+"-markup")); }
    else r.price=numIn(v(id+"-price"));
  });
  const mt=v("k-mailtext");
  if(mt!==null && mt!==offerMailText(o) && (o.mailEdited || document.activeElement===document.getElementById("k-mailtext"))){
    o.mailText=mt; o.mailEdited=true;
  }
  return o;
}
/* Uppdaterar belopp, summor och mejltext utan att rita om sidan. */
function offerLive(){
  const o=offerRead(); if(!o) return;
  const c=offerCalc(o);
  const put=(id,s)=>{ const e=document.getElementById(id); if(e) e.textContent=s; };
  c.rows.forEach(function(r,i){ put("k-r"+i+"-amt", kr2(r.amount)); });
  put("k-sum-arbete", c.sums.hours?fmt(c.sums.hours)+" h · "+kr2(c.sums.arbete):"");
  put("k-sum-material", c.sums.material?kr2(c.sums.material):"");
  put("k-sum-resa", c.sums.resa?kr2(c.sums.resa):"");
  put("k-net", kr2(c.sums.net)); put("k-vat", kr2(c.sums.vat)); put("k-gross", kr2(c.sums.gross));
  put("k-internal", "Bara för dig: material inköp "+kr2(c.sums.matCost)+", påslag "+kr2(c.sums.matMarkup)
    + (c.sums.hours?" · "+fmt(c.sums.hours)+" timmar":"")+" · giltig till "+c.validTo+".");
  const subj=document.getElementById("k-subj"); if(subj) subj.value=offerSubject(o);
  const mt=document.getElementById("k-mailtext");
  if(mt && !o.mailEdited && document.activeElement!==mt) mt.value=offerMailText(o);
}
document.addEventListener("input", function(ev){
  if(ev.target && ev.target.id==="proj-q"){
    S.projQ=ev.target.value;
    clearTimeout(projQTimer);
    projQTimer=setTimeout(scheduleRender, 120);
    return;
  }
  if(S.tab==="kalkyl" && S.off && ev.target && ev.target.closest && ev.target.closest("#kalk")) offerLive();
});
function offerBody(o){
  const c=offerCalc(o);
  const body=JSON.parse(JSON.stringify(o));
  delete body._id;
  body.sums=c.sums; body.validTo=c.validTo;
  body.updatedAt=new Date().toISOString(); body.byName=S.me?S.me.name:"";
  if(!body.mailEdited) body.mailText="";
  return body;
}
async function offerPdfBlob(o){
  const mod=await import("./offertpdf.js");
  const c=offerCalc(o);
  const doc=Object.assign({}, o, {rows:c.rows, sums:c.sums, validTo:c.validTo});
  return new Blob([mod.offerPdf(doc, firm())], {type:"application/pdf"});
}
const offerFileName = o => ("Offert-"+(o.nr||"")+"-"+String((o.customer||{}).name||"").trim())
  .replace(/[^\wåäöÅÄÖ -]/g,"").trim().replace(/\s+/g,"-").replace(/-+$/,"")+".pdf";

function firmModal(err){
  const f=firm();
  const fl=(id,label,v,extra)=>'<label class="fld"><span class="eyebrow">'+label+'</span><input id="'+id+'" type="text" value="'+esc(v==null?"":v)+'"'+(extra||"")+'></label>';
  openModal('<div class="mh"><div><span class="eyebrow">Står på varje offert</span><h3 style="margin-top:2px">Firmauppgifter</h3></div>'
    + '<button class="btn sm ghost" data-act="close">Stäng</button></div>'
    + '<div class="mb"><div class="stack">'
    + fl("ff-name","Företagsnamn",f.name)
    + '<div class="grid2">'+fl("ff-address","Gatuadress",f.address)+fl("ff-zip","Postnummer",f.zip)+fl("ff-city","Ort",f.city)
    + fl("ff-phone","Telefon",f.phone)+fl("ff-email","E-post",f.email,' autocapitalize="none"')+fl("ff-web","Webbplats",f.web)
    + fl("ff-orgnr","Organisationsnummer",f.orgnr)+fl("ff-vatnr","Momsregistreringsnummer",f.vatnr,' placeholder="SE5560000000 01"')
    + fl("ff-bankgiro","Bankgiro",f.bankgiro)+'</div>'
    + '<label class="fld"><input id="ff-fskatt" type="checkbox"'+(f.fskatt?" checked":"")+'> Godkänd för F-skatt (skrivs på offerten)</label>'
    + '<h4 style="margin-top:6px">Förval för nya offerter</h4>'
    + '<div class="grid2">'+fl("ff-rate","Timpris kr (exkl. moms)",numOut(f.rate),' inputmode="decimal"')
    + fl("ff-markup","Påslag på material %",numOut(f.markup),' inputmode="decimal"')
    + fl("ff-mil","Pris per mil kr",numOut(f.milPrice),' inputmode="decimal"')
    + fl("ff-valid","Giltighetstid dagar",String(f.validDays||30),' inputmode="numeric"')
    + fl("ff-pay","Betalningsvillkor",f.payTerms)
    + fl("ff-sign","Namn under mejlet",f.signature,' placeholder="'+esc(S.me?S.me.name:"")+'"')+'</div>'
    + '<label class="fld"><span class="eyebrow">Standardvillkor (kan ändras per offert)</span><textarea id="ff-terms" rows="3">'+esc(f.terms||"")+'</textarea></label>'
    + '<h4 style="margin-top:6px">AI-kalkylen</h4>'
    + fl("ff-workshop","Verkstadens adress (resor räknas härifrån – tomt = gatuadressen ovan)",f.workshop)
    + '<label class="fld"><span class="eyebrow">Egna anvisningar till AI-kalkylen</span><textarea id="ff-aihints" rows="4" '
    + 'placeholder="T.ex. Vi förzinkar hos … för ca … kr/kg. Räkna alltid två man vid montering. Vi köper stål från …">'+esc(f.aiHints||"")+'</textarea></label>'
    + (err?'<div class="err">'+esc(err)+'</div>':'')
    + '</div></div>'
    + '<div class="mf"><button class="btn" data-act="close">Avbryt</button><button class="btn primary" data-act="offfirmsave">Spara</button></div>');
}

/* ============================ lär upp AI-kalkylen ============================ */
/* Tre sorters kunskap som följer med varje AI-kalkyl:
   1. firmans egen prislista – går före priser från webben,
   2. tidsnormer – hur lång tid moment brukar ta i verkstaden,
   3. lärda exempel – färdiga offerter med det AI:n föreslog, det som blev
      rätt, utfallet i projektet och en kommentar om vad som var fel.
   Prislista och normer ligger i settings/aikunskap, exemplen i aiexempel. */
const aiKnow = () => S.aiKnow || {prices:[], norms:[], rules:""};
const kn = v => nf.format(r2(v));
function learnPanel(o){
  if(!o.id) return "";
  const ex=(S.aiExamples||[]).find(x=>x.offerId===o.id);
  return '<div class="panel" style="padding:14px;margin-bottom:14px"><h3 style="margin-bottom:4px">Lär AI:n av den här offerten</h3>'
    + '<p class="note" style="margin:0 0 8px">Spara offerten som lärdom när raderna stämmer. Nästa kalkyl på ett liknande jobb räknas då som du räknade här'
    + (o.ai&&o.ai.orig?' – och AI:n får se vad den själv föreslog ('+kn(o.ai.orig.hours)+' h, '+kr(o.ai.orig.net)+')':'')+'.</p>'
    + '<label class="fld"><span class="eyebrow">Vad var fel, eller vad ska AI:n tänka på nästa gång?</span>'
    + '<textarea id="k-learn" rows="3" placeholder="T.ex. Montering tar alltid en hel dag för två man. Rostfritt köper vi för ca 95 kr/kg.">'+esc(ex?ex.comment:"")+'</textarea></label>'
    + '<div class="bar" style="margin:8px 0 0"><button class="btn sm primary" data-act="offlearnsave">'+(ex?"Uppdatera lärdomen":"Spara som lärdom")+'</button>'
    + (ex?'<span class="note">Sparad '+esc(String(ex.at).slice(0,10))+'</span>':'')+'</div></div>';
}
/* Utfallet i projektet som skapades från offerten, om det finns något. */
function offerOutcome(offerId){
  const p=(S.projects||[]).find(x=>((x.quote||{}).offerId)===offerId);
  if(!p) return null;
  const a=projActual(p);
  if(!(a.hours||a.total)) return null;
  return {project:p.name, status:pStatus(p), hours:r2(a.hours), material:r2(a.parts.material), total:r2(a.total)};
}
function exampleFrom(o, comment){
  const c=offerCalc(o);
  return {id:o.id, offerId:o.id, nr:o.nr||"", title:o.title||"", status:o.status||"",
    mail:String(o.mail||"").slice(0,1500),
    rows:c.rows.map(r=>({kind:r.kind, desc:r.desc||"", qty:r2(r.qty), unit:r.unit||"",
      price:r.kind==="material"?0:r2(r.unitPrice), cost:r.kind==="material"?r2(r.cost):0, markup:r.kind==="material"?r2(r.markup):0})),
    net:c.sums.net, hours:c.sums.hours, matCost:c.sums.matCost||0,
    aiOrig:(o.ai&&o.ai.orig)||null, outcome:offerOutcome(o.id),
    comment:String(comment||"").trim().slice(0,1500), at:new Date().toISOString(), byName:S.me?S.me.name:""};
}
const learnWords = t => String(t||"").toLowerCase().match(/[a-zåäö0-9]{4,}/g) || [];
/* De exempel som liknar förfrågan mest, och annars de senaste. */
function pickExamples(mail, n){
  const want={}; learnWords(mail).forEach(w=>{ want[w]=1; });
  return (S.aiExamples||[]).map(function(x, i){
    const seen={}; let score=0;
    learnWords(x.title+" "+x.mail+" "+x.comment).forEach(w=>{ if(want[w] && !seen[w]){ seen[w]=1; score++; } });
    return {x:x, score:score+(x.status==="accepterad"?0.5:0), i:i};
  }).sort((a,b)=>b.score-a.score || a.i-b.i).slice(0,n).map(e=>e.x);
}
function exampleText(x){
  const kind=k=>x.rows.filter(r=>r.kind===k);
  const line=r=>r.kind==="material"
    ? r.desc+" "+kn(r.qty)+" "+r.unit+" à "+kn(r.cost)+" kr inköp + "+kn(r.markup)+" %"
    : r.desc+" "+kn(r.qty)+" "+r.unit+" à "+kn(r.price)+" kr";
  const out=["### Offert "+x.nr+": "+(x.title||"utan rubrik")+(x.status?" ("+(OFFER_STATUS[x.status]||x.status).toLowerCase()+")":"")];
  if(x.mail) out.push("Förfrågan (utdrag): "+x.mail.replace(/\s+/g," ").slice(0,700));
  [["arbete","Arbete"],["material","Material"],["resa","Resor"]].forEach(function(k){
    const rs=kind(k[0]); if(rs.length) out.push(k[1]+": "+rs.map(line).join("; "));
  });
  out.push("Slutlig offert: "+kn(x.hours)+" h arbete, materialinköp "+kn(x.matCost)+" kr, summa "+kn(x.net)+" kr exkl. moms.");
  if(x.aiOrig) out.push("AI:n föreslog först "+kn(x.aiOrig.hours)+" h och "+kn(x.aiOrig.net)+" kr – raderna ovan är det rättade.");
  if(x.outcome) out.push("Utfall i projektet "+x.outcome.project+": "+kn(x.outcome.hours)+" h, material "+kn(x.outcome.material)+" kr, totalt "+kn(x.outcome.total)+" kr"+(x.outcome.status!=="avslutad"?" (pågår fortfarande)":"")+".");
  if(x.comment) out.push("Kommentar från firman: "+x.comment);
  return out.join("\n");
}
/* Allt firman lärt AI:n, som en text som följer med förfrågan. */
function knowledgeText(mail){
  const k=aiKnow(), parts=[];
  const prices=(k.prices||[]).filter(p=>p.name && +p.cost);
  if(prices.length) parts.push("## Egen prislista (inköpspris exkl. moms – går före priser från webben)\n"
    + prices.slice(0,300).map(p=>"- "+p.name+": "+kn(p.cost)+" kr/"+(p.unit||"st")+(p.note?" ("+p.note+")":"")).join("\n"));
  const norms=(k.norms||[]).filter(n=>n.task && +n.hours);
  if(norms.length) parts.push("## Tidsnormer i verkstaden (går före din egen bedömning)\n"
    + norms.slice(0,150).map(n=>"- "+n.task+": "+kn(n.hours)+" h per "+(n.unit||"st")).join("\n"));
  if(String(k.rules||"").trim()) parts.push("## Fasta regler\n"+String(k.rules).trim());
  const ex=pickExamples(mail, 6);
  if(ex.length) parts.push("## Lärda exempel – så har firman räknat liknande jobb\n"+ex.map(exampleText).join("\n\n"));
  const docs=aiFilesFor("learn").filter(f=>f.text);
  if(docs.length) parts.push("## Firmans underlag (uppladdade filer)\n"+docs.map(f=>"### "+f.name+"\n"+f.text).join("\n\n"));
  return parts.join("\n\n").slice(0,80000);
}
function learnRows(list, cols, pre){
  return list.map(function(r, i){
    return '<tr>'+cols.map(function(c){
      return '<td data-l="'+c[1]+'"'+(c[2]?' style="width:'+c[2]+'px"':'')+'><input id="'+pre+i+'-'+c[0]+'" type="text"'
        + (c[3]?' inputmode="decimal"':'')+' value="'+esc(c[3]?numOut(r[c[0]]):(r[c[0]]||""))+'"'+(c[4]?' placeholder="'+esc(c[4])+'"':'')+'></td>';
    }).join("")+'<td class="r" style="width:60px"><button class="btn sm ghost" data-act="lrdel" data-t="'+pre+'" data-i="'+i+'" aria-label="Ta bort raden">✕</button></td></tr>';
  }).join("");
}
const PRICE_COLS=[["name","Artikel",0,0,"T.ex. VKR 40x40x3"],["unit","Enhet",70,0,"m"],["cost","Inköpspris kr",110,1,"0"],["note","Leverantör / not",0,0,"T.ex. Tibnor, mars 2026"]];
const NORM_COLS=[["task","Moment",0,0,"T.ex. Svetsa och slipa räckesstolpe"],["unit","Per",80,0,"st"],["hours","Timmar",90,1,"0"]];
function viewAiLearn(){
  const k=aiKnow(), ex=S.aiExamples||[];
  const exRows=ex.map(function(x){
    const diff=x.aiOrig&&x.aiOrig.hours?Math.round((x.hours-x.aiOrig.hours)/x.aiOrig.hours*100):null;
    return '<tr><td class="r">'+esc(x.nr)+'</td><td><b>'+esc(x.title||"—")+'</b>'+(x.comment?'<div class="note">'+esc(x.comment)+'</div>':'')+'</td>'
      + '<td class="r">'+kn(x.hours)+' h<div class="note">'+esc(kr(x.net))+'</div></td>'
      + '<td class="r">'+(x.aiOrig?kn(x.aiOrig.hours)+' h'+(diff!==null&&diff!==0?'<div class="note">'+(diff>0?"+":"")+diff+' % efter rättning</div>':''):'<span class="note">–</span>')+'</td>'
      + '<td class="r">'+(x.outcome?kn(x.outcome.hours)+' h<div class="note">'+esc(x.outcome.status==="avslutad"?"avslutat":"pågår")+'</div>':'<span class="note">–</span>')+'</td>'
      + '<td class="r" style="white-space:nowrap"><button class="btn sm ghost" data-act="lrexdel" data-x="'+esc(x.id)+'">Ta bort</button></td></tr>';
  }).join("");
  return '<div id="learn">'
    + '<div class="bar"><button class="btn sm ghost" data-act="offback">‹ Alla offerter</button>'
    + '<div class="per">Lär upp AI-kalkylen</div>'
    + '<button class="btn primary" style="margin-left:auto" data-act="lrsave">Spara</button></div>'
    + '<p class="note" style="margin:0 0 14px">Allt här följer med varje AI-kalkyl. Ju mer du lägger in, desto närmare hamnar AI:n hur ni själva räknar.</p>'
    + '<div class="panel" style="margin-bottom:14px"><div class="hd"><div><h3>Egen prislista</h3>'
    + '<span class="note">Era inköpspriser exkl. moms. AI:n använder dem i stället för att söka på webben.</span></div>'
    + '<button class="btn sm" style="margin-left:auto" data-act="lradd" data-t="lp">Lägg till rad</button></div>'
    + ((k.prices||[]).length?'<div class="tblwrap" style="border:0"><table class="tbl kalk"><thead><tr><th>Artikel</th><th>Enhet</th><th>Inköpspris kr</th><th>Leverantör / not</th><th></th></tr></thead><tbody>'
      + learnRows(k.prices, PRICE_COLS, "lp")+'</tbody></table></div>':'<p class="note" style="padding:10px 14px">Ingen prislista än.</p>')
    + '<div style="padding:10px 14px 14px"><label class="fld"><span class="eyebrow">Klistra in från Excel: artikel, enhet, pris (och not) – en rad per artikel</span>'
    + '<textarea id="lp-paste" rows="3" placeholder="VKR 40x40x3&#9;m&#9;55&#9;Tibnor"></textarea></label>'
    + '<button class="btn sm" style="margin-top:8px" data-act="lrpaste">Lägg till raderna</button></div></div>'
    + '<div class="panel" style="margin-bottom:14px"><div class="hd"><div><h3>Tidsnormer</h3>'
    + '<span class="note">Hur lång tid moment brukar ta hos er. AI:n räknar timmar med dem.</span></div>'
    + '<button class="btn sm" style="margin-left:auto" data-act="lradd" data-t="ln">Lägg till rad</button></div>'
    + ((k.norms||[]).length?'<div class="tblwrap" style="border:0"><table class="tbl kalk"><thead><tr><th>Moment</th><th>Per</th><th>Timmar</th><th></th></tr></thead><tbody>'
      + learnRows(k.norms, NORM_COLS, "ln")+'</tbody></table></div>':'<p class="note" style="padding:10px 14px">Inga tidsnormer än. Exempel: Montering av räcke – per meter – 0,75 h.</p>')
    + '</div>'
    + '<div class="panel" style="padding:14px;margin-bottom:14px"><h3 style="margin-bottom:8px">Fasta regler</h3>'
    + '<label class="fld"><span class="eyebrow">Sådant som alltid gäller</span><textarea id="lr-rules" rows="4" '
    + 'placeholder="T.ex. Vi räknar alltid minst 4 timmar för montering. Förzinkning kostar ca 14 kr/kg och tar två veckor. Lägg 1 timme ritning på allt.">'+esc(k.rules||"")+'</textarea></label></div>'
    + '<div class="panel" style="padding:14px;margin-bottom:14px">'
    + filesPanel("learn", "Filer AI:n alltid läser", "Leverantörers prislistor, egna kalkylmallar och liknande. Excel och CSV blir text; PDF och bilder läses som de är.")
    + '</div>'
    + '<div class="panel"><div class="hd"><div><h3>Lärda exempel</h3>'
    + '<span class="note">Sparas från en offert med <b>Spara som lärdom</b>. De '+6+' som liknar förfrågan mest följer med varje kalkyl.</span></div></div>'
    + (ex.length?'<div class="tblwrap" style="border:0"><table class="tbl"><thead><tr><th class="r">Nr</th><th>Offert och kommentar</th><th class="r">Slutlig</th><th class="r">AI:ns förslag</th><th class="r">Utfall</th><th></th></tr></thead><tbody>'
      + exRows+'</tbody></table></div>':'<p class="note" style="padding:10px 14px">Inga exempel än. Öppna en offert du är nöjd med och tryck på <b>Spara som lärdom</b>.</p>')
    + '</div></div>';
}
/* Läser av formuläret, så att inget man skrivit tappas när vyn ritas om. */
function learnRead(){
  const k=aiKnow(); if(!document.getElementById("learn")) return k;
  const v=id=>{ const e=document.getElementById(id); return e?e.value:null; };
  const read=(list, cols, pre)=>list.map(function(r, i){
    const o=Object.assign({}, r);
    cols.forEach(function(c){ const x=v(pre+i+"-"+c[0]); if(x!==null) o[c[0]]=c[3]?numIn(x):x.trim(); });
    return o;
  });
  k.prices=read(k.prices||[], PRICE_COLS, "lp");
  k.norms=read(k.norms||[], NORM_COLS, "ln");
  const r=v("lr-rules"); if(r!==null) k.rules=r;
  S.aiKnow=k; return k;
}
async function handleLearn(act, t){
  if(act==="offlearn"){ S.off=null; S.offSel="learn"; if(!S.aiKnow) await loadOffers(); render(); window.scrollTo(0,0); return true; }
  if(act==="offlearnsave"){
    const o=S.off; if(!o||!o.id){ toast("Spara offerten först."); return true; }
    offerRead();
    const comment=(document.getElementById("k-learn")||{}).value||"";
    if(!(o.rows||[]).some(r=>+r.qty)){ toast("Offerten har inga rader att lära av."); return true; }
    try{ await loadProjectData(); }catch(e){ console.error(e); }
    const x=exampleFrom(o, comment);
    const ok=await guard(function(){ return Store.set("aiexempel/"+x.id, x); }, "Sparad som lärdom. Nästa liknande kalkyl räknas på samma sätt.");
    if(ok){ S.aiExamples=[x].concat((S.aiExamples||[]).filter(e=>e.id!==x.id)); render(); offerLive(); }
    return true;
  }
  if(act==="lrfiledel"){
    const f=(S.aiFiles||[]).find(x=>x.id===t.dataset.f); if(!f) return true;
    if(!confirmTwice("lrfiledel"+f.id)){ toast("Tryck på ✕ en gång till för att ta bort "+f.name+"."); return true; }
    if(S.off) offerRead(); else learnRead();
    await guard(function(){ return deleteAiFile(f.id); }, f.name+" är borttagen.");
    render(); if(S.off) offerLive(); return true;
  }
  if(S.offSel!=="learn") return false;
  const k=learnRead();
  if(act==="lradd"){
    const list=t.dataset.t==="lp"?(k.prices=k.prices||[]):(k.norms=k.norms||[]);
    list.push(t.dataset.t==="lp"?{name:"", unit:"", cost:0, note:""}:{task:"", unit:"st", hours:0});
    render(); const el=document.getElementById(t.dataset.t+(list.length-1)+"-"+(t.dataset.t==="lp"?"name":"task")); if(el) el.focus();
    return true;
  }
  if(act==="lrdel"){ (t.dataset.t==="lp"?k.prices:k.norms).splice(+t.dataset.i,1); render(); return true; }
  if(act==="lrpaste"){
    const txt=(document.getElementById("lp-paste")||{}).value||"";
    let n=0;
    txt.split(/\r?\n/).forEach(function(line){
      const c=line.split(/\t|;/).map(x=>x.trim());
      if(c.length<3 || !c[0]) return;
      const cost=numIn(c[2]); if(!cost) return;
      k.prices.push({name:c[0], unit:c[1]||"st", cost:cost, note:c[3]||""}); n++;
    });
    render(); toast(n?n+" rader tillagda. Tryck på Spara.":"Hittade inga rader. Varje rad ska ha artikel, enhet och pris, med tabb eller semikolon emellan.");
    return true;
  }
  if(act==="lrsave"){
    const body={prices:(k.prices||[]).filter(p=>String(p.name||"").trim()), norms:(k.norms||[]).filter(n=>String(n.task||"").trim()),
      rules:String(k.rules||"").trim(), updatedAt:new Date().toISOString(), updatedBy:S.me?S.me.name:""};
    const ok=await guard(function(){ return Store.set("settings/aikunskap", body); }, "AI-kunskapen är sparad.");
    if(ok){ S.aiKnow=body; render(); }
    return true;
  }
  if(act==="lrexdel"){
    const id=t.dataset.x;
    if(!confirmTwice("lrexdel"+id)){ toast("Tryck på Ta bort en gång till för att ta bort exemplet."); return true; }
    const ok=await guard(function(){ return Store.del("aiexempel/"+id); }, "Exemplet är borttaget.");
    if(ok){ S.aiExamples=(S.aiExamples||[]).filter(x=>x.id!==id); render(); }
    return true;
  }
  return false;
}

/* ============================ filer till AI-kalkylen ============================ */
/* Ritningar, foton, PDF:er och Excel-filer som AI:n läser. Filer på en offert
   (scope "offer:<id>") följer med när den offerten räknas; filer under Lär upp
   AI:n (scope "learn") följer med varje kalkyl – prislistor från leverantörer,
   egna normer och liknande. Excel, CSV och text görs om till text direkt.
   Bilder och små PDF:er sparas som de är, uppdelade i bitar i aifiledata,
   eftersom ett Firestore-dokument rymmer högst 1 MB. Stora PDF:er – hundratals
   MB med ritningar – packas upp i webbläsaren: sidor med text blir text och
   ritningar och inskannade sidor blir bilder, så att AI:n får det den behöver
   utan att hela filen skickas. */
const PDF_ASIS=6*1024*1024, AICHUNK=900000, AISEND_MAX=14*1024*1024;
const PDF_MAX_PAGES=80, PDF_MAX_IMAGES=30;
let pdfLoading=null;
function ensurePdfJs(){
  if(window.pdfjsLib) return Promise.resolve(true);
  if(!pdfLoading){
    pdfLoading=new Promise(function(res){
      const sc=document.createElement("script");
      sc.src="lib/pdf.min.js";
      sc.onload=function(){
        try{ window.pdfjsLib.GlobalWorkerOptions.workerSrc="lib/pdf.worker.min.js"; }catch(e){}
        res(!!window.pdfjsLib);
      };
      sc.onerror=function(){ pdfLoading=null; res(false); };
      document.head.appendChild(sc);
    });
  }
  return pdfLoading;
}
/* Packar upp en stor PDF sida för sida. */
async function unpackPdf(file, onProgress){
  if(!(await ensurePdfJs())) throw new Error("PDF-läsaren kunde inte laddas. Kontrollera nätet och försök igen.");
  const pdf=await window.pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
  const n=pdf.numPages, last=Math.min(n, PDF_MAX_PAGES);
  let text="", images=[];
  for(let p=1;p<=last;p++){
    if(onProgress) onProgress(p, last);
    const page=await pdf.getPage(p);
    const tc=await page.getTextContent();
    const t=tc.items.map(i=>i.str).join(" ").replace(/\s+/g," ").trim();
    if(t.length>300 && text.length<60000){ text+="\n--- Sida "+p+" ---\n"+t; }
    else if(images.length<PDF_MAX_IMAGES){
      /* ritning eller inskannad sida – som bild, tillräckligt skarp för mått */
      const vp1=page.getViewport({scale:1}), k=Math.min(3, 1800/Math.max(vp1.width, vp1.height));
      const vp=page.getViewport({scale:k});
      const cv=document.createElement("canvas"); cv.width=Math.round(vp.width); cv.height=Math.round(vp.height);
      const ctx=cv.getContext("2d"); ctx.fillStyle="#fff"; ctx.fillRect(0,0,cv.width,cv.height);
      await page.render({canvasContext:ctx, viewport:vp}).promise;
      images.push({page:p, data:cv.toDataURL("image/jpeg",0.72).split(",")[1]||""});
      if(t) text+="\n--- Sida "+p+" (bild) ---\n"+t;
    }
    page.cleanup();
  }
  try{ await pdf.destroy(); }catch(e){}
  const note=n>last?"\n[PDF:en har "+n+" sidor – AI:n läser de första "+last+".]":"";
  return {text:(text+note).slice(0,60000), images:images, pages:n};
}
const aiFilesFor = scope => (S.aiFiles||[]).filter(f=>f.scope===scope);
const fileSize = n => n>1048576 ? (n/1048576).toFixed(1).replace(".",",")+" MB" : Math.max(1,Math.round((n||0)/1024))+" kB";
async function readAiFile(file){
  const name=file.name||"fil", type=file.type||"";
  if(/\.(xlsx|xlsm|xls|ods|csv)$/i.test(name) || /spreadsheet|excel|text\/csv/.test(type)){
    if(!(await ensureXLSX())) throw new Error("Excel-läsaren kunde inte laddas. Kontrollera nätet och försök igen.");
    const wb=XLSX.read(await file.arrayBuffer(), {type:"array"});
    const text=wb.SheetNames.map(n=>"# Blad: "+n+"\n"+XLSX.utils.sheet_to_csv(wb.Sheets[n],{FS:";", blankrows:false})).join("\n\n");
    return {kind:"text", mime:"text/csv", text:text.slice(0,60000)};
  }
  if(/\.(txt|md)$/i.test(name) || /^text\/plain/.test(type)) return {kind:"text", mime:"text/plain", text:(await file.text()).slice(0,60000)};
  if(/^image\//.test(type)){
    const url=await shrinkImage(file, 2000, 0.82);
    return {kind:"inline", mime:"image/jpeg", data:url.split(",")[1]||""};
  }
  if(type==="application/pdf" || /\.pdf$/i.test(name)){
    if(file.size<=PDF_ASIS) return {kind:"inline", mime:"application/pdf", data:await blobToB64(file)};
    const u=await unpackPdf(file, function(p, n){ if(p===1||p%10===0) toast("Packar upp "+name+": sida "+p+" av "+n+" …"); });
    return {kind:"pages", mime:"application/pdf", text:u.text, images:u.images, pages:u.pages};
  }
  throw new Error(name+": den filtypen kan AI:n inte läsa. Använd PDF, bild, Excel, CSV eller text.");
}
async function uploadAiFiles(scope, files){
  let ok=0;
  for(const file of files){
    try{
      const r=await readAiFile(file);
      const id=String(Date.now())+"-"+uid();
      const meta={id:id, scope:scope, name:String(file.name||"fil").slice(0,160), mime:r.mime, kind:r.kind,
        size:file.size||0, text:r.text||"", chunks:0, at:new Date().toISOString(), byName:S.me?S.me.name:""};
      if(r.kind==="pages"){
        /* varje sida som bild för sig: aifiledata/<id>__p<nr>__<bit> */
        meta.pageList=[];
        for(const img of r.images){
          const n=Math.ceil(img.data.length/AICHUNK);
          for(let i=0;i<n;i++) await Store.set("aifiledata/"+id+"__p"+img.page+"__"+i, {id:id, i:i, data:img.data.slice(i*AICHUNK,(i+1)*AICHUNK)});
          meta.pageList.push({page:img.page, chunks:n, size:Math.round(img.data.length*0.75)});
        }
        meta.pages=r.pages||0;
      }
      if(r.kind==="inline"){
        const n=Math.ceil(r.data.length/AICHUNK);
        for(let i=0;i<n;i++) await Store.set("aifiledata/"+id+"__"+i, {id:id, i:i, data:r.data.slice(i*AICHUNK,(i+1)*AICHUNK)});
        meta.chunks=n; meta.size=Math.round(r.data.length*0.75);
      }
      await Store.set("aifiles/"+id, meta);
      (S.aiFiles=S.aiFiles||[]).push(meta); ok++;
    }catch(e){ console.error(e); toast(e.message||"Filen kunde inte sparas."); }
  }
  if(ok) toast(ok===1?"Filen är sparad. AI:n läser den nästa gång du räknar.":ok+" filer är sparade. AI:n läser dem nästa gång du räknar.");
}
async function deleteAiFile(id){
  const f=(S.aiFiles||[]).find(x=>x.id===id); if(!f) return;
  await Store.del("aifiles/"+id);
  for(let i=0;i<(f.chunks||0);i++){ try{ await Store.del("aifiledata/"+id+"__"+i); }catch(e){ console.error(e); } }
  for(const p of (f.pageList||[]))
    for(let i=0;i<p.chunks;i++){ try{ await Store.del("aifiledata/"+id+"__p"+p.page+"__"+i); }catch(e){ console.error(e); } }
  S.aiFiles=(S.aiFiles||[]).filter(x=>x.id!==id);
}
async function aiFileData(f, page){
  let out="";
  const pre=page?"aifiledata/"+f.id+"__p"+page.page+"__":"aifiledata/"+f.id+"__", n=page?page.chunks:(f.chunks||0);
  for(let i=0;i<n;i++){ const d=await Store.get(pre+i); out+=(d&&d.data)||""; }
  return out;
}
function filesPanel(scope, title, hint){
  const list=aiFilesFor(scope);
  const label=f=>f.kind==="text"?"text":f.kind==="pages"?"PDF, "+(f.pages||0)+" sidor uppackad – "+(f.pageList||[]).length+" som bild":f.mime==="application/pdf"?"PDF":"bild";
  return '<div class="aifiles"><div class="aifiles-hd"><div><b>'+title+'</b><div class="note">'+hint+'</div></div>'
    + '<label class="btn sm" style="cursor:pointer">Lägg till fil'
    + '<input type="file" class="aifile-in" data-scope="'+esc(scope)+'" multiple hidden '
    + 'accept="image/*,application/pdf,.pdf,.xlsx,.xlsm,.xls,.ods,.csv,.txt,.md"></label></div>'
    + (list.length?'<ul class="aifile-list">'+list.map(f=>'<li><span class="aifile-name">'+esc(f.name)+'</span>'
        + '<span class="note">'+label(f)+' · '+fileSize(f.size)+'</span>'
        + '<button class="btn sm ghost" data-act="lrfiledel" data-f="'+esc(f.id)+'" aria-label="Ta bort '+esc(f.name)+'">✕</button></li>').join("")+'</ul>'
      :'')+'</div>';
}
/* Filerna som följer med en kalkyl: offertens egna först, sedan firmans. */
async function aiFilesPayload(o){
  const own=o.id?aiFilesFor("offer:"+o.id):[], firmF=aiFilesFor("learn");
  const files=[]; let total=0, skipped=[];
  const from=f=>f.scope==="learn"?"firma":"kund";
  for(const f of own.concat(firmF)){
    if(f.kind==="inline"){
      if(total+f.size*1.34>AISEND_MAX){ skipped.push(f.name); continue; }
      const data=await aiFileData(f); if(!data) continue;
      total+=data.length;
      files.push({name:f.name, mime:f.mime, data:data, from:from(f)});
    }else if(f.kind==="pages"){
      for(const p of (f.pageList||[])){
        if(total+p.size*1.34>AISEND_MAX){ skipped.push(f.name+" s. "+p.page); continue; }
        const data=await aiFileData(f, p); if(!data) continue;
        total+=data.length;
        files.push({name:f.name+", sida "+p.page, mime:"image/jpeg", data:data, from:from(f)});
      }
    }
  }
  const attachText=own.filter(f=>f.text).map(f=>"### "+f.name+"\n"+f.text).join("\n\n").slice(0,60000);
  return {files:files, attachText:attachText, skipped:skipped};
}

async function handleKalkyl(act, t){
  if(!isAdmin()) return true;
  if((act==="offlearn"||act==="offlearnsave"||/^lr/.test(act)) && await handleLearn(act, t)) return true;
  if(act==="offnew"){ S.off=newOffer(); S.offSel="new"; render(); offerLive(); window.scrollTo(0,0); return true; }
  if(act==="offopen"){
    const o=(S.offers||[]).find(x=>x.id===t.dataset.o); if(!o) return true;
    S.off=JSON.parse(JSON.stringify(o)); S.offSel=o.id; render(); offerLive(); window.scrollTo(0,0); return true;
  }
  if(act==="offback"){ S.off=null; S.offSel=null; render(); return true; }
  if(act==="offfirm"){ firmModal(""); return true; }
  if(act==="offfirmsave"){
    const g=id=>(document.getElementById(id)||{}).value||"";
    const body={name:g("ff-name").trim(), address:g("ff-address").trim(), zip:g("ff-zip").trim(), city:g("ff-city").trim(),
      phone:g("ff-phone").trim(), email:g("ff-email").trim(), web:g("ff-web").trim(), orgnr:g("ff-orgnr").trim(),
      vatnr:g("ff-vatnr").trim(), bankgiro:g("ff-bankgiro").trim(), fskatt:!!(document.getElementById("ff-fskatt")||{}).checked,
      rate:numIn(g("ff-rate")), markup:numIn(g("ff-markup")), milPrice:numIn(g("ff-mil")),
      validDays:Math.max(1,Math.round(numIn(g("ff-valid")))||30), payTerms:g("ff-pay").trim(),
      signature:g("ff-sign").trim(), terms:g("ff-terms").trim(),
      workshop:g("ff-workshop").trim(), aiHints:g("ff-aihints").trim(), updatedAt:new Date().toISOString()};
    if(!body.name) return firmModal("Fyll i företagsnamnet."), true;
    const ok=await guard(function(){ return Store.set("settings/offert", body); }, "Firmauppgifterna är sparade.");
    if(ok){ S.firm=body; closeModal(); render(); if(S.off) offerLive(); }
    return true;
  }
  if(!S.off) return false;
  offerRead();
  const o=S.off;
  if(act==="offrowadd"){
    const f=firm(), k=t.dataset.k, kd=OFFER_KINDS.find(x=>x[0]===k);
    const r={kind:k, desc:"", qty:0, unit:kd?kd[2]:""};
    if(k==="material"){ r.cost=0; r.markup=+f.markup||0; }
    else r.price = k==="arbete" ? (+f.rate||0) : (+f.milPrice||0);
    o.rows.push(r); render(); offerLive();
    const el=document.getElementById("k-r"+(o.rows.length-1)+"-desc"); if(el) el.focus();
    return true;
  }
  if(act==="offrowdel"){ o.rows.splice(+t.dataset.i,1); render(); offerLive(); return true; }
  if(act==="offparse"){
    const got=parseCustomerMail(o.mail), cu=o.customer;
    let n=0; ["contact","email","phone","address"].forEach(function(k){ if(got[k] && !String(cu[k]||"").trim()){ cu[k]=got[k]; n++; } });
    if(!String(cu.name||"").trim() && got.contact){ cu.name=got.contact; n++; }
    render(); offerLive();
    toast(n?"Hämtade "+n+" uppgifter ur mejlet. Kontrollera dem.":"Hittade inga nya kontaktuppgifter i mejlet.");
    return true;
  }
  if(act==="offai"){
    if(S.aiBusy) return true;
    if(!String(o.mail||"").trim()){ toast("Klistra in kundens förfrågan först."); return true; }
    const hasRows=(o.rows||[]).some(r=>String(r.desc||"").trim() || +r.qty);
    if(hasRows && !confirmTwice("offai")){ toast("AI:n ersätter raderna i offerten. Tryck på Räkna med AI en gång till för att fortsätta."); return true; }
    S.aiBusy=true; S.aiStatus="Startar AI-kalkylen … det tar oftast en till tre minuter."; render(); offerLive();
    const off=o;
    try{
      const r=await runAiKalkyl(off);
      applyAiKalkyl(off, r);
      S.aiStatus="Klar. Gå igenom raderna och antagandena, och spara offerten.";
      toast("AI-kalkylen är klar.");
    }catch(e){
      console.error(e); S.aiStatus=e.message||"AI-kalkylen misslyckades."; toast(S.aiStatus);
    }finally{
      S.aiBusy=false;
      if(S.off===off){ render(); offerLive(); }
    }
    return true;
  }
  if(act==="offmailreset"){ o.mailEdited=false; o.mailText=""; render(); offerLive(); return true; }
  if(act==="offsave"||act==="offpdf"||act==="offshare"){
    if(!String(o.customer.name||"").trim()) { toast("Fyll i kundens namn först."); return true; }
    if(!o.id) o.id=slug("offert-"+o.nr);
    const body=offerBody(o);
    const ok=await guard(function(){ return Store.set("offers/"+o.id, body); }, act==="offsave"?"Offerten är sparad.":"");
    if(!ok) return true;
    const i=(S.offers||[]).findIndex(x=>x.id===o.id);
    if(i>=0) S.offers[i]=body; else (S.offers=S.offers||[]).unshift(body);
    S.offSel=o.id;
    if(act==="offsave"){ render(); offerLive(); return true; }
    let blob;
    try{ blob=await offerPdfBlob(o); }catch(e){ console.error(e); toast("Kunde inte skapa PDF:en."); return true; }
    const name=offerFileName(o);
    const text=o.mailEdited?o.mailText:offerMailText(o);
    if(act==="offpdf"){ downloadBlob(blob, name); render(); offerLive(); return true; }
    /* Dela: på telefonen följer PDF:en med som bilaga. Annars mejlprogrammet. */
    const file=(typeof File!=="undefined") ? new File([blob], name, {type:"application/pdf"}) : null;
    if(file && navigator.canShare && navigator.canShare({files:[file]})){
      try{ await navigator.share({files:[file], title:offerSubject(o), text:text}); }
      catch(e){ if(!e || e.name!=="AbortError") toast("Kunde inte dela – ladda ner PDF:en i stället."); }
    } else {
      downloadBlob(blob, name);
      location.href="mailto:"+encodeURIComponent(o.customer.email||"")+"?subject="+encodeURIComponent(offerSubject(o))+"&body="+encodeURIComponent(text);
    }
    render(); offerLive(); return true;
  }
  if(act==="offcopy"){
    const text=o.mailEdited?o.mailText:offerMailText(o);
    try{ await navigator.clipboard.writeText(text); toast("Mejltexten är kopierad."); }
    catch(e){ const el=document.getElementById("k-mailtext"); if(el){ el.focus(); el.select(); } toast("Markerad – kopiera med Ctrl/Cmd + C."); }
    return true;
  }
  if(act==="offdel"){
    if(!o.id) return true;
    if(!confirmTwice("offdel")) { toast("Tryck på Ta bort en gång till för att ta bort offerten."); return true; }
    const ok=await guard(function(){ return Store.del("offers/"+o.id); }, "Offerten är borttagen.");
    if(ok){
      for(const f of aiFilesFor("offer:"+o.id)){ try{ await deleteAiFile(f.id); }catch(e){ console.error(e); } }
      S.offers=(S.offers||[]).filter(x=>x.id!==o.id); S.off=null; S.offSel=null; render();
    }
    return true;
  }
  return false;
}
/* Ett andra tryck inom fyra sekunder bekräftar en borttagning – utan
   webbläsarens confirm-ruta, som stoppar allt annat på sidan. */
const twice={};
function confirmTwice(key){
  const now=Date.now();
  if(twice[key] && now-twice[key]<4000){ delete twice[key]; return true; }
  twice[key]=now; return false;
}

/* ============================ render ============================ */
let lastViewTab=null;
function render(){
  if(!configured){ app.innerHTML=viewSetup()+supportBar(); return; }
  if(S.phase==="boot"){ app.innerHTML='<div class="skel">Startar '+esc(cfg("appName"))+'…</div>'; return; }
  if(S.phase==="onboarding"){ app.innerHTML=viewOnboarding()+supportBar(); return; }
  if(S.phase==="fixup"){ app.innerHTML=viewFixup()+supportBar(); return; }
  if(!S.me){
    app.innerHTML=viewLogin()+supportBar();
    const u=document.getElementById("l-user"); if(u && !S.busy) u.focus();
    return;
  }
  let body;
  if(S.tab==="attest" && isAdmin()) body=viewAttest();
  else if(S.tab==="personal" && isAdmin()) body=viewPersonal();
  else if(S.tab==="arkiv" && isAdmin()) body=viewArkiv();
  else if(S.tab==="listor" && isAdmin()) body=viewListor();
  else if(S.tab==="inkorg" && isSupport()) body=viewInkorg();
  else if(S.tab==="utseende" && isSupport()) body=viewUtseende();
  else if(S.tab==="kalkyl" && isAdmin()) body=viewKalkyl();
  else if(S.tab==="statistik" && isAdmin()) body=viewStatistik();
  else if(S.tab==="lon" && isAdmin()) body=viewLon();
  else if(S.tab==="projekt") body=viewProjekt();
  else if(S.tab==="kor") body=viewKor();
  else body=viewTid();
  /* Allt i #app byggs om. Det man håller på att skriva får inte försvinna för
     att något annat sparas i bakgrunden – samma månad från en annan enhet,
     eller Firestores egen bekräftelse av en sparning. */
  const fokus=document.activeElement && app.contains(document.activeElement) ? document.activeElement : null;
  const fokusId=fokus && fokus.id, selS=fokus && fokus.selectionStart, selE=fokus && fokus.selectionEnd;
  /* Mjuk övergång bara när man faktiskt byter flik – inte vid varje
     bakgrundssparning, så att det man skriver aldrig hoppar till. */
  const swap = S.tab!==lastViewTab; lastViewTab=S.tab;
  app.innerHTML=topbar()+'<div class="view'+(swap?' view--enter':'')+'">'+body+'</div>'+supportBar();
  if(dirty.size){
    dirty.forEach(function(v, id){
      const el=document.getElementById(id);
      if(!el || !app.contains(el)) return;
      if(el.type==="checkbox") el.checked=v.checked; else el.value=v.value;
    });
    if(document.getElementById("f-type")) { try{ syncProjField(); }catch(e){} }
  }
  if(fokusId){
    const el=document.getElementById(fokusId);
    if(el && app.contains(el)){
      el.focus({preventScroll:true});
      try{ if(selS!=null) el.setSelectionRange(selS, selE); }catch(e){}
    }
  }
  if(S.tab==="kalkyl" && S.off) offerLive();
  prefsSave();
}
/* Realtidsuppdateringar kommer ofta i par (lokal sparning + serverns svar).
   Samla dem till en enda omritning. */
let renderQueued=false;
function scheduleRender(){
  if(renderQueued) return;
  renderQueued=true;
  requestAnimationFrame(function(){ renderQueued=false; render(); });
}

/* ============================ händelser ============================ */
function shift(dir){
  const c=new Date(S.cursor);
  if(S.tab==="attest") c.setDate(c.getDate()+7*dir);
  else if(S.tab==="kor") c.setMonth(c.getMonth()+dir);
  else if(S.tab==="projekt"){ if(S.projPeriod==="week") c.setDate(c.getDate()+7*dir); else c.setMonth(c.getMonth()+dir); }
  else if(S.view==="month") c.setMonth(c.getMonth()+dir);
  else if(S.view==="week") c.setDate(c.getDate()+7*dir);
  else c.setDate(c.getDate()+dir);
  S.cursor=c;
}
async function guard(fn, okMsg){
  try{ await fn(); if(okMsg) toast(okMsg); return true; }
  catch(err){
    console.error(err);
    toast(err && err.code==="permission-denied"
      ? "Du har inte behörighet till den ändringen."
      : "Kunde inte spara. Kontrollera nätet – ändringen skickas när du är online igen.");
    return false;
  }
}

/* Fält i appen som användaren ändrat sedan senaste handling. Töms så fort
   användaren trycker på något – då har hen gått vidare. */
const dirty=new Map();
function markDirty(ev){
  const el=ev.target;
  if(!el || !el.id || !app.contains(el)) return;
  if(!/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
  dirty.set(el.id, {value:el.value, checked:!!el.checked});
}
document.addEventListener("input", markDirty, true);
document.addEventListener("change", markDirty, true);

document.addEventListener("click", async function(ev){
  const t=ev.target.closest("[data-act]");
  if(!t) return;
  const act=t.dataset.act;
  dirty.clear();
  if(act==="noop") return;
  if(/^(off|lr)/.test(act) && S.tab==="kalkyl" && await handleKalkyl(act, t)) return;
  if(act==="doupdate"){ location.reload(); return; }
  if(act==="ovl"){ if(ev.target===t) closeModal(); return; }
  if(act==="close"){ closeModal(); return; }
  if(act==="support"){ supportModal("",""); return; }
  if(act==="sendsupport"){ await sendSupport(); return; }

  if(act==="install"){
    const e=S.installEvt; S.installEvt=null;
    if(e){ e.prompt(); try{ await e.userChoice; }catch(err){} }
    render(); return;
  }

  /* --- uppstart & inloggning --- */
  if(act==="setupadmin"){
    const name=(document.getElementById("o-name").value||"").trim();
    const user=uname(document.getElementById("o-user").value);
    const pw=document.getElementById("o-pw").value||"";
    const demo=document.getElementById("o-demo").checked;
    if(!name){ S.loginErr="Fyll i ditt namn."; render(); return; }
    if(user.length<2){ S.loginErr="Välj ett kontonamn på minst två tecken (bokstäver och siffror)."; render(); return; }
    if(pw.length<6){ S.loginErr="Lösenordet måste vara minst sex tecken."; render(); return; }
    try{
      const meta=await getDoc(doc(db,"meta","app"));
      if(meta.exists()){
        S.metaExists=true;
        S.loginErr="Firman är redan uppsatt. Logga in med superadmin-kontot i stället – nya profiler skapas inne i appen under Personal & konton.";
        render(); return;
      }
    }catch(e){ /* kan inte läsas – felet visas nedan om skapandet misslyckas */ }
    S.busy=true; S.loginErr=""; S.creating=true; render();
    try{
      await setPersistence(auth, browserLocalPersistence);
      const cred=await createUserWithEmailAndPassword(auth, emailFor(user), pw);
      await setDoc(doc(db,"meta","app"), {ownerUid:cred.user.uid, created:new Date().toISOString()});
      await setDoc(doc(db,"employees",cred.user.uid), {name:name, username:user, role:"admin", createdAt:new Date().toISOString()});
      if(demo) await seedProjects();
      S.creating=false; S.busy=false;
      await enterApp(cred.user);
    }catch(err){
      console.error(err);
      S.creating=false; S.busy=false;
      S.loginErr=authMsg(err && err.code);
      S.phase="onboarding"; render();
    }
    return;
  }
  if(act==="login"){
    const rawUser=String(document.getElementById("l-user").value||"").trim();
    const user=rawUser.indexOf("@")>0 ? rawUser.toLowerCase() : uname(rawUser);
    const pw=document.getElementById("l-pw").value||"";
    const keep=document.getElementById("l-keep").checked;
    if(!user||!pw){ S.loginErr="Fyll i både kontonamn och lösenord."; render(); return; }
    S.busy=true; S.loginErr=""; render();
    try{
      await setPersistence(auth, keep?browserLocalPersistence:browserSessionPersistence);
      await signInWithEmailAndPassword(auth, await loginEmail(user), pw);
      S.loginErr="";
    }catch(err){
      S.loginErr=authMsg(err && err.code);
      S.busy=false; render(); return;
    }
    S.busy=false;
    return;
  }
  if(act==="retryprofile"){
    const u=S.pendingUser||auth.currentUser;
    if(!u){ S.phase="ready"; render(); return; }
    S.fixMsg=""; S.busy=true; render();
    await enterApp(u); return;
  }
  if(act==="repairprofile"){
    const u=S.pendingUser||auth.currentUser;
    if(!u) return;
    const nameEl=document.getElementById("fx-name");
    const name=(nameEl&&nameEl.value||"").trim()||String(u.email||"admin").split("@")[0];
    const user=String(u.email||"").split("@")[0];
    S.busy=true; S.fixMsg=""; render();
    try{
      let metaOwner=null;
      try{
        const m=await getDoc(doc(db,"meta","app"));
        if(m.exists()) metaOwner=m.data().ownerUid;
      }catch(e){}
      if(!metaOwner) await setDoc(doc(db,"meta","app"), {ownerUid:u.uid, created:new Date().toISOString()});
      await setDoc(doc(db,"employees",u.uid),
        {name:name, username:user, role:"admin", createdAt:new Date().toISOString()});
      S.busy=false;
      await enterApp(u);
      toast("Profilen är skapad. Välkommen in.");
    }catch(e){
      console.error(e);
      S.busy=false;
      S.fixMsg = (e && e.code==="permission-denied")
        ? "Databasen nekade skrivningen. Säkerhetsreglerna är inte publicerade – klistra in dem i Firestore → Rules och tryck Publish, kom sedan tillbaka och försök igen."
        : "Kunde inte skapa profilen. Felkod: "+((e&&e.code)||"okänt");
      render();
    }
    return;
  }
  if(act==="sendreset"){
    if(!isAdmin()) return;
    const e=S.employees.find(x=>x.id===t.dataset.e);
    if(!e||!looksReal(e.authEmail)) return;
    try{
      await sendPasswordResetEmail(auth, e.authEmail);
      closeModal(); toast("Återställningslänk skickad till "+e.authEmail+".");
    }catch(err){ empModal(t.dataset.e, authMsg(err && err.code)); }
    return;
  }
  if(act==="forgot"){ forgotModal("",""); return; }
  if(act==="doforgot"){
    const u=uname(document.getElementById("fg-user").value);
    const note=(document.getElementById("fg-note").value||"").trim();
    if(u.length<2) return forgotModal("Skriv ditt kontonamn.","");
    S.busy=true; forgotModal("","");
    let mailed=false;
    const addr=await loginEmail(u);
    if(looksReal(addr)){
      try{ await sendPasswordResetEmail(auth, addr); mailed=true; }catch(e){ console.error(e); }
    }
    let logged=false;
    try{
      const sid=String(Date.now())+"-"+uid();
      await Store.set("support/"+sid, {
        id:sid, done:false, name:u, contact:"", app:cfg("appName","Ellingesmide"), version:APP_VERSION,
        message:"Glömt lösenord. Kontonamn: "+u+(note?" – "+note:"")+(mailed?" (återställningsmejl skickat)":" (inget mejl kunde skickas – kontot saknar riktig e-post)"),
        page:"inloggning", role:"okänd", account:u, project:firebaseConfig.projectId||"",
        at:new Date().toISOString(), agent:(navigator.userAgent||"").slice(0,180)
      });
      logged=true;
    }catch(e){ console.error(e); }
    S.busy=false;
    if(mailed||logged) forgotModal("", mailed
      ? "Ett mejl med återställningslänk är skickat. Kolla skräpposten om det dröjer."
      : "Din begäran är skickad till supporten. De hör av sig med ett nytt lösenord.");
    else forgotModal("Kunde inte skicka just nu. Kontrollera nätet och försök igen.","");
    return;
  }
  if(act==="goonboarding"){ S.phase="onboarding"; S.loginErr=""; render(); return; }
  if(act==="gologin"){ S.phase="ready"; S.loginErr=""; render(); return; }
  if(act==="memenu"){ meModal("",""); return; }
  if(act==="changepw"){
    const oldPw=document.getElementById("m-old").value||"";
    const newPw=document.getElementById("m-new").value||"";
    if(newPw.length<6) return meModal("Det nya lösenordet måste vara minst sex tecken.","");
    try{
      const cred=EmailAuthProvider.credential(S.me.authEmail||emailFor(S.me.username), oldPw);
      await reauthenticateWithCredential(auth.currentUser, cred);
      await updatePassword(auth.currentUser, newPw);
      closeModal(); toast("Lösenordet är bytt.");
    }catch(err){ meModal(authMsg(err && err.code),""); }
    return;
  }
  if(act==="addmail"){
    /* Byter inloggningsadress från den interna till en riktig e-postadress.
       Kontonamnet är kvar – uppslaget i usernames pekar om till den nya adressen. */
    const mail=(document.getElementById("m-mail").value||"").trim().toLowerCase();
    const pw=document.getElementById("m-mailpw").value||"";
    if(!looksReal(mail)) return meModal("Skriv en riktig e-postadress.","");
    if(!pw) return meModal("Fyll i ditt nuvarande lösenord.","");
    try{
      const cred=EmailAuthProvider.credential(S.me.authEmail||emailFor(S.me.username), pw);
      await reauthenticateWithCredential(auth.currentUser, cred);
      await updateEmail(auth.currentUser, mail);
      /* Färsk inloggningsbiljett med den nya adressen – reglerna kontrollerar
         att kontonamnet bara pekas om till den adress man faktiskt har. */
      try{ await auth.currentUser.getIdToken(true); }catch(e){}
      const body=Object.assign({}, S.me, {authEmail:mail, email:S.me.email||mail});
      delete body.id;
      let lookupOk=true;
      try{ await Store.set("usernames/"+uname(S.me.username), {email:mail, name:S.me.name}); }catch(e){ console.error(e); lookupOk=false; }
      try{ await Store.set("employees/"+S.me.id, body); }catch(e){ console.error(e); }
      S.me=Object.assign({id:S.me.id}, body);
      const i=S.employees.findIndex(e=>e.id===S.me.id);
      if(i>=0) S.employees[i]=S.me;
      closeModal(); toast(lookupOk ? "E-postadressen är kopplad. Nu går det att återställa lösenordet."
        : "E-postadressen är kopplad. Logga hädanefter in med e-postadressen i stället för kontonamnet.");
      render();
    }catch(err){ console.error(err); meModal(authMsg(err && err.code),""); }
    return;
  }
  if(act==="logout"){
    closeModal();
    S.unsubs.forEach(x=>{try{x();}catch(e){}}); S.unsubs=[];
    await signOut(auth);
    return;
  }
  if(!S.me) return;

  const emp=(isAdmin() ? S.employees.find(e=>e.id===S.targetEmp) : null) || S.me;
  const wk=t.dataset.w || wkey(S.cursor);

  /* --- navigation --- */
  if(act==="tab"){
    S.tab=t.dataset.v; S.projSel=null;
    if(S.tab==="attest"){ await loadMonthsFor(weekMonths(wkey(S.cursor))); await loadWeekApprovals(); await loadReminderData(); }
    if(S.tab==="personal"){ await loadMonthsFor(weekMonths(wkey(S.cursor))); }
    if(S.tab==="projekt"||S.tab==="statistik"){ await loadProjectData(); }
    if(S.tab==="arkiv"){ await loadArchive(); await loadBackups(); await loadProjectData(); }
    if(S.tab==="inkorg"){ await loadInbox(); }
    if(S.tab==="kor"){ await loadKor(); }
    if(S.tab==="kalkyl"){ S.off=null; S.offSel=null; await loadOffers(); }
    if(S.tab==="lon"){ await loadLon(); }
    render(); return;
  }

  /* --- körjournal --- */
  if(act==="korveh"){ if(isAdmin()) vehModal(t.dataset.v||"", ""); return; }
  if(act==="saveveh"){
    if(!isAdmin()) return;
    const id=t.dataset.v;
    const regnr=(document.getElementById("v-reg").value||"").trim().toUpperCase().replace(/\s+/g,"");
    const name=(document.getElementById("v-name").value||"").trim();
    const note=(document.getElementById("v-note").value||"").trim();
    if(regnr.length<2) return vehModal(id,"Fyll i registreringsnumret.");
    if(S.vehicles.some(v=>v.id!==id && String(v.regnr).toUpperCase()===regnr))
      return vehModal(id,"Den bilen finns redan.");
    const vid=id||slug("bil-"+regnr);
    const old=id?vehById(id):null;
    const body={id:vid, regnr:regnr, name:name, note:note, unit:"km", active:true,
      createdAt:(old&&old.createdAt)||new Date().toISOString()};
    await guard(async function(){
      await Store.set("vehicles/"+vid, body);
      const i=S.vehicles.findIndex(v=>v.id===vid);
      if(i>=0) S.vehicles[i]=body; else S.vehicles.push(body);
      S.vehicles.sort((a,b)=>String(a.regnr).localeCompare(String(b.regnr),"sv"));
    }, id?"Bilen är uppdaterad.":"Bilen är tillagd. Skriv ut QR-koden och sätt i bilen.");
    closeModal(); render(); return;
  }
  if(act==="delveh"){
    if(!isAdmin()) return;
    confirmModal("Ta bort bilen?","Bilen försvinner ur listan och dess QR-kod slutar fungera. Redan sparade resor ligger kvar i journalen.","delveh2",t.dataset.v,"v");
    return;
  }
  if(act==="delveh2"){
    if(!isAdmin()) return;
    const vid=t.dataset.v;
    await guard(async function(){
      await Store.del("vehicles/"+vid);
      S.vehicles=S.vehicles.filter(v=>v.id!==vid);
    }, "Bilen är borttagen.");
    if(S.korVeh===vid) S.korVeh="";
    closeModal(); render(); return;
  }
  if(act==="korqr"){ if(isAdmin()) qrModal(t.dataset.v); return; }
  if(act==="korprint"){ window.print(); return; }

  if(act==="korscan"){ scanModal(t.dataset.v, t.dataset.p, ""); return; }
  if(act==="scretake"){
    if(S.scan){ S.scan.photo=""; S.scan.cells=null; S.scan.km=(document.getElementById("sc-km")||{}).value||""; }
    scanModal(S.scan.vehId, S.scan.phase, ""); return;
  }
  if(act==="scshoot"){
    const hint=document.getElementById("sc-hint");
    const cv=grabFrame();
    if(!cv){ if(hint) hint.textContent="Kameran är inte igång. Skriv in mätarställningen för hand."; return; }
    /* liten kopia sparas som bevis, en uppljusad kopia går till sifferavläsningen */
    /* Fotot är ett bevis på vad mätaren visade, inte ett fotografi att förstora.
       Det hålls litet med flit: varje resa hämtas varje gång körjournalen öppnas,
       och stora bilder gör fliken seg på mobil långt innan året är slut. */
    const small=document.createElement("canvas");
    const sw=Math.min(360, cv.width); small.width=sw; small.height=Math.round(cv.height*sw/cv.width);
    small.getContext("2d").drawImage(cv,0,0,small.width,small.height);
    let photo=""; try{ photo=small.toDataURL("image/jpeg",0.5); }catch(e){}
    if(photo.length>60000) photo="";       /* orimligt stort – spara hellre inget */
    if(S.scan){ S.scan.photo=photo; }
    const wide=S.aiMeterOff?"":grabWide();
    stopScan();
    showShot(photo||small.toDataURL("image/png"));
    if(hint) hint.textContent="Läser av siffrorna…";
    try{
      const scan=S.scan;
      const before=(document.getElementById("sc-km")||{}).value||"";
      /* telefonens avläsning och AI:n arbetar samtidigt */
      const aiP=aiMeter(wide, scan);
      let res;
      try{ res=await readMeter(cv, scan); }
      catch(e){ res={value:"", hint:"", failed:e}; }
      if(S.scan!==scan) return;            /* dialogen har stängts eller bytts under tiden */
      if(wide && !S.aiMeterOff && hint) hint.textContent=(res.value?"Avläst "+mfm.format(+res.value)+" km. ":"")+"AI:n kontrollerar fotot…";
      const ai=await aiP;
      if(S.scan!==scan) return;
      const box=document.getElementById("sc-km");
      if(box && box.value!==before){ if(hint) hint.textContent="Du har skrivit in ett värde – det används."; updateCalc(); return; }
      /* AI:n ser hela panelen och vet vilket tal som är totalmätaren, så den
         går före när den är säker. Är den osäker visas dess råd till föraren. */
      if(ai && ai.km && ai.confidence!=="låg"){
        const agree=res.value && +res.value===ai.km;
        if(box){ box.value=String(ai.km); scan.km=String(ai.km); }
        if(hint) hint.textContent=(ai.message||("Avläst: "+mfm.format(ai.km)+" km. Stämmer det med mätaren?"))
          +(agree?" Telefonens avläsning ger samma värde.":"");
        updateCalc(); return;
      }
      if(res.failed && !(ai && (ai.km || ai.message))) throw res.failed;
      if(!res.value && ai && ai.km){
        if(box){ box.value=String(ai.km); scan.km=String(ai.km); }
        if(hint) hint.textContent=(ai.message||"")+" Osäker avläsning – kontrollera varje siffra mot mätaren.";
        updateCalc(); return;
      }
      if(!res.value && ai && ai.message){ if(hint) hint.textContent=ai.message; updateCalc(); return; }
      if(res.value){
        if(box){ box.value=res.value; scan.km=res.value; }
        if(hint) hint.textContent=res.hint;
      }else{
        if(hint) hint.textContent=res.hint;
      }
    }catch(e){
      /* Avläsningen är en hjälp, inte ett krav – fotot och den manuella
         inmatningen fungerar ändå, så det här är en upplysning och inget fel. */
      console.warn("Körjournal: sifferavläsning ej tillgänglig –", (e&&e.message)||e);
      if(hint) hint.textContent="Sifferavläsningen kunde inte startas. Skriv in mätarställningen i rutan – fotot är sparat.";
    }
    updateCalc();
    return;
  }
  if(act==="scsave"){
    const vid=t.dataset.v, phase=t.dataset.p, v=vehById(vid);
    if(!v) return;
    if(S.scan && S.scan.saving) return;
    const ocrCells=S.scan&&S.scan.vehId===vid?S.scan.cells:null, ocrRead=S.scan&&S.scan.vehId===vid?S.scan.readText:"";
    const raw=(document.getElementById("sc-km")||{}).value||"";
    const km=parseInt(String(raw).replace(/\D/g,""),10);
    if(!km || isNaN(km)) return scanModal(vid, phase, "Fyll i mätarställningen i kilometer.");
    const photo=(S.scan&&S.scan.photo)||"";
    if(S.scan) S.scan.saving=true;
    if(phase==="start"){
      const id=slug("resa-"+v.regnr);
      const body={id:id, vehicleId:vid, regnr:v.regnr, empId:S.me.id, empName:S.me.name,
        projectId:(document.getElementById("sc-proj")||{}).value||"",
        kind:(document.getElementById("sc-kind")||{}).value||"tjanst",
        purpose:((document.getElementById("sc-purpose")||{}).value||"").trim(),
        startKm:km, startAt:new Date().toISOString(), photoStart:"", hasStart:!!photo,
        endKm:0, endAt:"", km:0, photoEnd:"", hasEnd:false, status:"open"};
      if(body.projectId) S.lastProj=body.projectId;
      const ok=await guard(async function(){
        await Store.set("trips/"+id, body);
        if(photo) await saveTripPhoto(id, S.me.id, "start", photo);
        S.trips.unshift(body);
      }, "Resan är startad vid "+mfm.format(km)+" km.");
      if(S.scan) S.scan.saving=false;
      if(!ok) return;
      ocrLearnAfterSave(vid, km, ocrCells, ocrRead);
    }else{
      const prev=openTripHere(vid);
      if(!prev) return scanModal(vid, phase, "Resan hittades inte längre.");
      if(km<=(+prev.startKm||0))
        return scanModal(vid, phase, "Slutvärdet måste vara högre än startvärdet ("+mfm.format(prev.startKm)+" km).");
      const other=prev.empId!==S.me.id;
      const body=Object.assign({}, prev, {endKm:km, endAt:new Date().toISOString(),
        km:km-(+prev.startKm||0), photoEnd:"", hasEnd:!!photo, status:"done"});
      if(other){ body.closedById=S.me.id; body.closedByName=S.me.name; }
      delete body._id;
      const ok=await guard(async function(){
        /* Avslutar man någon annans resa sparas resan först – säkerhetsreglerna
           släpper bara in slutfotot när resan visar vem som avslutade den. */
        if(other && !isAdmin()){
          await Store.set("trips/"+prev.id, body);
          if(photo){ try{ await saveTripPhoto(prev.id, S.me.id, "end", photo); }catch(e){ console.error(e); } }
        }else{
          if(photo) await saveTripPhoto(prev.id, prev.empId, "end", photo);
          await Store.set("trips/"+prev.id, body);
        }
        const i=S.trips.findIndex(x=>x.id===prev.id);
        if(i>=0) S.trips[i]=body;
      }, (other?"Resan som "+(prev.empName||"en annan förare")+" startade är avslutad: ":"Resan är sparad: ")
         +mfm.format(body.km)+" km ("+fmt(milOf(body.km))+" mil).");
      if(S.scan) S.scan.saving=false;
      if(!ok) return;
      ocrLearnAfterSave(vid, km, ocrCells, ocrRead);
    }
    closeModal(); render(); return;
  }

  if(act==="kortrip"){
    tripModal(t.dataset.t,"");
    const tr=S.trips.find(x=>x.id===t.dataset.t);
    if(tr) loadTripPhotos(tr);
    return;
  }
  if(act==="savetrip"){
    const id=t.dataset.t, old=S.trips.find(x=>x.id===id);
    if(!old) return;
    if(!isAdmin() && old.empId!==S.me.id) return;
    const s=parseInt(String((document.getElementById("t-start")||{}).value||"").replace(/\D/g,""),10);
    const e=parseInt(String((document.getElementById("t-end")||{}).value||"").replace(/\D/g,""),10);
    if(!s || isNaN(s)) return tripModal(id,"Startvärdet måste vara ett tal.");
    const closing=old.status==="open" && t.dataset.end==="1";
    if(closing && (!e || isNaN(e)))
      return tripModal(id,"Fyll i mätarställningen vid slut för att avsluta resan.");
    if((old.status==="done"||closing) && (!e || isNaN(e) || e<=s))
      return tripModal(id,"Slutvärdet måste vara högre än startvärdet.");
    const done=old.status==="done"||closing;
    const body=Object.assign({}, old, {
      startKm:s, endKm:done?e:0, km:done?e-s:0, status:done?"done":old.status,
      endAt:closing?new Date().toISOString():(old.endAt||""),
      projectId:(document.getElementById("t-proj")||{}).value||"",
      kind:(document.getElementById("t-kind")||{}).value||"tjanst",
      purpose:((document.getElementById("t-purpose")||{}).value||"").trim()});
    if(closing && old.empId!==S.me.id){ body.closedById=S.me.id; body.closedByName=S.me.name; }
    delete body._id;
    await guard(async function(){
      await Store.set("trips/"+id, body);
      const i=S.trips.findIndex(x=>x.id===id);
      if(i>=0) S.trips[i]=body;
    }, closing?"Resan är avslutad: "+mfm.format(e-s)+" km.":"Resan är uppdaterad.");
    closeModal(); render(); return;
  }
  if(act==="deltrip"){
    const id=t.dataset.t, old=S.trips.find(x=>x.id===id);
    if(!old) return;
    if(!isAdmin() && old.empId!==S.me.id) return;
    await guard(async function(){
      await Store.del("trips/"+id);
      for(const w of ["start","end"]){ try{ await Store.del("tripphotos/"+id+"__"+w); }catch(e){} }
      S.trips=S.trips.filter(x=>x.id!==id);
    }, "Resan är borttagen.");
    closeModal(); render(); return;
  }
  if(act==="korbook"){
    if(!isAdmin()) return;
    const pid=t.dataset.p, ym=mkey(S.cursor);
    const km=korRows().reduce(function(a,x){
      return a + ((x.status==="done" && x.kind!=="privat" && (x.projectId||"")===pid) ? (+x.km||0) : 0);
    },0);
    if(!km) return toast("Ingen tjänstekörning att bokföra på projektet.");
    const mil=milOf(km), price=+costOf("mil").price||0;
    /* Fast id per projekt och månad: trycker man två gånger skrivs samma post
       över med den aktuella summan i stället för att det blir dubbletter. */
    const id="mil-"+pid+"-"+ym;
    const body={id:id, projectId:pid, kind:"mil", date:dkey(new Date()),
      desc:"Körjournal "+monthName(ym), supplier:"",
      qty:mil, unit:costOf("mil").unit, unitPrice:r2(price), amount:r2(mil*price),
      byId:S.me.id, byName:S.me.name, createdAt:new Date().toISOString()};
    await guard(async function(){
      await Store.set("costs/"+id, body);
      const i=S.costs.findIndex(x=>x.id===id);
      if(i>=0) S.costs[i]=body; else S.costs.push(body);
    }, fmt(mil)+" mil bokförda på "+projName(pid)+" för "+monthName(ym)+"."
       + (price?"":" Obs: à-priset för milersättning står på 0 kr under Listor, så posten blir 0 kr."));
    return;
  }
  if(act==="korxls"){
    if(!isAdmin()) return;
    if(!(await ensureXLSX())) return toast("Excel-biblioteket kunde inte laddas. Kontrollera nätet och försök igen.");
    const ym=mkey(S.cursor);
    const rows=korRows().filter(x=>x.status==="done").slice().reverse();
    if(!rows.length) return toast("Inga avslutade resor att exportera den här månaden.");
    const aoa=[["Datum","Registreringsnummer","Förare","Projekt","Typ","Ärende",
                "Mätare start (km)","Mätare slut (km)","Km","Mil"]];
    rows.forEach(function(x){
      aoa.push([dagText(x.startAt), x.regnr||"", x.empName||"",
        x.projectId?projName(x.projectId):"", TRIPKIND[x.kind]||"", x.purpose||"",
        +x.startKm||0, +x.endKm||0, +x.km||0, milOf(x.km)]);
    });
    const tj=rows.filter(x=>x.kind!=="privat").reduce((a,x)=>a+(+x.km||0),0);
    const pv=rows.filter(x=>x.kind==="privat").reduce((a,x)=>a+(+x.km||0),0);
    aoa.push([], ["Summa tjänsteresor","","","","","","","",tj,milOf(tj)],
                 ["Summa privata resor","","","","","","","",pv,milOf(pv)]);
    const wb=window.XLSX.utils.book_new();
    const ws=window.XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"]=[{wch:12},{wch:16},{wch:18},{wch:26},{wch:14},{wch:28},{wch:16},{wch:16},{wch:10},{wch:10}];
    window.XLSX.utils.book_append_sheet(wb, ws, "Körjournal");
    window.XLSX.writeFile(wb, "Korjournal-"+ym+".xlsx");
    return;
  }
  if(act==="lstadd"||act==="lstdel"||act==="lstsave"||act==="lstreset"){
    if(!isAdmin()) return;
    if(act==="lstreset"){
      await guard(async function(){ await Store.del("settings/lists"); S.lists={}; }, "Listorna är återställda.");
      render(); return;
    }
    const cur=readLists();
    if(act==="lstadd"){
      if(t.dataset.lst==="t") cur.types.push({key:"", label:"Ny typ", short:"NY", proj:true, bill:true, abs:false, cls:"work"});
      else cur.costs.push({key:"", label:"Nytt kostnadsslag", unit:"st", price:0, bill:true});
    }
    if(act==="lstdel"){
      const i=+t.dataset.i;
      if(t.dataset.lst==="t") cur.types.splice(i,1); else cur.costs.splice(i,1);
      if(!cur.types.length){ toast("Det måste finnas minst en tidtyp."); return; }
      if(!cur.costs.length){ toast("Det måste finnas minst ett kostnadsslag."); return; }
    }
    /* nya rader får sin nyckel när de sparas */
    const takenT=[], takenC=[];
    cur.types.forEach(function(x){ if(!x.key) x.key=listKey(x.label,takenT); takenT.push(x.key); });
    cur.costs.forEach(function(x){ if(!x.key) x.key=listKey(x.label,takenC); takenC.push(x.key); });
    const body={types:cur.types, costs:cur.costs, updatedAt:new Date().toISOString(), updatedBy:S.me.name};
    if(act==="lstsave"){
      await guard(async function(){ await Store.set("settings/lists", body); S.lists=body; }, "Listorna är sparade för alla.");
    }else{
      S.lists=body;   /* lägg till / ta bort visas direkt, sparas när du trycker Spara */
    }
    render(); return;
  }
  if(act==="inbf"){ S.inboxFilter=t.dataset.v; render(); return; }
  if(act==="inbreload"){ await loadInbox(); render(); return; }
  if(act==="inbdone"){
    const x=S.inbox.find(y=>(y.id||y._id)===t.dataset.i);
    if(!x) return;
    x.done=!x.done; x.doneBy=S.me.name; x.doneAt=new Date().toISOString();
    await guard(function(){ return Store.set("support/"+(x.id||x._id), x); });
    render(); return;
  }
  if(act==="inbdel"){
    const id=t.dataset.i;
    await guard(async function(){ await Store.del("support/"+id); S.inbox=S.inbox.filter(y=>(y.id||y._id)!==id); }, "Borttagen.");
    render(); return;
  }
  if(act==="brandpreview"||act==="brandsave"||act==="brandreset"){
    if(!isSupport()) return;
    if(act==="brandreset"){
      await guard(async function(){ await Store.del("settings/app"); S.settings={}; }, "Återställt till standard.");
      applySettings(); render(); return;
    }
    const val=id=>{ const el=document.getElementById(id); return el?String(el.value||"").trim():""; };
    const inkSel=val("b-ink");
    const ink = inkSel==="custom" ? val("b-inkhex") : inkSel;
    const body={
      appName:val("b-name")||DEFAULTS.appName,
      tagline:cfg("tagline",""),
      company:val("b-comp"),
      loginHelp:val("b-login"),
      supportLabel:val("b-sup")||DEFAULTS.supportLabel,
      vat:(function(){ const v=parseHours(val("b-vat")); return isNaN(v)?25:r2(v); })(),
      tabs:{}, roles:{},
      theme:{mode:val("b-mode")||"auto", ink:/^#[0-9a-fA-F]{3,8}$/.test(ink)?ink:"", ground:cfg("theme.ground","")},
      updatedAt:new Date().toISOString(), updatedBy:S.me.name
    };
    ["tid","mitt","projekt","statistik","kalkyl","attest","lon","arkiv","personal","inkorg","utseende"].forEach(function(k){
      body.tabs[k]=val("b-tab-"+k)||DEFAULTS.tabs[k];
    });
    ["arbetare","admin","support"].forEach(function(r){ body.roles[r]=val("b-role-"+r)||DEFAULTS.roles[r]; });
    if(act==="brandpreview"){
      S.settings=body; S.vat=body.vat; applySettings(); render();
      toast("Så här blir det. Tryck Spara för alla när du är nöjd.");
      return;
    }
    await guard(async function(){
      await Store.set("settings/app", body);
      S.settings=body; S.vat=body.vat;
    }, "Sparat. Alla ser det nästa gång de laddar appen.");
    applySettings(); render(); return;
  }
  if(act==="remind"){ if(isAdmin()){ await loadReminderData(); remindModal(); } return; }
  if(act==="remone"||act==="remall"){
    /* Länken öppnar mejl eller sms av sig själv – vi noterar bara att det är gjort. */
    const wk=lastWeekKey();
    const list = act==="remall" ? pendingFor(wk).filter(x=>x.emp.email)
                                : pendingFor(wk).filter(x=>x.emp.id===t.dataset.e);
    await markReminded(list, wk, t.dataset.ch||"mejl");
    setTimeout(function(){ if(inModal()) remindModal(); }, 600);
    return;
  }
  if(act==="remopen"){
    if(!isAdmin()) return;
    closeModal();
    S.tab="tid"; S.view="week";
    S.cursor=weekMonday(lastWeekKey());
    await selectEmployee(t.dataset.e);
    render(); return;
  }
  if(act==="arkf"){ S.arkFilter=t.dataset.v; render(); return; }
  if(act==="arkdl"){
    const a=S.archive.find(x=>x.id===t.dataset.a);
    if(!a||!a.stored){ toast("Filen är för stor för att sparas i databasen – hämta den från servern."); return; }
    let data=a.data;
    if(!data){
      try{ const d=await Store.get("archivedata/"+a.id); data=d&&d.data; }catch(e){ console.error(e); }
    }
    if(!data){ toast("Filen hittades inte i databasen."); return; }
    downloadBlob(b64ToBlob(data), a.filename);
    return;
  }
  if(act==="arkkeep"){
    const a=S.archive.find(x=>x.id===t.dataset.a);
    if(!a) return;
    a.keep=!a.keep;
    const meta=Object.assign({}, a); delete meta._id;
    await guard(function(){ return Store.set("archive/"+a.id, meta); }, a.keep?"Filen är låst.":"Låset är borta.");
    render(); return;
  }
  if(act==="arkdel"){
    const id=t.dataset.a;
    await guard(async function(){
      await Store.del("archive/"+id);
      try{ await Store.del("archivedata/"+id); }catch(e){}
      S.archive=S.archive.filter(x=>x.id!==id);
    }, "Filen är borttagen.");
    render(); return;
  }
  if(act==="arkpurge"){
    const limit=new Date(); limit.setDate(limit.getDate()-90);
    const old=S.archive.filter(a=>!a.keep && new Date(a.createdAt)<limit);
    if(!old.length){ toast("Inga olåsta filer äldre än 90 dagar."); return; }
    await guard(async function(){
      for(const a of old){ await Store.del("archive/"+a.id); try{ await Store.del("archivedata/"+a.id); }catch(e){} }
      S.archive=S.archive.filter(a=>old.indexOf(a)<0);
    }, old.length+" filer rensade.");
    render(); return;
  }
  /* ---- säkerhetskopior ---- */
  if(act==="bknow"){
    if(!isAdmin()) return;
    const head=await runDailyBackup(true);
    render();
    toast(head?"Säkerhetskopia tagen.":(S.backupState?S.backupState.msg:"Kunde inte ta kopian."));
    return;
  }
  if(act==="bkdl"){
    if(!isAdmin()) return;
    const date=t.dataset.b;
    const head=S.backups.find(function(b){ return b.date===date; });
    if(!head) return;
    try{
      const text=await readBackup(date, head.parts||0);
      downloadBlob(new Blob([text],{type:"application/json"}), "sakerhetskopia-"+date+".json");
    }catch(e){ toast("Kunde inte hämta kopian: "+(e.message||e)); }
    return;
  }
  if(act==="bkkeep"){
    if(!isAdmin()) return;
    const head=S.backups.find(function(b){ return b.date===t.dataset.b; });
    if(!head) return;
    head.keep=!head.keep;
    await guard(function(){ return Store.set("backups/"+head.date, head); },
      head.keep?"Kopian sparas för alltid.":"Kopian rensas som vanligt.");
    render(); return;
  }
  if(act==="bkrestore"){
    if(!isAdmin()) return;
    confirmModal("Återställa hela databasen?",
      "Allt som står i appen ersätts med innehållet i kopian från "+t.dataset.b+". "
      +"Tid, projekt och kostnader som lagts in efter den dagen skrivs över. Det går inte att ångra.",
      "bkrestore2", t.dataset.b, "b");
    return;
  }
  if(act==="bkrestore2"){
    if(!isAdmin()) return;
    closeModal();
    await restoreBackup(t.dataset.b);
    return;
  }
  if(act==="serverfiles"){ await serverFilesModal(); return; }
  if(act==="srvdl"){
    try{
      const r=await syncCall("get",{path:t.dataset.f});
      downloadBlob(b64ToBlob(r.data), String(t.dataset.f).split("/").pop());
    }catch(e){ toast("Kunde inte hämta filen: "+e.message); }
    return;
  }
  if(act==="srvimport"){
    if(!(await ensureXLSX())){ toast("Excel-biblioteket kunde inte laddas. Kontrollera nätet och försök igen."); return; }
    try{
      const r=await syncCall("get",{path:t.dataset.f});
      const rows=parseCostSheet(new Uint8Array(atob(r.data).split("").map(c=>c.charCodeAt(0))).buffer);
      importModal(S.projSel||(S.projects[0]||{}).id, rows, String(t.dataset.f));
    }catch(e){ toast("Kunde inte läsa filen: "+e.message); }
    return;
  }
  if(act==="importlocal"){
    if(!(await ensureXLSX())){ toast("Excel-biblioteket kunde inte laddas. Kontrollera nätet och försök igen."); return; }
    const inp=document.createElement("input");
    inp.type="file"; inp.accept=".xlsx,.xls,.csv";
    inp.onchange=async function(){
      const f=inp.files[0]; if(!f) return;
      /* Excel-läsaren har en känd svaghet mot specialbyggda filer. En rimlig
         storleksgräns stänger den värsta vägen – kostnadslistor är små. */
      if(f.size>3*1024*1024){ toast("Filen är för stor för en kostnadslista (max 3 MB)."); return; }
      try{
        const ab=await f.arrayBuffer();
        importModal(t.dataset.p||S.projSel, parseCostSheet(ab), f.name);
      }catch(e){ console.error(e); toast("Kunde inte läsa filen."); }
    };
    inp.click();
    return;
  }
  if(act==="doimport"){
    if(!isAdmin()) return;
    const pid=(document.getElementById("im-proj")||{}).value||S.importPid;
    const rows=S.importRows||[];
    if(!pid||!rows.length){ closeModal(); return; }
    await guard(async function(){
      for(const r of rows){
        const id=slug("imp-"+r.kind+"-"+r.date);
        const body=Object.assign({}, r, {id:id, projectId:pid, unit:costOf(r.kind).unit,
          byId:S.me.id, byName:S.me.name, createdAt:new Date().toISOString(), imported:true});
        await Store.set("costs/"+id, body);
        S.costs.push(body);
      }
    }, rows.length+" kostnadsrader inlästa.");
    S.importRows=[]; closeModal(); render(); return;
  }
  if(act==="view"){ S.view=t.dataset.v; render(); return; }
  if(act==="prev"||act==="next"){
    shift(act==="prev"?-1:1);
    if(S.tab==="attest") await loadWeekApprovals();
    if(S.tab==="attest"||S.tab==="personal") await loadMonthsFor(weekMonths(wkey(S.cursor)));
    render(); return;
  }
  if(act==="today"){
    S.cursor=new Date();
    if(S.tab==="attest") await loadWeekApprovals();
    if(S.tab==="attest"||S.tab==="personal") await loadMonthsFor(weekMonths(wkey(S.cursor)));
    render(); return;
  }
  if(act==="gotoemp"){ if(!isAdmin()) return; S.tab="tid"; S.view="week"; await selectEmployee(t.dataset.e); render(); return; }
  if(act==="pp"){
    S.projPeriod=t.dataset.v;
    if(S.projPeriod==="range" && (!S.from||!S.to)){
      const m=weekMonday(wkey(S.cursor));
      S.from=dkey(m); S.to=dkey(new Date(m.getFullYear(),m.getMonth(),m.getDate()+6));
    }
    render(); return;
  }
  if(act==="preset"){
    const v=t.dataset.v, now=new Date();
    if(v==="thisweek"||v==="lastweek"){
      const base=new Date(now); if(v==="lastweek") base.setDate(base.getDate()-7);
      const m=weekMonday(wkey(base));
      S.from=dkey(m); S.to=dkey(new Date(m.getFullYear(),m.getMonth(),m.getDate()+6));
    }else{
      const d=new Date(now.getFullYear(), now.getMonth()+(v==="lastmonth"?-1:0), 1);
      S.from=dkey(d); S.to=dkey(new Date(d.getFullYear(), d.getMonth()+1, 0));
    }
    S.projPeriod="range"; render(); return;
  }
  if(act==="xlsproj"||act==="xlsprojsame"){
    if(!isAdmin()) return;
    if(!(await ensureXLSX())){ toast("Excel-biblioteket kunde inte laddas. Kontrollera nätet och försök igen."); return; }
    const pid=t.dataset.p, p=projById(pid);
    const kod=(p.kod||p.name||"projekt").replace(/[^\wåäöÅÄÖ -]/g,"").trim().replace(/\s+/g,"-");
    const name=kod+"-Fakturaunderlag.xlsx";
    try{
      const blob=wbBlob(projectWorkbook(pid));
      if(act==="xlsprojsame" && window.showSaveFilePicker){
        const fn=await writeSameFile("proj:"+pid, blob, name);
        toast("Uppdaterade "+fn+".");
      }else{
        downloadBlob(blob, name);
        toast("Excel-filen laddas ner.");
      }
      await archiveFile({kind:"projekt", label:(p.kod?p.kod+" ":"")+p.name+" · "+periodLabelProj(),
        period:periodLabelProj(), from:S.from, to:S.to,
        projectId:pid, projectKod:p.kod||"", projectName:p.name}, blob, name);
    }catch(e){
      console.error(e);
      if(!(e&&e.name==="AbortError")) toast("Kunde inte skapa filen.");
    }
    return;
  }
  if(act==="newcost"){ if(isAdmin()) costModal(t.dataset.p,"",""); return; }
  if(act==="editcost"){ if(isAdmin()) costModal("",t.dataset.c,""); return; }
  if(act==="savecost"){
    if(!isAdmin()) return;
    const cid=t.dataset.c, pid=t.dataset.p;
    const kind=document.getElementById("c-kind").value;
    const date=document.getElementById("c-date").value||dkey(new Date());
    const desc=(document.getElementById("c-desc").value||"").trim();
    const qty=parseHours(document.getElementById("c-qty").value);
    const price=parseHours(document.getElementById("c-price").value);
    if(!desc) return costModal(pid,cid,"Skriv en kort beskrivning.");
    if(isNaN(qty)||isNaN(price)) return costModal(pid,cid,"Antal och à-pris måste vara siffror.");
    const id=cid||slug(kind+"-"+date);
    const body={id:id, projectId:pid||(S.costs.find(x=>x.id===cid)||{}).projectId, kind:kind, date:date,
      desc:desc, supplier:(document.getElementById("c-sup").value||"").trim(),
      qty:r2(qty), unit:costOf(kind).unit, unitPrice:r2(price), amount:r2(qty*price),
      byId:S.me.id, byName:S.me.name, createdAt:(S.costs.find(x=>x.id===cid)||{}).createdAt||new Date().toISOString()};
    await guard(async function(){
      await Store.set("costs/"+id, body);
      const i=S.costs.findIndex(x=>x.id===id);
      if(i>=0) S.costs[i]=body; else S.costs.push(body);
    }, "Kostnaden är sparad.");
    closeModal(); render(); return;
  }
  if(act==="delcost"){
    if(!isAdmin()) return;
    const id=t.dataset.c;
    await guard(async function(){ await Store.del("costs/"+id); S.costs=S.costs.filter(x=>x.id!==id); }, "Kostnaden är borttagen.");
    closeModal(); render(); return;
  }
  if(act==="lonprev"||act==="lonnext"){
    const p=lonYm().split("-").map(Number), d=new Date(p[0], p[1]-1+(act==="lonprev"?-1:1), 1);
    S.lonMonth=mkey(d); await loadLon(); render(); return;
  }
  if(act==="lonnow"){ S.lonMonth=mkey(new Date()); await loadLon(); render(); return; }
  if(act==="xlslon"){
    if(!isAdmin()) return;
    if(!(await ensureXLSX())){ toast("Excel-biblioteket kunde inte laddas. Kontrollera nätet och försök igen."); return; }
    const ym=lonYm(), name="Loneunderlag-"+ym+".xlsx";
    try{
      const blob=wbBlob(lonWorkbook(ym));
      downloadBlob(blob, name);
      toast("Löneunderlaget laddas ner.");
      await archiveFile({kind:"lon", label:"Löneunderlag · "+monthName(ym), period:ym}, blob, name);
    }catch(e){ console.error(e); toast("Kunde inte skapa filen."); }
    return;
  }
  if(act==="nudgeday"){ dayModal(emp, t.dataset.d); return; }
  if(act==="photoview"){ await viewPhoto(t.dataset.f); return; }
  if(act==="photocancel"){ dropPendingPhotos(); closeModal(); return; }
  if(act==="photoup"){
    const p=pendingPhotos; if(!p){ closeModal(); return; }
    const note=(document.getElementById("ph-note")||{}).value||"";
    t.disabled=true; t.textContent="Sparar…";
    pendingPhotos=null;
    await uploadPhotos(p.pid, p.files, note);
    p.urls.forEach(function(u){ try{ URL.revokeObjectURL(u); }catch(e){} });
    closeModal(); return;
  }
  if(act==="photodel"){
    const id=t.dataset.f, f=(S.projPhotos||[]).find(x=>x.id===id); if(!f) return;
    if(!confirmTwice("photodel"+id)){ t.textContent="Tryck igen för att ta bort"; return; }
    const ok=await guard(async function(){
      await Store.del("projphotos/"+id);
      try{ await Store.del("projphotodata/"+id); }catch(e){ console.error(e); }
    }, "Fotot är borttaget.");
    if(ok) S.projPhotos=(S.projPhotos||[]).filter(x=>x.id!==id);
    closeModal(); render(); return;
  }
  if(act==="projqclear"){ S.projQ=""; dirty.delete("proj-q"); render(); const i=document.getElementById("proj-q"); if(i) i.focus(); return; }
  if(act==="openproj"){ S.projSel=t.dataset.p; S.projPhotosFor=null; render(); return; }
  if(act==="openarkproj"){ S.tab="projekt"; await loadProjectData(); S.projSel=t.dataset.p; S.projPhotosFor=null; render(); window.scrollTo(0,0); return; }
  if(act==="backproj"){ S.projSel=null; render(); return; }

  /* --- tid --- */
  if(act==="open"){
    const ds=t.dataset.d;
    if(S.view==="day" && S.tab==="tid"){ S.cursor=fromKey(ds); render(); return; }
    dayModal(emp, ds); return;
  }
  if(act==="add"||act==="quick"){
    const ds=t.dataset.d;
    let type, hours, note="", pid="";
    const pf=document.getElementById("f-proj");
    if(act==="quick"){
      type=t.dataset.t; hours=parseFloat(t.dataset.h);
      pid = typeOf(type).proj && pf ? pf.value : "";
    }else{
      type=document.getElementById("f-type").value;
      hours=parseHours(document.getElementById("f-hours").value);
      note=(document.getElementById("f-note").value||"").trim();
      pid = typeOf(type).proj && pf ? pf.value : "";
      if(isNaN(hours)||hours<=0){ const h=document.getElementById("f-hours"); h.focus(); h.select(); toast("Ange antal timmar, t.ex. 6 eller 6:30."); return; }
      if(hours>24) hours=24;
    }
    if(typeOf(type).proj && !pid && S.projects.filter(p=>p.status!=="avslutad").length){
      if(pf) pf.focus();
      toast("Välj vilket projekt timmarna hör till."); return;
    }
    const wasModal=inModal();
    if(pid) S.lastProj=pid;
    const cur=entriesFor(emp.id, ds).slice();
    cur.push({id:uid(), type:type, hours:r2(hours), note:note, projectId:pid});
    await guard(()=>saveDay(emp.id, ds, cur));
    render(); if(wasModal) dayModal(emp, ds);
    return;
  }
  if(act==="del"){
    const ds=t.dataset.d, wasModal=inModal();
    const cur=entriesFor(emp.id, ds).slice();
    cur.splice(+t.dataset.i,1);
    await guard(()=>saveDay(emp.id, ds, cur));
    render(); if(wasModal) dayModal(emp, ds);
    return;
  }

  /* --- attest --- */
  if(act==="submitwk"){
    await guard(()=>setApproval(emp.id, wk, "inskickad", ""), "Vecka "+wkNo(wk)+" inskickad för attest.");
    render(); return;
  }
  if(act==="approvewk"){
    if(!isAdmin()) return;
    await guard(()=>setApproval(emp.id, wk, "godkand", approvalOf(emp.id,wk).comment), "Vecka "+wkNo(wk)+" attesterad.");
    render(); return;
  }
  if(act==="reopenwk"){
    if(!isAdmin()) return;
    await guard(()=>setApproval(emp.id, wk, "utkast", ""), "Vecka "+wkNo(wk)+" öppnad igen.");
    render(); return;
  }
  if(act==="returnwk"){ if(isAdmin()) returnModal(emp.id, wk); return; }
  if(act==="submitfor"||act==="approvefor"||act==="reopenfor"){
    if(!isAdmin()) return;
    const status=act==="submitfor"?"inskickad":act==="approvefor"?"godkand":"utkast";
    await guard(()=>setApproval(t.dataset.e, wk, status, ""),
      act==="submitfor"?"Inskickad åt anställd.":act==="approvefor"?"Attesterad.":"Veckan är öppnad igen.");
    render(); return;
  }
  if(act==="returnfor"){ if(isAdmin()) returnModal(t.dataset.e, wk); return; }
  if(act==="doreturn"){
    await guard(()=>setApproval(t.dataset.e, t.dataset.w, "retur",
      (document.getElementById("r-note").value||"").trim()), "Veckan returnerad till den anställde.");
    closeModal(); render(); return;
  }
  if(act==="approveall"){
    if(!isAdmin()) return;
    const pend=S.allApprovals.filter(a=>a.status==="inskickad");
    if(!pend.length){ toast("Inga inskickade veckor att attestera."); return; }
    await guard(async function(){ for(const a of pend){ await setApproval(a.empId, wk, "godkand", a.comment||""); } },
      pend.length+" veckor attesterade.");
    render(); return;
  }

  /* --- export --- */
  if(act==="csv"){
    if(!isAdmin()) return;
    if(!(await ensureXLSX())){ toast("Excel-biblioteket kunde inte laddas. Kontrollera nätet och försök igen."); return; }
    const dates = S.view==="month" ? monthDates(mkey(S.cursor)) : weekDates(wkey(S.cursor));
    const tag = S.view==="month" ? mkey(S.cursor) : wk;
    const fn="Tidrapport-"+String(emp.name).replace(/\s+/g,"-")+"-"+tag+".xlsx";
    const blob=wbBlob(timeWorkbook(emp, dates, tag));
    downloadBlob(blob, fn);
    toast("Excel-filen laddas ner.");
    await archiveFile({kind:"vecka", label:emp.name+" · "+tag, period:tag,
      empId:emp.id, empName:emp.name}, blob, fn);
    return;
  }
  if(act==="csvweek"){
    if(!isAdmin()) return;
    if(!(await ensureXLSX())){ toast("Excel-biblioteket kunde inte laddas. Kontrollera nätet och försök igen."); return; }
    const dates=weekDates(wk);
    const wb=XLSX.utils.book_new();
    const rows=[["Anställd","Datum","Vecka","Veckodag","Projektkod","Projekt","Kund","Typ","Fakturerbart","Timmar","Notering"]];
    S.employees.forEach(function(e){
      dates.forEach(function(ds){
        entriesFor(e.id, ds, S.everyMonth).forEach(function(en){
          const p=projById(en.projectId), ty=typeOf(en.type);
          rows.push([e.name, ds, isoWeek(fromKey(ds)), DAYS[isoDow(fromKey(ds))],
            p?(p.kod||""):"", p?p.name:"", p?(p.kund||""):"", ty.label, ty.bill?"Ja":"Nej", en.hours, en.note||""]);
        });
      });
    });
    XLSX.utils.book_append_sheet(wb, sheetFrom(rows,[20,12,7,11,12,26,20,16,12,9,30],{9:H2}), "Tidposter");
    const sum=[["Anställd","Rapporterat","Fakturerbart","Övertid","Frånvaro","Dagar","Status"]];
    S.employees.forEach(function(e){
      const st=weekStats(e.id,wk,S.everyMonth);
      const ap=S.allApprovals.find(a=>a.empId===e.id)||{status:"utkast"};
      sum.push([e.name, st.worked, st.bill, st.ot, st.abs, st.regDays, STATUS[ap.status].label]);
    });
    XLSX.utils.book_append_sheet(wb, sheetFrom(sum,[22,13,13,10,11,8,14],{1:H2,2:H2,3:H2,4:H2}), "Per anställd");
    const wfn="Timmar-vecka-"+wk+".xlsx";
    const wblob=wbBlob(wb);
    downloadBlob(wblob, wfn);
    toast("Excel-filen laddas ner.");
    await archiveFile({kind:"vecka", label:"Alla anställda · vecka "+wkNo(wk), period:wk}, wblob, wfn);
    return;
  }

  /* --- projekt --- */
  if(act==="newproj"){ if(isAdmin()){ try{ await loadOffers(); }catch(e){} projModal(null); } return; }
  if(act==="editproj"){ if(isAdmin()){ try{ await loadOffers(); }catch(e){} projModal(t.dataset.p); } return; }
  if(act==="saveproj"){
    if(!isAdmin()) return;
    const name=(document.getElementById("p-name").value||"").trim();
    if(!name){ document.getElementById("p-name").focus(); toast("Projektet behöver ett namn."); return; }
    const id=t.dataset.p || slug(name);
    const rateRaw=(document.getElementById("p-rate").value||"").replace(/\s/g,"").replace(",",".");
    const old=S.projects.find(p=>p.id===id)||{};
    const status=document.getElementById("p-status").value;
    const body=Object.assign({}, old, {id:id, name:name,
      kod:(document.getElementById("p-kod").value||"").trim(),
      kund:(document.getElementById("p-kund").value||"").trim(),
      adress:(document.getElementById("p-adress").value||"").trim(),
      status:status,
      invoice:(document.getElementById("p-invoice")||{}).value||old.invoice||"ej",
      rate: rateRaw?r2(parseFloat(rateRaw)||0):"",
      notes:(document.getElementById("p-notes").value||"").trim(),
      updatedAt:new Date().toISOString()});
    const qn=id2=>{ const e=document.getElementById(id2); return e?numIn(e.value):0; };
    const offSel=(document.getElementById("p-offer")||{}).value||"";
    const offO=offSel?(S.offers||[]).find(o=>o.id===offSel):null;
    body.quote={total:qn("p-qtotal"), hours:qn("p-qhours"), labour:qn("p-qlabour"), material:qn("p-qmat"),
      travel:qn("p-qtravel"), other:qn("p-qother"), offerId:offSel, offerNr:offO?(offO.nr||""):((old.quote||{}).offerId===offSel?(old.quote||{}).offerNr||"":"")};
    /* Spara när och av vem ett projekt avslutades. Öppnas det igen tas markeringen bort. */
    if(status==="avslutad" && pStatus(old)!=="avslutad"){ body.archivedAt=new Date().toISOString(); body.archivedBy=S.me?S.me.name:""; }
    if(status!=="avslutad"){ delete body.archivedAt; delete body.archivedBy; }
    await guard(async function(){
      await Store.set("projects/"+id, body);
      const i=S.projects.findIndex(p=>p.id===id);
      if(i>=0) S.projects[i]=body; else S.projects.push(body);
      S.projects.sort((a,b)=>String(a.kod||"").localeCompare(String(b.kod||""),"sv"));
    }, status==="avslutad"&&pStatus(old)!=="avslutad"?"Projektet är avslutat och flyttat till arkivet.":"Projektet är sparat.");
    if(status==="avslutad" && S.projSel===id && S.tab==="projekt") S.projSel=null;
    closeModal(); render(); return;
  }
  if(act==="delproj"){
    if(!isAdmin()) return;
    if(projectHasHistory(t.dataset.p)){ toast("Projektet har registrerad tid eller kostnader och kan inte tas bort. Sätt status Avslutat så flyttas det till arkivet."); return; }
    confirmModal("Ta bort projekt?","Projektet har ingen registrerad tid och inga kostnader. Det tas bort helt.","delproj2",t.dataset.p,"p"); return;
  }
  if(act==="delproj2"){
    if(!isAdmin()) return;
    const id=t.dataset.p;
    if(projectHasHistory(id)){ closeModal(); toast("Projektet har historik och kan inte tas bort."); return; }
    await guard(async function(){ await Store.del("projects/"+id); S.projects=S.projects.filter(p=>p.id!==id); });
    if(S.projSel===id) S.projSel=null;
    closeModal(); render(); return;
  }

  /* --- profiler --- */
  if(act==="newemp"){ if(isAdmin()) empModal(null,""); return; }
  if(act==="editemp"){ if(isAdmin()) empModal(t.dataset.e,""); return; }
  if(act==="saveemp"){
    if(!isAdmin()) return;
    const id=t.dataset.e;
    const name=(document.getElementById("e-name").value||"").trim();
    const role=document.getElementById("e-role").value;
    if(!name) return empModal(id,"Fyll i namn.");
    if(id){
      const old=S.employees.find(e=>e.id===id);
      if(old && old.id===S.me.id && role!=="admin" && S.employees.filter(e=>e.role==="admin").length<2)
        return empModal(id,"Det måste finnas minst en superadmin.");
      /* Kontonamnet får bara bytas när inloggningen sker med riktig e-postadress,
         annars är namnet inbakat i inloggningsadressen och bytet skulle låsa ute
         personen. */
      const canRename = looksReal(old.authEmail);
      const wanted = uname(document.getElementById("e-user").value||old.username);
      const user = canRename && wanted.length>=2 ? wanted : uname(old.username);
      if(canRename && wanted.length && wanted.length<2)
        return empModal(id,"Kontonamnet måste vara minst två tecken.");
      if(user!==uname(old.username) && S.employees.some(e=>e.id!==id && uname(e.username)===user))
        return empModal(id,"Kontonamnet är redan taget.");

      /* Behåll allt som redan står i profilen, till exempel authEmail. Skrivs
         hela dokumentet över tappar kontot sin inloggningsadress. */
      /* Inloggningsadressen får INTE ändras härifrån. Firebase tillåter bara att
         en inloggad person byter sin EGEN adress (updateEmail). Skriver vi in en
         ny adress i databasen utan att Authentication vet om den, pekar uppslaget
         på något som inte finns och kontot blir utelåst. Den behålls som den är. */
      const authEmail = old.authEmail||"";
      const body=Object.assign({}, old, {name:name, username:user, role:role,
        authEmail:authEmail,
        createdAt:old.createdAt||"",
        email:(document.getElementById("e-mail").value||"").trim(),
        phone:(document.getElementById("e-phone").value||"").trim()});
      delete body.id;
      const oldUser=uname(old.username);
      await guard(async function(){
        await Store.set("employees/"+id, body);
        if(user!==oldUser){
          await Store.set("usernames/"+user, {email:authEmail||emailFor(user), name:name});
          try{ await Store.del("usernames/"+oldUser); }catch(e){ console.error(e); }
        }else if(authEmail){
          try{ await Store.set("usernames/"+user, {email:authEmail, name:name}); }catch(e){ console.error(e); }
        }
        const i=S.employees.findIndex(e=>e.id===id);
        if(i>=0) S.employees[i]=Object.assign({id:id}, body);
        if(S.me.id===id) S.me=Object.assign({id:id}, body);
      }, user!==oldUser ? "Profilen är uppdaterad. Nytt kontonamn: "+user : "Profilen är uppdaterad.");
      closeModal(); render(); return;
    }
    const user=uname(document.getElementById("e-user").value);
    const pw=document.getElementById("e-pw").value||"";
    if(user.length<2) return empModal(id,"Kontonamnet måste vara minst två tecken (bokstäver och siffror).");
    if(S.employees.some(e=>uname(e.username)===user)) return empModal(id,"Kontonamnet är redan taget.");
    if(pw.length<6) return empModal(id,"Lösenordet måste vara minst sex tecken.");
    try{
      const secName="secondary";
      const sec = getApps().find(a=>a.name===secName) || initializeApp(firebaseConfig, secName);
      const secAuth=getAuth(sec);
      const mail=(document.getElementById("e-mail").value||"").trim();
      /* Har personen en riktig e-post blir den inloggningsadress – då går lösenordet
         att återställa via mejl. Annars används den interna adressen. */
      const authEmail = /.+@.+\..+/.test(mail) ? mail.toLowerCase() : emailFor(user);
      const cred=await createUserWithEmailAndPassword(secAuth, authEmail, pw);
      const base={name:name, username:user, role:"arbetare", createdAt:new Date().toISOString(),
        authEmail:authEmail,
        email:mail,
        phone:(document.getElementById("e-phone").value||"").trim()};
      /* Profilen skrivs av superadmin, inte av det nya kontot. Reglerna låter
         bara superadmin skapa profiler – annars skulle vem som helst som
         skapar ett Firebase-konto kunna ge sig själv en profil och komma in. */
      await signOut(secAuth);
      const full=Object.assign({}, base, {role:role});
      await Store.set("employees/"+cred.user.uid, full);
      try{ await Store.set("usernames/"+user, {email:authEmail, name:name}); }catch(e){ console.error(e); }
      S.employees.push(Object.assign({id:cred.user.uid}, full));
      S.employees.sort((a,b)=>String(a.name).localeCompare(String(b.name),"sv"));
      closeModal(); toast("Profilen är skapad. Ge personen kontonamn och lösenord."); render();
    }catch(err){
      console.error(err);
      empModal(id, authMsg(err && err.code));
    }
    return;
  }
  if(act==="delemp"){ if(isAdmin()) confirmModal("Stäng av profil?","Personen kommer inte in i appen längre och försvinner ur listorna. Registrerade timmar ligger kvar. Kontonamnet går inte att återanvända.","delemp2",t.dataset.e); return; }
  if(act==="delemp2"){
    if(!isAdmin()) return;
    const id=t.dataset.e;
    if(id===S.me.id){ toast("Du kan inte stänga av ditt eget konto."); closeModal(); return; }
    await guard(async function(){ await Store.del("employees/"+id); S.employees=S.employees.filter(e=>e.id!==id); }, "Profilen är avstängd.");
    if(S.targetEmp===id) await selectEmployee(S.me.id);
    closeModal(); render(); return;
  }
});

document.addEventListener("change", async function(ev){
  if(ev.target.classList && ev.target.classList.contains("inv") && ev.target.dataset.p){
    if(!isAdmin()) return;
    const p=projById(ev.target.dataset.p); if(!p) return;
    const v=ev.target.value; if(!INVSTATUS[v]) return;
    const body=Object.assign({}, p, {invoice:v, invoiceAt:new Date().toISOString(), updatedAt:new Date().toISOString()});
    const ok=await guard(function(){ return Store.set("projects/"+p.id, body); }, "Fakturastatus: "+INVSTATUS[v]+".");
    if(ok){ const i=S.projects.findIndex(x=>x.id===p.id); if(i>=0) S.projects[i]=body; }
    render(); return;
  }
  if(ev.target.id==="p-offer"){
    const o=(S.offers||[]).find(x=>x.id===ev.target.value); if(!o||!o.sums) return;
    const set=(id,v)=>{ const e=document.getElementById(id); if(e) e.value=numOut(v); };
    set("p-qtotal", o.sums.net); set("p-qhours", o.sums.hours); set("p-qlabour", o.sums.arbete);
    set("p-qmat", o.sums.material); set("p-qtravel", o.sums.resa); set("p-qother", 0);
    const n=document.getElementById("p-name"); if(n && !n.value.trim() && o.title) n.value=o.title;
    const k=document.getElementById("p-kund"); if(k && !k.value.trim() && (o.customer||{}).name) k.value=o.customer.name;
    toast("Kalkylen är hämtad från offert "+(o.nr||"")+".");
    return;
  }
  if(ev.target.id==="st-scope"){ S.statScope=ev.target.value; render(); return; }
  if(ev.target.classList && ev.target.classList.contains("aifile-in")){
    if(!isAdmin()) return;
    const files=Array.from(ev.target.files||[]); let scope=ev.target.dataset.scope;
    ev.target.value="";
    if(!files.length) return;
    if(scope.indexOf("offer:")===0){
      if(!S.off) return;
      offerRead();
      /* samma id som offerten får när den sparas */
      if(!S.off.id) S.off.id=slug("offert-"+S.off.nr);
      scope="offer:"+S.off.id;
    }else learnRead();
    toast("Läser in "+(files.length===1?files[0].name:files.length+" filer")+" …");
    await uploadAiFiles(scope, files);
    render(); if(S.off) offerLive();
    return;
  }
  if(ev.target.id==="photo-in"){
    const files=Array.from(ev.target.files||[]), pid=ev.target.dataset.p;
    ev.target.value="";
    if(files.length && pid) photoNoteModal(pid, files);
    return;
  }
  if(ev.target.id==="f-type"){ syncProjField(); return; }
  if(ev.target.id==="f-proj"){ if(ev.target.value) S.lastProj=ev.target.value; return; }
  if(ev.target.id==="sel-emp"){ if(isAdmin()){ await selectEmployee(ev.target.value); render(); } return; }
  if(ev.target.id==="kor-veh"){ S.korVeh=ev.target.value; render(); return; }
  if(ev.target.id==="kor-who"){ S.korWho=ev.target.value; render(); return; }
  if(ev.target.id==="r-from"||ev.target.id==="r-to"){
    if(ev.target.id==="r-from") S.from=ev.target.value; else S.to=ev.target.value;
    S.projPeriod="range"; render(); return;
  }
  if(ev.target.id==="c-kind"){
    const p=document.getElementById("c-price");
    const def=costOf(ev.target.value);
    if(p && def && def.price && (!p.value || parseHours(p.value)===0)) p.value=fmt(def.price);
    return;
  }
});
document.addEventListener("keydown", function(ev){
  if(ev.key==="Escape" && inModal()){ closeModal(); return; }
  if(ev.key==="Escape" && ev.target && ev.target.id==="proj-q" && S.projQ){ ev.preventDefault(); S.projQ=""; dirty.delete("proj-q"); render(); return; }
  if(ev.key!=="Enter" || !ev.target) return;
  const id=ev.target.id, click=sel=>{ const b=(inModal()?modalRoot:document).querySelector(sel); if(b) b.click(); };
  if(id==="l-user"||id==="l-pw"){ ev.preventDefault(); const b=document.querySelector("[data-act='login']"); if(b) b.click(); }
  else if(id==="o-name"||id==="o-user"||id==="o-pw"){ ev.preventDefault(); const b=document.querySelector("[data-act='setupadmin']"); if(b) b.click(); }
  else if(id==="f-hours"||id==="f-note"){
    ev.preventDefault();
    const scope=ev.target.closest(".form")||document;
    const b=scope.querySelector("[data-act='add']"); if(b) b.click();
  }
  else if(id==="e-name"||id==="e-user"||id==="e-pw"){ ev.preventDefault(); click("[data-act='saveemp']"); }
  else if(id==="ph-note"){ ev.preventDefault(); click("[data-act='photoup']"); }
  else if(id==="p-name"||id==="p-kod"||id==="p-kund"||id==="p-rate"||id==="p-adress"){ ev.preventDefault(); click("[data-act='saveproj']"); }
  else if(id==="m-old"||id==="m-new"){ ev.preventDefault(); click("[data-act='changepw']"); }
});

window.addEventListener("beforeinstallprompt", function(e){
  e.preventDefault(); S.installEvt=e; render();
});

/* ============================ exempelprojekt ============================ */
async function seedProjects(){
  const projects=[
    {id:"p-101-hall", kod:"P-101", name:"Stålstomme lagerhall", kund:"Nordbygg AB", adress:"Industrivägen 4, Jordbro", status:"aktiv", rate:845, notes:"Montage av pelare och balkar, etapp 1."},
    {id:"p-104-racke", kod:"P-104", name:"Räcken Kv. Smedjan", kund:"Bostads AB Sund", adress:"Smedjegatan 12", status:"aktiv", rate:895, notes:"Smidesräcken till trapphus och balkonger."},
    {id:"p-112-verkstad", kod:"P-112", name:"Verkstad & tillverkning", kund:"Internt", adress:"", status:"aktiv", rate:0, notes:"Tid i egen verkstad som inte hör till ett kundprojekt."}
  ];
  for(const p of projects) await Store.set("projects/"+p.id, p);
}

/* ============================ start ============================ */
async function boot(){
  if(!configured){ render(); return; }
  const p=prefsLoad();
  if(p.cursor){ const d=fromKey(p.cursor); if(!isNaN(d)) S.cursor=d; }
  if(p.view) S.view=p.view;
  if(p.lastProj) S.lastProj=p.lastProj;

  try{
    let meta=null;
    try{ meta=await getDoc(doc(db,"meta","app")); }
    catch(e){
      if(canFallback(e) && useDbFallback()) meta=await getDoc(doc(db,"meta","app"));
      else throw e;
    }
    S.metaExists=meta.exists();
    if(meta.exists() && meta.data().ownerUid) S.ownerUid=meta.data().ownerUid;
    S.dbErr="";
    if(!S.metaExists){ S.phase="onboarding"; render(); }
  }catch(e){
    /* Databasen svarar inte – oftast opublicerade säkerhetsregler.
       Visa felet och låt ändå superadmin-kontot kunna skapas. */
    S.metaExists=false;
    S.dbErr=(e && e.code) ? e.code : "okänt fel";
    console.error(e);
  }

  onAuthStateChanged(auth, async function(user){
    if(S.creating) return;              /* uppstarten sköter inloggningen själv */
    if(!user){
      S.me=null; S.targetEmp=null; S.months=[]; S.approvals=[]; S.busy=false;
      S.pendingUser=null; S.fixErr=""; S.fixMsg="";
      if(S.phase!=="onboarding") S.phase="ready";
      render(); return;
    }
    await enterApp(user);
  });
}
async function enterApp(user){
  let snap=null, err=null;
  try{ snap=await getDoc(doc(db,"employees",user.uid)); }
  catch(e){ console.error(e); err=e; }
  if(err && canFallback(err) && useDbFallback()){
    err=null;
    try{ snap=await getDoc(doc(db,"employees",user.uid)); }
    catch(e){ console.error(e); err=e; }
  }
  if(err || !snap.exists()){
    S.pendingUser=user;
    S.fixErr = err ? (err.code || "okänt-fel") : "no-profile";
    S.fixRaw = err ? (err.message || "") : "";
    S.phase="fixup"; S.busy=false;
    render(); return;
  }
  S.me=Object.assign({id:user.uid}, snap.data());
  S.phase="ready"; S.loginErr=""; S.busy=false; S.fixErr="";
  if(!S.ownerUid){
    try{ const m=await getDoc(doc(db,"meta","app")); if(m.exists()) S.ownerUid=m.data().ownerUid||""; }catch(e){}
  }
  try{
    await loadAll();
    await selectEmployee(S.me.id);
    /* Har någon skannat QR-koden i bilen hoppar vi direkt till körjournalen. */
    if(S.deepKor) S.tab="kor";
    if(S.tab==="kor") await loadKor();
    if(S.tab==="attest"||S.tab==="personal") await loadMonthsFor(weekMonths(wkey(S.cursor)));
    if(S.tab==="projekt"||(S.tab==="statistik"&&isAdmin())) await loadProjectData();
    if(S.tab==="kalkyl" && isAdmin()) await loadOffers();
    if(S.tab==="lon" && isAdmin()) await loadLon();
    if(S.tab==="arkiv"){ await loadArchive(); await loadBackups(); }
    if(S.tab==="inkorg" && isSupport()) await loadInbox();
    if(isAdmin()){
      await loadReminderData();
      maybeAutoRemind();
      /* Dagens säkerhetskopia tas i bakgrunden, utan att någon behöver vänta. */
      loadBackups().then(function(){ return runDailyBackup(false); }).catch(function(e){ console.error(e); });
      backfillLocks().catch(function(e){ console.error("lås", e); });
    }
  }catch(e){ console.error(e); toast("Kunde inte hämta all data – kontrollera reglerna i Firestore."); }
  render();
  consumeDeepKor();
}
/* QR-koden i bilen pekar på #kor=<bilens id>. Öppna rätt bil och rätt steg:
   har föraren en påbörjad resa är nästa steg att avsluta den. */
function consumeDeepKor(){
  const vid=S.deepKor;
  if(!vid || !S.me) return;
  S.deepKor="";
  try{ history.replaceState(null,"",location.pathname+location.search); }catch(e){}
  const v=vehById(vid);
  if(!v){ toast("QR-koden pekar på en bil som inte finns kvar."); return; }
  S.korVeh=vid;
  scanModal(vid, openTripHere(vid) ? "slut" : "start", "");
}
/* Skannar föraren QR-koden medan appen redan är öppen byter webbläsaren bara
   adressens fragment – sidan laddas inte om. Då måste vi fånga det här. */
window.addEventListener("hashchange", async function(){
  const vid=parseKorHash();
  if(!vid) return;
  S.deepKor=vid;
  if(!S.me) return;            /* inloggningen tar hand om det efteråt */
  if(inModal()) closeModal();
  S.tab="kor";
  try{ await loadKor(); }catch(e){ console.error(e); }
  render();
  consumeDeepKor();
});
render();
boot();

/* Ny version upplagd? Ladda om en gång så att alla får den direkt. */
if("serviceWorker" in navigator){
  /* Bara när en NY version tar över – inte vid första installationen. */
  const hadController = !!navigator.serviceWorker.controller;
  let reloading=false;
  /* En ny version får aldrig ladda om sidan mitt i arbetet. Den laddas direkt
     bara strax efter start, annars när appen läggs i bakgrunden – och bara om
     inget är halvifyllt. Under tiden finns en knapp i toppen. */
  const safeToReload = () => !dirty.size && !inModal();
  navigator.serviceWorker.addEventListener("controllerchange", function(){
    if(reloading || !hadController) return;
    if(Date.now()-BOOT_AT < 8000 && safeToReload()){ reloading=true; location.reload(); return; }
    S.updateReady=true;
    if(S.me) scheduleRender();
  });
  document.addEventListener("visibilitychange", function(){
    if(document.hidden && S.updateReady && !reloading && safeToReload()){ reloading=true; location.reload(); }
  });
  window.addEventListener("load", function(){
    navigator.serviceWorker.register("sw.js").then(function(reg){
      if(reg.waiting) reg.waiting.postMessage("skipWaiting");
      reg.addEventListener("updatefound", function(){
        const nw=reg.installing;
        if(!nw) return;
        nw.addEventListener("statechange", function(){
          if(nw.state==="installed" && navigator.serviceWorker.controller) nw.postMessage("skipWaiting");
        });
      });
      setInterval(function(){ reg.update().catch(function(){}); }, 30*60*1000);
    }).catch(function(){});
  });
}
