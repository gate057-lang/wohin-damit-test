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
  termine: P.speicher.lesen('termine'),          // { liste, quelle: {art, url}, stand }
  erinnerung: P.speicher.lesen('erinnerung', { an: false, uhrzeit: '19:00', auswahl: null }),
  fotoAktiv: true,
};

const SCHNELL = ['Pizzakarton', 'Kassenbon', 'Akku', 'Tetrapak', 'Glühbirne', 'Styropor', 'Sofa', 'Medikamente'];

/* ------------------------------ Grundlagen ------------------------------ */

async function ladeDaten() {
  const [stamm, lexikon, ratgeber] = await Promise.all([
    fetch('daten/fraktionen.json?v=83368c4').then((r) => r.json()),
    fetch('daten/lexikon.json?v=83368c4').then((r) => r.json()),
    fetch('daten/ratgeber.json?v=83368c4').then((r) => r.json()).catch(() => null),
  ]);
  Z.stamm = stamm;
  Z.ratgeber = ratgeber;
  Z.index = Regeln.baueIndex(lexikon);
}

function zeige(ansicht) {
  Z.ansicht = ansicht;
  for (const s of document.querySelectorAll('.ansicht')) s.hidden = s.id !== 'ansicht-' + ansicht;
  for (const b of document.querySelectorAll('.leiste button')) {
    b.classList.toggle('aktiv', b.dataset.zu === ansicht || ((ansicht === 'ergebnis' || ansicht === 'markieren') && b.dataset.zu === 'start'));
  }
  if (ansicht !== 'start' && Z.korrektur) korrekturEnde();
  if (ansicht === 'orte') zeichneOrte();
  if (ansicht === 'termine') zeichneTermine();
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
  zeichneAbholung();
  beobachteRecherche();
  if (Z.ansicht === 'region') zeichneRegion();
}

