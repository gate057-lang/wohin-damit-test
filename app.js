/* =====================================================================
   Wohin damit? – Anwendungslogik
   Läuft identisch als Webseite, installierte PWA und native App (Capacitor).
   ===================================================================== */
'use strict';

const P = window.Plattform;
const $ = (s, w = document) => w.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[z]));

const Z = {
  stamm: null,
  index: null,
  ort: P.speicher.lesen('ort'),
  profil: P.speicher.lesen('profil'),
  hoefe: null,
  ansicht: 'start',
  abfrageTimer: null,
};

const SCHNELL = ['Pizzakarton', 'Kassenbon', 'Akku', 'Tetrapak', 'Glühbirne', 'Styropor', 'Sofa', 'Medikamente'];

/* ------------------------------ Grundlagen ------------------------------ */

async function ladeDaten() {
  const [stamm, lexikon] = await Promise.all([
    fetch('daten/fraktionen.json?v=ee50fa4').then((r) => r.json()),
    fetch('daten/lexikon.json?v=ee50fa4').then((r) => r.json()),
  ]);
  Z.stamm = stamm;
  Z.index = Regeln.baueIndex(lexikon);
}

function zeige(ansicht) {
  Z.ansicht = ansicht;
  for (const s of document.querySelectorAll('.ansicht')) s.hidden = s.id !== 'ansicht-' + ansicht;
  for (const b of document.querySelectorAll('.leiste button')) {
    b.classList.toggle('aktiv', b.dataset.zu === ansicht || (ansicht === 'ergebnis' && b.dataset.zu === 'start'));
  }
  if (ansicht === 'orte') zeichneOrte();
  if (ansicht === 'region') zeichneRegion();
  window.scrollTo({ top: 0 });
}

function laden(text) {
  $('#laden').hidden = !text;
  if (text) $('#ladenText').textContent = text;
}

/* ------------------------------ Standort & Region ------------------------------ */

function zeichneKopf() {
  const o = Z.ort, p = Z.profil;
  $('#ortName').textContent = o ? (o.gemeinde || o.kreis) : 'Standort festlegen';
  $('#ortKreis').textContent = o ? (o.kreis !== o.gemeinde ? o.kreis : o.bundesland) : 'Tippen, um deinen Ort zu wählen';
  const st = $('#regionStatus');
  st.className = 'status';
  st.hidden = !p;
  if (!p) return;
  if (p.status === 'ermittelt') { st.textContent = 'Regeln deines Entsorgers'; st.classList.add('ok'); }
  else if (p.status === 'wird_ermittelt') { st.textContent = 'Regeln werden ermittelt'; st.classList.add('laeuft'); }
  else st.textContent = 'Allgemeine Regeln';

  const karte = $('#regionKarte');
  if (p.status === 'wird_ermittelt') {
    karte.hidden = false;
    karte.innerHTML = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      <p>Ich lerne gerade die Regeln für <strong>${esc(p.kreis)}</strong> kennen. Bis dahin gelten die bundesweiten Grundregeln – das dauert meist ein bis drei Minuten.</p>`;
  } else if (p.status === 'ermittelt' && p.zusammenfassung) {
    karte.hidden = false;
    karte.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/></svg>
      <p>${esc(p.zusammenfassung)}</p>`;
  } else karte.hidden = true;
}

function setzeRegion(ort, profil) {
  Z.ort = ort;
  Z.profil = profil;
  Z.hoefe = null;
  P.speicher.schreiben('ort', ort);
  P.speicher.schreiben('profil', profil);
  zeichneKopf();
  beobachteRecherche();
  if (Z.ansicht === 'region') zeichneRegion();
}

