/* ocr.js – avläsning av bilens mätarställning.

   Tre lager, i tur och ordning:

   1. Bildbehandling. Remsan från kameran gråskalas, tröskas med Otsus metod
      och delas upp i enskilda siffror. En siffra för sig är mycket lättare
      att känna igen än en hel rad.

   2. Mallbank per bil. Varje gång föraren bekräftar en avläsning vet vi facit.
      Då sparas varje sifferruta som en liten normaliserad bild, märkt med rätt
      siffra, i bilens egen bank. Nästa skanning jämförs mot den banken.
      Eftersom en och samma bil alltid har samma typsnitt och samma placering
      blir det träffsäkert efter en handfull skanningar.

   3. Rimlighet. Mätaren går bara uppåt, och bara rimligt mycket mellan två
      avläsningar. Med förra ställningen som facit går de flesta felen att
      rätta automatiskt – vi provar de näst bästa siffrorna och behåller den
      kombination som både ser bäst ut och är rimlig.

   Modulen är fristående och har inga beroenden, så den går att testa för sig.
*/

export const CELL_W = 12, CELL_H = 20;      /* normaliserad sifferruta */
const CELL_N = CELL_W * CELL_H;
export const MAX_PER_DIGIT = 14;            /* mallar att spara per siffra och bil */

/* ============================ bildbehandling ============================ */

/* Gråskala ur en canvas. Returnerar {w,h,g} där g är 0–255 per bildpunkt. */
export function toGray(canvas){
  const ctx = canvas.getContext("2d");
  const im = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = im.data, n = canvas.width * canvas.height;
  const g = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    g[i] = (d[k] * 0.299 + d[k + 1] * 0.587 + d[k + 2] * 0.114) | 0;
  }
  return { w: canvas.width, h: canvas.height, g: g };
}

/* Otsus metod: hittar den tröskel som bäst skiljer mörkt från ljust. */
export function otsu(g){
  const hist = new Uint32Array(256);
  for (let i = 0; i < g.length; i++) hist[g[i]]++;
  const total = g.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, bestT = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; bestT = t; }
  }
  return bestT;
}

/* Gör om till 1 = bläck, 0 = bakgrund. `invert` vänder på polariteten,
   vilket behövs för mätare med ljusa siffror på mörk bakgrund. */
export function binarize(gray, t, invert){
  const out = new Uint8Array(gray.g.length);
  for (let i = 0; i < gray.g.length; i++) {
    const dark = gray.g[i] < t;
    out[i] = (invert ? !dark : dark) ? 1 : 0;
  }
  return out;
}

/* Tar bort ensamma punkter som inte hänger ihop med något – kamerabrus. */
function despeckle(bin, w, h){
  const out = new Uint8Array(bin.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!bin[i]) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (dx || dy) n += bin[i + dy * w + dx];
      if (n >= 2) out[i] = 1;
    }
  }
  return out;
}

/* Delar remsan i kolumner där det finns bläck, och klipper ut varje siffra.
   Returnerar rutor sorterade från vänster till höger. */
export function segment(bin, w, h){
  const col = new Uint32Array(w);
  for (let x = 0; x < w; x++) {
    let c = 0;
    for (let y = 0; y < h; y++) c += bin[y * w + x];
    col[x] = c;
  }
  /* en kolumn räknas som "tom" när den nästan saknar bläck */
  const minInk = Math.max(1, Math.round(h * 0.04));
  const runs = [];
  let start = -1;
  for (let x = 0; x < w; x++) {
    const on = col[x] >= minInk;
    if (on && start < 0) start = x;
    if ((!on || x === w - 1) && start >= 0) {
      const end = on ? x : x - 1;
      if (end - start + 1 >= 2) runs.push([start, end]);
      start = -1;
    }
  }
  /* slå ihop rutor som ligger tätt – en sjua eller etta kan brytas isär */
  const merged = [];
  for (const r of runs) {
    const prev = merged[merged.length - 1];
    if (prev && r[0] - prev[1] <= 1) prev[1] = r[1];
    else merged.push([r[0], r[1]]);
  }
  /* lodrät utsträckning per ruta */
  const boxes = [];
  for (const [x0, x1] of merged) {
    let y0 = h, y1 = -1;
    for (let y = 0; y < h; y++) {
      let any = 0;
      for (let x = x0; x <= x1; x++) if (bin[y * w + x]) { any = 1; break; }
      if (any) { if (y < y0) y0 = y; y1 = y; }
    }
    if (y1 >= y0) boxes.push({ x0: x0, x1: x1, y0: y0, y1: y1 });
  }
  return boxes;
}

