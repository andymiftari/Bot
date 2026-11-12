/* Juridiska sidor: integritetspolicy (GDPR) och information om cookies och
   lagring (lagen om elektronisk kommunikation 9 kap. 28 §), samt sidfoten med
   företagsuppgifter (e-handelslagen 8 §).

   Företagsuppgifterna hämtas från meta/app.legal, som superadmin fyller i under
   Kalkyl → Firmauppgifter. meta/app går att läsa utan inloggning, så sidfoten
   och policyn fungerar även på inloggningssidan. Där en uppgift saknas visas en
   markering, så att det syns vad som behöver fyllas i. */

export const POLICY_DATE = "12 november 2026";

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const MISSING = '<span class="legal-missing">uppgift saknas – fylls i under Kalkyl → Firmauppgifter</span>';
const val = v => (v && String(v).trim()) ? esc(v) : MISSING;

function addressLine(L) {
  const a = [L.address, [L.zip, L.city].filter(Boolean).join(" ")].filter(x => x && String(x).trim());
  return a.length ? esc(a.join(", ")) : MISSING;
}

/* ---------- sidfot ---------- */
export function legalFooter(L, extra) {
  L = L || {};
  const bits = [];
  bits.push('<b>' + esc(L.name || "Ellinge Smidesservice AB") + '</b>');
  if (L.orgnr) bits.push('Org.nr ' + esc(L.orgnr));
  const adr = [L.address, [L.zip, L.city].filter(Boolean).join(" ")].filter(x => x && String(x).trim()).join(", ");
  if (adr) bits.push(esc(adr));
  if (L.email) bits.push('<a href="mailto:' + esc(L.email) + '">' + esc(L.email) + '</a>');
  if (L.phone) bits.push('<a href="tel:' + esc(String(L.phone).replace(/[^\d+]/g, "")) + '">' + esc(L.phone) + '</a>');
  if (L.vatnr) bits.push('Momsreg.nr ' + esc(L.vatnr));
  if (L.fskatt) bits.push('Godkänd för F-skatt');
  return '<footer class="legalfoot" role="contentinfo">'
    + '<p class="legalfoot-firm">' + bits.join('<span class="dotsep" aria-hidden="true"> · </span>') + '</p>'
    + '<nav class="legalfoot-links" aria-label="Juridisk information">'
    + '<a href="integritetspolicy" data-act="legal" data-v="privacy">Integritetspolicy</a>'
    + '<a href="cookies" data-act="legal" data-v="cookies">Cookies och lagring</a>'
    + (extra || "")
    + '</nav></footer>';
}

/* ---------- gemensam ram ---------- */
function page(title, lead, body) {
  return '<main class="legal" id="main">'
    + '<p><button class="btn sm ghost" data-act="legalback">← Tillbaka till appen</button></p>'
    + '<article class="legal-doc">'
    + '<h1>' + esc(title) + '</h1>'
    + '<p class="legal-lead">' + lead + '</p>'
    + body
    + '</article></main>';
}

