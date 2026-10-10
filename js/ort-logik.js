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

  /* ---------- Umgebung: Container und „Verschenken statt wegwerfen“ ---------- */

  const UMGEBUNG = {
    // Altglas- und Altkleidercontainer (OSM: amenity=recycling + recycling_type=container)
    glas: { radius: 4000, teile: [
      'nwr["amenity"="recycling"]["recycling_type"="container"]["recycling:glass_bottles"="yes"]',
      'nwr["amenity"="recycling"]["recycling_type"="container"]["recycling:glass"="yes"]',
    ] },
    textil: { radius: 6000, teile: [
      'nwr["amenity"="recycling"]["recycling_type"="container"]["recycling:clothes"="yes"]',
      'nwr["amenity"="recycling"]["recycling_type"="container"]["recycling:shoes"="yes"]',
    ] },
    // Sozialkaufhäuser, Second-Hand, Verschenkboxen, Bücherschränke, Repair-Cafés
    verschenken: { radius: 12000, teile: [
      'nwr["shop"~"^(charity|second_hand)$"]',
      'nwr["amenity"~"^(give_box|public_bookcase|repair_cafe)$"]',
      'nwr["repair"="assisted_self_service"]',
    ] },
  };

  /** Rechteckiger Suchbereich statt Kreis – für Overpass deutlich schneller. */
  function umgebungAbfrage(art, lat, lon) {
    const u = UMGEBUNG[art];
    if (!u) throw new Error('Unbekannte Art');
    const la = Number(lat), lo = Number(lon);
    const dLat = u.radius / 111320, dLon = u.radius / (111320 * Math.cos(la * Math.PI / 180));
    const bbox = [la - dLat, lo - dLon, la + dLat, lo + dLon].map((x) => x.toFixed(5)).join(',');
    const teile = u.teile.map((t) => `${t}(${bbox});`).join('');
    return `[out:json][timeout:25];(${teile});out center tags 80;`;
  }

  function artVon(t) {
    if (t.amenity === 'give_box') return 'Verschenkbox';
    if (t.amenity === 'public_bookcase') return 'Bücherschrank';
    if (t.amenity === 'repair_cafe' || t.repair === 'assisted_self_service') return 'Repair-Café';
    if (t.shop === 'charity') return 'Sozialkaufhaus';
    if (t.shop === 'second_hand') return 'Second-Hand';
    if (t['recycling:clothes'] === 'yes' || t['recycling:shoes'] === 'yes') return 'Altkleidercontainer';
    if (t['recycling:glass_bottles'] === 'yes' || t['recycling:glass'] === 'yes') return 'Altglascontainer';
    return 'Ort';
  }

  /** Overpass-Antwort → Orte (ohne Koordinatenlose), sortiert nach Entfernung vom Punkt. */
  function umgebungAusOverpass(d, lat, lon, gesucht) {
    const r = Math.PI / 180;
    const km = (a, b) => 12742 * Math.asin(Math.sqrt(Math.sin((b.lat - a.lat) * r / 2) ** 2 +
      Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2));
    const gesehen = new Set();
    return (d.elements || []).map((e) => {
      const t = e.tags || {};
      const p = { lat: e.lat || (e.center && e.center.lat), lon: e.lon || (e.center && e.center.lon) };
      const art = gesucht === 'glas' ? 'Altglascontainer' : gesucht === 'textil' ? 'Altkleidercontainer' : artVon(t);
      return {
        art,
        name: t.name || t.operator || art,
        adresse: [t['addr:street'] && `${t['addr:street']} ${t['addr:housenumber'] || ''}`.trim(), t['addr:city']].filter(Boolean).join(', '),
        oeffnungszeiten_osm: t.opening_hours || null,
        web: t.website || t['contact:website'] || null,
        lat: p.lat, lon: p.lon,
        km: p.lat ? km({ lat: Number(lat), lon: Number(lon) }, p) : null,
      };
    }).filter((o) => o.lat && o.lon)
      .filter((o) => { const k = o.lat.toFixed(4) + o.lon.toFixed(4); if (gesehen.has(k)) return false; gesehen.add(k); return true; })
      .sort((a, b) => a.km - b.km)
      .slice(0, 12);
  }

  return { slug, ausAdresse, grundprofil, overpassAbfrage, hoefeAusOverpass, umgebungAbfrage, umgebungAusOverpass, UMGEBUNG_ARTEN: Object.keys(UMGEBUNG) };
});
