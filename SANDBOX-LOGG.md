# Sandbox-logg

Utvecklingsagenten arbetar på grenen `claude/sandbox-forbattringar`. Den grenen
deployar aldrig: bara `main` och `claude/odds-lappar-sportsbetting-dyfm54`
publiceras till den riktiga sidan. Versionen (`APP_VERSION`, `sw.js`) bumpas
först när en förbättring tas ut live.

**Testa:** demon finns som artifakt på https://claude.ai/artifact/L1u9iVbgfCWVM7yPVxdk9x
– samma kod som på grenen, men mot påhittad testdata i webbläsaren
(`demo/fakefb.js`, `demo/seed.js`). Byggs med `node demo/build.mjs <utmapp>`.
"Börja om" i hörnet (tryck två gånger) lägger tillbaka testdatan.

**Testsvit:** `node demo/test.mjs` (eller `node demo/test.mjs sök xss` för vissa) bygger demon och kör
alla kontroller i en riktig webbläsare med svensk tidszon. Körs varje varv.

Begränsningar i demon: AI-kalkyl och AI-avläsning av mätaren svarar inte
(inga serverfunktioner), nedladdningar (Excel, PDF), kamera och utskrift
stoppas av artifaktens ram.

## Gjort

| Datum | Område | Vad | Commit |
|---|---|---|---|
| 2026-10-20 | Testbarhet | Demoläge som artifakt: hela appen mot testdata, uppdateras varje varv | b571109 |
| 2026-10-20 | Stabilitet/design | Foton: eget fönster med förhandsvisning, text och Avbryt i stället för webbläsarens textruta; ta bort foto med två tryck i stället för confirm() | 8498b70 |
| 2026-10-20 | Säkerhet | Främling med eget Firebase-konto kunde ge sig själv en profil och läsa projekt, kunder, timpriser och bilar; alla inloggade kunde läsa inköpspriserna i AI-kunskapen. Nu skapar bara superadmin profiler (appen skriver profilen som admin), allt kräver profil och offert/AI-kunskap kräver admin. Vecka i attest måste stämma med dokumentet. 34 regeltester i emulatorn. **Måste ut tillsammans: app + regler (deployflödet tar appen först).** | 8f53f44 |
| 2026-10-20 | Ny funktion | Sökruta i projektlistan: filtrerar på kod, namn, kund och adress medan man skriver (flera ord = alla måste finnas), visar ”2 av 5 projekt”, summaraden räknar träffarna, Esc/Rensa tömmer. Demo: rimligare offertbelopp. | 5b0644b |
| 2026-10-20 | Stabilitet | Tidsposter kunde försvinna: två snabba ändringar samma dag (eller en som väntar på segt nät) utgick från samma gamla lista och skrev över varandra – testat: före ”2,1”, efter ”2,3,1”. saveDay uppdaterar nu listan innan den väntar på databasen. Dessutom ignoreras dubbeltryck (samma knapp inom 400 ms), utom för bläddring och flikar. | f6a2e5b |
| 2026-10-20 | Design | Månadskalendern på mobil: projektkoden klipptes till en bit av en bokstav i varje post och såg ut som skräptecken. Under 620 px visas bara timmarna, centrerat; färgen visar typ och hela posten syns i dagsvyn. | bb0f431 |
| 2026-10-20 | Stabilitet/UX | Offline-läge syns: gul list ”Ingen anslutning – det du sparar skickas när nätet är tillbaka, du behöver inte spara igen” och en bekräftelse när nätet kommer tillbaka. Demo: skylten är en smal list överst i stället för att täcka innehåll. | 3f35695 |
| 2026-10-20 | Ny funktion | ”Samma som tis 20 okt · 8 h · P-1042” i dagsformuläret: på en tom dag kopieras arbetsposterna (projekt, timmar, notering) från senaste arbetsdagen inom två veckor med ett tryck. Frånvaro kopieras aldrig. | 2c942de |
| 2026-10-20 | Hastighet | Projekt/Statistik/Arkiv hämtade alla tidrapporter och kostnader i hela historiken från servern varje gång fliken öppnades (växer varje månad). Nu en live-lyssning: cachen visas direkt och servern skickar bara ändringar. Mätt i demon: 5×(Projekt+Statistik) läste 100→10 tidrapporter och 60→6 kostnader. Stängs vid utloggning. (Ritning mätt: 6–15 ms per flik även med 10 anställda × 2 år – inget att vinna där.) | 1c7d4c5 |
| 2026-10-20 | Buggfix | **Fel tid och fel datum i körjournalen.** Tidsstämplar (UTC) visades och grupperades på sina första tecken: en resa 07:05 visades som 05:05 i Sverige, en resa efter midnatt fick gårdagens datum och en resa natten till den 1:a hamnade i fel månad (och fel milersättning). Testat med svensk tidszon. Nu localDay/localTime/stampText överallt (körjournal, Excel-export, foton, AI-exempel, påminnelser, arkiv). Resetabellen visar ”tis 20/10” på en rad. | 47d8dfd |
| 2026-10-20 | Säkerhet | Flikarnas namn (Utseende & texter) sattes in i HTML utan escape – ett kapat supportkonto kunde köra kod hos alla. Rättat. XSS-svep i demon: skadlig kod i 484 textfält (namn, projekt, kunder, anteckningar, resor, kostnader, inställningar) genom alla flikar och flera fönster – före kördes den i flikarna, efter ingenstans. Serverfunktionerna granskade: kräver rätt roll, ingen åtgärd behövs. | 4463bb1 |
| 2026-10-20 | Stabilitet | Testsvit `demo/test.mjs`: 10 tester (alla flikar utan fel, foton, sökning, kopiera förra dagen, snabba ändringar på segt nät, dubbeltryck, offline, svensk tid, XSS-svep, inloggning som arbetare). Visade att dubbeltrycksspärren också hindrar att ett dubbeltryck på ”Ta bort” går förbi ”Tryck igen”. | 99ec6af |
| 2026-10-20 | Testbarhet | Demo: Kalkyl-fliken har firmauppgifter (påhittade nummer), tre offerter (utkast, skickad, accepterad – den accepterade kopplad till Balkongräcken) och en prislista, tidsnormer och regler under Lär upp AI:n, så hela offertflödet går att prova. Testdatan laddas om automatiskt (v3). | 1479be5 |
| 2026-10-20 | Design | Kompaktare topplist på telefon (under 520 px): kontoknappen blir bara initialerna på samma rad som namnet (hela namnet i etiketten), flikarna lite tätare. Topplisten för admin: 287 → 230 px (36 % → 29 % av skärmen), 330 → 271 px på 360 px breda telefoner. | 68b8697 |
| 2026-10-20 | Design | ”Mer”-knapp på telefon: Arkiv, Personal, Listor, Inkorg och Utseende ligger bakom Mer (den flik man står på syns alltid; på dator syns allt). Topplisten för admin på telefon: 287 → 189 px totalt med förra varvet. Nytt test i sviten. | b96371e |
| 2026-10-20 | Stabilitet | Automatiska felrapporter: oväntade fel läggs i Inkorg (fel, flik, version, telefon), högst tre per besök, aldrig samma två gånger, inget nätbrus. Knapptryck som misslyckas ger nu ”Något gick fel – felet är rapporterat” i stället för ingenting. Samma form som supportförfrågan, reglerna oförändrade. Exporterna granskade: tal skrivs som tal, ingen åtgärd. Nytt test (12 st). | d9c2ee9 |
| 2026-10-20 | Ny funktion | Offertuppföljning: skickade offerter märks ”Går ut om 4 dagar” (gult), ”Utgången för 11 dagar sedan” (rött) eller ”Gäller till …”, och en rad ovanför listan påminner när någon går ut inom en vecka. Demo: två skickade offerter i det läget (testdata v4). Nytt test (13 st). | 5c20283 |
| 2026-10-20 | Design/tillgänglighet | Kontrast enligt WCAG för alla färgpar i ljust och mörkt läge: allt klarade 4,5:1 utom grå hjälptext på sidans bakgrund i ljust läge (4,40). `--muted` #5D6B74 → #5A6871 ger minst 4,61 mot alla ljusa ytor – knappt synligt, men läsbart i solljus. | 0f4f170 |
| 2026-10-20 | Ny funktion | ”Skapa projekt av offerten”: på en skickad/accepterad offert skapas projektet med ett tryck – nästa projektkod (P-1047 → P-1048), kund, adress, timpris, kontakt och hela kalkylen (pris, timmar, arbete, material, resor), kopplat till offerten. Offerten markeras accepterad, projektet öppnas, och offerten visar sedan ”Öppna projektet” i stället. Nytt test (14 st). | 1db72e9 |
| 2026-10-20 | Ny funktion | **”Att göra” i varje projekt**: delad checklista (beställa material, boka lift, ta mått). Alla med profil lägger till och bockar av, det syns vem och när, listan är live mellan telefoner. Ny samling `projtasks` med regler: arbetare får bara bocka av i eget namn, aldrig ändra texten, bara ta bort egna punkter (17 regeltester + de 34 tidigare). Med i dagliga säkerhetskopian. Regeltesterna sparade i `demo/regler/`. Nytt test i sviten (15 st). **Måste ut med reglerna (deployflödet tar dem).** | (denna) |

## Idéer att ta sig an

- Enter i timfältet när man lägger till tid: den gamla siffran blir kvar i rutan efteråt (Chrome skickar change från rutan mitt i omritningen). Fixat för Att göra – avgör om tidrapporten ska tömmas eller behålla siffran med flit.

- `window.print` i körjournalen fungerar i appen men inte i demon – överväg en PDF-export i stället.
- Säkerhetshuvuden i `timmar-app/_headers` (gå igenom vad som redan finns).