/* Sållar bort rutor som omöjligt kan vara siffror: för breda, för smala,
   för låga. Höjden på en siffra är stabil, så den används som måttstock. */
export function keepDigitBoxes(boxes){
  if (!boxes.length) return [];
  const heights = boxes.map(b => b.y1 - b.y0 + 1).sort((a, b) => a - b);
  const medH = heights[heights.length >> 1];
  return boxes.filter(function(b){
    const bh = b.y1 - b.y0 + 1, bw = b.x1 - b.x0 + 1;
    if (bh < medH * 0.55) return false;      /* punkter, streck, skräp */
    if (bw > medH * 1.4) return false;       /* två siffror som suttit ihop */
    if (bw < medH * 0.05) return false;
    return true;
  });
}

/* Skalar en ruta till CELL_W x CELL_H med ytmedelvärde, så att tjocka och
   tunna siffror blir jämförbara. */
export function normalize(bin, w, h, box){
  const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
  const cell = new Uint8Array(CELL_N);
  for (let cy = 0; cy < CELL_H; cy++) {
    const sy0 = box.y0 + Math.floor(cy * bh / CELL_H);
    const sy1 = box.y0 + Math.max(Math.floor((cy + 1) * bh / CELL_H), Math.floor(cy * bh / CELL_H) + 1);
    for (let cx = 0; cx < CELL_W; cx++) {
      const sx0 = box.x0 + Math.floor(cx * bw / CELL_W);
      const sx1 = box.x0 + Math.max(Math.floor((cx + 1) * bw / CELL_W), Math.floor(cx * bw / CELL_W) + 1);
      let on = 0, tot = 0;
      for (let y = sy0; y < sy1 && y <= box.y1; y++)
        for (let x = sx0; x < sx1 && x <= box.x1; x++) { on += bin[y * w + x]; tot++; }
      cell[cy * CELL_W + cx] = (tot && on * 2 >= tot) ? 1 : 0;
    }
  }
  return cell;
}

/* Provar båda polariteterna och behåller den som ger den mest trovärdiga
   raden av siffror: jämnstora rutor, rimligt antal. */
export function cellsFromCanvas(canvas){
  const gray = toGray(canvas);
  const t = otsu(gray.g);
  let best = null;
  for (const invert of [false, true]) {
    const bin = despeckle(binarize(gray, t, invert), gray.w, gray.h);
    const boxes = keepDigitBoxes(segment(bin, gray.w, gray.h));
    if (!boxes.length) continue;
    /* poäng: 4–9 siffror är rimligt, och de ska vara någorlunda lika höga */
    const hs = boxes.map(b => b.y1 - b.y0 + 1);
    const mean = hs.reduce((a, b) => a + b, 0) / hs.length;
    const spread = Math.sqrt(hs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / hs.length) / (mean || 1);
    const countPenalty = (boxes.length < 4 || boxes.length > 9) ? 1.2 : 0;
    const score = spread + countPenalty - Math.min(boxes.length, 8) * 0.03;
    if (!best || score < best.score)
      best = { score: score, invert: invert, boxes: boxes,
               cells: boxes.map(b => normalize(bin, gray.w, gray.h, b)) };
  }
  return best || { score: 99, invert: false, boxes: [], cells: [] };
}

/* ============================ mallbank ============================ */

/* Mallarna lagras som base64 i Firestore – kompakt och lätt att läsa tillbaka. */
export function cellToStr(cell){
  let s = "";
  for (let i = 0; i < CELL_N; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k++) if (cell[i + k]) b |= 1 << k;
    s += String.fromCharCode(b);
  }
  return typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64");
}
export function strToCell(str){
  const s = typeof atob === "function" ? atob(str) : Buffer.from(str, "base64").toString("binary");
  const cell = new Uint8Array(CELL_N);
  for (let i = 0; i < CELL_N; i += 8) {
    const b = s.charCodeAt(i >> 3) || 0;
    for (let k = 0; k < 8; k++) if (b & (1 << k)) cell[i + k] = 1;
  }
  return cell;
}
export function bankFromDoc(doc){
  const bank = {};
  const src = (doc && doc.digits) || {};
  for (let d = 0; d <= 9; d++) {
    const list = src[String(d)];
    bank[d] = Array.isArray(list) ? list.map(strToCell) : [];
  }
  return bank;
}
export function bankToDoc(bank){
  const digits = {};
  for (let d = 0; d <= 9; d++) digits[String(d)] = (bank[d] || []).map(cellToStr);
  return { digits: digits };
}
export function bankSize(bank){
  let n = 0;
  for (let d = 0; d <= 9; d++) n += (bank[d] || []).length;
  return n;
}

