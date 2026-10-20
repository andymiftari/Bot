/* Regeltest för firestore.rules (att-gora), körs i Firebase-emulatorn:
     cd <mapp med firestore.rules, firebase.json och npm i @firebase/rules-unit-testing firebase firebase-tools>
     npx firebase emulators:exec --only firestore --project demo-test "node att-gora.mjs"
   firebase.json: {"firestore":{"rules":"firestore.rules"},"emulators":{"firestore":{"port":8085}}} */
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDocs, collection, query, where, updateDoc, deleteDoc } from "firebase/firestore";
import fs from "fs";
const env=await initializeTestEnvironment({projectId:"demo-tasks", firestore:{rules:fs.readFileSync("firestore.rules","utf8"), host:"127.0.0.1", port:8085}});
await env.withSecurityRulesDisabled(async c=>{ const db=c.firestore();
  await setDoc(doc(db,"meta/app"),{ownerUid:"own"});
  await setDoc(doc(db,"employees/adm"),{role:"admin"}); await setDoc(doc(db,"employees/a"),{role:"arbetare"}); await setDoc(doc(db,"employees/b"),{role:"arbetare"});
  await setDoc(doc(db,"projects/p1"),{name:"P1"});
  await setDoc(doc(db,"projtasks/t1"),{id:"t1",projectId:"p1",text:"Boka lift",done:false,byId:"a",byName:"A",at:"z",doneById:"",doneByName:"",doneAt:""});
});
const a=env.authenticatedContext("a").firestore(), b=env.authenticatedContext("b").firestore(), adm=env.authenticatedContext("adm").firestore(), x=env.authenticatedContext("x").firestore();
const T=(id,o)=>Object.assign({id,projectId:"p1",text:"Beställ stål",done:false,byId:"b",byName:"B",at:"z",doneById:"",doneByName:"",doneAt:""},o||{});
let bad=0; const r=async(n,p,w)=>{let ok;try{await p;ok=true}catch(e){ok=false} if(ok!==w)bad++; console.log((ok===w?"✓ ":"✗ ")+(ok?"tillåts":"nekas ")+"  "+n);};
await r("arbetare läser listan", getDocs(query(collection(b,"projtasks"),where("projectId","==","p1"))), true);
await r("främling läser listan", getDocs(query(collection(x,"projtasks"),where("projectId","==","p1"))), false);
await r("arbetare lägger till punkt", setDoc(doc(b,"projtasks/t2"),T("t2")), true);
await r("…i någon annans namn", setDoc(doc(b,"projtasks/t3"),T("t3",{byId:"a"})), false);
await r("…redan avbockad", setDoc(doc(b,"projtasks/t4"),T("t4",{done:true})), false);
await r("…för lång text", setDoc(doc(b,"projtasks/t5"),T("t5",{text:"x".repeat(201)})), false);
await r("…på projekt som inte finns", setDoc(doc(b,"projtasks/t6"),T("t6",{projectId:"nej"})), false);
await r("…med extra fält", setDoc(doc(b,"projtasks/t7"),T("t7",{hemligt:1})), false);
await r("främling lägger till", setDoc(doc(x,"projtasks/t8"),T("t8",{byId:"x"})), false);
await r("B bockar av A:s punkt i eget namn", updateDoc(doc(b,"projtasks/t1"),{done:true,doneById:"b",doneByName:"B",doneAt:"y"}), true);
await r("B ångrar avbockningen", updateDoc(doc(b,"projtasks/t1"),{done:false,doneById:"",doneByName:"",doneAt:""}), true);
await r("B bockar av i A:s namn", updateDoc(doc(b,"projtasks/t1"),{done:true,doneById:"a",doneByName:"A",doneAt:"y"}), false);
await r("B ändrar A:s text", updateDoc(doc(b,"projtasks/t1"),{text:"Något annat"}), false);
await r("B tar bort A:s punkt", deleteDoc(doc(b,"projtasks/t1")), false);
await r("B tar bort sin egen punkt", deleteDoc(doc(b,"projtasks/t2")), true);
await r("admin ändrar text", updateDoc(doc(adm,"projtasks/t1"),{text:"Boka saxlift"}), true);
await r("admin tar bort", deleteDoc(doc(adm,"projtasks/t1")), true);
console.log(bad?bad+" FEL":"Alla regler stämmer."); await env.cleanup(); process.exit(bad?1:0);
