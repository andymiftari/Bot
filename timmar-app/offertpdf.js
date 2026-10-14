/* Offert som PDF – egen liten PDF-skrivare, inga externa bibliotek.
   Typsnitt: Helvetica och Helvetica-Bold (finns i alla PDF-läsare) med
   WinAnsi-kodning, så å, ä, ö och € fungerar. Bredderna nedan kommer från
   Adobes typsnittsmått (AFM) och behövs för radbrytning och högerjustering. */
const PDFW={c:" !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ §©®°±²³·ÄÅÆÉÖ×ØÜßàáäåæçèéêíñóöøúü–—‘’“”•…€",n:[278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,278,556,737,737,400,584,333,333,278,667,667,1000,667,778,584,778,722,611,556,556,556,556,889,500,556,556,556,278,556,556,556,611,556,556,556,1000,222,222,333,333,350,1000,556],b:[278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,278,556,737,737,400,584,333,333,278,722,722,1000,667,778,584,778,722,611,556,556,556,556,889,556,556,556,556,278,611,611,611,611,611,611,556,1000,278,278,500,500,350,1000,556]};
/* Ellinge-logotypen (logo.svg) omräknad till PDF-ritkommandon. */
const LOGO_PDF={w:315,h:53.567032,ops:"0 0 0 rg 103.52 24.49 m 103.52 27.69 l 98.09 27.69 l 98.09 20.43 l 105.07 20.43 l 105.07 16.3 l 98.09 16.3 l 98.09 10.08 l 103.45 10.08 l 103.45 12.84 l 108.12 12.84 l 108.12 6.3 l 89.18 6.3 l 89.18 10.08 l 91.62 10.08 l 91.62 27.69 l 89.18 27.69 l 89.18 31.46 l 108.19 31.46 l 108.19 24.49 l h 103.52 24.49 m f 0 0 0 rg 136.78 23.45 m 136.78 27.69 l 131.43 27.69 l 131.43 10.08 l 134.12 10.08 l 134.12 6.3 l 122.51 6.3 l 122.51 10.08 l 124.96 10.08 l 124.96 27.69 l 122.51 27.69 l 122.51 31.46 l 141.45 31.46 l 141.45 23.45 l h 136.78 23.45 m f 0 0 0 rg 169.29 23.45 m 169.29 27.69 l 163.94 27.69 l 163.94 10.08 l 166.63 10.08 l 166.63 6.3 l 155.02 6.3 l 155.02 10.08 l 157.46 10.08 l 157.46 27.69 l 155.02 27.69 l 155.02 31.46 l 173.96 31.46 l 173.96 23.45 l h 169.29 23.45 m f 0 0 0 rg 198.89 10.08 m 198.89 6.3 l 187.53 6.3 l 187.53 10.08 l 189.98 10.08 l 189.98 27.69 l 187.53 27.69 l 187.53 31.46 l 198.89 31.46 l 198.89 27.69 l 196.44 27.69 l 196.44 10.08 l h 198.89 10.08 m f 0 0 0 rg 240.99 6.3 m 231.07 6.3 l 231.07 10.08 l 233.52 10.08 l 233.52 23.09 l 222.27 6.3 l 212.85 6.3 l 212.85 10.08 l 215.29 10.08 l 215.29 27.69 l 212.85 27.69 l 212.85 31.46 l 222.77 31.46 l 222.77 27.69 l 220.33 27.69 l 220.33 14.61 l 231.47 31.46 l 238.55 31.46 l 238.55 10.08 l 240.99 10.08 l h 240.99 6.3 m f 0 0 0 rg 269.77 17.7 m 269.77 21.94 l 274.36 21.94 l 274 25.21 271.56 27.26 268.36 27.26 c 264.62 27.26 262.29 23.55 262.29 18.53 c 262.29 13.64 265.12 10.55 268.87 10.55 c 271.67 10.55 273.75 11.95 274.76 14.25 c 279.14 14.25 l 279.14 6.3 l 274.47 6.3 l 274.47 8.61 l 272.75 6.74 270.27 5.73 267.32 5.73 c 260.64 5.73 255.17 11.3 255.17 18.74 c 255.17 26.11 259.8 32 266.99 32 c 270.27 32 273 30.6 274.79 28.23 c 274.79 31.46 l 279.94 31.46 l 279.94 17.7 l h 269.77 17.7 m f q 294 6 m 313.73 6 l 313.73 32 l 294 32 l h 294 6 m W n 0 0 0 rg 309.06 24.49 m 309.06 27.69 l 303.64 27.69 l 303.64 20.43 l 310.61 20.43 l 310.61 16.3 l 303.64 16.3 l 303.64 10.08 l 309 10.08 l 309 12.84 l 313.66 12.84 l 313.66 6.3 l 294.72 6.3 l 294.72 10.08 l 297.17 10.08 l 297.17 27.69 l 294.72 27.69 l 294.72 31.46 l 313.74 31.46 l 313.74 24.49 l h 309.06 24.49 m f Q 0 0 0 rg 92.11 39.18 m 92.11 38.59 92.57 38.18 93.18 38.18 c 94.14 38.18 94.84 38.84 95.09 39.79 c 96.9 39.79 l 96.9 36.57 l 94.93 36.57 l 94.93 37.36 l 94.38 36.74 93.57 36.36 92.63 36.36 c 90.71 36.36 89.34 37.68 89.34 39.38 c 89.34 43.14 94.6 42.47 94.6 44.36 c 94.6 45.03 94.07 45.52 93.28 45.52 c 92.14 45.52 91.33 44.75 91.02 43.7 c 89.18 43.7 l 89.18 47.18 l 91.14 47.18 l 91.14 46.29 l 91.74 46.97 92.66 47.39 93.75 47.39 c 95.93 47.39 97.37 45.97 97.37 44.07 c 97.37 40.26 92.11 40.95 92.11 39.18 c h 92.11 39.18 m f 0 0 0 rg 117.48 38.17 m 117.48 36.57 l 112.83 36.57 l 110.39 42.5 l 107.96 36.57 l 103.23 36.57 l 103.23 38.17 l 104.26 38.17 l 104.26 45.59 l 103.23 45.59 l 103.23 47.18 l 107.33 47.18 l 107.33 45.59 l 106.35 45.59 l 106.35 39.21 l 109.15 46.06 l 110.98 46.06 l 113.81 39.21 l 113.81 45.59 l 112.83 45.59 l 112.83 47.18 l 117.48 47.18 l 117.48 45.59 l 116.45 45.59 l 116.45 38.17 l h 117.48 38.17 m f 0 0 0 rg 128.12 38.17 m 128.12 36.57 l 123.34 36.57 l 123.34 38.17 l 124.37 38.17 l 124.37 45.59 l 123.34 45.59 l 123.34 47.18 l 128.12 47.18 l 128.12 45.59 l 127.09 45.59 l 127.09 38.17 l h 128.12 38.17 m f 0 0 0 rg 138.84 36.57 m 134.01 36.57 l 134.01 38.17 l 135.04 38.17 l 135.04 45.59 l 134.01 45.59 l 134.01 47.18 l 139.11 47.18 l 142.49 47.18 144.61 45.12 144.61 41.83 c 144.61 38.54 142.22 36.57 138.84 36.57 c h 138.75 45.52 m 137.77 45.52 l 137.77 38.24 l 138.64 38.24 l 140.37 38.24 141.61 39.5 141.61 41.82 c 141.61 44.2 140.48 45.52 138.75 45.52 c h 138.75 45.52 m f 0 0 0 rg 156.6 44.24 m 156.6 45.59 l 154.32 45.59 l 154.32 42.53 l 157.25 42.53 l 157.25 40.79 l 154.32 40.79 l 154.32 38.17 l 156.57 38.17 l 156.57 39.34 l 158.54 39.34 l 158.54 36.57 l 150.55 36.57 l 150.55 38.17 l 151.59 38.17 l 151.59 45.59 l 150.55 45.59 l 150.55 47.18 l 158.57 47.18 l 158.57 44.24 l h 156.6 44.24 m f 0 0 0 rg 167.61 39.18 m 167.61 38.59 168.06 38.18 168.67 38.18 c 169.64 38.18 170.34 38.84 170.57 39.79 c 172.39 39.79 l 172.39 36.57 l 170.42 36.57 l 170.42 37.36 l 169.86 36.74 169.06 36.36 168.12 36.36 c 166.2 36.36 164.84 37.68 164.84 39.38 c 164.84 43.14 170.09 42.47 170.09 44.36 c 170.09 45.03 169.56 45.52 168.77 45.52 c 167.64 45.52 166.82 44.75 166.51 43.7 c 164.67 43.7 l 164.67 47.18 l 166.64 47.18 l 166.64 46.29 l 167.23 46.97 168.15 47.39 169.24 47.39 c 171.42 47.39 172.86 45.97 172.86 44.07 c 172.86 40.26 167.61 40.95 167.61 39.18 c h 167.61 39.18 m f 0 0 0 rg 181.73 39.18 m 181.73 38.59 182.19 38.18 182.79 38.18 c 183.76 38.18 184.46 38.84 184.7 39.79 c 186.52 39.79 l 186.52 36.57 l 184.55 36.57 l 184.55 37.36 l 183.99 36.74 183.19 36.36 182.25 36.36 c 180.32 36.36 178.96 37.68 178.96 39.38 c 178.96 43.14 184.21 42.47 184.21 44.36 c 184.21 45.03 183.69 45.52 182.9 45.52 c 181.76 45.52 180.95 44.75 180.64 43.7 c 178.79 43.7 l 178.79 47.18 l 180.76 47.18 l 180.76 46.29 l 181.35 46.97 182.28 47.39 183.36 47.39 c 185.55 47.39 186.99 45.97 186.99 44.07 c 186.99 40.26 181.73 40.95 181.73 39.18 c h 181.73 39.18 m f 0 0 0 rg 198.88 44.24 m 198.88 45.59 l 196.6 45.59 l 196.6 42.53 l 199.54 42.53 l 199.54 40.79 l 196.6 40.79 l 196.6 38.17 l 198.86 38.17 l 198.86 39.34 l 200.82 39.34 l 200.82 36.57 l 192.84 36.57 l 192.84 38.17 l 193.87 38.17 l 193.87 45.59 l 192.84 45.59 l 192.84 47.18 l 200.86 47.18 l 200.86 44.24 l h 198.88 44.24 m f 0 0 0 rg 215.96 45.59 m 213.95 42.32 l 215.12 41.88 216.03 40.83 216.03 39.57 c 216.03 37.76 214.31 36.57 212.18 36.57 c 206.88 36.57 l 206.88 38.17 l 207.91 38.17 l 207.91 45.59 l 206.88 45.59 l 206.88 47.18 l 211.55 47.18 l 211.55 45.59 l 210.63 45.59 l 210.63 42.83 l 211.41 42.83 l 213.8 47.18 l 217.09 47.18 l 217.09 45.59 l h 211.39 41.36 m 210.63 41.36 l 210.63 38.09 l 211.48 38.09 l 212.4 38.09 213.12 38.68 213.12 39.68 c 213.12 40.76 212.38 41.36 211.39 41.36 c h 211.39 41.36 m f 0 0 0 rg 232.95 36.57 m 228.27 36.57 l 228.27 38.17 l 229.47 38.17 l 227.38 44.82 l 225.27 38.17 l 226.47 38.17 l 226.47 36.57 l 221.29 36.57 l 221.29 38.17 l 222.32 38.17 l 225.61 47.2 l 228.67 47.2 l 231.92 38.17 l 232.95 38.17 l h 232.95 36.57 m f 0 0 0 rg 243.14 38.17 m 243.14 36.57 l 238.36 36.57 l 238.36 38.17 l 239.39 38.17 l 239.39 45.59 l 238.36 45.59 l 238.36 47.18 l 243.14 47.18 l 243.14 45.59 l 242.11 45.59 l 242.11 38.17 l h 243.14 38.17 m f 0 0 0 rg 257.13 43.53 m 256.64 44.57 255.78 45.32 254.59 45.32 c 253.13 45.32 252.11 43.82 252.11 41.74 c 252.11 39.74 253.22 38.39 254.74 38.39 c 255.84 38.39 256.71 39.17 256.99 40.27 c 258.81 40.27 l 258.81 36.57 l 256.84 36.57 l 256.84 37.52 l 256.22 36.77 255.3 36.34 254.18 36.34 c 251.34 36.34 249.11 38.77 249.11 41.79 c 249.11 45.03 251.1 47.41 254.46 47.41 c 256.51 47.41 258.16 46.48 259.05 44.82 c h 257.13 43.53 m f 0 0 0 rg 270.85 44.24 m 270.85 45.59 l 268.56 45.59 l 268.56 42.53 l 271.5 42.53 l 271.5 40.79 l 268.56 40.79 l 268.56 38.17 l 270.81 38.17 l 270.81 39.34 l 272.78 39.34 l 272.78 36.57 l 264.8 36.57 l 264.8 38.17 l 265.83 38.17 l 265.83 45.59 l 264.8 45.59 l 264.8 47.18 l 272.81 47.18 l 272.81 44.24 l h 270.85 44.24 m f 0 0 0 rg 298.07 45.59 m 294.73 36.57 l 291.61 36.57 l 288.23 45.59 l 287.27 45.59 l 287.27 47.18 l 291.59 47.18 l 291.59 45.59 l 290.52 45.59 l 290.98 44.15 l 294.72 44.15 l 295.17 45.59 l 294.11 45.59 l 294.11 47.18 l 299.07 47.18 l 299.07 45.59 l h 291.59 42.24 m 292.86 38.57 l 294.11 42.24 l h 291.59 42.24 m f q 304 36 m 313.73 36 l 313.73 48 l 304 48 l h 304 36 m W n 0 0 0 rg 311.4 41.52 m 312.48 41.2 313.33 40.34 313.33 39.24 c 313.33 37.59 311.8 36.57 309.82 36.57 c 304.45 36.57 l 304.45 38.17 l 305.48 38.17 l 305.48 45.59 l 304.45 45.59 l 304.45 47.18 l 309.95 47.18 l 312.09 47.18 313.74 46.04 313.74 44.06 c 313.74 42.77 312.71 41.79 311.4 41.52 c h 308.21 38.09 m 308.94 38.09 l 309.89 38.09 310.51 38.57 310.51 39.41 c 310.51 40.38 309.91 40.92 308.96 40.92 c 308.21 40.92 l h 309.04 45.66 m 308.21 45.66 l 308.21 42.44 l 309 42.44 l 310.07 42.44 310.83 43 310.83 44.02 c 310.83 45.06 310.12 45.66 309.04 45.66 c h 309.04 45.66 m f Q q 1.26 0 m 74 0 l 74 53.14 l 1.26 53.14 l h 1.26 0 m W n 0 0 0 rg 73.97 3.88 m 73.89 11.08 l 63.79 11.07 l 63.6 31.95 l 73.62 32.51 l 73.54 39.58 l 39.12 53.14 l 1.8 48.66 l 1.69 39.28 l 13.23 37.05 l 13.04 10.77 l 1.37 10.77 l 1.26 1.16 l 39.17 0 l h 39.16 10.23 m 39.16 9.82 l 65.86 10.04 l 72.86 10.04 l 72.92 4.8 l 39.17 1.04 l h 39.15 10.77 m 25.6 10.77 l 25.71 41.45 l 62.56 32.2 l 62.75 10.97 l 39.15 10.78 l h 72.51 38.88 m 72.58 33.57 l 39.13 43.41 l 39.12 52.02 l h 72.51 38.88 m f* Q"};
/* Tecken som inte finns i WinAnsi-kodningen men som webbläsaren gärna lägger in. */
const SUBST = {" ":" ", " ":" ", "−":"-", "‑":"-", "‐":"-", "\t":" "};
/* WinAnsi (cp1252) 0x80–0x9F. Allt i 0xA0–0xFF är samma som Latin-1. */
const CP = {"€":128,"‚":130,"„":132,"…":133,"‘":145,"’":146,"“":147,"”":148,"•":149,"–":150,"—":151,"™":153};
const WIDX = {}; for(let i=0;i<PDFW.c.length;i++) WIDX[PDFW.c[i]]=i;

