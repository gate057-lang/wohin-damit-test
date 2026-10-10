/* =====================================================================
   Wohin damit? – Öffnungszeiten im OpenStreetMap-Format auswerten
   Unterstützt die häufigen Formen: "Mo-Fr 08:00-12:00,13:00-17:00; Sa 09:00-12:00",
   "24/7", "off", deutsche Tageskürzel (Mo, Di, Mi, Do, Fr, Sa, So).
   Komplexe Regeln (Monate, Wochen, Feiertage) → null (= unbekannt).
   ===================================================================== */
(function (wurzel, fabrik) {
  if (typeof module === 'object' && module.exports) module.exports = fabrik();
  else wurzel.Oeffnung = fabrik();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TAGE = { mo: 0, tu: 1, we: 2, th: 3, fr: 4, sa: 5, su: 6, di: 1, mi: 2, do: 3, so: 6 };
  const NAMEN = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  function minuten(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  }

  /** Liefert eine Wochentabelle: 7 Listen mit [von, bis] in Minuten, oder null. */
  function parse(text) {
    if (!text) return null;
    const t = String(text).trim();
    if (t === '24/7') return Array.from({ length: 7 }, () => [[0, 1440]]);
    const woche = Array.from({ length: 7 }, () => []);
    for (let regel of t.split(';')) {
      regel = regel.trim();
      if (!regel) continue;
      if (/^(PH|SH)\b/i.test(regel)) continue; // Feiertage ignorieren
      const m = /^([A-Za-z]{2}(?:\s*-\s*[A-Za-z]{2})?(?:\s*,\s*[A-Za-z]{2}(?:\s*-\s*[A-Za-z]{2})?)*)\s+(.+)$/.exec(regel);
      if (!m) return null;
      const tage = [];
      for (const teil of m[1].split(',')) {
        const [a, b] = teil.split('-').map((x) => TAGE[x.trim().toLowerCase()]);
        if (a === undefined || (b === undefined && teil.includes('-'))) return null;
        if (b === undefined) tage.push(a);
        else for (let i = a; ; i = (i + 1) % 7) { tage.push(i); if (i === b) break; }
      }
      const zeiten = m[2].trim();
      if (/^(off|closed|geschlossen)$/i.test(zeiten)) { tage.forEach((d) => { woche[d] = []; }); continue; }
      const spannen = [];
      for (const z of zeiten.split(',')) {
        const [von, bis] = z.split('-').map(minuten);
        if (!Number.isFinite(von) || !Number.isFinite(bis)) return null;
        spannen.push([von, bis === 0 ? 1440 : bis]);
      }
      tage.forEach((d) => { woche[d] = spannen; });
    }
    return woche;
  }

  const zeit = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

  /** Jetzt geöffnet? → { offen, text } oder null, wenn unbekannt. */
  function status(text, jetzt = new Date()) {
    const woche = parse(text);
    if (!woche) return null;
    const tag = (jetzt.getDay() + 6) % 7;
    const min = jetzt.getHours() * 60 + jetzt.getMinutes();
    for (const [von, bis] of woche[tag]) {
      if (min >= von && min < bis) {
        const rest = bis - min;
        return { offen: true, text: rest <= 60 ? `Offen, schließt in ${rest} Min.` : `Offen bis ${zeit(bis)}` };
      }
    }
    for (let i = 0; i < 8; i++) {
      const d = (tag + i) % 7;
      const spannen = woche[d].filter(([von]) => i > 0 || von > min).sort((a, b) => a[0] - b[0]);
      if (spannen.length) {
        const wann = i === 0 ? 'heute' : i === 1 ? 'morgen' : NAMEN[d];
        return { offen: false, text: `Geschlossen · öffnet ${wann} ${zeit(spannen[0][0])}` };
      }
    }
    return { offen: false, text: 'Geschlossen' };
  }

  /** Macht OSM-Öffnungszeiten lesbar: eine Regel pro Zeile, deutsche Tage und Monate. */
  function lesbar(text) {
    if (!text) return '';
    const TAG = { Mo: 'Mo', Tu: 'Di', We: 'Mi', Th: 'Do', Fr: 'Fr', Sa: 'Sa', Su: 'So' };
    const MONAT = { Jan: 'Jan', Feb: 'Feb', Mar: 'Mär', Apr: 'Apr', May: 'Mai', Jun: 'Jun', Jul: 'Jul', Aug: 'Aug', Sep: 'Sep', Oct: 'Okt', Nov: 'Nov', Dec: 'Dez' };
    return String(text).split(';').map((r) => r.trim()).filter(Boolean).map((r) => r
      // häufige Sommer-/Winterzeit-Regeln (Zeitumstellung = letzter Sonntag im März/Oktober)
      .replace(/^Mar Su\[-1\]\s*-\s*Oct Su\[-1\](\s*-1 days?)?:?\s*/i, 'Sommer: ')
      .replace(/^Oct Su\[-1\]\s*-\s*Mar Su\[-1\](\s*-1 days?)?:?\s*/i, 'Winter: ')
      .replace(/^([A-Z][a-z]{2})\s*-\s*([A-Z][a-z]{2})\s*:?\s+(?=[A-Z][a-z])/, '$1–$2: ')
      .replace(/^PH\s+off$/i, 'Feiertags geschlossen')
      .replace(/^PH\s+/i, 'Feiertags ')
      .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)\[-1\]/g, (_, t) => `letzter ${TAG[t]}`)
      .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)\[(\d)\]/g, (_, t, n) => `${n}. ${TAG[t]}`)
      .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/g, (t) => TAG[t])
      .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g, (m) => MONAT[m])
      .replace(/\boff\b/g, 'geschlossen')
      .replace(/-/g, '–')
      .replace(/,(?=\d)/g, ', ')
      .replace(/(\d{2}:\d{2})–(\d{2}:\d{2})/g, '$1–$2')
    ).join('\n');
  }

  return { parse, status, lesbar };
});
