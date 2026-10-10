/* =====================================================================
   Wohin damit? – Abfuhrtermine
   ICS/iCal einlesen, Termine einer Tonnenart zuordnen, nächste Abholung.
   Läuft im Browser (window.Termine) und im Server (require).
   ===================================================================== */
(function (wurzel, fabrik) {
  if (typeof module === 'object' && module.exports) module.exports = fabrik();
  else wurzel.Termine = fabrik();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Reihenfolge zählt: spezifische Begriffe zuerst
  const MUSTER = [
    ['schadstoff', /schadstoff|problemm[uü]ll|problemabfall|sonderm[uü]ll|giftm[uü]ll/i],
    ['sperrmuell', /sperrm[uü]ll|sperrgut/i],
    ['elektro', /elektro|e-schrott|elektronik/i],
    ['gruengut', /gr[uü]ngut|gr[uü]nschnitt|gartenabf|baumschnitt|christbaum|weihnachtsbaum|laub/i],
    ['textil', /altkleider|textil/i],
    ['glas', /altglas|\bglas\b/i],
    ['verpackung', /gelb|verpackung|wertstoff|leichtverp|lvp|dsd|duales/i],
    ['papier', /papier|pappe|blaue tonne|\bpapp|\bpp[kt]\b|altpap/i],
    ['bio', /\bbio|braune tonne|kompost|organik/i],
    ['rest', /rest|hausm[uü]ll|graue tonne|schwarze tonne|\brm\b/i],
  ];

  /** Ordnet einen Kalendertext einer Fraktion zu (oder null). */
  function fraktionAus(text) {
    for (const [f, re] of MUSTER) if (re.test(text || '')) return f;
    return null;
  }

  function entfalte(ics) {
    // RFC 5545: Fortsetzungszeilen beginnen mit Leerzeichen oder Tab
    return String(ics).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  }

  function datumAus(wert) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(wert || '');
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }

  function unescape(t) {
    return String(t || '').replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
  }

  /** ICS-Text → [{datum, fraktion, bezeichnung}] (sortiert, ohne Duplikate). */
  function ausIcs(ics) {
    if (!/BEGIN:VCALENDAR/.test(ics)) throw new Error('Das ist keine Kalenderdatei (ICS).');
    const termine = [];
    const bloecke = entfalte(ics).split('BEGIN:VEVENT').slice(1);
    for (const b of bloecke) {
      const zeile = (name) => {
        const m = new RegExp('^' + name + '(?:;[^:\\n]*)?:(.*)$', 'm').exec(b);
        return m ? m[1].trim() : '';
      };
      const datum = datumAus(zeile('DTSTART'));
      const titel = unescape(zeile('SUMMARY'));
      if (!datum || !titel) continue;
      const fraktion = fraktionAus(titel) || fraktionAus(unescape(zeile('DESCRIPTION'))) || fraktionAus(unescape(zeile('CATEGORIES')));
      termine.push({ datum, fraktion: fraktion || 'rest', bezeichnung: titel.slice(0, 80), erkannt: Boolean(fraktion) });
    }
    const gesehen = new Set();
    return termine
      .filter((t) => { const k = t.datum + '|' + t.bezeichnung; if (gesehen.has(k)) return false; gesehen.add(k); return true; })
      .sort((a, b) => a.datum.localeCompare(b.datum));
  }

  /** Heutiges Datum in Berlin als JJJJ-MM-TT. */
  function heute(jetzt = new Date()) {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(jetzt);
  }

  function kommende(termine, ab = heute(), max = 50) {
    return (termine || []).filter((t) => t.datum >= ab).slice(0, max);
  }

  /** Nächster Termin für eine Fraktion. */
  function naechster(termine, fraktion, ab = heute()) {
    return (termine || []).find((t) => t.datum >= ab && t.fraktion === fraktion) || null;
  }

  const TAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  /** „heute“, „morgen“ oder „Do, 16.10.“ */
  function wann(datum, ab = heute()) {
    const d = new Date(datum + 'T12:00:00');
    const h = new Date(ab + 'T12:00:00');
    const diff = Math.round((d - h) / 864e5);
    if (diff === 0) return 'heute';
    if (diff === 1) return 'morgen';
    return `${TAGE[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;
  }

  /** Termine → ICS-Text (Export in den eigenen Kalender, mit Erinnerung am Vorabend). */
  function zuIcs(termine, namen) {
    const z = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Wohin damit?//DE', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Abfuhrtermine'];
    for (const t of termine) {
      const d = t.datum.replace(/-/g, '');
      const n = new Date(t.datum + 'T12:00:00'); n.setDate(n.getDate() + 1);
      const ende = n.toISOString().slice(0, 10).replace(/-/g, '');
      z.push('BEGIN:VEVENT', `UID:${d}-${t.fraktion}@wohin.velasync.de`, `DTSTAMP:${d}T000000Z`,
        `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${ende}`, `SUMMARY:${(namen && namen[t.fraktion]) || t.bezeichnung}`,
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Tonne rausstellen', 'TRIGGER:-PT5H', 'END:VALARM', 'END:VEVENT');
    }
    z.push('END:VCALENDAR');
    return z.join('\r\n');
  }

  return { fraktionAus, ausIcs, heute, kommende, naechster, wann, zuIcs };
});
