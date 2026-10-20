/* Regeltest för firestore.rules (resor), körs i Firebase-emulatorn:
     cd <mapp med firestore.rules, firebase.json och npm i @firebase/rules-unit-testing firebase firebase-tools>
     npx firebase emulators:exec --only firestore --project demo-test "node resor.mjs"
   firebase.json: {"firestore":{"rules":"firestore.rules"},"emulators":{"firestore":{"port":8085}}} */
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, getDocs, collection, query, where } from "firebase/firestore";
import fs from "fs";
const env=await initializeTestEnvironment({projectId:"demo-test", firestore:{rules:fs.readFileSync("firestore.rules","utf8"), host:"127.0.0.1", port:8085}});
await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  await setDoc(doc(db,"employees/a"),{role:"arbetare",name:"A"});
  await setDoc(doc(db,"employees/b"),{role:"arbetare",name:"B"});
  await setDoc(doc(db,"trips/t1"),{id:"t1",vehicleId:"v1",empId:"a",empName:"A",startKm:1000,status:"open",endKm:0,endAt:"",km:0,photoEnd:"",hasEnd:false,kind:"tjanst"});
  await setDoc(doc(db,"trips/t2"),{id:"t2",vehicleId:"v1",empId:"a",startKm:900,status:"done",endKm:950,km:50});
});
const b=env.authenticatedContext("b").firestore();
const x=env.authenticatedContext("x").firestore();
const base={id:"t1",vehicleId:"v1",empId:"a",empName:"A",startKm:1000,status:"open",endKm:0,endAt:"",km:0,photoEnd:"",hasEnd:false,kind:"tjanst"};
const r=async(n,p)=>{ try{ await p; console.log("OK  ",n);}catch(e){ console.log("NEJ ",n);} };
await r("B listar öppna resor", getDocs(query(collection(b,"trips"),where("status","==","open"))));
await r("B listar alla resor (ska nekas)", getDocs(collection(b,"trips")));
await r("B läser avslutad resa (ska nekas)", getDoc(doc(b,"trips/t2")));
await r("X utan profil listar öppna (ska nekas)", getDocs(query(collection(x,"trips"),where("status","==","open"))));
await r("B ändrar km-start (ska nekas)", setDoc(doc(b,"trips/t1"),{...base,startKm:1,status:"done",endKm:1100,km:1099,endAt:"z",closedById:"b",closedByName:"B"}));
await r("B byter förare (ska nekas)", setDoc(doc(b,"trips/t1"),{...base,empId:"b",status:"done",endKm:1100,km:100,endAt:"z",closedById:"b",closedByName:"B"}));
await r("B avslutar A:s resa", setDoc(doc(b,"trips/t1"),{...base,status:"done",endKm:1100,km:100,endAt:"z",hasEnd:true,closedById:"b",closedByName:"B"}));
await r("B sparar slutfoto", setDoc(doc(b,"tripphotos/t1__end"),{tripId:"t1",empId:"b",which:"end",data:"abc"}));
await r("B sparar startfoto (ska nekas)", setDoc(doc(b,"tripphotos/t1__start"),{tripId:"t1",empId:"b",which:"start",data:"abc"}));
await r("B ändrar avslutad resa igen (ska nekas)", setDoc(doc(b,"trips/t1"),{...base,status:"done",endKm:1200,km:200,endAt:"z",closedById:"b",closedByName:"B"}));
await env.cleanup();
