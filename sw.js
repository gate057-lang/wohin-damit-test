/* Wohin damit? – Service Worker
   Programmdateien kommen bevorzugt frisch aus dem Netz, ohne Netz aus dem
   Zwischenspeicher. Lexikon und Grundregeln sind so auch offline verfügbar.
   API-Aufrufe fasst der Service Worker nie an. */
const VERSION = 'wohin-test-80ef6e7';
const HUELLE = [
  './', './index.html', './app.css', './app.js', './manifest.webmanifest',
  './js/regeln.js', './js/ort-logik.js', './js/plattform.js', './js/oeffnungszeiten.js',
  './daten/fraktionen.json', './daten/lexikon.json',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
  './impressum.html', './datenschutz.html', './kontakt.html', './rechtstexte.css',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(HUELLE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((antwort) => {
        if (antwort.ok) {
          const kopie = antwort.clone();
          caches.open(VERSION).then((c) => c.put(e.request, kopie));
        }
        return antwort;
      })
      .catch(() => caches.match(e.request).then((t) => t || caches.match('./index.html')))
  );
});