function clean(s){ return String(s==null?"":s).replace(/[  −‑‐\t]/g, c=>SUBST[c]).replace(/\r/g,""); }
function enc(s){
  let out="";
  for(const ch of clean(s)){
    let c=ch.charCodeAt(0);
    if(CP[ch]) c=CP[ch];
    else if(c>255 || (c>=128 && c<160)) c=63;      /* "?" */
    const b=String.fromCharCode(c);
    out += (b==="(" || b===")" || b==="\\") ? "\\"+b : b;
  }
  return out;
}
export function textWidth(s, size, bold){
  const tbl=bold?PDFW.b:PDFW.n; let w=0;
  for(const ch of clean(s)){ const i=WIDX[ch]; w += (i===undefined ? 556 : tbl[i]); }
  return w*size/1000;
}
/* Radbryter en text så att den ryms i en viss bredd. Tomma rader behålls. */
export function wrap(s, size, maxW, bold){
  const lines=[];
  clean(s).split("\n").forEach(function(par){
    const words=par.split(/ +/); let cur="";
    if(!par.trim()){ lines.push(""); return; }
    words.forEach(function(w){
      const t=cur?cur+" "+w:w;
      if(textWidth(t,size,bold)<=maxW || !cur){
        /* Ett ord som ensamt är för långt delas upp. */
        if(!cur && textWidth(w,size,bold)>maxW){
          let part="";
          for(const ch of w){ if(textWidth(part+ch,size,bold)>maxW){ lines.push(part); part=ch; } else part+=ch; }
          cur=part;
        } else cur=t;
      } else { lines.push(cur); cur=w; }
    });
    lines.push(cur);
  });
  return lines;
}

