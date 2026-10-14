/* qr.js – QR-kodare för Ellingesmide.
   Skriven för att ligga i appen, så att utskrift av bilarnas QR-koder
   fungerar även utan internet. Byte-läge, felkorrigeringsnivå M,
   version 1–10 (upp till 213 tecken). Följer ISO/IEC 18004.

   Användning:
     import { qrSvg } from "./qr.js";
     el.innerHTML = qrSvg("https://exempel.se/#kor=abc", {size:240, quiet:4});
*/

/* ---- Galois-fält GF(256), primitivt polynom 0x11D ---- */
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(function(){
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x; LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11D;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const gmul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

/* Generatorpolynom för n felkorrigeringskodord. */
function rsGen(n){
  let p = [1];
  for (let i = 0; i < n; i++) {
    const np = new Array(p.length + 1).fill(0);
    for (let j = 0; j < p.length; j++) {
      /* p * (x + α^i): x-ledet behåller index, konstantledet skjuts ett steg */
      np[j] ^= p[j];
      np[j + 1] ^= gmul(p[j], EXP[i]);
    }
    p = np;
  }
  return p;
}
function rsEncode(data, ecLen){
  const gen = rsGen(ecLen);
  const res = new Array(ecLen).fill(0);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ res[0];
    res.shift(); res.push(0);
    if (factor !== 0) for (let j = 0; j < gen.length - 1; j++) res[j] ^= gmul(gen[j + 1], factor);
  }
  return res;
}

/* ---- tabeller, felkorrigeringsnivå M ---- */
/* [totala kodord, ec-kodord per block, block i grupp 1, datakodord i grupp 1,
    block i grupp 2, datakodord i grupp 2] */
const SPEC = {
  1:  [26,  10, 1, 16, 0, 0],
  2:  [44,  16, 1, 28, 0, 0],
  3:  [70,  26, 1, 44, 0, 0],
  4:  [100, 18, 2, 32, 0, 0],
  5:  [134, 24, 2, 43, 0, 0],
  6:  [172, 16, 4, 27, 0, 0],
  7:  [196, 18, 4, 31, 0, 0],
  8:  [242, 22, 2, 38, 2, 39],
  9:  [292, 22, 3, 36, 2, 37],
  10: [346, 26, 4, 43, 1, 44]
};
/* Mittpunkter för justeringsmönstren. */
const ALIGN = {
  1: [], 2: [6,18], 3: [6,22], 4: [6,26], 5: [6,30],
  6: [6,34], 7: [6,22,38], 8: [6,24,42], 9: [6,26,46], 10: [6,28,50]
};

function dataCapacity(v){
  const s = SPEC[v];
  return s[2] * s[3] + s[4] * s[5];
}
/* Antal tecken som ryms i byte-läge: datakodord minus lägesindikator
   (4 bitar) och teckenräknare (8 bitar för version 1–9, 16 för 10+). */
function charCapacity(v){
  const headerBits = 4 + (v <= 9 ? 8 : 16);
  return dataCapacity(v) - Math.ceil(headerBits / 8);
}

/* ---- bitström ---- */
function BitBuffer(){
  this.bits = [];
}
BitBuffer.prototype.put = function(value, length){
  for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
};

/* ---- teckenkodning ---- */
function utf8Bytes(str){
  const out = [];
  for (const ch of String(str)) {
    let c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 63)); }
    else if (c < 0x10000) { out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
    else { out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
  }
  return out;
}

function buildCodewords(bytes, version){
  const spec = SPEC[version];
  const ecLen = spec[1];
  const buf = new BitBuffer();
  buf.put(4, 4);                                   /* byte-läge */
  buf.put(bytes.length, version <= 9 ? 8 : 16);    /* teckenräknare */
  for (const b of bytes) buf.put(b, 8);

  const totalDataBits = dataCapacity(version) * 8;
  /* avslutare, max fyra nollor */
  for (let i = 0; i < 4 && buf.bits.length < totalDataBits; i++) buf.bits.push(0);
  while (buf.bits.length % 8 !== 0) buf.bits.push(0);

  const data = [];
  for (let i = 0; i < buf.bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | buf.bits[i + j];
    data.push(byte);
  }
  const padBytes = [0xEC, 0x11];
  for (let i = 0; data.length < dataCapacity(version); i++) data.push(padBytes[i % 2]);

  /* dela upp i block, räkna felkorrigering per block */
  const blocks = [];
  let pos = 0;
  for (let g = 0; g < 2; g++) {
    const count = spec[2 + g * 2], size = spec[3 + g * 2];
    for (let b = 0; b < count; b++) {
      const chunk = data.slice(pos, pos + size);
      pos += size;
      blocks.push({ data: chunk, ec: rsEncode(chunk, ecLen) });
    }
  }
  /* flätas samman: först alla datakodord kolumnvis, sedan alla ec-kodord */
  const out = [];
  const maxData = Math.max.apply(null, blocks.map(b => b.data.length));
  for (let i = 0; i < maxData; i++)
    for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  for (let i = 0; i < ecLen; i++)
    for (const b of blocks) out.push(b.ec[i]);
  return out;
}

