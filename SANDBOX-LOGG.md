# Sandbox-logg

Utvecklingsagenten arbetar på grenen `claude/sandbox-forbattringar`. Den grenen
deployar aldrig: bara `main` och `claude/odds-lappar-sportsbetting-dyfm54`
publiceras till den riktiga sidan. Versionen (`APP_VERSION`, `sw.js`) bumpas
först när en förbättring tas ut live.

**Testa:** demon finns som artifakt på https://claude.ai/artifact/L1u9iVbgfCWVM7yPVxdk9x
– samma kod som på grenen, men mot påhittad testdata i webbläsaren
(`demo/fakefb.js`, `demo/seed.js`). Byggs med `node demo/build.mjs <utmapp>`.
"Börja om" i hörnet (tryck två gånger) lägger tillbaka testdatan.

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
| 2026-10-20 | Buggfix | **Fel tid och fel datum i körjournalen.** Tidsstämplar (UTC) visades och grupperades på sina första tecken: en resa 07:05 visades som 05:05 i Sverige, en resa efter midnatt fick gårdagens datum och en resa natten till den 1:a hamnade i fel månad (och fel milersättning). Testat med svensk tidszon. Nu localDay/localTime/stampText överallt (körjournal, Excel-export, foton, AI-exempel, påminnelser, arkiv). Resetabellen visar ”tis 20/10” på en rad. | (denna) |

## Idéer att ta sig an

- `window.print` i körjournalen fungerar i appen men inte i demon – överväg en PDF-export i stället.
- Säkerhetshuvuden i `timmar-app/_headers` (gå igenom vad som redan finns).
- Svenska datum och tal överallt i exporter.