async function standortBestimmen(frisch = false) {
  const chip = $('#ortChip');
  if (chip.classList.contains('sucht')) return;
  chip.classList.add('sucht');
  try {
    $('#ortName').textContent = 'Standort wird bestimmt …';
    $('#ortKreis').textContent = '';
    const pos = await P.standort(frisch);
    const d = await P.api(`/ort?lat=${pos.lat}&lon=${pos.lon}`);
    setzeRegion(d.ort, d.profil);
    Z.hoefe = null;
  } catch (f) {
    zeichneKopf();
    if (Z.ort) alert(f.message);
    else {
      const karte = $('#regionKarte');
      karte.hidden = false;
      karte.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 22s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z"/></svg>
        <p>${esc(f.message)} <button class="textknopf" type="button" data-zu="region">Ort eingeben</button></p>`;
    }
  } finally {
    chip.classList.remove('sucht');
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
    return `<div data-umgebung="${e.fraktion}" data-max="3"><p class="leer">Container in der Nähe werden gesucht …</p></div>`;
  }
  if (['rest', 'bio', 'papier', 'verpackung', 'gruengut', 'schadstoff'].includes(e.fraktion)) {
    const t = Z.termine && Termine.naechster(Z.termine.liste, e.fraktion);
    if (t) return `<div class="naechste"><span class="punkt" style="background:${esc(e.farbe)}"></span>Nächste Abholung: <strong>${esc(Termine.wann(t.datum))}</strong></div>`;
    if (['rest', 'bio', 'papier', 'verpackung'].includes(e.fraktion)) {
      return `<div class="aktionen"><button class="knopf zweit" type="button" data-zu="termine">Abfuhrtermine einrichten</button></div>`;
    }
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
      ${e.verschenkbar ? `<div class="karte verschenken"><p><strong>Noch gut?</strong> Verschenken statt wegwerfen – das freut andere und spart dir den Weg.</p>
        <div data-umgebung="verschenken" data-fuer="${esc(e.lexikon_id || '')}" data-max="4" data-spaeter="1">
          <button class="knopf zweit klein" type="button" data-umgebung-laden>Orte zum Weitergeben in der Nähe</button></div></div>` : ''}
      ${extra.gelernt ? '<p class="gelernt-hinweis">✓ Aus Korrekturen gelernt</p>' : ''}
      <div class="aktionen"><button class="textknopf" type="button" data-melden="${esc(e.lexikon_id || '')}" data-name="${esc(e.gegenstand)}" data-eid="${esc(extra.erkennung_id || '')}">Stimmt nicht?</button></div>
    </div>
  </article>`;
}

function zeigeEintrag(eintrag, lernId) {
  const e = Regeln.entscheide(eintrag, Z.profil, Z.stamm);
  // Korrektur eines Fotos: der gewählte Eintrag ist die richtige Antwort → Erkennung lernt
  const eid = lernId || Z.korrektur;
  let dank = '';
  if (eid && eintrag.id) {
    lernen(eid, eintrag.id);
    dank = '<p class="gelernt-hinweis">✓ Danke! Die Erkennung lernt daraus.</p>';
  }
  korrekturEnde();
  $('#ergebnisInhalt').innerHTML = ergebnisKarte(e) + dank;
  zeige('ergebnis');
  fuelleUmgebung($('#ergebnisInhalt'));
}

async function fotoAuswerten(datei) {
  if (!datei) return;
  laden('Ich schaue mir das an …');
  try {
    const bild = await P.bildVerkleinern(datei);
    Z.letztesFoto = bild;
    const d = await P.api('/erkennen', { daten: { bild, region_key: Z.ort && Z.ort.key } });
    $('#ergebnisInhalt').innerHTML = fotoErgebnisHtml(d, true);
    zeige('ergebnis');
    fuelleUmgebung($('#ergebnisInhalt'));
  } catch (f) {
    $('#ergebnisInhalt').innerHTML = `<article class="karte fehler"><p><strong>Das hat nicht geklappt.</strong></p><p>${esc(f.message)}</p>
      <p class="leer">Du kannst den Gegenstand auch über die Suche finden.</p></article>`;
    zeige('ergebnis');
  } finally {
    laden(null);
    $('#fotoEingabe').value = '';
  }
}

/** Ergebnis einer Foto-Erkennung als HTML (eine oder mehrere Karten). */
function fotoErgebnisHtml(d, mitMarkieren, titel) {
  const eid = d.erkennung_id || '';
  const kopf = titel ? `<h3 class="monat">${esc(titel)}</h3>` : '';
  if (!d.gegenstaende.length) {
    const alt = (d.alternativen || []).length
      ? `<p>Vielleicht ist es:</p><div class="schnell">${d.alternativen.map((a) => `<button type="button" data-id="${esc(a.lexikon_id)}" data-wort="${esc(a.bezeichnung)}" data-lernen="${esc(eid)}">${esc(a.bezeichnung)}</button>`).join('')}</div>` : '';
    return `${kopf}<article class="karte"><p><strong>Ich habe nichts sicher erkannt.</strong></p>
      <p class="leer">${esc(d.unklar_grund || 'Versuche es mit mehr Licht und dem Gegenstand formatfüllend im Bild.')}</p>${alt}
      <div class="aktionen"><label class="knopf" for="fotoEingabe">Noch ein Foto</label>
      ${eid ? `<button class="knopf zweit" type="button" data-korrigieren="${esc(eid)}">Richtigen Gegenstand suchen</button>` : ''}</div></article>`;
  }
  const alt = (d.alternativen || []).length
    ? `<article class="karte"><p><strong>Nicht richtig erkannt?</strong> Vielleicht ist es:</p>
        <div class="schnell">${d.alternativen.map((a) => `<button type="button" data-id="${esc(a.lexikon_id)}" data-wort="${esc(a.bezeichnung)}" data-lernen="${esc(eid)}">${esc(a.bezeichnung)}</button>`).join('')}</div>
        <div class="aktionen"><button class="textknopf" type="button" data-korrigieren="${esc(eid)}">Etwas anderes – selbst suchen</button></div></article>` : '';
  const markieren = mitMarkieren && Z.letztesFoto
    ? `<article class="karte hinweis-karte"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="8" height="8" rx="1.5"/><rect x="13" y="11" width="8" height="8" rx="1.5"/></svg>
        <p>Mehrere Teile im Bild, z. B. Becher und Deckel? <button class="textknopf" type="button" id="zumMarkieren">Teile einzeln markieren</button></p></article>` : '';
  return kopf + d.gegenstaende.map((g) => ergebnisKarte(g.ergebnis, {
    ...g, erkennung_id: eid, gelernt: d.gelernt,
    sicherheit: d.alternativen && d.alternativen.length ? 1 : g.sicherheit,
  })).join('') + alt + markieren;
}

/* ------------------------------ Umgebung (Container, Verschenken) ------------------------------ */

const umgebungCache = new Map();
async function umgebung(art) {
  if (!Z.ort) throw new Error('Lege zuerst deinen Standort fest.');
  const k = `${art}|${Z.ort.lat.toFixed(3)}|${Z.ort.lon.toFixed(3)}`;
  if (!umgebungCache.has(k)) {
    umgebungCache.set(k, P.api(`/umgebung?art=${art}&lat=${Z.ort.lat}&lon=${Z.ort.lon}`).then((d) => d.orte)
      .catch((f) => { umgebungCache.delete(k); throw f; }));
  }
  return umgebungCache.get(k);
}

function routeZu(o) {
  return `https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lon}`;
}

function ortListeHtml(orte) {
  return `<ul class="ort-liste">${orte.map((o) => {
    const st = Oeffnung.status(o.oeffnungszeiten_osm);
    const unter = [o.name !== o.art ? o.art : '', o.adresse, st ? st.text : ''].filter(Boolean).join(' · ');
    return `<li><span class="o-text"><strong>${esc(o.name)}</strong>${unter ? `<small>${esc(unter)}</small>` : ''}</span>
      <span class="o-km">${o.km < 1 ? Math.round(o.km * 1000) + ' m' : o.km.toFixed(1).replace('.', ',') + ' km'}</span>
      <button class="knopf klein" type="button" data-link="${esc(routeZu(o))}">Route</button></li>`;
  }).join('')}</ul>`;
}

/** Bücherschränke nur für Bücher, Repair-Cafés nur für Reparierbares. */
function passtZum(o, fuer) {
  if (o.art === 'Bücherschrank') return ['buch', 'cd', 'videokassette'].includes(fuer);
  if (o.art === 'Repair-Café') return ['kleingeraet', 'laptop', 'handy', 'spielzeug_elektro', 'fahrrad', 'kleidung', 'regenschirm', 'armbanduhr'].includes(fuer);
  return true;
}

async function fuelleBereich(el) {
  const art = el.dataset.umgebung, max = Number(el.dataset.max || 5), fuer = el.dataset.fuer || '';
  el.innerHTML = '<p class="leer">Wird gesucht …</p>';
  try {
    const orte = (await umgebung(art)).filter((o) => art !== 'verschenken' || passtZum(o, fuer)).slice(0, max);
    el.innerHTML = orte.length ? ortListeHtml(orte)
      : `<p class="leer">${art === 'verschenken' ? 'In der Nähe ist nichts eingetragen. Tipp: Nachbarschafts-Gruppen oder Kleinanzeigen („Zu verschenken“).' : 'In der Nähe ist kein Container eingetragen – frag am Wertstoffhof.'}</p>`;
  } catch (f) {
    el.innerHTML = `<p class="leer">${esc(f.message)}</p><button class="knopf zweit klein" type="button" data-umgebung-laden>Nochmal versuchen</button>`;
  }
}

function fuelleUmgebung(wurzel) {
  for (const el of wurzel.querySelectorAll('[data-umgebung]')) if (!el.dataset.spaeter) fuelleBereich(el);
}

/* ------------------------------ Lernen aus Korrekturen ------------------------------ */

function lernen(eid, lexikonId) {
  if (!eid || !lexikonId) return;
  P.api('/lernen', { daten: { erkennung_id: eid, lexikon_id: lexikonId } }).catch(() => {});
}

function korrekturStarten(eid) {
  Z.korrektur = eid;
  $('#korrekturHinweis').hidden = false;
  zeige('start');
  const f = $('#suchFeld');
  f.value = '';
  f.focus();
  f.scrollIntoView({ block: 'center' });
}

function korrekturEnde() {
  Z.korrektur = null;
  $('#korrekturHinweis').hidden = true;
}

/* ------------------------------ Mehrere Teile markieren ------------------------------ */

const M = { bild: null, rahmen: [], zieht: null };

function markierenOeffnen() {
  if (!Z.letztesFoto) return;
  M.rahmen = [];
  const img = new Image();
  img.onload = () => {
    M.bild = img;
    const c = $('#markierBild');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    markierenZeichnen();
    zeige('markieren');
  };
  img.src = Z.letztesFoto;
}

function markierenZeichnen() {
  const c = $('#markierBild'), g = c.getContext('2d');
  g.drawImage(M.bild, 0, 0);
  const s = Math.max(2, c.width / 220);
  const alle = M.zieht ? [...M.rahmen, M.zieht] : M.rahmen;
  alle.forEach((r, i) => {
    const x = Math.min(r.x1, r.x2), y = Math.min(r.y1, r.y2), w = Math.abs(r.x2 - r.x1), h = Math.abs(r.y2 - r.y1);
    g.fillStyle = 'rgba(31,122,77,.18)'; g.fillRect(x, y, w, h);
    g.lineWidth = s * 2; g.strokeStyle = '#ffffff'; g.strokeRect(x, y, w, h);
    g.lineWidth = s; g.strokeStyle = '#1f7a4d'; g.strokeRect(x, y, w, h);
    if (r !== M.zieht) {
      g.fillStyle = '#1f7a4d'; g.beginPath(); g.arc(x + s * 9, y + s * 9, s * 8, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.font = `bold ${s * 10}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(i + 1), x + s * 9, y + s * 9.5);
    }
  });
  $('#markierErkennen').disabled = !M.rahmen.length;
  $('#markierErkennen').textContent = M.rahmen.length ? `${M.rahmen.length} ${M.rahmen.length === 1 ? 'Teil' : 'Teile'} erkennen` : 'Teile erkennen';
}

function punktImBild(ev) {
  const c = $('#markierBild'), r = c.getBoundingClientRect();
  return { x: (ev.clientX - r.left) * (c.width / r.width), y: (ev.clientY - r.top) * (c.height / r.height) };
}

async function markierteErkennen() {
  laden('Ich schaue mir die Teile an …');
  try {
    const teile = [];
    for (const [i, r] of M.rahmen.entries()) {
      const x = Math.min(r.x1, r.x2), y = Math.min(r.y1, r.y2), w = Math.abs(r.x2 - r.x1), h = Math.abs(r.y2 - r.y1);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
      c.getContext('2d').drawImage(M.bild, x, y, w, h, 0, 0, c.width, c.height);
      const d = await P.api('/erkennen', { daten: { bild: c.toDataURL('image/jpeg', 0.85), region_key: Z.ort && Z.ort.key } });
      teile.push(fotoErgebnisHtml(d, false, `Teil ${i + 1}`));
    }
    $('#ergebnisInhalt').innerHTML = teile.join('');
    zeige('ergebnis');
    fuelleUmgebung($('#ergebnisInhalt'));
  } catch (f) { alert(f.message); } finally { laden(null); }
}

/* ------------------------------ Sprachsuche ------------------------------ */

/** „Wohin mit dem alten Toaster?“ → „Toaster“ */
function sprachAnfrage(text) {
  return String(text).toLowerCase()
    .replace(/[?!.,]/g, ' ')
    .replace(/\b(wohin|wo|mit|kommt|kommen|gehört|gehören|gehoert|hin|rein|hinein|entsorge|entsorgen|entsorgt|ich|man|soll|kann|werfe|wegwerfen|weg|in|welche|tonne|müll)\b/g, ' ')
    .replace(/\b(der|die|das|dem|den|des|ein|eine|einem|einen|einer|mein|meine|meinem|meinen|alt|alte|alten|alter|altes|kaputt|kaputte|kaputten|kaputtes|leer|leere|leeren|gebraucht|gebrauchte|gebrauchten)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

async function sprachSuche() {
  const k = $('#mikroKnopf');
  if (k.classList.contains('hoert')) return;
  k.classList.add('hoert');
  try {
    const gesagt = await P.sprache.hoeren();
    const q = sprachAnfrage(gesagt) || gesagt;
    $('#suchFeld').value = q;
    sucheAnzeigen(q);
    const treffer = Regeln.suche(Z.index, q, 2);
    if (treffer.length === 1 || (treffer[0] && Regeln.falte(treffer[0].wort) === Regeln.falte(q))) {
      $('#suchTreffer').hidden = true;
      zeigeEintrag({ ...treffer[0], n: treffer[0].wort });
    }
  } catch (f) { alert(f.message); } finally { k.classList.remove('hoert'); }
}

/* ------------------------------ Strichcode ------------------------------ */

async function barcodeZeigen(code) {
  code = String(code || '').replace(/\D/g, '');
  if (code.length < 8) { alert('Bitte die 8- oder 13-stellige Nummer unter dem Strichcode eingeben.'); return; }
  laden('Produkt wird gesucht …');
  try {
    const p = await Barcode.produkt(code);
    if (!p) {
      $('#ergebnisInhalt').innerHTML = `<article class="karte"><p><strong>Produkt nicht gefunden</strong> (${esc(code)})</p>
        <p class="leer">Mach am besten ein Foto der Verpackung – das klappt auch ohne Strichcode.</p>
        <div class="aktionen"><label class="knopf" for="fotoEingabe">Foto machen</label></div></article>`;
    } else if (!p.teile.length) {
      $('#ergebnisInhalt').innerHTML = `<article class="karte"><p><strong>${esc(p.name)}</strong>${p.marke ? ' · ' + esc(p.marke) : ''}</p>
        <p class="leer">Zu diesem Produkt sind keine Verpackungsangaben hinterlegt. Mach ein Foto der Verpackung.</p>
        <div class="aktionen"><label class="knopf" for="fotoEingabe">Foto machen</label></div></article>`;
    } else {
      const zeilen = p.teile.map((t) => {
        const e = Regeln.entscheide({ n: t.teil, f: t.fraktion, h: '' }, Z.profil, Z.stamm);
        return `<li><span class="punkt" style="background:${esc(e.farbe)}"></span>${esc(t.teil)}<small class="leer">&nbsp;${esc(t.material)}</small><span class="ziel"><strong>${esc(e.behaelter)}</strong></span></li>`;
      }).join('');
      const pfand = p.teile.some((t) => t.pfand)
        ? `<div class="region-hinweis">Getränkedosen und Einwegflaschen aus Kunststoff haben meist Pfand – achte auf das Pfandzeichen und bring sie zum Automaten.</div>` : '';
      $('#ergebnisInhalt').innerHTML = `<article class="ergebnis">
        <div class="produkt-kopf"><p class="was">${esc(p.marke || 'Produkt')}</p><p class="wohin">${esc(p.name)}</p></div>
        <div class="ergebnis-koerper">${pfand}<ul class="teile">${zeilen}</ul>
          <p class="quelle">Verpackungsangaben: Open Food Facts (ODbL). Teile möglichst voneinander trennen.</p></div></article>`;
    }
    zeige('ergebnis');
  } catch (f) { alert(f.message); } finally { laden(null); }
}

async function barcodeFoto(datei) {
  if (!datei) return;
  try {
    const code = await Barcode.ausFoto(datei);
    if (code) barcodeZeigen(code);
    else {
      const n = prompt('Ich konnte den Strichcode nicht lesen. Gib die Nummer darunter ein:');
      if (n) barcodeZeigen(n);
    }
  } catch { const n = prompt('Gib die Nummer unter dem Strichcode ein:'); if (n) barcodeZeigen(n); }
  finally { $('#barcodeFoto').value = ''; }
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

function zeichneContainer() {
  const el = $('#containerListe');
  if (!Z.ort) { el.innerHTML = '<p class="leer">Lege zuerst deinen Standort fest.</p>'; return; }
  el.innerHTML = `<article class="karte"><div data-umgebung="${Z.containerArt || 'glas'}" data-max="5"></div></article>`;
  fuelleUmgebung(el);
}

async function zeichneOrte() {
  zeichneContainer();
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
        ${h.km != null ? `<span class="entfernung">Entfernung: ${h.km.toFixed(1).replace('.', ',')} km</span>` : ''}
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

/* ------------------------------ Termine ------------------------------ */

const HAUSHALT = ['rest', 'bio', 'papier', 'verpackung', 'glas', 'gruengut', 'schadstoff', 'sperrmuell', 'elektro', 'textil'];
const namenFuer = (f) => Regeln.entscheide({ n: '', f, h: '' }, Z.profil, Z.stamm).behaelter;
const farbeFuer = (f) => Regeln.entscheide({ n: '', f, h: '' }, Z.profil, Z.stamm).farbe;
function alleNamen() {
  return Object.fromEntries(HAUSHALT.map((f) => [f, namenFuer(f)]));
}

function zeichneAbholung() {
  const k = $('#abholungKarte');
  if (!Z.ort) { k.hidden = true; return; }
  k.hidden = false;
  const naechste = Z.termine ? Termine.kommende(Z.termine.liste, Termine.heute(), 3) : [];
  if (!Z.termine) {
    k.innerHTML = `<button class="abholung-leer" type="button" data-zu="termine">
      <svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>
      <span><strong>Abfuhrtermine einrichten</strong><small>Dann siehst du hier, welche Tonne als Nächstes dran ist – auf Wunsch mit Erinnerung am Vorabend.</small></span></button>`;
    return;
  }
  if (!naechste.length) {
    k.innerHTML = `<p class="leer">Keine kommenden Termine mehr im Kalender. <button class="textknopf" type="button" data-zu="termine">Aktualisieren</button></p>`;
    return;
  }
  k.innerHTML = `<p class="abholung-titel">Nächste Abholung</p>` + naechste.map((t) => `
    <div class="abholung-zeile ${Termine.wann(t.datum) === 'morgen' ? 'bald' : ''}">
      <span class="punkt" style="background:${esc(farbeFuer(t.fraktion))}"></span>
      <span class="a-wann">${esc(Termine.wann(t.datum))}</span>
      <span class="a-was">${esc(namenFuer(t.fraktion))}</span>
    </div>`).join('') + `<button class="textknopf" type="button" data-zu="termine">Alle Termine</button>`;
}

function setzeTermine(liste, quelle) {
  Z.termine = { liste, quelle, stand: new Date().toISOString() };
  P.speicher.schreiben('termine', Z.termine);
  zeichneAbholung();
  if (Z.erinnerung.an) erinnerungEinrichten(true);
  zeichneTermine();
}

function zeichneTermine() {
  const ziel = $('#termineInhalt');
  const einrichten = $('#termineEinrichten');
  $('#kalenderFotoKnopf').hidden = !Z.fotoAktiv;
  const p = Z.profil;
  $('#entsorgerKalender').innerHTML = p && p.termine && p.termine.url
    ? `<button class="knopf zweit" type="button" data-link="${esc(p.termine.url)}">Kalender deines Entsorgers</button>` : '';
  if (p && p.termine && p.termine.typ === 'ics' && p.termine.url && !$('#icsLink').value) $('#icsLink').value = p.termine.url;

  if (!Z.termine) {
    einrichten.hidden = false;
    ziel.innerHTML = `<p class="leer">Hol dir die Termine deiner Straße einmal in die App. Danach siehst du jederzeit, welche Tonne dran ist.</p>`;
    return;
  }
  einrichten.hidden = !Z.termineBearbeiten;
  const kommend = Termine.kommende(Z.termine.liste, Termine.heute(), 60);
  const monate = {};
  for (const t of kommend) {
    const m = new Date(t.datum + 'T12:00:00').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    (monate[m] = monate[m] || []).push(t);
  }
  const vorhanden = [...new Set(Z.termine.liste.map((t) => t.fraktion))];
  const auswahl = Z.erinnerung.auswahl || vorhanden;
  const geht = P.erinnerung.moeglich();
  const quelleText = { url: 'Kalender-Link', datei: 'ICS-Datei', foto: 'Foto des Kalenders' }[Z.termine.quelle && Z.termine.quelle.art] || 'Import';

  ziel.innerHTML = `
    <article class="karte">
      <p><strong>Erinnerung am Vorabend</strong></p>
      ${geht.ok ? `
        <label class="schalter"><input type="checkbox" id="erinnerungAn" ${Z.erinnerung.an ? 'checked' : ''}><span>Erinnern um</span>
          <select id="erinnerungZeit">${['17:00', '18:00', '19:00', '20:00', '21:00', '22:00'].map((z) => `<option ${z === Z.erinnerung.uhrzeit ? 'selected' : ''}>${z}</option>`).join('')}</select> Uhr</label>
        <div class="schnell">${vorhanden.map((f) => `<button type="button" class="wahl ${auswahl.includes(f) ? 'an' : ''}" data-erinnern="${esc(f)}"><span class="punkt" style="background:${esc(farbeFuer(f))}"></span>${esc(namenFuer(f))}</button>`).join('')}</div>
        ${Z.erinnerung.an ? `<button class="textknopf" type="button" id="erinnerungTest">Test-Erinnerung senden</button>` : ''}
      ` : `<p class="leer">${esc(geht.grund)}</p>`}
    </article>
    ${Object.entries(monate).map(([m, liste]) => `
      <h3 class="monat">${esc(m)}</h3>
      <article class="karte termine-liste">${liste.map((t) => `
        <div class="termin">
          <span class="punkt" style="background:${esc(farbeFuer(t.fraktion))}"></span>
          <span class="t-tag">${esc(Termine.wann(t.datum))}</span>
          <span class="t-was">${esc(namenFuer(t.fraktion))}${t.erkannt === false ? ` <small>(${esc(t.bezeichnung)})</small>` : ''}</span>
        </div>`).join('')}</article>`).join('') || '<p class="leer">Keine kommenden Termine.</p>'}
    <div class="aktionen">
      ${Z.termine.quelle && Z.termine.quelle.url ? `<button class="knopf zweit klein" type="button" id="termineNeu">Aktualisieren</button>` : ''}
      <button class="knopf zweit klein" type="button" id="termineExport">In meinen Kalender</button>
      <button class="knopf zweit klein" type="button" id="termineQuelle">${Z.termineBearbeiten ? 'Fertig' : 'Andere Quelle'}</button>
      <button class="textknopf" type="button" id="termineWeg">Termine entfernen</button>
    </div>
    <p class="quelle">Quelle: ${esc(quelleText)} · Stand ${new Date(Z.termine.stand).toLocaleDateString('de-DE')}</p>`;
}

async function icsVonLink(url) {
  laden('Termine werden geladen …');
  try {
    const d = await P.api('/termine/ics', { daten: { url } });
    setzeTermine(d.termine, { art: 'url', url });
    Z.termineBearbeiten = false;
    zeichneTermine();
  } catch (f) { alert(f.message); } finally { laden(null); }
}

async function icsAusDatei(datei) {
  if (!datei) return;
  try {
    const liste = Termine.ausIcs(await datei.text());
    if (!liste.length) throw new Error('In der Datei stehen keine Termine.');
    Z.termineBearbeiten = false;
    setzeTermine(liste, { art: 'datei' });
  } catch (f) { alert(f.message); } finally { $('#icsDatei').value = ''; }
}

async function kalenderAusFoto(datei) {
  if (!datei) return;
  laden('Ich lese den Kalender …');
  try {
    const bild = await P.bildVerkleinern(datei, 2000, 0.88);
    const d = await P.api('/kalender-foto', { daten: { bild } });
    if (!d.termine.length) throw new Error(d.hinweis || 'Ich konnte keine Termine lesen. Versuch es mit einem schärferen Foto.');
    Z.termineBearbeiten = false;
    setzeTermine(d.termine.map((t) => ({ ...t, erkannt: true })).sort((a, b) => a.datum.localeCompare(b.datum)), { art: 'foto' });
    if (d.hinweis) alert(d.hinweis);
  } catch (f) { alert(f.message); } finally { laden(null); $('#kalenderFoto').value = ''; }
}

async function erinnerungEinrichten(still) {
  const e = Z.erinnerung;
  try {
    if (e.an && Z.termine) {
      await P.erinnerung.einrichten({ termine: Termine.kommende(Z.termine.liste, Termine.heute(), 400), uhrzeit: e.uhrzeit, auswahl: e.auswahl, namen: alleNamen() });
    } else {
      await P.erinnerung.beenden();
    }
  } catch (f) {
    e.an = false;
    if (!still) alert(f.message);
  }
  P.speicher.schreiben('erinnerung', e);
  if (Z.ansicht === 'termine') zeichneTermine();
}

/* ------------------------------ Region ------------------------------ */

function zeichneRatgeber() {
  const r = Z.ratgeber;
  if (!r || $('#ratgeber').childElementCount) return;
  const liste = (titel, punkte, art) => punkte && punkte.length
    ? `<h4>${titel}</h4><ul class="${art}">${punkte.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  $('#ratgeber').innerHTML = r.abschnitte.map((s) => {
    const f = Z.stamm.fraktionen[s.fraktion] || Z.stamm.fraktionen.rest;
    return `<details class="karte regel">
      <summary><span class="r-symbol">${tonneSvg(f.symbol, f.farbe)}</span>
        <span class="r-titel"><strong>${esc(s.titel)}</strong><small>${esc(s.kurz)}</small></span></summary>
      <div class="r-inhalt">
        ${liste('Gehört hinein', s.ja, 'ja')}
        ${liste('Gehört nicht hinein', s.nein, 'nein')}
        ${s.tipp ? `<p class="r-tipp">${esc(s.tipp)}</p>` : ''}
      </div></details>`;
  }).join('');
  const sv = r.service;
  if (sv) {
    $('#serviceKarte').innerHTML = `<article class="karte service">
      <p><strong>${esc(sv.titel)}</strong></p>
      <p class="leer">${esc(sv.text)}</p>
      <a class="nummer" href="tel:${esc(sv.nummer)}">${esc(sv.nummer)}</a>
      <p class="leer">${esc(sv.zeiten)}</p>
      <div class="aktionen"><a class="knopf" href="tel:${esc(sv.nummer)}">Jetzt anrufen</a>
        <button class="knopf zweit" type="button" data-link="${esc(sv.quelle)}">115.de</button></div>
    </article>`;
  }
}

function zeichneRegion() {
  zeichneRatgeber();
  const o = Z.ort, p = Z.profil;
  $('#ortZusammenfassung').textContent = o ? '· ' + (o.gemeinde || o.kreis) : '';
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
    const el = ev.target.closest('[data-zu],[data-link],[data-id],[data-ort],[data-melden],[data-korrigieren],[data-umgebung-laden],#zumMarkieren');
    if (!el) return;
    if (el.dataset.zu) { ev.preventDefault(); zeige(el.dataset.zu); }
    else if (el.dataset.link) { ev.preventDefault(); P.oeffne(el.dataset.link); }
    else if (el.dataset.id) {
      const e = Regeln.findeId(Z.index, el.dataset.id);
      $('#suchTreffer').hidden = true;
      if (e) zeigeEintrag({ ...e, n: el.dataset.wort || e.n }, el.dataset.lernen);
    } else if (el.dataset.ort !== undefined) {
      const t = $('#ortTreffer')._treffer[Number(el.dataset.ort)];
      if (t) ortWaehlen(t);
    } else if (el.dataset.korrigieren !== undefined) {
      korrekturStarten(el.dataset.korrigieren);
    } else if (el.dataset.umgebungLaden !== undefined) {
      const bereich = el.closest('[data-umgebung]');
      if (bereich) fuelleBereich(bereich);
    } else if (el.id === 'zumMarkieren') {
      markierenOeffnen();
    } else if (el.dataset.melden !== undefined) {
      // Bei Foto-Ergebnissen: richtigen Gegenstand wählen lassen (die Erkennung lernt mit)
      if (el.dataset.eid) korrekturStarten(el.dataset.eid);
      else melden(el.dataset.melden, el.dataset.name);
    }
  });

  // Korrektur abbrechen
  $('#korrekturAbbruch').addEventListener('click', korrekturEnde);

  // Sprachsuche
  $('#mikroKnopf').hidden = !P.sprache.moeglich;
  $('#mikroKnopf').addEventListener('click', sprachSuche);

  // Teile markieren: Rahmen ziehen, antippen löscht
  const fl = $('#markierBild');
  fl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const p = punktImBild(e);
    M.zieht = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    fl.setPointerCapture(e.pointerId);
  });
  fl.addEventListener('pointermove', (e) => {
    if (!M.zieht) return;
    const p = punktImBild(e);
    M.zieht.x2 = p.x; M.zieht.y2 = p.y;
    markierenZeichnen();
  });
  fl.addEventListener('pointerup', (e) => {
    if (!M.zieht) return;
    const r = M.zieht; M.zieht = null;
    const min = fl.width / 25;
    if (Math.abs(r.x2 - r.x1) < min || Math.abs(r.y2 - r.y1) < min) {
      // Antippen: Rahmen an dieser Stelle löschen
      const p = punktImBild(e);
      const i = M.rahmen.findIndex((q) => p.x >= Math.min(q.x1, q.x2) && p.x <= Math.max(q.x1, q.x2) && p.y >= Math.min(q.y1, q.y2) && p.y <= Math.max(q.y1, q.y2));
      if (i >= 0) M.rahmen.splice(i, 1);
    } else if (M.rahmen.length < 6) {
      M.rahmen.push(r);
    }
    markierenZeichnen();
  });
  $('#markierLeeren').addEventListener('click', () => { M.rahmen = []; markierenZeichnen(); });
  $('#markierErkennen').addEventListener('click', markierteErkennen);

  // Container in den Höfen umschalten
  $('#containerWahl').addEventListener('click', (e) => {
    const b = e.target.closest('[data-container]');
    if (!b) return;
    for (const x of $('#containerWahl').children) x.classList.toggle('an', x === b);
    Z.containerArt = b.dataset.container;
    zeichneContainer();
  });

  // Tipp auf den Ort oben: sofort den aktuellen Standort holen (anderen Ort wählen: Reiter „Region“)
  $('#ortChip').addEventListener('click', () => standortBestimmen(true));

  // Strichcode
  $('#barcodeKnopf').hidden = !Barcode.kannErkennen();
  $('#barcodeFoto').addEventListener('change', (e) => barcodeFoto(e.target.files[0]));
  $('#barcodeNummer').addEventListener('click', () => {
    const n = prompt('Nummer unter dem Strichcode (8 oder 13 Ziffern):');
    if (n) barcodeZeigen(n);
  });

  // Termine
  $('#icsLaden').addEventListener('click', () => {
    const url = $('#icsLink').value.trim();
    if (!url) { alert('Bitte zuerst den Kalender-Link einfügen.'); return; }
    icsVonLink(url);
  });
  $('#icsDatei').addEventListener('change', (e) => icsAusDatei(e.target.files[0]));
  $('#kalenderFoto').addEventListener('change', (e) => kalenderAusFoto(e.target.files[0]));
  const ti = $('#termineInhalt');
  ti.addEventListener('change', (e) => {
    if (e.target.id === 'erinnerungAn') { Z.erinnerung.an = e.target.checked; erinnerungEinrichten(false); }
    if (e.target.id === 'erinnerungZeit') { Z.erinnerung.uhrzeit = e.target.value; erinnerungEinrichten(false); }
  });
  ti.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.erinnern) {
      const alle = [...new Set(Z.termine.liste.map((t) => t.fraktion))];
      const a = new Set(Z.erinnerung.auswahl || alle);
      a.has(b.dataset.erinnern) ? a.delete(b.dataset.erinnern) : a.add(b.dataset.erinnern);
      Z.erinnerung.auswahl = [...a];
      if (Z.erinnerung.an) erinnerungEinrichten(false); else { P.speicher.schreiben('erinnerung', Z.erinnerung); zeichneTermine(); }
    } else if (b.id === 'erinnerungTest') {
      try { await P.erinnerung.test(); } catch (f) { alert(f.message); }
    } else if (b.id === 'termineNeu') {
      icsVonLink(Z.termine.quelle.url);
    } else if (b.id === 'termineExport') {
      P.speichereDatei('abfuhrtermine.ics', Termine.zuIcs(Termine.kommende(Z.termine.liste, Termine.heute(), 400), alleNamen()), 'text/calendar');
    } else if (b.id === 'termineQuelle') {
      Z.termineBearbeiten = !Z.termineBearbeiten;
      zeichneTermine();
    } else if (b.id === 'termineWeg') {
      if (!confirm('Alle Abfuhrtermine aus der App entfernen?')) return;
      Z.termine = null;
      P.speicher.schreiben('termine', null);
      Z.erinnerung.an = false;
      await erinnerungEinrichten(true);
      zeichneAbholung();
      zeichneTermine();
    }
  });
  $('#fotoEingabe').addEventListener('change', (e) => fotoAuswerten(e.target.files[0]));
  $('#standortNeu').addEventListener('click', async () => { laden('Standort wird bestimmt …'); await standortBestimmen(true); laden(null); zeichneRegion(); });

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

/* ------------------------------ Updates (native App) ------------------------------ */

let letztePruefung = 0;
function updatesPruefen() {
  if (!P.nativ || Date.now() - letztePruefung < 6 * 3600e3) return;
  letztePruefung = Date.now();
  P.updates.pruefen();
}
window.addEventListener('wohin-update', (e) => {
  const d = e.detail;
  const el = $('#updateHinweis');
  el.hidden = false;
  el.innerHTML = `<span>${esc(d.text)}</span>
    <button class="knopf klein" type="button" id="updateKnopf">${esc(d.knopf)}</button>
    ${d.pflicht ? '' : '<button class="textknopf" type="button" id="updateSpaeter">Später</button>'}`;
  $('#updateKnopf').onclick = () => (d.art === 'web' ? P.updates.jetztAnwenden(d.id) : P.oeffne(d.url));
  const spaeter = $('#updateSpaeter');
  if (spaeter) spaeter.onclick = () => { el.hidden = true; };
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) updatesPruefen(); });

async function start() {
  verdrahte();
  await ladeDaten();
  zeichneKopf();
  zeichneAbholung();
  if (location.hash === '#termine') zeige('termine');
  P.api('/health').then((h) => { Z.fotoAktiv = h.foto_ki === 'claude'; }).catch(() => { Z.fotoAktiv = false; });
  updatesPruefen();
  if (Z.ort) {
    beobachteRecherche();
    // Profil im Hintergrund auffrischen
    // (startet auf dem Server bei Bedarf die Recherche, z. B. wenn bisher nur Grundregeln vorlagen)
    P.api(`/ort?lat=${Z.ort.lat}&lon=${Z.ort.lon}`).then((d) => setzeRegion(d.ort, d.profil)).catch(() => {});
  } else {
    standortBestimmen();
  }
  if ('serviceWorker' in navigator && !P.nativ && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start();