const n2 = new Intl.NumberFormat("sv-SE",{minimumFractionDigits:2,maximumFractionDigits:2});
const n0 = new Intl.NumberFormat("sv-SE",{maximumFractionDigits:2});
export const money = v => n2.format(Math.round(((+v||0)+Number.EPSILON)*100)/100)+" kr";
const num = v => n0.format(+v||0);

const W=595.28, H=841.89, ML=50, MR=545.28;
const KINDS=[["arbete","Arbete"],["material","Material"],["resa","Resor"]];

/* Bygger offerten som en PDF-fil. o = offerten med uträknade belopp,
   f = firmans uppgifter. Kunden ser bara försäljningspriser – aldrig
   inköpspris eller påslag. */
export function offerPdf(o, f){
  f=f||{}; const cu=o.customer||{};
  const pages=[]; let cs="", y=0;
  const col=(g)=>cs+=g+" g\n";
  const txt=(x,yy,s,size,bold,gray)=>{
    cs+="BT /"+(bold?"F2":"F1")+" "+size+" Tf "+(gray==null?0:gray)+" g "+x.toFixed(2)+" "+yy.toFixed(2)+" Td ("+enc(s)+") Tj ET\n";
  };
  const rtxt=(xr,yy,s,size,bold,gray)=>txt(xr-textWidth(s,size,bold),yy,s,size,bold,gray);
  const line=(x1,y1,x2,y2,w,gray)=>{ cs+=(gray==null?0:gray)+" G "+(w||0.5)+" w "+x1.toFixed(2)+" "+y1.toFixed(2)+" m "+x2.toFixed(2)+" "+y2.toFixed(2)+" l S\n"; };

  function footer(){
    const fy=58; line(ML,fy+14,MR,fy+14,0.5,0.75);
    const c1=[f.name||"", f.address||"", [f.zip,f.city].filter(Boolean).join(" ")].filter(Boolean);
    const c2=[f.phone?"Telefon "+f.phone:"", f.email||"", f.web||""].filter(Boolean);
    const c3=[f.orgnr?"Org.nr "+f.orgnr:"", f.vatnr?"Momsreg.nr "+f.vatnr:"", f.bankgiro?"Bankgiro "+f.bankgiro:"", f.fskatt?"Godkänd för F-skatt":""].filter(Boolean);
    [[c1,ML],[c2,ML+175],[c3,ML+340]].forEach(function(c){
      c[0].forEach(function(s,i){ txt(c[1], fy-i*10, s, 7.5, i===0&&c[1]===ML, 0.35); });
    });
  }
  function header(first){
    if(first){
      const lw=150, s=lw/LOGO_PDF.w, top=H-48;
      cs+="q "+s.toFixed(5)+" 0 0 "+(-s).toFixed(5)+" "+ML+" "+top+" cm\n"+LOGO_PDF.ops+"\nQ\n";
      rtxt(MR,H-66,"OFFERT",22,true);
      const meta=[["Offertnummer",o.nr||""],["Datum",o.date||""],["Giltig till och med",o.validTo||""]];
      meta.forEach(function(m,i){
        rtxt(MR-92,H-88-i*13,m[0],8.5,false,0.4);
        rtxt(MR,H-88-i*13,m[1],8.5,true);
      });
      y=H-150;
    } else {
      txt(ML,H-50,(f.name||"")+" · Offert "+(o.nr||""),8.5,true,0.35);
      line(ML,H-58,MR,H-58,0.5,0.75);
      y=H-80;
    }
  }
  function newPage(first){
    if(cs) { pages.push(cs); }
    cs=""; header(first); 
  }
  const BOTTOM=100;
  function need(h, inTable){
    if(y-h>=BOTTOM) return;
    newPage(false);
    if(inTable) tableHead();
  }

  newPage(true);

  /* Kund och avsändare */
  const cuLines=[cu.name, cu.contact&&cu.contact!==cu.name?"Att: "+cu.contact:"", ...(String(cu.address||"").split("\n")), cu.email, cu.phone].filter(s=>s&&String(s).trim());
  const frLines=[f.name, f.address, [f.zip,f.city].filter(Boolean).join(" "), f.phone, f.email].filter(s=>s&&String(s).trim());
  txt(ML,y,"KUND",7.5,true,0.45); txt(ML+260,y,"FRÅN",7.5,true,0.45);
  let yy=y-14;
  cuLines.forEach(function(s,i){ txt(ML,yy-i*12.5,s,i===0?10.5:9.5,i===0); });
  frLines.forEach(function(s,i){ txt(ML+260,yy-i*12.5,s,i===0?10.5:9.5,i===0); });
  if(o.ref){ txt(ML+260,yy-frLines.length*12.5-4,"Vår referens: "+o.ref,9,false,0.35); }
  y=yy-Math.max(cuLines.length, frLines.length+(o.ref?1:0))*12.5-22;

  /* Rubrik och beskrivning */
  if(o.title){
    wrap(o.title,14,MR-ML,true).forEach(function(s){ need(18); txt(ML,y,s,14,true); y-=18; });
    y-=2;
  }
  if(o.intro){
    wrap(o.intro,10,MR-ML).forEach(function(s){ need(14); if(s) txt(ML,y,s,10,false,0.1); y-=14; });
    y-=6;
  }

  /* Tabell */
  const C={desc:ML, qty:390, unit:398, price:478, amt:MR};
  const DW=C.qty-ML-48;
  function tableHead(){
    txt(C.desc,y,"BESKRIVNING",7.5,true,0.45);
    rtxt(C.qty,y,"ANTAL",7.5,true,0.45);
    txt(C.unit,y,"ENHET",7.5,true,0.45);
    rtxt(C.price,y,"À-PRIS",7.5,true,0.45);
    rtxt(C.amt,y,"BELOPP",7.5,true,0.45);
    y-=6; line(ML,y,MR,y,0.8,0); y-=14;
  }
  need(60); y-=4; tableHead();
  KINDS.forEach(function(k){
    const rows=(o.rows||[]).filter(r=>r.kind===k[0] && (r.desc||r.amount));
    if(!rows.length) return;
    need(34,true);
    txt(C.desc,y,k[1],9.5,true); y-=14;
    rows.forEach(function(r){
      const dl=wrap(r.desc||"",9.5,DW);
      need(dl.length*12.5+4,true);
      dl.forEach(function(s,i){ txt(C.desc+8,y-i*12.5,s,9.5); });
      rtxt(C.qty,y,num(r.qty),9.5); txt(C.unit,y,r.unit||"",9.5,false,0.3);
      rtxt(C.price,y,money(r.unitPrice),9.5); rtxt(C.amt,y,money(r.amount),9.5);
      y-=dl.length*12.5+4;
    });
    const sub=rows.reduce((a,r)=>a+(+r.amount||0),0);
    line(C.price-60,y+8,MR,y+8,0.4,0.7);
    rtxt(C.price,y-3,"Summa "+k[1].toLowerCase(),8.5,false,0.35); rtxt(C.amt,y-3,money(sub),8.5,true);
    y-=22;
  });

  /* Summor */
  need(70);
  line(ML,y+6,MR,y+6,0.8,0);
  y-=10;
  const s=o.sums||{};
  [["Summa exkl. moms",money(s.net)],["Moms "+num(s.vatRate||25)+" %",money(s.vat)]].forEach(function(r){
    rtxt(C.price,y,r[0],10,false,0.2); rtxt(C.amt,y,r[1],10); y-=15;
  });
  line(C.price-90,y+9,MR,y+9,0.5,0.5);
  y-=6;
  const gw=textWidth(money(s.gross),12,true);
  rtxt(Math.min(C.price, C.amt-gw-18),y,"Att betala inkl. moms",12,true); rtxt(C.amt,y,money(s.gross),12,true);
  y-=34;

  /* Villkor */
  const terms=[];
  if(o.validTo) terms.push("Offerten gäller till och med "+o.validTo+".");
  if(f.payTerms) terms.push("Betalningsvillkor: "+f.payTerms+".");
  if(o.terms) terms.push(o.terms);
  if(terms.length){
    need(40);
    txt(ML,y,"VILLKOR",7.5,true,0.45); y-=14;
    wrap(terms.join("\n"),9,MR-ML).forEach(function(l){ need(12); if(l) txt(ML,y,l,9,false,0.15); y-=12; });
  }
  pages.push(cs);

  /* Sidfot och sidnummer på alla sidor */
  const total=pages.length;
  for(let i=0;i<total;i++){
    cs=""; footer();
    if(total>1) rtxt(MR,30,"Sida "+(i+1)+" av "+total,7.5,false,0.45);
    pages[i]+=cs;
  }

  /* Själva PDF-filen */
  const objs=[];
  const add=s=>{ objs.push(s); return objs.length; };
  const catalog=add(""), pagesId=add("");
  const f1=add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2=add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids=[];
  pages.forEach(function(c){
    const cid=add("<< /Length "+c.length+" >>\nstream\n"+c+"\nendstream");
    kids.push(add("<< /Type /Page /Parent "+pagesId+" 0 R /MediaBox [0 0 "+W+" "+H+"] /Resources << /Font << /F1 "+f1+" 0 R /F2 "+f2+" 0 R >> >> /Contents "+cid+" 0 R >>"));
  });
  objs[catalog-1]="<< /Type /Catalog /Pages "+pagesId+" 0 R >>";
  objs[pagesId-1]="<< /Type /Pages /Kids ["+kids.map(k=>k+" 0 R").join(" ")+"] /Count "+kids.length+" >>";
  const info=add("<< /Title ("+enc("Offert "+(o.nr||"")+(o.title?" – "+o.title:""))+") /Author ("+enc(f.name||"")+") /Producer (Ellingesmide) >>");
  let out="%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"; const offs=[];
  objs.forEach(function(b,i){ offs.push(out.length); out+=(i+1)+" 0 obj\n"+b+"\nendobj\n"; });
  const xref=out.length;
  out+="xref\n0 "+(objs.length+1)+"\n0000000000 65535 f \n"+offs.map(n=>String(n).padStart(10,"0")+" 00000 n \n").join("");
  out+="trailer\n<< /Size "+(objs.length+1)+" /Root "+catalog+" 0 R /Info "+info+" 0 R >>\nstartxref\n"+xref+"\n%%EOF\n";
  const bytes=new Uint8Array(out.length);
  for(let i=0;i<out.length;i++) bytes[i]=out.charCodeAt(i)&255;
  return bytes;
}