/* Avstånd mellan två rutor: andel bildpunkter som skiljer. 0 = identiska. */
export function dist(a, b){
  let diff = 0;
  for (let i = 0; i < CELL_N; i++) if (a[i] !== b[i]) diff++;
  return diff / CELL_N;
}

/* Hur en siffra utan mallar värderas. Varken bra eller dåligt – banken har
   helt enkelt inget att säga om den. Att straffa den som "dålig matchning"
   vore fel: då väljs hellre en siffra banken råkar känna igen, och avläsningen
   blir självsäkert fel. */
const NEUTRAL = 0.45;

/* Rangordnar alla siffror för en ruta. Bäst först. */
export function rank(bank, cell){
  const out = [];
  for (let d = 0; d <= 9; d++) {
    const list = bank[d] || [];
    if (!list.length) { out.push({ digit: d, d: NEUTRAL, known: false }); continue; }
    let best = 1;
    for (const t of list) { const s = dist(cell, t); if (s < best) best = s; }
    out.push({ digit: d, d: best, known: true });
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}

/* Lägger in bekräftade siffror i banken. Mallar som redan är nästan identiska
   hoppas över, så att banken samlar variation i stället för dubbletter. */
export function learn(bank, cells, text){
  if (!cells || cells.length !== String(text).length) return 0;
  let added = 0;
  for (let i = 0; i < cells.length; i++) {
    const d = +String(text)[i];
    if (isNaN(d)) continue;
    const list = bank[d] || (bank[d] = []);
    let near = false;
    for (const t of list) if (dist(cells[i], t) < 0.04) { near = true; break; }
    if (near) continue;
    list.push(cells[i]);
    if (list.length > MAX_PER_DIGIT) list.shift();
    added++;
  }
  return added;
}

/* ============================ rimlighet ============================ */

/* Hur långt en bil rimligen hinner mellan två avläsningar. Generöst tilltaget
   – hellre släppa igenom en lång dag än att gnälla på en riktig avläsning. */
export const MAX_JUMP = 3000;

export function plausible(value, last){
  if (!isFinite(value) || value < 0) return false;
  if (!last) return String(value).length >= 3 && value < 10000000;
  return value >= last && value <= last + MAX_JUMP;
}

/* Vad en färdig sifferrad kostar mot bildens rutor: medelavståndet för de
   siffror raden påstår sig ha. Lågt = stämmer väl med det kameran såg. */
export function costOf(text, ranks){
  let sum = 0, known = 0, unknown = 0, worst = 0;
  for (let i = 0; i < ranks.length; i++) {
    const d = +text[i];
    let e = null;
    for (const r of ranks[i]) if (r.digit === d) { e = r; break; }
    if (!e || !e.known) { unknown++; continue; }   /* banken kan inte uttala sig */
    sum += e.d; known++;
    if (e.d > worst) worst = e.d;
  }
  const cost = known ? sum / known : 1;
  /* liten övervikt för rader vi faktiskt kan bekräfta mot banken */
  return { cost: cost, effektiv: cost + unknown * 0.06, known: known, unknown: unknown, worst: worst };
}

/* Väljer mätarställning genom att räkna igenom alla rimliga värden och se
   vilket som stämmer bäst med bilden.

   Det här är kärnan i att det fungerar. Förra ställningen låser de inledande
   siffrorna nästan helt – står den på 124 580 ligger nästa någonstans mellan
   124 580 och 127 580, alltså börjar den på 124, 125, 126 eller 127. Kvar att
   verkligen läsa är de sista siffrorna. Därför blir avläsningen rätt även när
   mallbanken bara känner igen en del av siffrorna. */
export function bestReading(ranks, last){
  const n = ranks.length;
  if (!n) return null;
  const top = ranks.map(r => r[0].digit).join("");

  if (!last) {
    /* ingen historik att luta sig mot – ta rutornas bästa bud som det är */
    const c = costOf(top, ranks);
    return { text: top, value: parseInt(top, 10), ok: true, cost: c.cost,
             confidence: confidenceOf(c, 0.4), source: "bild" };
  }

  let best = null, second = null;
  for (let v = last; v <= last + MAX_JUMP; v++) {
    const s = String(v);
    if (s.length !== n) continue;
    const c = costOf(s, ranks);
    const cand = { text: s, value: v, c: c, e: c.effektiv };
    if (!best || cand.e < best.e) { second = best; best = cand; }
    else if (!second || cand.e < second.e) { second = cand; }
  }
  if (!best) {
    /* inget rimligt värde har lika många siffror som rutorna – kan hända när
       mätaren slagit runt, eller när segmenteringen missat. Flagga i stället. */
    const c = costOf(top, ranks);
    return { text: top, value: parseInt(top, 10), ok: false, cost: c.cost,
             confidence: 0, source: "bild" };
  }
  const margin = second ? (second.e - best.e) : 0.4;
  return { text: best.text, value: best.value, ok: true, cost: best.c.cost,
           confidence: confidenceOf(best.c, margin), source: "bank+historik" };
}

/* Säkerheten väger fyra saker, och alla måste vara goda:
     – hur väl raden stämmer med bilden
     – hur mycket bättre den är än näst bästa rimliga värde
     – hur stor del av siffrorna banken över huvud taget kunde uttala sig om
     – hur dålig den sämsta enskilda siffran var
   Blir någon av dem svag sjunker säkerheten, och appen låter bli att fylla i.
   Hellre tomt fält än ett självsäkert fel i en körjournal. */
function confidenceOf(c, margin){
  const passform = Math.max(0, 1 - c.cost * 2.4);
  const marginal = Math.min(1, margin * 14);
  const tackning = c.known / Math.max(1, c.known + c.unknown);
  const samsta   = Math.max(0, 1 - c.worst * 1.3);
  return Math.max(0, Math.min(1, passform * marginal * tackning * samsta));
}

/* Redigeringsavstånd: hur många tecken som skiljer två sifferrader. */
function editDist(a, b){
  const m = a.length, n = b.length;
  let prev = new Array(n + 1), cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    const t = prev; prev = cur; cur = t;
  }
  return prev[n];
}

