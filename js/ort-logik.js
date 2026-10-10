/* =====================================================================
   Wohin damit? – Ortslogik (gemeinsam für Server und App)
   Nominatim-Adresse → Ort/Region, Overpass-Abfrage für Wertstoffhöfe.
   Die App nutzt das direkt, wenn der eigene Server nicht erreichbar ist.
   ===================================================================== */
(function (wurzel, fabrik) {
  if (typeof module === 'object' && module.exports) module.exports = fabrik();
  else wurzel.Ortlogik = fabrik();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function slug(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /** Wandelt eine Nominatim-Adresse in unsere Ortsbeschreibung um. */
  function ausAdresse(a, lat, lon) {
    if (a.country_code && a.country_code !== 'de') return { ausserhalb: true, land: a.country || '' };
    const gemeinde = a.city || a.town || a.village || a.municipality || a.suburb || a.hamlet || '';
    const land = a.state || a.city || '';
    // Landkreis; bei kreisfreien Städten fehlt "county" → die Stadt ist selbst der Kreis.
    let kreis = a.county || '';
    let kreisArt = 'landkreis';
    if (!kreis) {
      kreis = a.city || a.town || a.state || gemeinde;
      kreisArt = 'kreisfreie_stadt';
    }
    return {
      key: `${slug(land)}/${slug(kreis)}`,
      kreis,
      kreis_art: kreisArt,
      gemeinde,
      ortsteil: a.suburb || a.village || '',
      bundesland: land,
      plz: a.postcode || '',
      lat: Number(lat),
      lon: Number(lon),
    };
  }

  /** Grundprofil, solange für eine Region nichts ermittelt ist (bundesweite Regeln). */
  function grundprofil(ort, status = 'allgemein') {
    return {
      key: ort.key, kreis: ort.kreis, bundesland: ort.bundesland,
      system: { verpackung: 'unbekannt', bio: 'unbekannt', papier: 'unbekannt' },
      abweichungen: [], wertstoffhoefe: [], behaelter: {},
      status,
    };
  }

  function overpassAbfrage(lat, lon, radius = 30000) {
    return `[out:json][timeout:20];(nwr["amenity"="recycling"]["recycling_type"="centre"](around:${radius},${lat},${lon}););out center tags 40;`;
  }

  /** Overpass-Antwort → Liste von Wertstoffhöfen. */
  function hoefeAusOverpass(d) {
    return (d.elements || []).map((e) => {
      const t = e.tags || {};
      const annahme = Object.keys(t).filter((k) => k.startsWith('recycling:') && t[k] === 'yes').map((k) => k.slice(10));
      return {
        name: t.name || t.operator || 'Wertstoffhof',
        betreiber: t.operator || null,
        adresse: [t['addr:street'] && `${t['addr:street']} ${t['addr:housenumber'] || ''}`.trim(), [t['addr:postcode'], t['addr:city']].filter(Boolean).join(' ')].filter(Boolean).join(', '),
        oeffnungszeiten_osm: t.opening_hours || null,
        telefon: t.phone || t['contact:phone'] || null,
        web: t.website || t['contact:website'] || null,
        annahme,
        lat: e.lat || (e.center && e.center.lat),
        lon: e.lon || (e.center && e.center.lon),
        quelle: 'OpenStreetMap',
      };
    }).filter((h) => h.lat && h.lon);
  }

  return { slug, ausAdresse, grundprofil, overpassAbfrage, hoefeAusOverpass };
});
