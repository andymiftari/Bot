/* Demoläge för Ellingesmide – ersätter Firebase i artifakten.
   Byggskriptet (demo/build.mjs) pekar appens tre Firebase-importer hit, så
   att exakt samma app.js körs, men mot en låtsasdatabas i webbläsaren.
   Inget skickas någonstans: datan ligger i localStorage hos den som testar
   och börjar om från testdatan med knappen "Börja om" eller ?reset i adressen. */

import { seed } from "./seed.js";

/* Höjs när testdatan ändras, så att alla får den nya direkt. */
const LS = "ellingesmide-demo-v3";
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
let data = null;

function loadData(){
  try{
    if(/[?&]reset\b/.test(location.search)) localStorage.removeItem(LS);
    const s = localStorage.getItem(LS);
    if(s) return JSON.parse(s);
  }catch(e){ /* privat läge – kör bara i minnet */ }
  return seed();
}
function saveData(){ try{ localStorage.setItem(LS, JSON.stringify(data)); }catch(e){} }
data = loadData(); saveData();
export function demoReset(){ try{ localStorage.removeItem(LS); }catch(e){} location.reload(); }

/* Serverfunktionerna (AI-kalkyl, miltalsavläsning) finns inte i demon. */
const realFetch = window.fetch.bind(window);
window.fetch = function(url, opts){
  const u = String(url && url.url || url);
  if(/^\/?api\//.test(u) || u.indexOf(location.origin + "/api/") === 0){
    return Promise.resolve(new Response(JSON.stringify({error:"AI-funktionerna är avstängda i demoläget."}),
      {status:503, headers:{"content-type":"application/json"}}));
  }
  return realFetch(url, opts);
};

/* ---------------- app ---------------- */
const apps = [];
export function initializeApp(_cfg, name){
  const a = {name: name || "[DEFAULT]"};
  apps.push(a); return a;
}
export const getApps = () => apps.slice();
export const getApp = name => apps.find(a => a.name === (name || "[DEFAULT]"));

/* ---------------- firestore ---------------- */
const db = {};
export const initializeFirestore = () => db;
export const getFirestore = () => db;
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});

const pathOf = parts => parts.filter(p => p !== db).join("/");
export const doc = (_db, ...parts) => ({kind:"doc", path:pathOf(parts)});
export const collection = (_db, ...parts) => ({kind:"coll", coll:pathOf(parts), wheres:[]});
export const where = (f, op, v) => ({f, op, v});
export const query = (c, ...ws) => ({kind:"coll", coll:c.coll, wheres:c.wheres.concat(ws)});

const snap = (path) => {
  const id = path.split("/").pop(), d = data[path];
  return {id, exists: () => d !== undefined, data: () => clone(d)};
};
/* window.__demoLatency gör databasen långsam i tester, som ett segt nät. */
const later = fn => new Promise(r => setTimeout(() => r(fn()), window.__demoLatency || 8));

function test(val, op, v){
  switch(op){
    case "==": return val === v;
    case "!=": return val !== v;
    case ">=": return val >= v;
    case ">": return val > v;
    case "<=": return val <= v;
    case "<": return val < v;
    case "in": return Array.isArray(v) && v.includes(val);
    case "array-contains": return Array.isArray(val) && val.includes(v);
    default: return false;
  }
}
function run(q){
  const pre = q.coll + "/";
  return Object.keys(data)
    .filter(p => p.startsWith(pre) && p.indexOf("/", pre.length) < 0)
    .filter(p => q.wheres.every(w => test((data[p] || {})[w.f], w.op, w.v)))
    .map(snap);
}

const listeners = new Set();
function notify(){
  saveData();
  listeners.forEach(l => { try{ l.cb({docs: run(l.q)}); }catch(e){ console.error(e); } });
}

