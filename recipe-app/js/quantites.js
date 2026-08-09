/* Lecture, addition et mise a l'echelle des quantites d'ingredients.
   Fonctions pures, sans DOM : testables sous Node.

   Les quantites du carnet sont du texte libre venu des sites sources. Sur les
   169 lignes d'ingredients on trouve « 200 g », « 8 », « 3 c. à s. », « 1/2 c. à c. »,
   « 3/4 l », mais aussi « Selon goût », « Pour le plat », « 130 g, plus pour le
   moule » ou « 1 pavés, environ 400 g ». Le principe retenu : ce qui se lit
   proprement est calcule, le reste est conserve mot pour mot et affiche a cote.
   Jamais de perte silencieuse d'information.

   Expose window.CarnetQuantites dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  // --- Table des unites -------------------------------------------------------
  //
  // `base` donne le facteur vers l'unite de reference de la famille (g ou ml).
  // Deux quantites ne s'additionnent que dans une meme famille. « c. à s. » et
  // « c. à c. » forment chacune leur propre famille : les convertir l'une en
  // l'autre supposerait une equivalence approximative qu'on ne veut pas inventer.

  var UNITES = [
    { nom: 'g', famille: 'masse', base: 1, alias: ['g', 'gr', 'gramme', 'grammes'] },
    { nom: 'kg', famille: 'masse', base: 1000, alias: ['kg', 'kilo', 'kilos', 'kilogramme', 'kilogrammes'] },

    { nom: 'ml', famille: 'volume', base: 1, alias: ['ml', 'millilitre', 'millilitres'] },
    { nom: 'cl', famille: 'volume', base: 10, alias: ['cl', 'centilitre', 'centilitres'] },
    { nom: 'dl', famille: 'volume', base: 100, alias: ['dl', 'decilitre', 'decilitres'] },
    { nom: 'l', famille: 'volume', base: 1000, alias: ['l', 'litre', 'litres'] },

    {
      nom: 'c. à s.',
      famille: 'cuillere-soupe',
      base: 1,
      alias: ['c. à s.', 'c. a s.', 'c à s', 'c a s', 'cs', 'cuillere à soupe', 'cuilleres à soupe', 'cuillere a soupe', 'cuilleres a soupe'],
    },
    {
      nom: 'c. à c.',
      famille: 'cuillere-cafe',
      base: 1,
      alias: ['c. à c.', 'c. a c.', 'c à c', 'c a c', 'cc', 'c. à café', 'c. a cafe', 'cuillere à café', 'cuilleres à café', 'cuillere a cafe', 'cuilleres a cafe'],
    },
  ];

  // Unites denombrables : chacune ne s'additionne qu'avec elle-meme. La chaine vide
  // correspond a une quantite sans unite (« 8 » capres, « 3 » oeufs).
  var DENOMBRABLES = [
    '',
    'gousse',
    'pincée',
    'morceau',
    'sachet',
    'verre',
    'rouleau',
    'tranche',
    'pavé',
    'feuille',
    'branche',
    'brin',
    'boule',
    'part',
    'tablette',
    'citron',
    'oeuf',
    'goutte',
    'bouquet',
    'botte',
    'bâton',
  ];

  /** Minuscules, sans accents, espaces normalises. */
  function clef(texte) {
    return String(texte || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /** Retire un « s » ou « x » final, pour que « gousses » vaille « gousse ». */
  function singulier(mot) {
    return mot.replace(/(s|x)$/i, '');
  }

  function trouverUnite(texte) {
    var k = clef(texte);
    if (k === '') return { nom: '', famille: 'denombrable:', base: 1 };

    for (var i = 0; i < UNITES.length; i += 1) {
      var u = UNITES[i];
      for (var j = 0; j < u.alias.length; j += 1) {
        if (clef(u.alias[j]) === k) return { nom: u.nom, famille: u.famille, base: u.base };
      }
    }

    var sing = singulier(k);
    for (var d = 0; d < DENOMBRABLES.length; d += 1) {
      if (clef(DENOMBRABLES[d]) === sing) {
        // On rend la forme canonique de la table, accentuee : « pincée » et non la
        // clef normalisee « pincee », qui s'afficherait sans accent.
        return { nom: DENOMBRABLES[d], famille: 'denombrable:' + sing, base: 1 };
      }
    }
    return null;
  }

  // --- Nombres ----------------------------------------------------------------

  /** Lit « 200 », « 1,5 », « 1.5 », « 3/4 ». Retourne null si ce n'est pas un nombre. */
  function lireNombre(texte) {
    var t = String(texte || '').trim().replace(',', '.');

    var fraction = t.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (fraction) {
      var d = Number(fraction[2]);
      return d === 0 ? null : Number(fraction[1]) / d;
    }

    if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
    return null;
  }

  /** Formate un nombre a la francaise : virgule decimale, pas de zero inutile. */
  function formatNombre(valeur) {
    if (typeof valeur !== 'number' || !isFinite(valeur)) return '';
    // Trois decimales au maximum, puis on retire les zeros de fin.
    var arrondi = Math.round(valeur * 1000) / 1000;
    var texte = String(arrondi);
    if (texte.indexOf('.') !== -1) texte = texte.replace(/0+$/, '').replace(/\.$/, '');
    return texte.replace('.', ',');
  }

  // --- Lecture d'une quantite -------------------------------------------------

  // Une fourchette : « 6 à 8 c. à c. », « 2-3 gousses ». Elle porte deux nombres, pas
  // un : la multiplier reviendrait a choisir lequel des deux compte, et la sommer a
  // additionner une valeur qui n'existe pas. Elle est donc traitee comme « Selon
  // goût » : conservee mot pour mot, jamais touchee.
  //
  // Sans cette regle, « 6 à 8 c. à c. » double en « 12, à 8 c. à c. », ce qui est
  // visiblement casse, et surtout personne ne s'en rend compte tant qu'on ne double
  // pas la recette.
  //
  // La forme « 6/8 » n'est volontairement pas reconnue comme une fourchette : elle est
  // indistinguable de la fraction six-huitiemes, et « 1/2 sachet » doit rester une
  // demie. Une source qui ecrit « 6/8 » pour « 6 a 8 » doit etre transcrite « 6 à 8 ».
  var FOURCHETTE = /^\d+(?:[.,]\d+)?\s*(?:à|a|-|–)\s*\d+(?:[.,]\d+)?(?:\s|$)/i;

  function estFourchette(texte) {
    return FOURCHETTE.test(String(texte || '').trim());
  }

  /**
   * Analyse une quantite ecrite.
   * Retourne { valeur, unite, famille, base, reste, brut, lisible }.
   * `lisible` vaut false quand aucun nombre n'a pu etre lu (« Selon goût ») :
   * la quantite est alors intouchable, ni additionnable ni multipliable.
   * `reste` porte le texte qui suit l'unite (« , plus pour le moule ») et qui est
   * toujours conserve.
   */
  function analyser(brut) {
    var texte = String(brut === null || brut === undefined ? '' : brut).trim();
    var vide = { valeur: null, unite: null, famille: null, base: 1, reste: texte, brut: texte, lisible: false };
    if (texte === '') return vide;
    if (estFourchette(texte)) return vide;

    // Nombre en tete : entier, decimal ou fraction.
    var tete = texte.match(/^(\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?)\s*(.*)$/);
    if (!tete) return vide;

    var valeur = lireNombre(tete[1]);
    if (valeur === null) return vide;

    var suite = tete[2].trim();

    // On cherche la plus longue unite reconnue en tete du reste, pour que
    // « c. à s. indiquée dans la béchamel » donne l'unite « c. à s. » et le reste
    // « indiquée dans la béchamel ».
    var meilleure = null;
    var mots = suite.split(/\s+/);
    for (var n = Math.min(4, mots.length); n >= 0; n -= 1) {
      var candidat = mots.slice(0, n).join(' ').replace(/[,;]$/, '');
      var unite = trouverUnite(candidat);
      if (unite) {
        meilleure = { unite: unite, reste: mots.slice(n).join(' ').replace(/^[,;]\s*/, '').trim() };
        break;
      }
    }

    if (!meilleure) {
      // Un nombre suivi de texte non reconnu : on garde le nombre et tout le reste.
      return { valeur: valeur, unite: '', famille: 'denombrable:', base: 1, reste: suite, brut: texte, lisible: true };
    }

    return {
      valeur: valeur,
      unite: meilleure.unite.nom,
      famille: meilleure.unite.famille,
      base: meilleure.unite.base,
      reste: meilleure.reste,
      brut: texte,
      lisible: true,
    };
  }

  /**
   * Accorde une unite denombrable au pluriel : « 3 gousse » se lit mal.
   * Ne concerne pas les unites de mesure, qui sont invariables (« 300 g »).
   */
  function pluriel(unite, valeur) {
    if (!unite || Math.abs(valeur) <= 1) return unite;

    var estDenombrable = DENOMBRABLES.some(function (d) {
      return d !== '' && clef(d) === clef(unite);
    });
    if (!estDenombrable) return unite;
    if (/(s|x)$/i.test(unite)) return unite;

    // « morceau » donne « morceaux », le reste prend un s.
    return /eau$/i.test(unite) ? unite + 'x' : unite + 's';
  }

  /** Reconstitue une quantite a partir d'une valeur, d'une unite et d'un reste. */
  function ecrire(valeur, unite, reste) {
    var morceaux = [formatNombre(valeur)];
    if (unite) morceaux.push(pluriel(unite, valeur));
    var texte = morceaux.join(' ');
    if (reste) texte += (/^[,;]/.test(reste) ? '' : ', ') + reste;
    return texte;
  }

  // --- Addition ---------------------------------------------------------------

  /** Unite d'affichage la plus lisible pour un total exprime en unite de base. */
  function uniteAffichage(famille, totalBase) {
    if (famille === 'masse') {
      return totalBase >= 1000 ? { nom: 'kg', base: 1000 } : { nom: 'g', base: 1 };
    }
    if (famille === 'volume') {
      if (totalBase >= 1000) return { nom: 'l', base: 1000 };
      if (totalBase >= 100 && totalBase % 10 === 0) return { nom: 'cl', base: 10 };
      return { nom: 'ml', base: 1 };
    }
    return null;
  }

  /**
   * Additionne des quantites ecrites.
   *
   * Ne fusionne que ce qui est de meme famille : « 300 g » et « 125 g » donnent
   * « 425 g », « 50 cl » et « 1 l » donnent « 1,5 l ». Ce qui n'est pas
   * additionnable est conserve tel quel et joint par « + » :
   * « 3 c. à s. » et « 200 g » donnent « 3 c. à s. + 200 g ».
   *
   * Une quantite seule est rendue mot pour mot : additionner ne doit pas reecrire
   * ce que personne n'a demande de changer.
   */
  function additionner(quantites) {
    var textes = (quantites || []).map(function (q) {
      return String(q === null || q === undefined ? '' : q).trim();
    });
    var utiles = textes.filter(function (t) {
      return t !== '';
    });

    if (utiles.length === 0) return '';
    if (utiles.length === 1) return utiles[0];

    var groupes = []; // { famille, total, premiere }
    var index = {};
    var intouchables = [];

    utiles.forEach(function (texte) {
      var q = analyser(texte);
      // Une quantite illisible, ou porteuse d'un commentaire, n'est pas additionnee :
      // « 130 g, plus pour le moule » ne peut pas se fondre dans un total sans
      // perdre son commentaire.
      if (!q.lisible || q.reste) {
        // Deux fois « Selon goût » ne fait pas « Selon goût + Selon goût ».
        if (intouchables.indexOf(texte) === -1) intouchables.push(texte);
        return;
      }
      if (!index[q.famille]) {
        index[q.famille] = { famille: q.famille, unite: q.unite, total: 0, nb: 0 };
        groupes.push(index[q.famille]);
      }
      index[q.famille].total += q.valeur * q.base;
      index[q.famille].nb += 1;
    });

    var morceaux = groupes.map(function (g) {
      var affichage = uniteAffichage(g.famille, g.total);
      if (affichage) return ecrire(g.total / affichage.base, affichage.nom, '');
      // Denombrables et cuillerees : l'unite ne change pas.
      return ecrire(g.total, g.unite, '');
    });

    return morceaux.concat(intouchables).join(' + ');
  }

  // --- Mise a l'echelle -------------------------------------------------------

  /**
   * Multiplie une quantite ecrite par un facteur.
   * Le texte residuel est conserve : « 130 g, plus pour le moule » multiplie par 2
   * donne « 260 g, plus pour le moule ». Une quantite sans nombre est rendue
   * inchangee : « Selon goût » reste « Selon goût ».
   */
  function echelonner(brut, facteur) {
    var q = analyser(brut);
    if (!q.lisible || typeof facteur !== 'number' || !isFinite(facteur) || facteur <= 0) {
      return String(brut === null || brut === undefined ? '' : brut);
    }
    return ecrire(arrondirUtile(q.valeur * facteur), q.unite, q.reste);
  }

  /**
   * Arrondi utile en cuisine : on evite les decimales inutiles sans mentir sur la
   * valeur. Au-dela de 10 on arrondit a l'entier, en dessous on garde une decimale.
   */
  function arrondirUtile(valeur) {
    if (valeur >= 10) return Math.round(valeur);
    return Math.round(valeur * 10) / 10;
  }

  // --- Mise a l'echelle dans du texte libre -----------------------------------
  //
  // Les instructions contiennent des nombres qu'il ne faut surtout PAS multiplier :
  // sur les 75 occurrences numeriques des 20 recettes, 69 sont des durees (minutes,
  // heures), des temperatures (°C) ou des dimensions (cm, mm) : seules 6 sont des
  // quantites. Doubler une recette ne double ni le temps de cuisson ni la
  // temperature du four.
  //
  // On travaille donc sur liste blanche : seules les unites de masse, de volume et
  // de cuilleree sont multipliees, et jamais un nombre nu (« thermostat 6 »,
  // « étape 2 » n'ont pas d'unite et resteraient ambigus).

  var UNITES_ECHELONNABLES = 'kg|kilos?|kilogrammes?|g|gr|grammes?|ml|millilitres?|cl|centilitres?|dl|litres?|l|c\\. à s\\.|c\\. a s\\.|c\\. à c\\.|c\\. a c\\.|cuillères? à soupe|cuillères? à café|gousses?|pincées?|sachets?|tranches?';

  var MOTIF_TEXTE = new RegExp('(\\d+(?:[.,]\\d+)?(?:\\s*/\\s*\\d+)?)(\\s*)(' + UNITES_ECHELONNABLES + ')(?![\\wàâäéèêëîïôöùûüç])', 'gi');

  /**
   * Multiplie les quantites trouvees dans un texte libre.
   * Retourne { texte, remplacements } pour qu'un appelant puisse montrer ce qui a
   * change avant d'enregistrer.
   */
  function echelonnerTexte(texte, facteur) {
    var source = String(texte === null || texte === undefined ? '' : texte);
    if (typeof facteur !== 'number' || !isFinite(facteur) || facteur <= 0 || facteur === 1) {
      return { texte: source, remplacements: [] };
    }

    var remplacements = [];
    var resultat = source.replace(MOTIF_TEXTE, function (tout, nombre, espace, unite) {
      var valeur = lireNombre(nombre);
      if (valeur === null) return tout;
      var nouveau = formatNombre(arrondirUtile(valeur * facteur)) + espace + unite;
      remplacements.push({ avant: tout, apres: nouveau });
      return nouveau;
    });

    return { texte: resultat, remplacements: remplacements };
  }

  // --- Portions ---------------------------------------------------------------

  /**
   * Lit un nombre de parts dans un texte libre : « 6 personnes » donne 6,
   * « 4 gros gourmands » donne 4, « 1 galette de 22 cm » donne 1.
   * Retourne { nombre, libelle } ou nombre vaut null si rien n'est lisible.
   */
  function analyserPortions(brut) {
    var texte = String(brut === null || brut === undefined ? '' : brut).trim();
    var m = texte.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
    if (!m) return { nombre: null, libelle: texte };
    return { nombre: lireNombre(m[1]), libelle: m[2].trim() };
  }

  /** Reecrit un texte de portions avec un nouveau nombre, en gardant le libelle. */
  function ecrirePortions(nombre, libelle) {
    var texte = formatNombre(nombre);
    return libelle ? texte + ' ' + libelle : texte;
  }

  var api = {
    UNITES: UNITES,
    DENOMBRABLES: DENOMBRABLES,
    clef: clef,
    lireNombre: lireNombre,
    formatNombre: formatNombre,
    analyser: analyser,
    estFourchette: estFourchette,
    ecrire: ecrire,
    pluriel: pluriel,
    additionner: additionner,
    echelonner: echelonner,
    echelonnerTexte: echelonnerTexte,
    arrondirUtile: arrondirUtile,
    analyserPortions: analyserPortions,
    ecrirePortions: ecrirePortions,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.CarnetQuantites = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