/* ---------- integritetspolicy ---------- */
export function viewPrivacy(L, opt) {
  L = L || {};
  opt = opt || {};
  const name = esc(L.name || "Ellinge Smidesservice AB");
  const contact = L.email ? '<a href="mailto:' + esc(L.email) + '">' + esc(L.email) + '</a>' : MISSING;
  const s = (h, inner) => '<section><h2>' + h + '</h2>' + inner + '</section>';
  const body =
    s("1. Vem som ansvarar",
      '<p>Personuppgiftsansvarig är <b>' + name + '</b>.</p>'
      + '<dl class="legal-dl">'
      + '<dt>Organisationsnummer</dt><dd>' + val(L.orgnr) + '</dd>'
      + '<dt>Postadress</dt><dd>' + addressLine(L) + '</dd>'
      + '<dt>E-post</dt><dd>' + contact + '</dd>'
      + '<dt>Telefon</dt><dd>' + val(L.phone) + '</dd>'
      + '</dl>'
      + '<p>Frågor om hur vi hanterar dina personuppgifter skickar du till adressen ovan. Vi svarar inom en månad.</p>')
    + s("2. Vad appen används till",
      '<p>' + esc(opt.appName || "Appen") + ' är firmans interna verktyg för tidrapportering, körjournal, projektuppföljning, '
      + 'attest av arbetsveckor och offerter. Den används av firmans anställda och av dem firman ger ett konto. '
      + 'Den är inte en webbutik och säljer ingenting till besökare.</p>')
    + s("3. Vilka uppgifter vi behandlar, varför och med vilket stöd",
      '<div class="tblwrap"><table class="legal-tbl"><thead><tr><th scope="col">Uppgifter</th><th scope="col">Varför</th><th scope="col">Rättslig grund (GDPR art. 6)</th></tr></thead><tbody>'
      + '<tr><td>Namn, kontonamn, e-post, mobilnummer och roll</td><td>Ge dig ett konto, logga in, skicka påminnelser och lösenordsåterställning</td><td>Anställningsavtalet (b)</td></tr>'
      + '<tr><td>Arbetade timmar, övertid, projekt och anteckningar per dag</td><td>Lön, fakturering av kunder och uppföljning av projekt</td><td>Anställningsavtalet (b), rättslig förpliktelse enligt arbetstidslagen och bokföringslagen (c)</td></tr>'
      + '<tr><td>Frånvaro som sjukdom och VAB</td><td>Lön, sjuklön och anmälan till Försäkringskassan</td><td>Rättslig förpliktelse (c). Sjukfrånvaro är en hälsouppgift och behandlas enligt art. 9.2 b (arbetsrätt). Bara superadmin ser andras frånvaro.</td></tr>'
      + '<tr><td>Körjournal: bil, datum och tid, mätarställning, sträcka, ärende och foto på mätaren</td><td>Körjournal som Skatteverket kräver för tjänstebilar och förmånsbilar, och reseersättning</td><td>Rättslig förpliktelse (c), berättigat intresse av att kunna styrka körningar (f)</td></tr>'
      + '<tr><td>Foton och filer kopplade till projekt</td><td>Dokumentera utfört arbete för kund och garanti</td><td>Berättigat intresse (f)</td></tr>'
      + '<tr><td>Kunduppgifter i projekt och offerter: namn, adress och kontaktuppgifter</td><td>Ta fram offerter och utföra uppdrag</td><td>Avtal med kunden (b), berättigat intresse (f)</td></tr>'
      + '<tr><td>Supportärenden: namn, kontaktuppgift, meddelande och vilken sida du var på</td><td>Hjälpa dig när något inte fungerar</td><td>Berättigat intresse (f)</td></tr>'
      + '<tr><td>Tekniska uppgifter: IP-adress, webbläsare och tidpunkt i serverloggar</td><td>Driftsäkerhet och skydd mot intrång</td><td>Berättigat intresse (f)</td></tr>'
      + '</tbody></table></div>')
    + s("4. AI-funktioner",
      '<p>Superadmin kan låta appen ta fram ett förslag till offert. Då skickas underlaget som superadmin klistrat in eller laddat upp '
      + '(till exempel kundens förfrågan, ritningar och prislistor) via vår server till en AI-tjänst: Google Gemini och, om den är påslagen, Anthropic Claude. '
      + 'Appen kan också läsa av mätarställningen på ett foto med Google Gemini.</p>'
      + '<p>Skicka inte känsliga personuppgifter till AI-funktionerna. Ta bort personnummer och liknande ur underlaget innan du laddar upp det. '
      + 'Ingen AI fattar beslut om dig – förslagen granskas alltid av en människa.</p>')
    + s("5. Vilka som får del av uppgifterna",
      '<p>Inom firman ser en arbetare bara sina egna uppgifter. Superadmin ser alla anställdas tid, frånvaro och körjournal. '
      + 'Vi säljer aldrig personuppgifter och lämnar inte ut dem till andra än:</p>'
      + '<ul>'
      + '<li><b>Google</b> (Firebase: inloggning och databas; Gemini: AI-förslag) – personuppgiftsbiträde.</li>'
      + '<li><b>Cloudflare</b> (driftar webbplatsen och vår server) – personuppgiftsbiträde.</li>'
      + (opt.supportMail ? '<li><b>Web3Forms</b> (vidarebefordrar supportärenden som mejl) – personuppgiftsbiträde.</li>' : '')
      + (opt.anthropic ? '<li><b>Anthropic</b> (Claude: AI-förslag till offerter) – personuppgiftsbiträde.</li>' : '')
      + '<li>Myndigheter när lagen kräver det, till exempel Skatteverket och Försäkringskassan, och vår redovisningsbyrå för löneadministration.</li>'
      + '</ul>'
      + '<p>Vi har personuppgiftsbiträdesavtal med biträdena. Google, Cloudflare och Anthropic kan behandla uppgifter i USA. '
      + 'Överföringen sker med stöd av EU:s beslut om adekvat skyddsnivå för företag anslutna till EU–US Data Privacy Framework, '
      + 'som alla tre är, och EU-kommissionens standardavtalsklausuler.</p>')
    + s("6. Hur länge vi sparar uppgifterna",
      '<ul>'
      + '<li><b>Tidrapporter, löneunderlag, körjournal och projekt:</b> sju år efter utgången av det kalenderår då räkenskapsåret avslutades, enligt bokföringslagen (7 kap. 2 §). Projekt och deras historik tas aldrig bort i förtid, eftersom de är underlag för fakturor och garantiåtaganden.</li>'
      + '<li><b>Ditt konto:</b> stängs när anställningen upphör. Namnet finns kvar i de rapporter som ska sparas enligt ovan.</li>'
      + '<li><b>Supportärenden:</b> tas bort senast ett år efter att ärendet är löst.</li>'
      + '<li><b>Säkerhetskopior:</b> skrivs över löpande och sparas högst 30 dagar.</li>'
      + '<li><b>Serverloggar:</b> sparas av Google och Cloudflare enligt deras villkor, normalt högst 30 dagar.</li>'
      + '</ul>')
    + s("7. Dina rättigheter",
      '<p>Du har rätt att</p><ul>'
      + '<li>få veta vilka uppgifter vi har om dig och få en kopia av dem (registerutdrag),</li>'
      + '<li>få felaktiga uppgifter rättade,</li>'
      + '<li>få uppgifter raderade när de inte längre behövs och vi inte måste spara dem enligt lag,</li>'
      + '<li>begära att behandlingen begränsas,</li>'
      + '<li>invända mot behandling som grundas på berättigat intresse,</li>'
      + '<li>få ut uppgifter du själv lämnat i ett maskinläsbart format (dataportabilitet).</li>'
      + '</ul><p>Kontakta oss på ' + contact + '. Är du missnöjd med hur vi hanterar dina uppgifter kan du klaga hos '
      + '<b>Integritetsskyddsmyndigheten (IMY)</b>, Box 8114, 104 20 Stockholm, <a href="https://www.imy.se" rel="noopener" target="_blank">imy.se</a>.</p>')
    + s("8. Säkerhet",
      '<p>All trafik är krypterad (https). Varje person loggar in med eget konto, och databasens säkerhetsregler ser till att en arbetare bara når sina egna uppgifter. '
      + 'Inskickade och attesterade veckor låses. Vi tar säkerhetskopior varje dag.</p>')
    + s("9. Cookies och lagring",
      '<p>Appen använder ingen spårning, ingen statistik och ingen reklam. Den lagrar bara det som behövs för att du ska kunna vara inloggad och arbeta utan nät. '
      + 'Läs mer på sidan <a href="cookies" data-act="legal" data-v="cookies">Cookies och lagring</a>.</p>')
    + s("10. Ändringar",
      '<p>Ändras policyn uppdaterar vi datumet nedan och berättar om större ändringar i appen.</p>');
  return page("Integritetspolicy",
    'Så här hanterar ' + name + ' personuppgifter i appen. Senast uppdaterad ' + POLICY_DATE + '.',
    body);
}