/* ---- rutnät ---- */
function emptyGrid(n){
  const g = [];
  for (let i = 0; i < n; i++) g.push(new Array(n).fill(null));
  return g;
}
function placeFinder(g, r, c){
  for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
    const rr = r + dr, cc = c + dc;
    if (rr < 0 || cc < 0 || rr >= g.length || cc >= g.length) continue;
    const inRing = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
                   (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6));
    const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
    g[rr][cc] = (inRing || inCore) ? 1 : 0;
  }
}
function placeAlignment(g, version){
  const centers = ALIGN[version];
  const n = g.length;
  for (const r of centers) for (const c of centers) {
    /* hoppa över de tre hörnen där sökmönstren redan ligger */
    if ((r <= 8 && c <= 8) || (r <= 8 && c >= n - 9) || (r >= n - 9 && c <= 8)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++)
      g[r + dr][c + dc] = (Math.max(Math.abs(dr), Math.abs(dc)) !== 1) ? 1 : 0;
  }
}
function reserveFormat(g){
  const n = g.length;
  for (let i = 0; i < 9; i++) {
    if (g[8][i] === null) g[8][i] = 2;
    if (g[i][8] === null) g[i][8] = 2;
  }
  for (let i = 0; i < 8; i++) {
    if (g[8][n - 1 - i] === null) g[8][n - 1 - i] = 2;
    if (g[n - 1 - i][8] === null) g[n - 1 - i][8] = 2;
  }
  g[n - 8][8] = 1;   /* alltid mörk modul */
}
function bch15(data){
  let d = data << 10;
  for (let i = 14; i >= 10; i--) if ((d >>> i) & 1) d ^= 0x537 << (i - 10);
  return ((data << 10) | d) ^ 0x5412;
}
function bch18(version){
  let d = version << 12;
  for (let i = 17; i >= 12; i--) if ((d >>> i) & 1) d ^= 0x1F25 << (i - 12);
  return (version << 12) | d;
}
function placeFormat(g, mask){
  const n = g.length;
  const bits = bch15((0 << 3) | mask);   /* 0 = felkorrigeringsnivå M */
  for (let i = 0; i < 15; i++) {
    /* mest signifikanta biten läggs först, i ordningen cellerna räknas upp nedan */
    const bit = (bits >>> (14 - i)) & 1;
    /* kopia 1, runt övre vänstra sökmönstret */
    if (i < 6)       g[8][i] = bit;
    else if (i === 6) g[8][7] = bit;
    else if (i === 7) g[8][8] = bit;
    else if (i === 8) g[7][8] = bit;
    else              g[14 - i][8] = bit;
    /* kopia 2: sju moduler nedåt i vänsterkanten, åtta åt höger på rad 8.
       Bit 7 hör till den vågräta delen – (n-8, 8) är den alltid mörka modulen. */
    if (i < 7) g[n - 1 - i][8] = bit;
    else       g[8][n - 15 + i] = bit;
  }
}
function placeVersion(g, version){
  if (version < 7) return;
  const n = g.length;
  const bits = bch18(version);
  for (let i = 0; i < 18; i++) {
    const bit = (bits >>> i) & 1;
    const r = Math.floor(i / 3), c = i % 3;
    g[r][n - 11 + c] = bit;
    g[n - 11 + c][r] = bit;
  }
}
const maskFn = [
  (r, c) => (r + c) % 2 === 0,
  (r, c) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
];

function placeData(g, codewords, mask){
  const n = g.length;
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  let col = n - 1, upward = true;
  while (col > 0) {
    if (col === 6) col--;                 /* hoppa över den lodräta tidslinjen */
    for (let i = 0; i < n; i++) {
      const row = upward ? n - 1 - i : i;
      for (let k = 0; k < 2; k++) {
        const c = col - k;
        if (g[row][c] !== null) continue;
        let bit = 0;
        if (bitIndex < totalBits) bit = (codewords[bitIndex >> 3] >>> (7 - (bitIndex & 7))) & 1;
        bitIndex++;
        g[row][c] = maskFn[mask](row, c) ? bit ^ 1 : bit;
      }
    }
    upward = !upward;
    col -= 2;
  }
}

