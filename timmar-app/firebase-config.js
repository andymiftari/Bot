// ---------------------------------------------------------------------------
// Klistra in din Firebase-konfiguration mellan klamrarna nedan.
//
// Du hittar den i Firebase-konsolen:
//   Project settings (kugghjulet)  ->  Your apps  ->  Web app  ->  SDK setup
//   och välj "Config".
//
// Det ska se ut ungefär så här när du är klar:
//
//   export const firebaseConfig = {
//     apiKey: "AIzaSyD-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
//     authDomain: "timmar-smide.firebaseapp.com",
//     projectId: "timmar-smide",
//     storageBucket: "timmar-smide.appspot.com",
//     messagingSenderId: "123456789012",
//     appId: "1:123456789012:web:abcdef1234567890"
//   };
//
// Värdena är inte hemliga – de är gjorda för att ligga i webbläsaren.
// Det som skyddar datan är inloggningen och säkerhetsreglerna i Firestore.
// ---------------------------------------------------------------------------

export const firebaseConfig = {
  apiKey: "AIzaSyDXKDqf79k0e5d7tOrmYEq2DzkDwY6pfWs",
  authDomain: "tidsrapportering-ellingesmide.firebaseapp.com",
  projectId: "tidsrapportering-ellingesmide",
  storageBucket: "tidsrapportering-ellingesmide.firebasestorage.app",
  messagingSenderId: "846100468244",
  appId: "1:846100468244:web:e78cf59797d0a8ac99cd01"
};

// Domänen används bara internt för att bygga en e-postadress av kontonamnet.
// Den behöver inte finnas på riktigt. Ändra den gärna till ert eget namn.
export const ACCOUNT_DOMAIN = "timmar.app";

// ---------------------------------------------------------------------------
// Supportknappen längst ner på varje sida.
//
// Meddelandet sparas alltid i databasen under "support". Vill du också få det
// som mejl utan att adressen syns i appen: skapa ett gratis konto på
// web3forms.com, ange din mottagaradress där, och klistra in nyckeln nedan.
// Nyckeln avslöjar ingen adress – den är bara en referens hos tjänsten.
// ---------------------------------------------------------------------------
export const SUPPORT_ENDPOINT = "https://api.web3forms.com/submit";
export const SUPPORT_KEY = "";   // t.ex. "a1b2c3d4-...". Tom = bara databasen.

// ---------------------------------------------------------------------------
// Filmapp på egen server (one.com).
//
// Lägg filen sync.php i webbroten på ditt webbhotell, sätt samma hemliga ord
// där och här nedan, och fyll i adressen. Då sparas varje uttagen rapport även
// som en riktig Excel-fil på servern, i mappar per projekt och vecka – och
// appen kan läsa tillbaka filer därifrån.
//
// Lämna SYNC_URL tom tills du flyttat appen till one.com. Allt annat fungerar
// precis som vanligt under tiden.
// ---------------------------------------------------------------------------
export const SYNC_URL = "";      // t.ex. "https://dinfirma.se/sync.php"
export const SYNC_TOKEN = "";    // samma hemliga ord som i sync.php