async function standortBestimmen() {
  try {
    $('#ortName').textContent = 'Standort wird bestimmt …';
    const pos = await P.standort();
    const d = await P.api(`/ort?lat=${pos.lat}&lon=${pos.lon}`);
    setzeRegion(d.ort, d.profil);
  } catch (f) {
    zeichneKopf();
    if (!Z.ort) {
      const karte = $('#regionKarte');
      karte.hidden = false;
      karte.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 22s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z"/></svg>
        <p>${esc(f.message)} <button class="textknopf" type="button" data-zu="region">Ort eingeben</button></p>`;
    }
  }
}

/** Fragt den Stand der Recherche regelmäßig ab, solange sie läuft. */
function beobachteRecherche() {
  clearTimeout(Z.abfrageTimer);
  if (!Z.profil || Z.profil.status !== 'wird_ermittelt' || !Z.ort) return;
  let versuche = 0;
  const frage = async () => {
    try {
      const d = await P.api('/region/' + Z.ort.key);
      if (d.profil.status !== 'wird_ermittelt') { setzeRegion(Z.ort, d.profil); return; }
    } catch { /* später erneut */ }
    if (++versuche < 120) Z.abfrageTimer = setTimeout(frage, 6000);
  };
  Z.abfrageTimer = setTimeout(frage, 5000);
}

/* ------------------------------ Darstellung Tonne ------------------------------ */

function tonneSvg(symbol, farbe) {
  const f = esc(farbe);
  const dunkel = `color-mix(in srgb, ${f} 70%, #000)`;
  switch (symbol) {
    case 'sack':
      return `<svg viewBox="0 0 72 84"><path d="M30 10c-2-4 2-8 6-6 4-2 8 2 6 6l-3 6h-6l-3-6Z" fill="${dunkel}"/><path d="M24 18h24c8 10 14 26 14 42 0 14-12 20-26 20S10 74 10 60c0-16 6-32 14-42Z" fill="${f}"/><path d="M26 34c-3 8-4 16-3 26" stroke="rgba(255,255,255,.35)" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`;
    case 'container':
      return `<svg viewBox="0 0 72 84"><rect x="8" y="24" width="56" height="54" rx="8" fill="${f}"/><path d="M14 24 22 8h28l8 16Z" fill="${dunkel}"/><circle cx="36" cy="16" r="4" fill="rgba(255,255,255,.7)"/><rect x="16" y="38" width="40" height="5" rx="2.5" fill="rgba(255,255,255,.3)"/></svg>`;
    case 'hof':
      return `<svg viewBox="0 0 72 84"><path d="M6 36 36 14l30 22v42H6Z" fill="${f}"/><path d="M2 38 36 12l34 26" stroke="${dunkel}" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect x="26" y="50" width="20" height="28" rx="3" fill="rgba(255,255,255,.35)"/></svg>`;
    case 'handel':
      return `<svg viewBox="0 0 72 84"><path d="M12 28h48l-4 50H16Z" fill="${f}"/><path d="M26 30v-8a10 10 0 0 1 20 0v8" stroke="${dunkel}" stroke-width="5" fill="none" stroke-linecap="round"/></svg>`;
    case 'sperrmuell':
      return `<svg viewBox="0 0 72 84"><rect x="10" y="36" width="52" height="26" rx="8" fill="${f}"/><rect x="4" y="40" width="12" height="26" rx="6" fill="${dunkel}"/><rect x="56" y="40" width="12" height="26" rx="6" fill="${dunkel}"/><rect x="16" y="24" width="40" height="18" rx="7" fill="${f}" opacity=".8"/><rect x="12" y="66" width="6" height="10" rx="2" fill="${dunkel}"/><rect x="54" y="66" width="6" height="10" rx="2" fill="${dunkel}"/></svg>`;
    default:
      return `<svg viewBox="0 0 72 84"><rect x="8" y="8" width="56" height="12" rx="4" fill="${dunkel}"/><path d="M12 22h48l-4 52a6 6 0 0 1-6 6H22a6 6 0 0 1-6-6Z" fill="${f}"/><rect x="28" y="12" width="16" height="4" rx="2" fill="rgba(255,255,255,.4)"/><path d="M26 34v34M36 34v34M46 34v34" stroke="rgba(255,255,255,.28)" stroke-width="3" stroke-linecap="round"/></svg>`;
  }
}

/* ------------------------------ Ergebnis ------------------------------ */

const HOF_FRAKTIONEN = new Set(['elektro', 'schadstoff', 'holz', 'metall', 'bauschutt', 'gruengut', 'wertstoffhof', 'batterie']);

function naechsterSchritt(e) {
  const p = Z.profil || {};
  if (e.fraktion === 'sperrmuell') return sperrmuellHtml(true);
  if (HOF_FRAKTIONEN.has(e.fraktion) || (e.symbol === 'hof')) {
    return `<div class="aktionen"><button class="knopf" type="button" data-zu="orte">Wertstoffhof in der Nähe</button>
      ${e.fraktion === 'schadstoff' && p.schadstoff && p.schadstoff.url ? `<button class="knopf zweit" type="button" data-link="${esc(p.schadstoff.url)}">Schadstoffmobil-Termine</button>` : ''}</div>`;
  }
  if (e.fraktion === 'glas' || e.fraktion === 'textil') {
    const was = e.fraktion === 'glas' ? 'Altglascontainer' : 'Altkleidercontainer';
    const o = Z.ort;
    const url = o ? `https://www.google.com/maps/search/${encodeURIComponent(was)}/@${o.lat},${o.lon},14z` : `https://www.google.com/maps/search/${encodeURIComponent(was)}`;
    return `<div class="aktionen"><button class="knopf zweit" type="button" data-link="${esc(url)}">${was} auf der Karte</button></div>`;
  }
  if (['rest', 'bio', 'papier', 'verpackung'].includes(e.fraktion) && p.termine && p.termine.url) {
    return `<div class="aktionen"><button class="knopf zweit" type="button" data-link="${esc(p.termine.url)}">Abfuhrkalender ansehen</button></div>`;
  }
  return '';
}

function ergebnisKarte(e, extra = {}) {
  const regionText = e.regions_hinweis
    ? `<div class="region-hinweis">${esc(e.regions_hinweis)}${e.regions_quelle ? `<br><a href="#" data-link="${esc(e.regions_quelle)}">Quelle ansehen</a>` : ''}</div>` : '';
  const teile = (extra.bestandteile || []).length
    ? `<ul class="teile">${extra.bestandteile.map((b) => `<li><span class="punkt" style="background:${esc(b.ergebnis.farbe)}"></span>${esc(b.teil)}<span class="ziel">${esc(b.ergebnis.behaelter)}</span></li>`).join('')}</ul>` : '';
  const unsicher = extra.sicherheit !== undefined && extra.sicherheit < 0.6
    ? `<p class="sicherheit">Ich bin mir hier nicht ganz sicher. Prüfe das Ergebnis lieber über die Suche.</p>` : '';
  const allgemein = e.quelle === 'allgemein' && Z.profil && Z.profil.status !== 'ermittelt'
    ? `<p class="allgemein-hinweis">Bundesweite Grundregel – dein Entsorger kann abweichen.</p>` : '';
  return `<article class="ergebnis">
    <div class="ergebnis-kopf" style="--farbe:${esc(e.farbe)}">
      <div class="tonne">${tonneSvg(e.symbol, e.farbe)}</div>
      <div><p class="was">${esc(e.gegenstand)}</p><p class="wohin">${esc(e.behaelter)}</p></div>
    </div>
    <div class="ergebnis-koerper">
      ${e.hinweis ? `<p>${esc(e.hinweis)}</p>` : ''}
      ${regionText}${unsicher}${teile}${allgemein}
      ${naechsterSchritt(e)}
      <div class="aktionen"><button class="textknopf" type="button" data-melden="${esc(e.lexikon_id || '')}" data-name="${esc(e.gegenstand)}">Stimmt nicht?</button></div>
    </div>
  </article>`;
}

function zeigeEintrag(eintrag) {
  const e = Regeln.entscheide(eintrag, Z.profil, Z.stamm);
  $('#ergebnisInhalt').innerHTML = ergebnisKarte(e);
  zeige('ergebnis');
}

async function fotoAuswerten(datei) {
  if (!datei) return;
  laden('Ich schaue mir das an …');
  try {
    const bild = await P.bildVerkleinern(datei);
    const d = await P.api('/erkennen', { daten: { bild, region_key: Z.ort && Z.ort.key } });
    if (!d.gegenstaende.length) {
      $('#ergebnisInhalt').innerHTML = `<article class="karte"><p><strong>Ich habe nichts erkannt.</strong></p>
        <p class="leer">${esc(d.unklar_grund || 'Versuche es mit mehr Licht und dem Gegenstand formatfüllend im Bild.')}</p>
        <div class="aktionen"><label class="knopf" for="fotoEingabe">Noch ein Foto</label></div></article>`;
    } else {
      $('#ergebnisInhalt').innerHTML = d.gegenstaende.map((g) => ergebnisKarte(g.ergebnis, g)).join('');
    }
    zeige('ergebnis');
  } catch (f) {
    $('#ergebnisInhalt').innerHTML = `<article class="karte fehler"><p><strong>Das hat nicht geklappt.</strong></p><p>${esc(f.message)}</p>
      <p class="leer">Du kannst den Gegenstand auch über die Suche finden.</p></article>`;
    zeige('ergebnis');
  } finally {
    laden(null);
    $('#fotoEingabe').value = '';
  }
}

/* ------------------------------ Suche ------------------------------ */

function sucheAnzeigen(text) {
  const liste = $('#suchTreffer');
  if (!text.trim()) { liste.hidden = true; return; }
  const treffer = Regeln.suche(Z.index, text, 7);
  liste.hidden = false;
  if (!treffer.length) {
    liste.innerHTML = `<li class="leer">Nichts gefunden. Mach am besten ein Foto davon.</li>`;
    return;
  }
  liste.innerHTML = treffer.map((t) => {
    const e = Regeln.entscheide(t, Z.profil, Z.stamm);
    return `<li><button type="button" data-id="${esc(t.id)}" data-wort="${esc(t.wort)}"><span class="punkt" style="background:${esc(e.farbe)}"></span>
      <span class="t-name">${esc(t.wort)}</span><span class="t-ziel">${esc(e.behaelter)}</span></button></li>`;
  }).join('');
}

/* ------------------------------ Höfe & Sperrmüll ------------------------------ */

function entfernungKm(a, b) {
  const r = Math.PI / 180;
  const d = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(d));
}

function routeUrl(h) {
  if (h.lat && h.lon) return `https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lon}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.name + ' ' + (h.adresse || ''))}`;
}

const STOFFE = { electrical_appliances: 'Elektro', batteries: 'Batterien', glass: 'Glas', paper: 'Papier', cardboard: 'Pappe', plastic: 'Kunststoff',
  green_waste: 'Grüngut', wood: 'Holz', scrap_metal: 'Schrott', rubble: 'Bauschutt', hazardous_waste: 'Schadstoffe', clothes: 'Kleidung',
  polystyrene_foam: 'Styropor', tyres: 'Reifen', engine_oil: 'Altöl', fluorescent_tubes: 'Leuchtmittel', cooking_oil: 'Speisefett', cork: 'Korken', cds: 'CDs',
  books: 'Bücher', cans: 'Dosen', cartons: 'Getränkekartons', glass_bottles: 'Glasflaschen', magazines: 'Zeitschriften', newspaper: 'Zeitungen',
  hardcore: 'Bauschutt', white_goods: 'Großgeräte', small_appliances: 'Kleingeräte', furniture: 'Möbel', mattresses: 'Matratzen',
  plastic_packaging: 'Verpackungen', plastic_bottles: 'Plastikflaschen', aluminium: 'Alu', metal: 'Metall', wood_waste: 'Holz',
  garden_waste: 'Gartenabfall', oil: 'Öl', paint: 'Farben', car_batteries: 'Autobatterien', computers: 'Computer', mobile_phones: 'Handys',
  shoes: 'Schuhe', toner_cartridges: 'Toner', printer_cartridges: 'Druckerpatronen', bulky_waste: 'Sperrmüll', organic: 'Bioabfall',
  light_bulbs: 'Leuchtmittel', fridge_and_freezer: 'Kühlgeräte', tv_monitor: 'Bildschirme', asbestos: 'Asbest', gypsum: 'Gips', styrofoam: 'Styropor' };

async function zeichneOrte() {
  const ziel = $('#hoefeListe');
  $('#sperrmuellKarte').innerHTML = sperrmuellHtml(false);
  if (!Z.ort) { ziel.innerHTML = '<p class="leer">Lege zuerst deinen Standort fest.</p>'; return; }
  const offiziell = (Z.profil && Z.profil.wertstoffhoefe) || [];
  if (!Z.hoefe) {
    ziel.innerHTML = offiziell.length ? hoefeHtml(offiziell, []) : '<p class="leer">Wird geladen …</p>';
    try { Z.hoefe = (await P.api(`/hoefe?lat=${Z.ort.lat}&lon=${Z.ort.lon}`)).hoefe; } catch { Z.hoefe = []; }
  }
  try {
    ziel.innerHTML = hoefeHtml(offiziell, Z.hoefe);
  } catch (f) {
    ziel.innerHTML = '<p class="leer">Die Wertstoffhöfe konnten nicht angezeigt werden. Bitte die Seite neu laden.</p>';
    console.error(f);
  }
}

function hoefeHtml(offiziell, osm) {
  const namen = new Set(offiziell.map((h) => Regeln.falte(h.name)));
  const ausOsm = osm
    .filter((h) => !namen.has(Regeln.falte(h.name)))
    .map((h) => ({ ...h, km: Z.ort ? entfernungKm(Z.ort, h) : null }))
    .sort((a, b) => a.km - b.km)
    .slice(0, 8);
  const alle = [...offiziell.map((h) => ({ ...h, offiziell: true })), ...ausOsm];
  if (!alle.length) return '<p class="leer">Keine Wertstoffhöfe gefunden.</p>';
  return alle.map((h) => {
    const st = Oeffnung.status(h.oeffnungszeiten_osm);
    // Englische OSM-Schlüssel ohne Übersetzung werden ausgeblendet; Angaben des Entsorgers sind schon deutsch
    const annahme = [...new Set((h.annahme || []).map((a) => STOFFE[a] || (h.offiziell || /[A-ZÄÖÜäöüß ]/.test(a) ? a : null)).filter(Boolean))].slice(0, 12);
    return `<article class="karte hof">
      <h3>${esc(h.name)}</h3>
      ${h.adresse ? `<div class="adr">${esc(h.adresse)}</div>` : ''}
      ${st ? `<div class="zustand ${st.offen ? 'offen' : 'zu'}">${esc(st.text)}</div>` : ''}
      ${h.oeffnungszeiten_text ? `<div class="zeiten">${esc(h.oeffnungszeiten_text)}</div>` : (h.oeffnungszeiten_osm ? `<div class="zeiten">${esc(Oeffnung.lesbar(h.oeffnungszeiten_osm))}</div>` : '')}
      ${annahme.length ? `<div class="marken">${annahme.map((a) => `<span class="marke">${esc(a)}</span>`).join('')}</div>` : ''}
      <div class="zeile">
        <button class="knopf klein" type="button" data-link="${esc(routeUrl(h))}">Route</button>
        ${h.km != null ? `<span class="entfernung">${h.km.toFixed(1).replace('.', ',')} km</span>` : ''}
        <span class="entfernung">${h.offiziell ? 'Quelle: Entsorger' : 'Quelle: OpenStreetMap'}</span>
      </div>
    </article>`;
  }).join('');
}

function sperrmuellHtml(kurz) {
  const s = Z.profil && Z.profil.sperrmuell;
  if (!s || s.verfahren === 'unbekannt') {
    return `<article class="karte"><p>${Z.profil && Z.profil.status === 'wird_ermittelt'
      ? 'Die Sperrmüll-Regeln deiner Region werden gerade ermittelt.'
      : 'Für deine Region habe ich noch keine Sperrmüll-Angaben. Dein Landratsamt bzw. deine Stadt hilft weiter.'}</p></article>`;
  }
  const verfahren = { abruf: 'Abholung auf Anmeldung', termin: 'Feste Sammeltermine', bringen: 'Selbst zum Wertstoffhof bringen' }[s.verfahren];
  return `<article class="karte">
    <p><strong>${esc(verfahren)}</strong></p>
    ${s.kosten ? `<p>Kosten: ${esc(s.kosten)}</p>` : ''}
    ${s.menge && !kurz ? `<p>Menge: ${esc(s.menge)}</p>` : ''}
    ${s.hinweis ? `<p class="leer">${esc(s.hinweis)}</p>` : ''}
    <div class="aktionen">
      ${s.anmeldung_url ? `<button class="knopf" type="button" data-link="${esc(s.anmeldung_url)}">So meldest du ihn an</button>` : ''}
      ${s.telefon ? `<a class="knopf zweit" href="tel:${esc(s.telefon.replace(/[^\d+]/g, ''))}">${esc(s.telefon)}</a>` : ''}
    </div>
    ${s.quelle && !kurz ? `<p class="quelle">Quelle: ${esc(s.quelle)}</p>` : ''}
  </article>`;
}

/* ------------------------------ Region ------------------------------ */

function zeichneRegion() {
  const o = Z.ort, p = Z.profil;
  const ziel = $('#regionInfo');
  if (!o || !p) { ziel.innerHTML = '<article class="karte"><p class="leer">Noch kein Ort festgelegt.</p></article>'; return; }
  const sys = p.system || {};
  const vp = { sack: 'Gelber Sack', tonne: 'Gelbe Tonne', wertstofftonne: 'Wertstofftonne', bringsystem: 'Wertstoffhof / Wertstoffinsel', unbekannt: 'noch unbekannt' };
  const bio = { tonne: 'Biotonne', bringsystem: 'Sammelstelle', keine: 'keine Biotonne', unbekannt: 'noch unbekannt' };
  const statusText = { ermittelt: 'Automatisch ermittelt', wird_ermittelt: 'Wird gerade ermittelt', unsicher: 'Unsicher – Grundregeln aktiv', fehler: 'Ermittlung fehlgeschlagen – Grundregeln aktiv', allgemein: 'Bundesweite Grundregeln' }[p.status] || p.status;
  ziel.innerHTML = `<article class="karte">
    <div class="region-zeile"><span>Ort</span><span>${esc(o.gemeinde || o.kreis)}</span></div>
    <div class="region-zeile"><span>Kreis</span><span>${esc(o.kreis)}</span></div>
    <div class="region-zeile"><span>Bundesland</span><span>${esc(o.bundesland)}</span></div>
    ${p.entsorger ? `<div class="region-zeile"><span>Entsorger</span><span>${p.entsorger.url ? `<a href="#" data-link="${esc(p.entsorger.url)}">${esc(p.entsorger.name)}</a>` : esc(p.entsorger.name)}</span></div>` : ''}
    <div class="region-zeile"><span>Verpackungen</span><span>${esc(vp[sys.verpackung] || 'noch unbekannt')}</span></div>
    <div class="region-zeile"><span>Bioabfall</span><span>${esc(bio[sys.bio] || 'noch unbekannt')}</span></div>
    <div class="region-zeile"><span>Stand</span><span>${esc(statusText)}${p.ermittelt_am ? ' am ' + new Date(p.ermittelt_am).toLocaleDateString('de-DE') : ''}</span></div>
    ${p.abfall_abc_url ? `<div class="aktionen"><button class="knopf zweit klein" type="button" data-link="${esc(p.abfall_abc_url)}">Abfall-ABC des Entsorgers</button></div>` : ''}
    ${p.termine && p.termine.url ? `<div class="aktionen"><button class="knopf zweit klein" type="button" data-link="${esc(p.termine.url)}">Abfuhrkalender</button></div>` : ''}
  </article>
  ${(p.abweichungen || []).length ? `<h2 class="abschnitt">Besonderheiten hier</h2><article class="karte">${p.abweichungen.map((a) => `<div class="region-zeile"><span>${esc(a.begriff)}</span><span>${esc((Z.stamm.fraktionen[a.fraktion] || {}).name || a.fraktion)}</span></div>`).join('')}</article>` : ''}`;
}

async function ortSuchen(text) {
  const liste = $('#ortTreffer');
  if (text.trim().length < 2) { liste.hidden = true; return; }
  try {
    const d = await P.api('/ort/suche?q=' + encodeURIComponent(text));
    liste.hidden = false;
    liste.innerHTML = d.treffer.length
      ? d.treffer.map((t, i) => `<li><button type="button" data-ort="${i}"><span class="t-name">${esc(t.gemeinde || t.kreis)}</span><span class="t-ziel">${esc(t.kreis)}</span></button></li>`).join('')
      : '<li class="leer">Kein Ort gefunden.</li>';
    liste._treffer = d.treffer;
  } catch (f) {
    liste.hidden = false;
    liste.innerHTML = `<li class="leer">${esc(f.message)}</li>`;
  }
}

async function ortWaehlen(t) {
  laden('Region wird geladen …');
  try {
    const d = await P.api(`/ort?lat=${t.lat}&lon=${t.lon}`);
    setzeRegion(d.ort, d.profil);
    $('#ortTreffer').hidden = true;
    $('#ortSuche').value = '';
  } catch (f) { alert(f.message); } finally { laden(null); }
}

async function melden(id, name) {
  const text = prompt(`Was stimmt bei „${name}“ nicht? (z. B. „Gehört bei uns in die Biotonne“)`);
  if (text === null) return;
  try {
    await P.api('/meldung', { daten: { region_key: Z.ort ? Z.ort.key : 'unbekannt', lexikon_id: id || null, text: `${name}: ${text}` } });
    alert('Danke! Ich prüfe das.');
  } catch (f) { alert(f.message); }
}

/* ------------------------------ Ereignisse ------------------------------ */

function verdrahte() {
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-zu],[data-link],[data-id],[data-ort],[data-melden]');
    if (!el) return;
    if (el.dataset.zu) { ev.preventDefault(); zeige(el.dataset.zu); }
    else if (el.dataset.link) { ev.preventDefault(); P.oeffne(el.dataset.link); }
    else if (el.dataset.id) {
      const e = Regeln.findeId(Z.index, el.dataset.id);
      $('#suchTreffer').hidden = true;
      if (e) zeigeEintrag({ ...e, n: el.dataset.wort || e.n });
    } else if (el.dataset.ort !== undefined) {
      const t = $('#ortTreffer')._treffer[Number(el.dataset.ort)];
      if (t) ortWaehlen(t);
    } else if (el.dataset.melden !== undefined) melden(el.dataset.melden, el.dataset.name);
  });

  $('#ortChip').addEventListener('click', () => zeige('region'));
  $('#fotoEingabe').addEventListener('change', (e) => fotoAuswerten(e.target.files[0]));
  $('#standortNeu').addEventListener('click', async () => { laden('Standort wird bestimmt …'); await standortBestimmen(); laden(null); zeichneRegion(); });

  const feld = $('#suchFeld');
  feld.addEventListener('input', () => sucheAnzeigen(feld.value));
  feld.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const erster = $('#suchTreffer button');
      if (erster) erster.click();
    }
  });

  let ortTimer;
  $('#ortSuche').addEventListener('input', (e) => {
    clearTimeout(ortTimer);
    ortTimer = setTimeout(() => ortSuchen(e.target.value), 450);
  });

  $('#schnellwahl').innerHTML = SCHNELL.map((s) => `<button type="button" data-suche="${esc(s)}">${esc(s)}</button>`).join('');
  $('#schnellwahl').addEventListener('click', (e) => {
    const b = e.target.closest('[data-suche]');
    if (!b) return;
    const t = Regeln.suche(Z.index, b.dataset.suche, 1)[0];
    if (t) zeigeEintrag({ ...t, n: t.wort });
  });
}

async function start() {
  verdrahte();
  await ladeDaten();
  zeichneKopf();
  if (Z.ort) {
    beobachteRecherche();
    // Profil im Hintergrund auffrischen
    P.api('/region/' + Z.ort.key).then((d) => setzeRegion(Z.ort, d.profil)).catch(() => {});
  } else {
    standortBestimmen();
  }
  if ('serviceWorker' in navigator && !P.nativ && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start();
