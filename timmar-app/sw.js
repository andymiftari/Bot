/* Timmar – service worker.
   Appens egna filer hämtas alltid från nätet först, så att en ny version
   slår igenom direkt när du lagt upp den. Cachen används som reserv när
   telefonen är utan täckning. Tidrapporterna själva cachas av Firestore. */

const VERSION = "ellingesmide-2026-10-19-i";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "qr.js",
  "offertpdf.js",
  "ocr.js",
  "firebase-config.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png",
  "logo.svg",
  "logo-icon.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", event => {
  if (event.data === "skipWaiting") self.skipWaiting();
});

function networkFirst(req, cacheKey){
  return fetch(req)
    .then(res => {
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(cacheKey || req, copy));
      }
      return res;
    })
    .catch(() => caches.match(cacheKey || req).then(r => r || caches.match("index.html")));
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Firebase och egen synkserver går alltid direkt till nätet.
  if (/googleapis\.com|firebaseio\.com|firebaseapp\.com/.test(url.hostname)) return;
  if (/sync\.php/.test(url.pathname)) return;

  // Sidladdning och appens egna filer: nät först, cache som reserv.
  if (req.mode === "navigate") { event.respondWith(networkFirst(req, "index.html")); return; }
  if (url.origin === self.location.origin && /\.(js|css|webmanifest|html)$/.test(url.pathname)) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Ikoner, typsnitt och bibliotek ändras sällan: cache först.
  if (url.origin === self.location.origin ||
      /gstatic\.com|fonts\.googleapis\.com|cdnjs\.cloudflare\.com/.test(url.hostname)) {
    event.respondWith(
      caches.match(req).then(hit => {
        const live = fetch(req).then(res => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(VERSION).then(c => c.put(req, copy));
          }
          return res;
        }).catch(() => hit);
        return hit || live;
      })
    );
  }
});
