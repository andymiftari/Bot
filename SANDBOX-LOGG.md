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
| 2026-10-20 | Testbarhet | Demoläge som artifakt: hela appen mot testdata, uppdateras varje varv | (denna) |

## Idéer att ta sig an

- Byt webbläsarens egna dialoger (`prompt` för fototext, `confirm` för att ta bort foto, `window.print` i körjournalen) mot appens egna fönster – de ser bättre ut och fungerar överallt.
- Säkerhetshuvuden i `timmar-app/_headers` (gå igenom vad som redan finns).
- Svenska datum och tal överallt i exporter.