export const getDoc = ref => later(() => snap(ref.path));
/* window.__demoReads räknar hämtade dokument per samling – för hastighetstester. */
const reads = window.__demoReads = {};
const count = (coll, n) => { reads[coll] = (reads[coll] || 0) + n; };
export const getDocs = q => later(() => { const docs = run(q); count(q.coll, docs.length); return {docs}; });
export const setDoc = (ref, body, opts) => later(() => {
  data[ref.path] = (opts && opts.merge) ? Object.assign({}, data[ref.path] || {}, clone(body)) : clone(body);
  notify();
});
export const deleteDoc = ref => later(() => { delete data[ref.path]; notify(); });
export function onSnapshot(q, cb){
  const l = {q, cb};
  listeners.add(l);
  /* Första svaret räknas som en hämtning; ändringar därefter skickar Firestore
     som små tillägg, så de räknas inte här. */
  setTimeout(() => { if(listeners.has(l)){ const docs = run(q); count(q.coll, docs.length); cb({docs}); } }, 8);
  return () => listeners.delete(l);
}

/* ---------------- auth ---------------- */
const AUTH_LS = "ellingesmide-demo-user";
const auth = {currentUser:null, main:true};
const otherAuths = new Map();
const authCbs = new Set();
function userFor(uid){
  const e = data["employees/" + uid];
  return e ? {uid, email: e.authEmail || "", displayName: e.name || ""} : null;
}
(function startUser(){
  let uid = null;
  try{ uid = localStorage.getItem(AUTH_LS); }catch(e){}
  /* Första gången loggas man in som ägaren, så att allt går att prova direkt. */
  if(uid === null) uid = data["meta/app"] && data["meta/app"].ownerUid;
  auth.currentUser = uid ? userFor(uid) : null;
})();
function setUser(u){
  auth.currentUser = u;
  try{ localStorage.setItem(AUTH_LS, u ? u.uid : ""); }catch(e){}
  authCbs.forEach(cb => { try{ cb(u); }catch(e){ console.error(e); } });
}
const authErr = code => Object.assign(new Error(code), {code});

/* Appen skapar nya konton via en andra instans och loggar sedan ut den.
   Den instansen får en egen inloggning, så att testaren inte loggas ut. */
export function getAuth(app){
  if(!app || app.name === "[DEFAULT]") return auth;
  if(!otherAuths.has(app.name)) otherAuths.set(app.name, {currentUser:null, main:false});
  return otherAuths.get(app.name);
}
export const browserLocalPersistence = "local";
export const browserSessionPersistence = "session";
export const setPersistence = () => Promise.resolve();
export function onAuthStateChanged(_a, cb){
  authCbs.add(cb);
  setTimeout(() => cb(auth.currentUser), 20);
  return () => authCbs.delete(cb);
}
export function signInWithEmailAndPassword(a, email, pw){
  return later(() => {
    const e = String(email || "").toLowerCase();
    const uid = Object.keys(data).filter(p => p.startsWith("employees/"))
      .map(p => p.slice(10)).find(id => String(data["employees/" + id].authEmail || "").toLowerCase() === e);
    if(!uid || !pw) throw authErr("auth/invalid-credential");
    const u = userFor(uid);
    if(a && a.main === false) a.currentUser = u; else setUser(u);
    return {user:u};
  });
}
export function createUserWithEmailAndPassword(_a, email, pw){
  return later(() => {
    if(String(pw || "").length < 6) throw authErr("auth/weak-password");
    const e = String(email || "").toLowerCase();
    if(Object.keys(data).some(p => p.startsWith("employees/") && String(data[p].authEmail || "").toLowerCase() === e))
      throw authErr("auth/email-already-in-use");
    const u = {uid: "demo-" + Math.random().toString(36).slice(2, 10), email: e, displayName: ""};
    /* Den som skapar ett konto i appen blir inte inloggad som det – samma som
       när superadmin lägger upp personal i den riktiga appen via en andra instans. */
    return {user:u};
  });
}
export const signOut = a => later(() => { if(a && a.main === false) a.currentUser = null; else setUser(null); });
export const updatePassword = () => Promise.resolve();
export const updateEmail = (u, email) => later(() => { if(u) u.email = email; });
export const reauthenticateWithCredential = () => Promise.resolve();
export const EmailAuthProvider = {credential: (email, pw) => ({email, pw})};
export const sendPasswordResetEmail = () => Promise.resolve();