/* ---------- cookies och lagring ---------- */
export function viewCookies(L, opt) {
  L = L || {};
  opt = opt || {};
  const row = (n, where, why, how, need) => '<tr><td><code>' + esc(n) + '</code></td><td>' + where + '</td><td>' + why + '</td><td>' + how + '</td><td>' + need + '</td></tr>';
  const body =
    '<section><h2>Kort sagt</h2><p>Appen spårar dig inte. Den har ingen besöksstatistik, inga reklam- eller sociala-medier-kakor och laddar inga skript eller typsnitt från tredje part för att följa dig. '
    + 'Det som lagras i din webbläsare behövs för att tjänsten du bett om ska fungera. Därför krävs inget samtycke enligt lagen om elektronisk kommunikation (9 kap. 28 §), men du ska få veta vad som lagras.</p></section>'
    + '<section><h2>Det här lagras på din enhet</h2>'
    + '<div class="tblwrap"><table class="legal-tbl"><thead><tr><th scope="col">Namn</th><th scope="col">Typ</th><th scope="col">Varför</th><th scope="col">Hur länge</th><th scope="col">Behövs</th></tr></thead><tbody>'
    + row("firebaseLocalStorageDb", "IndexedDB", "Håller dig inloggad (Firebase Authentication)", "Tills du loggar ut", "Ja")
    + row("firestore/…", "IndexedDB", "Sparar det du rapporterar när du saknar nät och skickar det när nätet är tillbaka", "Tills du loggar ut eller rensar webbläsaren", "Ja")
    + row("ellingesmide-…", "Cachelagring (service worker)", "Gör att appen startar snabbt och fungerar utan täckning", "Byts ut vid varje ny version", "Ja")
    + row("timmar:prefs", "localStorage", "Kommer ihåg vilken vy och vecka du senast tittade på", "Tills du stänger av det nedan", "Nej, valfritt")
    + row("timmar:remind:…", "localStorage", "Ser till att påminnelselistan bara öppnas av sig själv en gång per dag (bara superadmin)", "En dag", "Ja")
    + '</tbody></table></div>'
    + '<p class="note">Inga kakor (cookies) från tredje part sätts. Cloudflare kan sätta en tekniskt nödvändig säkerhetskaka för att stoppa angrepp mot webbplatsen.</p></section>'
    + '<section><h2>Dina inställningar</h2>'
    + '<label class="check legal-toggle"><input type="checkbox" id="lg-prefs"' + (opt.prefsOn ? ' checked' : '') + ' data-act="legalprefs"> '
    + '<span>Kom ihåg senaste vy och vecka på den här enheten</span></label>'
    + '<p><button class="btn" data-act="legalclear">Rensa sparade inställningar och appens cache på den här enheten</button></p>'
    + '<p class="note">Rensningen tar inte bort något du rapporterat. Det du sparat som ännu inte hunnit skickas ligger kvar tills det är skickat.</p>'
    + '</section>'
    + '<section><h2>Mer information</h2><p>Hur vi hanterar personuppgifter står i <a href="integritetspolicy" data-act="legal" data-v="privacy">integritetspolicyn</a>.</p></section>';
  return page("Cookies och lagring", 'Vad appen sparar i din webbläsare och varför. Senast uppdaterad ' + POLICY_DATE + '.', body);
}
