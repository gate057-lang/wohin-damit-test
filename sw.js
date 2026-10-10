/* Wohin damit? – Service Worker
   Programmdateien kommen bevorzugt frisch aus dem Netz, ohne Netz aus dem
   Zwischenspeicher. Lexikon und Grundregeln sind so auch offline verfügbar.
   API-Aufrufe fasst der Service Worker nie an. */
const VERSION = 'wohin-test-3711a7f';
const HUELLE = [
  './', './index.html', './app.css', './app.js',
  './js/regeln.js', './js/ort-logik.js', './js/termine.js', './js/barcode.js', './js/plattform.js', './js/oeffnungszeiten.js',
  './daten/fraktionen.json', './daten/lexikon.json', './daten/ratgeber.json',
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
  // Symbole und Manifest nie über den Service Worker – das Betriebssystem soll sie direkt laden
  if (/\/icons\/|webmanifest$|apple-touch-icon|favicon/.test(url.pathname)) return;
  e.respondWith(
    fetch(e.request)
      .then((antwort) => {
        if (antwort.ok) {
          const kopie = antwort.clone();
          caches.open(VERSION).then((c) => c.put(e.request, kopie));
        }
        return antwort;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((t) => t || caches.match('./index.html')))
  );
});

// Erinnerung am Vorabend (Web-Push vom Server)
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { text: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.titel || 'Wohin damit?', {
    body: d.text || '',
    tag: d.tag || 'wohin',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: { url: './#termine' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((fenster) => {
    for (const f of fenster) if ('focus' in f) return f.focus();
    return self.clients.openWindow(e.notification.data && e.notification.data.url || './');
  }));
});
