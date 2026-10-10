/* =====================================================================
   Wohin damit? – Plattform-Schicht
   Kapselt alles, was sich zwischen Browser/PWA und nativer App (Capacitor,
   iOS/Android) unterscheidet: Schnittstellenadresse, Standort, Foto,
   Speicher. Die übrige App spricht nur mit window.Plattform.
   ===================================================================== */
(function () {
  'use strict';

  // In der nativen App ist die Seite lokal (capacitor://, https://localhost) –
  // die Schnittstelle liegt dann fest auf dem Server.
  const SERVER = 'https://wohin.velasync.de';
  const cap = window.Capacitor;
  const nativ = Boolean(cap && cap.isNativePlatform && cap.isNativePlatform());
  // Testversion auf GitHub Pages spricht ebenfalls den festen Server an
  const fremd = nativ || /\.github\.io$/.test(location.hostname);
  const API = fremd ? SERVER + '/api' : new URL('api', location.href).pathname.replace(/\/$/, '');
  let ohneServer = false; // wird gesetzt, sobald der Server einmal nicht erreichbar war

  /* ---------- Ersatzweg ohne eigenen Server (Testversion, Server noch nicht online) ----------
     Standort, Ortssuche und Wertstoffhöfe kommen dann direkt von OpenStreetMap,
     es gelten die bundesweiten Grundregeln. Foto-Erkennung braucht den Server. */
  async function nominatim(pfad) {
    const r = await fetch('https://nominatim.openstreetmap.org' + pfad + '&accept-language=de');
    if (!r.ok) throw new Error('Ortsdienst nicht erreichbar.');
    return r.json();
  }
  const ERSATZ = {
    async ort(q) {
      const d = await nominatim(`/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${q.get('lat')}&lon=${q.get('lon')}`);
      if (!d || !d.address) throw new Error('Ort nicht gefunden.');
      const o = Ortlogik.ausAdresse(d.address, q.get('lat'), q.get('lon'));
      if (o.ausserhalb) throw new Error('Wohin damit? funktioniert bisher nur in Deutschland.');
      return { ort: o, profil: Ortlogik.grundprofil(o) };
    },
    async 'ort/suche'(q) {
      const liste = await nominatim(`/search?format=jsonv2&addressdetails=1&countrycodes=de&limit=6&q=${encodeURIComponent(q.get('q') || '')}`);
      return { treffer: liste.filter((d) => d.address).map((d) => ({ name: d.display_name, ...Ortlogik.ausAdresse(d.address, d.lat, d.lon) })).filter((o) => !o.ausserhalb) };
    },
    async hoefe(q) {
      const r = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(Ortlogik.overpassAbfrage(q.get('lat'), q.get('lon'))),
      });
      if (!r.ok) throw new Error('Kartendienst nicht erreichbar.');
      return { hoefe: Ortlogik.hoefeAusOverpass(await r.json()) };
    },
  };
  async function ersatz(pfad) {
    const [weg, suche] = pfad.slice(1).split('?');
    const q = new URLSearchParams(suche || '');
    if (ERSATZ[weg]) return ERSATZ[weg](q);
    const f = new Error(weg === 'erkennen'
      ? 'Die Foto-Erkennung ist in dieser Testversion noch nicht aktiv. Nutze bitte die Suche.'
      : 'Diese Funktion braucht den Server, der noch nicht online ist.');
    f.status = 503;
    f.ohneServer = true;
    throw f;
  }

  async function api(pfad, optionen = {}) {
    const init = { method: optionen.methode || 'GET', headers: {} };
    if (optionen.daten !== undefined) {
      init.method = optionen.methode || 'POST';
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(optionen.daten);
    }
    if (ohneServer) return ersatz(pfad);
    let antwort;
    try {
      antwort = await fetch(API + pfad, init);
    } catch {
      if (!navigator.onLine) {
        const f = new Error('Keine Verbindung. Bitte Internet prüfen.');
        f.offline = true;
        throw f;
      }
      ohneServer = true; // Server nicht erreichbar → ab jetzt Ersatzweg
      return ersatz(pfad);
    }
    const daten = await antwort.json().catch(() => ({}));
    if (!antwort.ok) {
      const f = new Error(daten.fehler || 'Anfrage fehlgeschlagen (' + antwort.status + ')');
      f.status = antwort.status;
      throw f;
    }
    return daten;
  }

  /** Aktueller Standort. Nativ über das Geolocation-Plugin, sonst Browser. */
  async function standort() {
    const plugin = nativ && cap.Plugins && cap.Plugins.Geolocation;
    if (plugin) {
      const p = await plugin.getCurrentPosition({ enableHighAccuracy: false, timeout: 15000 });
      return { lat: p.coords.latitude, lon: p.coords.longitude };
    }
    if (!navigator.geolocation) throw new Error('Dein Gerät gibt keinen Standort frei.');
    return new Promise((ok, nein) => {
      navigator.geolocation.getCurrentPosition(
        (p) => ok({ lat: p.coords.latitude, lon: p.coords.longitude }),
        (f) => nein(new Error(f.code === 1
          ? 'Standort nicht freigegeben. Du kannst deinen Ort auch unter „Region“ eingeben.'
          : 'Standort konnte nicht bestimmt werden.')),
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 }
      );
    });
  }

  /** Foto verkleinern (längste Kante max. 1024 px) und als JPEG-data-URL liefern. */
  function bildVerkleinern(datei, kante = 1024, qualitaet = 0.82) {
    return new Promise((ok, nein) => {
      const url = URL.createObjectURL(datei);
      const img = new Image();
      img.onload = () => {
        const f = Math.min(1, kante / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * f);
        c.height = Math.round(img.naturalHeight * f);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        ok(c.toDataURL('image/jpeg', qualitaet));
      };
      img.onerror = () => { URL.revokeObjectURL(url); nein(new Error('Das Bild konnte nicht gelesen werden.')); };
      img.src = url;
    });
  }

  /** Kleiner Speicher, der in privaten Fenstern nicht abstürzt. */
  const speicher = {
    lesen(k, ersatz = null) {
      try { const v = localStorage.getItem('wd_' + k); return v ? JSON.parse(v) : ersatz; } catch { return ersatz; }
    },
    schreiben(k, v) {
      try { localStorage.setItem('wd_' + k, JSON.stringify(v)); } catch { /* egal */ }
    },
  };

  /** Externen Link öffnen – nativ im System-Browser. */
  function oeffne(url) {
    const browser = nativ && cap.Plugins && cap.Plugins.Browser;
    if (browser) browser.open({ url });
    else window.open(url, '_blank', 'noopener');
  }

  /* ---------- Erinnerungen am Vorabend ----------
     Nativ: lokale Benachrichtigungen auf dem Gerät (kein Server nötig).
     Browser/PWA: Web-Push über den Server (iPhone nur als installierte App). */
  function b64zuBytes(b64) {
    const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  }
  const lokal = () => nativ && cap.Plugins && cap.Plugins.LocalNotifications;

  const erinnerung = {
    /** Ist eine Erinnerung auf diesem Gerät überhaupt möglich? → { ok, grund } */
    moeglich() {
      if (lokal()) return { ok: true };
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
        const installiert = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
        return { ok: false, grund: ios && !installiert
          ? 'Auf dem iPhone gehen Erinnerungen, wenn du die App über Teilen → „Zum Home-Bildschirm“ installierst.'
          : 'Dieser Browser unterstützt keine Erinnerungen.' };
      }
      return { ok: true };
    },

    async einrichten({ termine, uhrzeit, auswahl, namen }) {
      const n = lokal();
      if (n) {
        const recht = await n.requestPermissions();
        if (recht.display !== 'granted') throw new Error('Benachrichtigungen sind nicht erlaubt.');
        const alt = await n.getPending();
        if (alt.notifications.length) await n.cancel({ notifications: alt.notifications.map((x) => ({ id: x.id })) });
        const [h, m] = uhrzeit.split(':').map(Number);
        const proTag = {};
        for (const t of termine) if (!auswahl || auswahl.includes(t.fraktion)) (proTag[t.datum] = proTag[t.datum] || new Set()).add(namen[t.fraktion] || t.bezeichnung);
        const liste = Object.entries(proTag).map(([datum, was]) => {
          const at = new Date(datum + 'T00:00:00');
          at.setDate(at.getDate() - 1);
          at.setHours(h, m, 0, 0);
          return { at, was: [...was] };
        }).filter((x) => x.at > new Date()).slice(0, 60);
        await n.schedule({ notifications: liste.map((x, i) => ({
          id: 1000 + i, title: 'Morgen ist Abholung', body: x.was.join(', ') + ' – heute Abend rausstellen.',
          schedule: { at: x.at, allowWhileIdle: true },
        })) });
        return { art: 'lokal', anzahl: liste.length };
      }
      const reg = await navigator.serviceWorker.ready;
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('Benachrichtigungen sind nicht erlaubt.');
      const { schluessel } = await api('/push/schluessel');
      let abo = await reg.pushManager.getSubscription();
      if (!abo) abo = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64zuBytes(schluessel) });
      await api('/push/abo', { daten: { abo: abo.toJSON(), termine, uhrzeit, auswahl, namen } });
      return { art: 'push' };
    },

    async beenden() {
      const n = lokal();
      if (n) {
        const alt = await n.getPending();
        if (alt.notifications.length) await n.cancel({ notifications: alt.notifications.map((x) => ({ id: x.id })) });
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration();
      const abo = reg && await reg.pushManager.getSubscription();
      if (abo) {
        await api('/push/ende', { daten: { endpoint: abo.endpoint } }).catch(() => {});
        await abo.unsubscribe();
      }
    },

    async test() {
      const n = lokal();
      if (n) {
        await n.schedule({ notifications: [{ id: 999, title: 'Wohin damit?', body: 'So sieht deine Erinnerung am Vorabend aus.', schedule: { at: new Date(Date.now() + 3000) } }] });
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const abo = await reg.pushManager.getSubscription();
      if (!abo) throw new Error('Erinnerung zuerst einschalten.');
      await api('/push/test', { daten: { abo: abo.toJSON() } });
    },
  };

  /** Datei speichern (Kalender-Export). */
  function speichereDatei(name, text, typ) {
    const url = URL.createObjectURL(new Blob([text], { type: typ }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  window.Plattform = { erinnerung, speichereDatei, nativ, API, api, standort, bildVerkleinern, speicher, oeffne, get ohneServer() { return ohneServer; } };
})();