/* Rättar en sifferrad från en vanlig OCR mot förra ställningen. Används när
   mallbanken ännu är otränad. Samma tanke som bestReading: leta upp det
   rimliga värde som ligger närmast det OCR:en trodde sig se, och acceptera
   bara om rättningen är liten – annars är gissningen inte värd att lita på. */
export function repairPlain(raw, last){
  const s = String(raw || "").replace(/\D/g, "");
  if (!s) return null;
  const v0 = parseInt(s, 10);
  if (!last) return { text: s, value: v0, ok: isFinite(v0) && s.length >= 3 };
  if (plausible(v0, last)) return { text: s, value: v0, ok: true };

  let best = null;
  for (let v = last; v <= last + MAX_JUMP; v++) {
    const t = String(v);
    /* bara rättningar av samma längd, eller en saknad/extra siffra */
    if (Math.abs(t.length - s.length) > 1) continue;
    const d = editDist(s, t);
    if (t.length !== s.length && d > 1) continue;
    if (!best || d < best.d) { best = { text: t, value: v, d: d }; if (d === 0) break; }
  }
  if (best && best.d <= 2)
    return { text: best.text, value: best.value, ok: true, rattad: true, avstand: best.d };
  return { text: s, value: v0, ok: false };
}

/* ============================ huvudingång ============================ */

/* Läser mätaren ur en canvas. `bank` är bilens mallbank, `last` förra
   kända ställningen. Returnerar förslaget plus rutorna, så att de kan
   märkas och sparas när föraren bekräftat. */
export function readOdometer(canvas, bank, last){
  const seg = cellsFromCanvas(canvas);
  if (!seg.cells.length) return { cells: [], text: "", value: NaN, ok: false, confidence: 0, source: "ingen" };
  const trained = bankSize(bank) >= 10;
  if (!trained) return { cells: seg.cells, boxes: seg.boxes, text: "", value: NaN, ok: false, confidence: 0, source: "otränad" };
  const ranks = seg.cells.map(c => rank(bank, c));
  const r = bestReading(ranks, last);
  return { cells: seg.cells, boxes: seg.boxes, text: r.text, value: r.value,
           ok: r.ok, confidence: r.confidence, source: "bank" };
}
