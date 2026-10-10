/* =====================================================================
   Wohin damit? – Regelwerk
   Entscheidet aus Lexikon-Eintrag + Regionsprofil, wohin etwas gehört.
   Läuft identisch im Browser (window.Regeln) und in Node (require).
   ===================================================================== */
(function (wurzel, fabrik) {
  if (typeof module === 'object' && module.exports) module.exports = fabrik();
  else wurzel.Regeln = fabrik();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Nur für den internen Vergleich: Kleinschreibung, Umlaut-Varianten angleichen. */
  function falte(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function abstand(a, b) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > 2) return 9;
    const z = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let vorher = z[0];
      z[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = z[j];
        z[j] = Math.min(z[j] + 1, z[j - 1] + 1, vorher + (a[i - 1] === b[j - 1] ? 0 : 1));
        vorher = tmp;
      }
    }
    return z[b.length];
  }

  /** Suchindex über Name + Synonyme aufbauen. */
  function baueIndex(lexikon) {
    const eintraege = lexikon.eintraege || lexikon;
    return eintraege.map((e) => {
      const original = [e.n, ...(e.s || [])];
      return { e, original, begriffe: original.map(falte) };
    });
  }

  /** Lexikonsuche mit Tippfehlertoleranz. Liefert sortierte Treffer;
      `wort` ist der Begriff, der am besten gepasst hat (z. B. „Kühlschrank“). */
  function suche(index, anfrage, max = 8) {
    const q = falte(anfrage);
    if (!q) return [];
    const treffer = [];
    for (const { e, original, begriffe } of index) {
      let wert = 0, wort = e.n;
      const merke = (w, i) => { if (w > wert) { wert = w; wort = original[i]; } };
      begriffe.forEach((b, i) => {
        if (b === q) merke(100, i);
        else if (b.startsWith(q)) merke(80 - (b.length - q.length) * 0.5, i);
        else if (b.includes(q) && q.length >= 3) merke(60, i);
        else if (q.length >= 4) {
          const toleranz = q.length >= 7 ? 2 : 1;
          for (const teil of b.split(' ')) if (abstand(teil, q) <= toleranz) merke(50, i);
        }
      });
      if (wert > 0) treffer.push({ e, wort, wert: wert + (falte(e.n) === q ? 5 : 0) });
    }
    return treffer.sort((a, b) => b.wert - a.wert).slice(0, max)
      .map((t) => ({ ...t.e, wort: t.wort.charAt(0).toUpperCase() + t.wort.slice(1) }));
  }

  function findeId(index, id) {
    const t = index.find((x) => x.e.id === id);
    return t ? t.e : null;
  }

  /**
   * Kern: Wohin gehört dieser Eintrag in dieser Region?
   * eintrag: Lexikon-Eintrag ({id, n, f, h, sg}) oder freie Angabe ({n, f, h})
   * profil:  Regionsprofil (darf fehlen → Bundes-Grundregel)
   * stamm:   Inhalt von fraktionen.json
   */
  function entscheide(eintrag, profil, stamm) {
    const fr = stamm.fraktionen;
    const sys = (profil && profil.system) || {};
    let fraktion = eintrag.f in fr ? eintrag.f : 'rest';
    let hinweis = eintrag.h || '';
    let quelle = profil && profil.status === 'ermittelt' ? 'region' : 'allgemein';
    let regionsHinweis = '';
    let regionsQuelle = null;

    // 1. Ausdrückliche Abweichung der Region für genau diesen Begriff
    const abw = (profil && profil.abweichungen || []).find(
      (a) => (a.lexikon_id && a.lexikon_id === eintrag.id) ||
             (a.begriff && falte(a.begriff) === falte(eintrag.n))
    );
    if (abw) {
      if (abw.fraktion && abw.fraktion in fr) fraktion = abw.fraktion;
      if (abw.hinweis) regionsHinweis = abw.hinweis;
      regionsQuelle = abw.quelle || null;
      quelle = 'region';
    }

    let behaelter = fr[fraktion].behaelter;
    let symbol = fr[fraktion].symbol;

    // 2. Stoffgleiche Nichtverpackungen in Regionen mit Wertstofftonne
    if (!abw && eintrag.sg && sys.verpackung === 'wertstofftonne') {
      fraktion = 'verpackung';
      behaelter = 'Wertstofftonne';
      symbol = 'tonne';
      regionsHinweis = 'In deiner Region gehören auch Gegenstände aus Kunststoff oder Metall, die keine Verpackung sind, in die Wertstofftonne.';
    }

    // 3. Sammelsystem der Region (gelber Sack/Tonne, Biotonne ja/nein, …)
    const systeme = stamm.systeme || {};
    if (systeme[fraktion]) {
      const art = sys[fraktion] || 'unbekannt';
      const s = systeme[fraktion][art] || systeme[fraktion].unbekannt;
      if (s) {
        if (s.fraktion_ersatz && s.fraktion_ersatz in fr) {
          regionsHinweis = regionsHinweis || 'In deiner Region gibt es keine Biotonne.';
          fraktion = s.fraktion_ersatz;
          behaelter = s.behaelter;
          symbol = fr[fraktion].symbol;
        } else if (behaelter !== 'Wertstofftonne') {
          behaelter = s.behaelter;
          if (s.symbol) symbol = s.symbol;
        }
      }
    }

    // 4. Eigene Behälternamen und Farben der Region
    const eigen = profil && profil.behaelter && profil.behaelter[fraktion];
    let farbe = fr[fraktion].farbe;
    if (eigen) {
      if (eigen.name) behaelter = eigen.name;
      if (eigen.farbe) farbe = eigen.farbe;
    }

    return {
      gegenstand: eintrag.n,
      lexikon_id: eintrag.id || null,
      fraktion,
      fraktion_name: fr[fraktion].name,
      behaelter,
      farbe,
      symbol,
      hinweis,
      regions_hinweis: regionsHinweis,
      regions_quelle: regionsQuelle,
      quelle,
      verschenkbar: Boolean(eintrag.v),
    };
  }

  return { falte, baueIndex, suche, findeId, entscheide };
});
