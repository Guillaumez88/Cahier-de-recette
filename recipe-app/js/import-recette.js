/* Import d'une recette trouvée sur internet.

   ## Pourquoi on ne peut pas simplement donner un lien

   Le carnet est un site statique : il n'a pas de serveur qui pourrait aller
   chercher la page à sa place. Et un `fetch` direct depuis le navigateur vers
   `marmiton.org` est **bloqué par le navigateur lui-même** : sans en-tête
   `Access-Control-Allow-Origin`, la réponse n'est jamais lisible. Ce n'est pas
   un défaut à corriger, c'est la règle qui empêche n'importe quel site de lire
   le contenu d'un autre en votre nom, et aucun site de recettes ne l'assouplit.

   Ce module ne va donc jamais chercher quoi que ce soit. Il reçoit **du texte
   déjà obtenu** (le contenu de la page, collé, ou le JSON extrait par le
   marque-page) et en tire une recette. C'est `app.js` qui décide comment ce
   texte arrive.

   ## Ce qu'il lit

   La quasi-totalité des sites de cuisine publient leur recette en
   `schema.org/Recipe`, au format JSON-LD, dans une balise
   `<script type="application/ld+json">`. C'est une norme, pas une convention
   propre à un site : la lire donne un import qui marche partout au lieu d'un
   analyseur par site, qui casserait à chaque refonte.

   Un repli lit les microdonnées (`itemprop="recipeIngredient"`) pour les sites
   restés sur cette forme plus ancienne.

   ## Ce qu'il ne fait jamais

   **Il n'invente rien.** Un temps de préparation absent reste « Non indiqué »
   et la fiche le déclare dans `manquants`, comme pour les recettes saisies à la
   main. Une quantité qu'il ne sait pas lire est conservée mot pour mot dans le
   nom de l'ingrédient plutôt que d'être devinée. Une catégorie inconnue tombe
   sur « Plat » **et le dit**, plutôt que de se faire passer pour une donnée de
   la source.

   Expose window.CarnetImport dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  var estNode = typeof module !== 'undefined' && module.exports;
  var Quantites = estNode ? require('./quantites.js') : global.CarnetQuantites;

  // --- Extraction du JSON-LD ---------------------------------------------------

  /**
   * Tous les blocs `application/ld+json` d'une page, analysés.
   *
   * Le découpage se fait par expression régulière et non par le DOM : ce module
   * doit tourner sous Node pour être testé, et surtout, construire un DOM à partir
   * d'un HTML étranger exécuterait ses `<script>` et chargerait ses images.
   */
  function blocsJsonLd(html) {
    var blocs = [];
    var motif = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    var trouve;
    while ((trouve = motif.exec(String(html || '')))) {
      var brut = trouve[1].trim();
      if (brut === '') continue;
      try {
        blocs.push(JSON.parse(brut));
      } catch (erreur) {
        // Un bloc mal formé ne doit pas faire échouer les autres : certaines pages
        // en portent trois, dont un cassé.
      }
    }
    return blocs;
  }

  function typesDe(objet) {
    var t = objet && (objet['@type'] || objet.type);
    if (!t) return [];
    return (Array.isArray(t) ? t : [t]).map(function (x) {
      return String(x).toLowerCase();
    });
  }

  /** Parcourt un JSON-LD, y compris `@graph` et les tableaux, et rend la recette. */
  function chercherRecette(noeud, profondeur) {
    if (!noeud || profondeur > 6) return null;

    if (Array.isArray(noeud)) {
      for (var i = 0; i < noeud.length; i += 1) {
        var trouve = chercherRecette(noeud[i], profondeur + 1);
        if (trouve) return trouve;
      }
      return null;
    }

    if (typeof noeud !== 'object') return null;
    if (typesDe(noeud).indexOf('recipe') !== -1) return noeud;

    if (noeud['@graph']) return chercherRecette(noeud['@graph'], profondeur + 1);
    // `mainEntity` porte la recette sur les pages qui declarent d'abord un WebPage.
    if (noeud.mainEntity) return chercherRecette(noeud.mainEntity, profondeur + 1);
    if (noeud.mainEntityOfPage && typeof noeud.mainEntityOfPage === 'object') {
      return chercherRecette(noeud.mainEntityOfPage, profondeur + 1);
    }
    return null;
  }

  /** La recette schema.org d'une page, ou null. */
  function recetteJsonLd(html) {
    var blocs = blocsJsonLd(html);
    for (var i = 0; i < blocs.length; i += 1) {
      var trouve = chercherRecette(blocs[i], 0);
      if (trouve) return trouve;
    }
    return null;
  }

  // --- Repli : microdonnees ----------------------------------------------------

  function texteBalise(fragment) {
    return decoderEntites(String(fragment || '').replace(/<[^>]*>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Valeurs d'un `itemprop` dans un HTML, dans l'ordre d'apparition.
   *
   * Deux formes coexistent et il faut les deux : une balise ordinaire dont le corps
   * porte la valeur, et une balise vide (`<meta itemprop="prepTime" content="PT15M">`)
   * qui n'a pas de fermeture. Ne chercher que la premiere faisait perdre tous les
   * temps, qui sont presque toujours ecrits en `meta`.
   */
  function microdonnees(html, propriete) {
    var texte = String(html || '');
    var trouvees = [];

    // Balises vides : meta, link, et toute balise auto-fermante.
    var vide = new RegExp(
      '<(?:meta|link)[^>]*itemprop\\s*=\\s*["\']' + propriete + '["\'][^>]*>',
      'gi'
    );
    var t;
    while ((t = vide.exec(texte))) {
      var contenu = /content\s*=\s*["']([^"']*)["']/i.exec(t[0]);
      if (contenu) trouvees.push({ position: t.index, valeur: decoderEntites(contenu[1]) });
    }

    // Balises ordinaires, dont le corps porte la valeur.
    var pleine = new RegExp(
      '<([a-z0-9]+)[^>]*itemprop\\s*=\\s*["\']' + propriete + '["\'][^>]*>([\\s\\S]*?)<\\/\\1>',
      'gi'
    );
    while ((t = pleine.exec(texte))) {
      var attribut = /content\s*=\s*["']([^"']*)["']/i.exec(t[0]);
      var valeur = attribut ? decoderEntites(attribut[1]) : texteBalise(t[2]);
      if (valeur) trouvees.push({ position: t.index, valeur: valeur });
    }

    // L'ordre du document, et non l'ordre des deux passes : les ingredients doivent
    // sortir dans l'ordre de la liste.
    return trouvees
      .sort(function (a, b) {
        return a.position - b.position;
      })
      .map(function (x) {
        return x.valeur;
      });
  }

  // Les entites HTML sont **sensibles a la casse** : `&Eacute;` est un E majuscule
  // accentue, `&eacute;` un e minuscule. Les confondre transformait « Éplucher » en
  // « éplucher » en tete d'etape.
  var ENTITES = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    rsquo: '’',
    lsquo: '‘',
    ldquo: '“',
    rdquo: '”',
    laquo: '«',
    raquo: '»',
    deg: '°',
    hellip: '…',
    ndash: '–',
    mdash: '—',
    frac12: '½',
    frac14: '¼',
    frac34: '¾',
  };

  // Les lettres accentuees, dans les deux casses, construites une fois.
  [
    ['eacute', 'é', 'É'],
    ['egrave', 'è', 'È'],
    ['ecirc', 'ê', 'Ê'],
    ['euml', 'ë', 'Ë'],
    ['agrave', 'à', 'À'],
    ['acirc', 'â', 'Â'],
    ['aelig', 'æ', 'Æ'],
    ['ccedil', 'ç', 'Ç'],
    ['ocirc', 'ô', 'Ô'],
    ['oelig', 'œ', 'Œ'],
    ['ouml', 'ö', 'Ö'],
    ['ucirc', 'û', 'Û'],
    ['ugrave', 'ù', 'Ù'],
    ['uuml', 'ü', 'Ü'],
    ['icirc', 'î', 'Î'],
    ['iuml', 'ï', 'Ï'],
  ].forEach(function (e) {
    ENTITES[e[0]] = e[1];
    // « Eacute » : premiere lettre en majuscule, c'est la forme employee par HTML.
    ENTITES[e[0].charAt(0).toUpperCase() + e[0].slice(1)] = e[2];
  });

  function decoderEntites(texte) {
    return String(texte || '')
      .replace(/&#(\d+);/g, function (tout, code) {
        return String.fromCharCode(Number(code));
      })
      .replace(/&#x([0-9a-f]+);/gi, function (tout, code) {
        return String.fromCharCode(parseInt(code, 16));
      })
      .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, function (tout, nom) {
        // Correspondance exacte d'abord, puis en minuscules pour les entites sans
        // accent (`&AMP;`), tolerees par les navigateurs.
        if (Object.prototype.hasOwnProperty.call(ENTITES, nom)) return ENTITES[nom];
        var bas = String(nom).toLowerCase();
        return Object.prototype.hasOwnProperty.call(ENTITES, bas) ? ENTITES[bas] : tout;
      });
  }

  // --- Conversions -------------------------------------------------------------

  /**
   * Durée ISO 8601 (« PT1H20M ») vers le format du carnet (« 1 h 20 min »).
   * Rend null pour tout ce qui ne se lit pas : mieux vaut « Non indiqué » qu'un
   * zéro qui passerait pour une durée mesurée.
   */
  function dureeIso(valeur) {
    var texte = String(valeur || '').trim().toUpperCase();
    var trouve = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(texte);
    if (!trouve) return null;

    var minutes = (Number(trouve[1] || 0) * 24 + Number(trouve[2] || 0)) * 60 + Number(trouve[3] || 0);
    if (minutes <= 0) return null;

    var heures = Math.floor(minutes / 60);
    var reste = minutes % 60;
    if (heures === 0) return reste + ' min';
    if (reste === 0) return heures + ' h';
    return heures + ' h ' + (reste < 10 ? '0' + reste : reste);
  }

  function premier(valeur) {
    if (Array.isArray(valeur)) return valeur.length ? premier(valeur[0]) : null;
    return valeur === undefined || valeur === null || valeur === '' ? null : valeur;
  }

  function texteDe(valeur) {
    var v = premier(valeur);
    if (v === null) return null;
    if (typeof v === 'object') {
      var interne = v.name || v.text || v['@value'] || v.url;
      return interne ? decoderEntites(String(interne)).trim() : null;
    }
    return decoderEntites(String(v)).replace(/\s+/g, ' ').trim() || null;
  }

  /**
   * Découpe « 200 g d'olives noires » en quantité et nom.
   *
   * Le carnet range la quantité à part du nom, la source les écrit ensemble.
   * L'analyse réutilise `quantites.js`, donc les mêmes règles que partout : ce qui
   * ne se lit pas proprement reste dans le nom, mot pour mot, plutôt que d'être
   * deviné. « Selon goût » ou « Sel » n'ont pas de quantité, et c'est correct.
   */
  function decouperIngredient(ligne) {
    var texte = decoderEntites(String(ligne || '')).replace(/\s+/g, ' ').trim();
    if (texte === '') return null;

    var lu = Quantites.analyser(texte);
    if (!lu.lisible) return { nom: texte, quantite: '' };

    var nom = String(lu.reste || '').replace(/^(?:de\s+la\s+|de\s+l['’]|d['’]|de\s+|du\s+|des\s+)/i, '').trim();
    if (nom === '') return { nom: texte, quantite: '' };

    var quantite = Quantites.ecrire(lu.valeur, lu.unite, '');
    // Une unité vide donne « 3 » seul : c'est la forme du carnet pour un dénombrable.
    return { nom: nom.charAt(0).toUpperCase() + nom.slice(1), quantite: quantite };
  }

  /** Les étapes, quelle que soit la forme employée par la source. */
  function etapesDe(valeur) {
    var lignes = [];

    function ajouter(v) {
      if (!v) return;
      if (Array.isArray(v)) return v.forEach(ajouter);
      if (typeof v === 'object') {
        // HowToSection porte ses etapes dans `itemListElement`.
        if (v.itemListElement) return ajouter(v.itemListElement);
        var t = v.text || v.name;
        if (t) lignes.push(decoderEntites(String(t)));
        return;
      }
      // Une chaine unique porte souvent plusieurs etapes separees par des sauts de
      // ligne ou numerotees : les recoller en une seule etape serait illisible.
      String(v)
        .split(/\r?\n+/)
        .forEach(function (morceau) {
          lignes.push(decoderEntites(morceau));
        });
    }

    ajouter(valeur);

    return lignes
      .map(function (l) {
        return String(l).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      })
      .filter(function (l) {
        return l !== '';
      })
      .map(function (l, i) {
        return { numero: i + 1, texte: l, astuce: null };
      });
  }

  // Les trois categories du carnet. Une source dit « Dessert », « Plat principal »,
  // « Entrée froide »… : on rapproche sur des mots, et ce qui ne correspond a rien
  // tombe sur « Plat » en le declarant, plutot que de se faire passer pour une
  // donnee de la source.
  var CATEGORIES = [
    [/dessert|gateau|gâteau|patisserie|pâtisserie|sucre|sucré|goûter|gouter/i, 'Dessert'],
    [/entr[ée]e|ap[ée]ritif|amuse|hors.d.oeuvre|salade/i, 'Entrée'],
    [/plat|principal|r[ée]sistance|accompagnement/i, 'Plat'],
  ];

  function categorieDe(valeur) {
    var texte = texteDe(valeur);
    if (!texte) return null;
    for (var i = 0; i < CATEGORIES.length; i += 1) {
      if (CATEGORIES[i][0].test(texte)) return CATEGORIES[i][1];
    }
    return null;
  }

  function portionsDe(valeur) {
    var texte = texteDe(valeur);
    if (!texte) return null;
    // « 6 » seul, forme la plus repandue, devient « 6 personnes ». Une valeur qui
    // porte deja son unite (« 6 parts », « 1 tarte ») est gardee telle quelle.
    if (/^\d+$/.test(texte)) return texte + ' personne' + (Number(texte) > 1 ? 's' : '');
    return texte;
  }

  function caloriesDe(nutrition) {
    if (!nutrition || typeof nutrition !== 'object') return null;
    var texte = texteDe(nutrition.calories);
    if (!texte) return null;
    var nombre = /(\d+)/.exec(texte);
    return nombre ? Number(nombre[1]) : null;
  }

  // --- Assemblage --------------------------------------------------------------

  /**
   * Construit une recette du carnet a partir d'un objet schema.org/Recipe.
   *
   * Rend { recette, manquants } : `manquants` liste ce que la source ne donne pas,
   * et il est recopie dans la fiche. C'est la regle du projet : un trou se declare,
   * il ne se comble pas.
   */
  function depuisSchema(objet, url) {
    var manquants = [];

    var titre = texteDe(objet.name) || texteDe(objet.headline);
    if (!titre) return { erreur: 'la page ne donne pas de titre de recette' };

    var ingredients = []
      .concat(objet.recipeIngredient || objet.ingredients || [])
      .map(decouperIngredient)
      .filter(Boolean);
    if (ingredients.length === 0) {
      return { erreur: 'la page ne donne aucun ingrédient : ce n’est probablement pas une fiche recette' };
    }

    var instructions = etapesDe(objet.recipeInstructions);
    if (instructions.length === 0) {
      manquants.push('La source ne donne aucune étape de préparation : la fiche est à compléter à la main.');
    }

    var preparation = dureeIso(objet.prepTime);
    var cuisson = dureeIso(objet.cookTime);
    var total = dureeIso(objet.totalTime);
    if (!preparation) manquants.push('La source ne donne pas de temps de préparation.');
    if (!cuisson) manquants.push('La source ne donne pas de temps de cuisson.');
    if (!total && (preparation || cuisson)) {
      manquants.push(
        'La source ne donne pas de temps total. Il n’a pas été calculé : additionner préparation et ' +
          'cuisson supposerait qu’elles ne se chevauchent pas, ce que la source ne dit pas.'
      );
    }
    if (!total && !preparation && !cuisson) {
      manquants.push('La source ne donne aucune durée : la recette sort des filtres de temps.');
    }

    var categorie = categorieDe(objet.recipeCategory);
    if (!categorie) {
      categorie = 'Plat';
      manquants.push(
        'La source ne donne pas de catégorie exploitable : « Plat » a été retenu par défaut, à corriger si besoin.'
      );
    }

    var portions = portionsDe(objet.recipeYield);
    if (!portions) {
      portions = 'Non indiqué';
      manquants.push(
        'La source ne donne pas de nombre de parts : le recalcul automatique des quantités est indisponible ' +
          'tant qu’il n’est pas renseigné.'
      );
    }

    var origine = texteDe(objet.recipeCuisine);
    var calories = caloriesDe(objet.nutrition);
    var auteur = texteDe(objet.author) || texteDe(objet.publisher);

    var adresse = url || texteDe(objet.url) || texteDe(objet['@id']) || '';
    if (!/^https?:\/\//.test(adresse)) adresse = '';
    if (!adresse) {
      manquants.push('L’adresse de la source n’a pas pu être relevée : la fiche ne peut pas y renvoyer.');
    }

    var quantitesVides = ingredients.filter(function (i) {
      return i.quantite === '';
    }).length;
    if (quantitesVides > 0) {
      manquants.push(
        quantitesVides +
          (quantitesVides > 1 ? ' ingrédients n’ont pas de quantité lisible' : ' ingrédient n’a pas de quantité lisible') +
          ' : la source les écrit sans nombre, ou dans une forme non reconnue. Le texte d’origine est conservé.'
      );
    }

    return {
      recette: {
        id: '',
        titre: titre,
        categorie: categorie,
        origine: origine || 'Non indiquée',
        difficulte: 'Non indiquée',
        portions: portions,
        temps: {
          preparation: preparation || 'Non indiqué',
          cuisson: cuisson || 'Non indiqué',
          repos: 'Non indiqué',
          total: total || 'Non indiqué',
        },
        calories: calories,
        source: { label: auteur ? titre + ' — ' + auteur : titre, url: adresse },
        ingredients: [{ groupe: null, items: ingredients }],
        instructions: instructions,
        astuces: { recette: [], commentaires: [] },
        variantes: { recette: [], associees: [] },
        manquants: manquants,
        flowTable: { headers: [], rows: [] },
      },
      manquants: manquants,
    };
  }

  /** Repli sur les microdonnees, pour les pages restees sur cette forme. */
  function depuisMicrodonnees(html, url) {
    var titre = microdonnees(html, 'name')[0];
    var ingredients = microdonnees(html, 'recipeIngredient').concat(microdonnees(html, 'ingredients'));
    if (!titre || ingredients.length === 0) return null;

    return depuisSchema(
      {
        name: titre,
        recipeIngredient: ingredients,
        recipeInstructions: microdonnees(html, 'recipeInstructions'),
        recipeYield: microdonnees(html, 'recipeYield')[0],
        recipeCategory: microdonnees(html, 'recipeCategory')[0],
        recipeCuisine: microdonnees(html, 'recipeCuisine')[0],
        prepTime: microdonnees(html, 'prepTime')[0],
        cookTime: microdonnees(html, 'cookTime')[0],
        totalTime: microdonnees(html, 'totalTime')[0],
        author: microdonnees(html, 'author')[0],
      },
      url
    );
  }

  /**
   * Point d'entree : rend { recette, manquants } ou { erreur }.
   *
   * `contenu` est soit le HTML d'une page, soit un JSON-LD deja extrait (ce que
   * rend le marque-page). `url` est l'adresse d'origine, quand on la connait.
   */
  function importer(contenu, url) {
    var texte = String(contenu || '').trim();
    if (texte === '') return { erreur: 'rien n’a été collé' };

    // Un JSON colle directement, sans balise autour.
    if (texte.charAt(0) === '{' || texte.charAt(0) === '[') {
      try {
        var direct = chercherRecette(JSON.parse(texte), 0);
        if (direct) return depuisSchema(direct, url);
      } catch (erreur) {
        /* pas du JSON : on continue avec les autres formes */
      }
    }

    var schema = recetteJsonLd(texte);
    if (schema) return depuisSchema(schema, url);

    var micro = depuisMicrodonnees(texte, url);
    if (micro) return micro;

    return {
      erreur:
        'aucune recette n’a été trouvée dans ce contenu. La page ne publie peut-être pas sa recette au format ' +
        'schema.org, ou la copie est incomplète : sélectionnez toute la page (Ctrl+A) avant de copier.',
    };
  }

  var api = {
    blocsJsonLd: blocsJsonLd,
    recetteJsonLd: recetteJsonLd,
    microdonnees: microdonnees,
    decoderEntites: decoderEntites,
    dureeIso: dureeIso,
    decouperIngredient: decouperIngredient,
    etapesDe: etapesDe,
    categorieDe: categorieDe,
    portionsDe: portionsDe,
    depuisSchema: depuisSchema,
    importer: importer,
  };

  if (estNode) module.exports = api;
  else global.CarnetImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
