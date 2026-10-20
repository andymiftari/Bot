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

## Idéer att ta sig an

- `window.print` i körjournalen fungerar i appen men inte i demon – överväg en PDF-export i stället.
- Säkerhetshuvuden i `timmar-app/_headers` (gå igenom vad som redan finns).
- Svenska datum och tal överallt i exporter.
