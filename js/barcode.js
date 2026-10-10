/* =====================================================================
   Wohin damit? – Strichcode → Verpackungsteile (Open Food Facts)
   Erkennung über die BarcodeDetector-Schnittstelle des Browsers (Android/Chrome),
   sonst Eingabe der Nummer. Verpackungsangaben kommen von Open Food Facts (ODbL).
   ===================================================================== */
(function (wurzel, fabrik) {
  if (typeof module === 'object' && module.exports) module.exports = fabrik();
  else wurzel.Barcode = fabrik();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const kannErkennen = () => typeof self !== 'undefined' && 'BarcodeDetector' in self;

  /** Strichcode aus einem Foto lesen (EAN/UPC). */
  async function ausFoto(datei) {
    if (!kannErkennen()) return null;
    const erkenner = new self.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    const bild = await createImageBitmap(datei);
    const treffer = await erkenner.detect(bild);
    bild.close && bild.close();
    return treffer.length ? treffer[0].rawValue : null;
  }

  // Material (Open-Food-Facts-Schlüssel oder Freitext) → Fraktion
  const MATERIAL = [
    [/glass|glas/i, 'glas'],
    [/paper|cardboard|carton|papier|pappe|karton|kraft/i, 'papier'],
    [/tetra|composite|verbund|beverage-carton|getränkekarton/i, 'verpackung'],
    [/plastic|pet|hdpe|ldpe|pp\b|ps\b|polypro|polyeth|kunststoff|plastik|film|folie/i, 'verpackung'],
    [/alumin|steel|metal|tin|weißblech|weissblech|alu|dose|can/i, 'verpackung'],
    [/wood|holz|cork|kork/i, 'rest'],
  ];
  const TEIL = { bottle: 'Flasche', jar: 'Glas', lid: 'Deckel', cap: 'Verschluss', box: 'Schachtel', bag: 'Beutel', tray: 'Schale',
    film: 'Folie', label: 'Etikett', can: 'Dose', pot: 'Becher', tub: 'Becher', sleeve: 'Banderole', wrapper: 'Verpackung',
    'brick': 'Getränkekarton', 'seal': 'Siegel', 'pouch': 'Beutel', 'packet': 'Packung', 'sachet': 'Tütchen',
    packaging: 'Verpackung', 'drink can': 'Getränkedose', 'bottle cap': 'Verschluss', 'individual dose': 'Einzelportion', 'wrapping': 'Verpackung' };

  // Materialbezeichnungen von Open Food Facts → Deutsch
  const DEUTSCH = [
    [/clear glass|white glass|colou?rless glass/i, 'Weißglas'], [/green glass/i, 'Grünglas'], [/brown glass|amber glass/i, 'Braunglas'], [/glass/i, 'Glas'],
    [/\bpet\b|polyethylene terephthalate/i, 'Kunststoff (PET)'], [/hdpe|high density/i, 'Kunststoff (HDPE)'], [/ldpe|low density/i, 'Kunststoff (LDPE)'],
    [/\bpp\b|polypropylene/i, 'Kunststoff (PP)'], [/\bps\b|polystyrene/i, 'Kunststoff (PS)'], [/plastic/i, 'Kunststoff'],
    [/alumin/i, 'Aluminium'], [/steel|tin/i, 'Weißblech'], [/metal/i, 'Metall'],
    [/c\/?pap|paper composite|composite|tetra/i, 'Verbundmaterial'], [/corrugated cardboard/i, 'Wellpappe'], [/cardboard|carton/i, 'Karton'], [/paper/i, 'Papier'],
    [/wood/i, 'Holz'], [/cork/i, 'Kork'],
  ];
  function deutsch(material) {
    for (const [re, d] of DEUTSCH) if (re.test(material)) return d;
    return material;
  }

  function fraktionFuer(text) {
    for (const [re, f] of MATERIAL) if (re.test(text)) return f;
    return null;
  }
  const ohneSprache = (s) => String(s || '').replace(/^[a-z]{2}:/, '').replace(/-/g, ' ');

  /** Produkt + Verpackungsteile von Open Food Facts. */
  async function produkt(code) {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,product_name_de,brands,packagings,packaging_tags,packaging,categories_tags`, {
      headers: { Accept: 'application/json' },
    });
    if (!r.ok && r.status !== 404) throw new Error('Produktdatenbank nicht erreichbar.');
    const d = await r.json();
    if (d.status !== 1 || !d.product) return null;
    const p = d.product;
    const teile = [];
    const getraenk = (p.categories_tags || []).some((c) => /beverages|getraenke|drinks|sodas|waters|beers|juices/.test(c));
    for (const v of p.packagings || []) {
      const material = ohneSprache(v.material);
      const form = ohneSprache(v.shape);
      // Ohne Materialangabe nur raten, wo die Form eindeutig ist (Dose); sonst weglassen
      const f = fraktionFuer(material) || (/can\b|dose/.test(form) ? 'verpackung' : null);
      if (!f) continue;
      // Einweg-Getränkedosen und -Kunststoffflaschen tragen in Deutschland Pfand
      const pfand = getraenk && (/can|dose/.test(form) || (/bottle|flasche/.test(form) && /plastic|pet|kunststoff/.test(material)));
      teile.push({ teil: TEIL[form] || (form ? form.charAt(0).toUpperCase() + form.slice(1) : 'Verpackung'), material: deutsch(material), fraktion: pfand ? 'pfand' : (f || 'verpackung'), sicher: Boolean(f), pfand });
    }
    if (!teile.length) {
      const tags = (p.packaging_tags || []).map(ohneSprache).join(' ') + ' ' + (p.packaging || '');
      const gesehen = new Set();
      for (const wort of tags.split(/[,\s]+/)) {
        const f = fraktionFuer(wort);
        if (f && !gesehen.has(f)) { gesehen.add(f); teile.push({ teil: 'Verpackung', material: deutsch(wort), fraktion: f, sicher: true }); }
      }
    }
    return {
      name: p.product_name_de || p.product_name || 'Unbekanntes Produkt',
      marke: (p.brands || '').split(',')[0].trim(),
      teile,
    };
  }

  return { kannErkennen, ausFoto, produkt, fraktionFuer };
});