function penalty(g){
  const n = g.length;
  let score = 0;
  const at = (r, c) => g[r][c] === 1 ? 1 : 0;

  /* regel 1: fem eller fler lika i rad, vågrätt och lodrätt */
  for (let i = 0; i < n; i++) {
    let runR = 1, runC = 1;
    for (let j = 1; j < n; j++) {
      if (at(i, j) === at(i, j - 1)) runR++; else { if (runR >= 5) score += 3 + runR - 5; runR = 1; }
      if (at(j, i) === at(j - 1, i)) runC++; else { if (runC >= 5) score += 3 + runC - 5; runC = 1; }
    }
    if (runR >= 5) score += 3 + runR - 5;
    if (runC >= 5) score += 3 + runC - 5;
  }
  /* regel 2: block om 2x2 i samma färg */
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
    const v = at(r, c);
    if (v === at(r, c + 1) && v === at(r + 1, c) && v === at(r + 1, c + 1)) score += 3;
  }
  /* regel 3: mönstret 1:1:3:1:1 med fyra ljusa moduler intill */
  const p1 = [1,0,1,1,1,0,1,0,0,0,0], p2 = [0,0,0,0,1,0,1,1,1,0,1];
  const match = (arr, pat) => pat.every((v, i) => arr[i] === v);
  for (let r = 0; r < n; r++) for (let c = 0; c <= n - 11; c++) {
    const rowSeq = [], colSeq = [];
    for (let k = 0; k < 11; k++) { rowSeq.push(at(r, c + k)); colSeq.push(at(c + k, r)); }
    if (match(rowSeq, p1) || match(rowSeq, p2)) score += 40;
    if (match(colSeq, p1) || match(colSeq, p2)) score += 40;
  }
  /* regel 4: obalans mellan mörkt och ljust */
  let dark = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) dark += at(r, c);
  const pct = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

/* ---- publikt ---- */
export function qrMatrix(text){
  const bytes = utf8Bytes(text);
  let version = 0;
  for (let v = 1; v <= 10; v++) if (bytes.length <= charCapacity(v)) { version = v; break; }
  if (!version) throw new Error("Texten är för lång för en QR-kod (max " + charCapacity(10) + " tecken).");

  const codewords = buildCodewords(bytes, version);
  const n = version * 4 + 17;

  /* mall med alla fasta mönster, återanvänds för varje maskprov */
  const base = emptyGrid(n);
  placeFinder(base, 0, 0);
  placeFinder(base, 0, n - 7);
  placeFinder(base, n - 7, 0);
  placeAlignment(base, version);
  for (let i = 8; i < n - 8; i++) {
    if (base[6][i] === null) base[6][i] = i % 2 === 0 ? 1 : 0;
    if (base[i][6] === null) base[i][6] = i % 2 === 0 ? 1 : 0;
  }
  reserveFormat(base);
  placeVersion(base, version);

  let best = null, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    /* de reserverade formatrutorna behåller sin markering under datautlägget,
       så att databitarna hoppar över dem – de skrivs av placeFormat efteråt */
    const g = base.map(row => row.slice());
    placeData(g, codewords, mask);
    placeFormat(g, mask);
    const s = penalty(g);
    if (s < bestScore) { bestScore = s; best = g; }
  }
  return best.map(row => row.map(v => v === 1));
}

/* Returnerar QR-koden som fristående SVG. Skalbar, så den blir skarp
   i utskrift oavsett storlek. */
export function qrSvg(text, opts){
  const o = opts || {};
  const quiet = o.quiet == null ? 4 : o.quiet;     /* tyst zon, minst 4 enligt standarden */
  const dark = o.dark || "#000000";
  const light = o.light || "#ffffff";
  const m = qrMatrix(text);
  const n = m.length, total = n + quiet * 2;
  let path = "";
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!m[r][c]) { c++; continue; }
      let len = 0;
      while (c + len < n && m[r][c + len]) len++;
      path += "M" + (c + quiet) + " " + (r + quiet) + "h" + len + "v1h-" + len + "z";
      c += len;
    }
  }
  const size = o.size ? ' width="' + o.size + '" height="' + o.size + '"' : "";
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '"'
    + size + ' shape-rendering="crispEdges" role="img" aria-label="QR-kod">'
    + '<rect width="' + total + '" height="' + total + '" fill="' + light + '"/>'
    + '<path d="' + path + '" fill="' + dark + '"/></svg>';
}
