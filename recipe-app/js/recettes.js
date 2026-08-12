/* Recettes : version d'origine, modifications partagees, mise a l'echelle.

   Le carnet a deux sources :
   - data/recipes.json, le fichier d'origine servi avec le site, en lecture seule ;
   - la collection Firestore `recettes`, qui contient les recettes modifiees.

   Une recette modifiee remplace entierement l'originale. « Reinitialiser » supprime
   la version modifiee, ce qui fait reapparaitre l'originale : aucune modification
   n'est donc irreversible, et le fichier d'origine n'est jamais touche.

   Les modifications sont partagees comme la liste de courses, et recopiees en local
   pour que le carnet reste consultable sans reseau.

   Note assumee : les modifications sont relues au chargement de la page et apres
   chaque enregistrement, pas en continu. Une recette modifiee sur un autre appareil
   apparait donc au prochain rafraichissement de la page. Sonder les recettes toutes
   les cinq secondes couterait des lectures Firestore pour des donnees qui changent
   quelques fois par mois.

   Expose window.CarnetRecettes dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  var estNode = typeof module !== 'undefined' && module.exports;
  var Sync = estNode ? require('./sync.js') : global.CarnetSync;
  var Q = estNode ? require('./quantites.js') : global.CarnetQuantites;
  var Flux = estNode ? require('./flux.js') : global.CarnetFlux;

  var CLE_CACHE = 'carnet-de-recettes:recettes-modifiees';

  var base = []; // recettes d'origine, telles que servies par le site
  var abonnes = [];

  var etat = { erreur: null, chargeLe: null };

  function surChangement(rappel) {
    abonnes.push(rappel);
  }

  function notifier() {
    abonnes.forEach(function (rappel) {
      try {
        rappel();
      } catch (erreur) {
        /* un abonne fautif ne bloque pas les autres */
      }
    });
  }

  // --- Cache local des modifications ------------------------------------------

  function lireCache() {
    try {
      var brut = global.localStorage && global.localStorage.getItem(CLE_CACHE);
      if (!brut) return {};
      var valeur = JSON.parse(brut);
      return valeur && typeof valeur === 'object' && !Array.isArray(valeur) ? valeur : {};
    } catch (erreur) {
      return {};
    }
  }

  function ecrireCache(modifiees) {
    try {
      if (global.localStorage) global.localStorage.setItem(CLE_CACHE, JSON.stringify(modifiees));
    } catch (erreur) {
      /* quota atteint : les modifications restent en memoire pour la session */
    }
    notifier();
    return modifiees;
  }

  // --- Chargement --------------------------------------------------------------

  /** Fixe les recettes d'origine, lues dans data/recipes.json. */
  function definirBase(recettes) {
    base = Array.isArray(recettes) ? recettes : [];
    return base;
  }

  function idsDeBase() {
    var index = {};
    base.forEach(function (r) {
      index[r.id] = true;
    });
    return index;
  }

  /**
   * Liste effective : les recettes d'origine, celles modifiees remplacant les leurs,
   * suivies de celles creees depuis l'application.
   *
   * L'ordre du fichier d'origine est conserve pour que le livre ne se reorganise pas
   * a chaque modification. Les recettes ajoutees viennent ensuite, par titre : elles
   * n'ont pas de rang dans le fichier d'origine, il faut donc un ordre stable qui ne
   * depende pas de l'ordre de lecture de Firestore.
   */
  function toutes() {
    var modifiees = lireCache();
    var deBase = idsDeBase();

    var liste = base.map(function (recette) {
      return modifiees[recette.id] || recette;
    });

    var ajoutees = Object.keys(modifiees)
      .filter(function (id) {
        return !deBase[id];
      })
      .map(function (id) {
        return modifiees[id];
      })
      .filter(function (recette) {
        return recette && recette.id && recette.titre;
      })
      .sort(function (a, b) {
        return String(a.titre).localeCompare(String(b.titre), 'fr');
      });

    return liste.concat(ajoutees);
  }

  // --- Le livre de cuisine et les livres de la bibliotheque ---------------------
  //
  // Une recette porte deux champs facultatifs, tous deux ranges dans son document
  // comme le reste de la recette (elle est enregistree en une seule chaine JSON, il
  // n'y a donc rien a changer dans sync.js ni dans firestore.rules) :
  //
  //   livre    identifiant du livre de la bibliotheque auquel elle est rattachee.
  //            Absent pour les recettes du livre de cuisine, qui est la reference.
  //   auLivre  vraie quand une recette de livre a ete remontee dans le livre de
  //            cuisine, ce qui la rend planifiable. Absente sinon.
  //
  // Pourquoi un drapeau et pas une copie : tout le chemin du planning est synchrone,
  // de la reserve de plats au PDF du menu en passant par l'ajout aux courses de la
  // semaine. Une recette remontee doit donc etre lisible immediatement, sans
  // chargement, ce qu'un drapeau sur une recette deja en cache garantit. Et rien ne
  // se duplique : corriger la recette la corrige partout.

  /** L'identifiant du livre d'une recette, ou null si elle est du livre de cuisine. */
  function livreDe(id) {
    var recette = parId(id);
    return recette && recette.livre ? String(recette.livre) : null;
  }

  /** Vrai si cette recette de livre a ete remontee dans le livre de cuisine. */
  function estRemontee(id) {
    var recette = parId(id);
    return Boolean(recette && recette.livre && recette.auLivre);
  }

  /**
   * Le livre de cuisine : la reference, et la seule source du planning.
   *
   * Les recettes d'origine, celles ajoutees a la main, et celles qu'on a remontees
   * depuis un livre de la bibliotheque. Rien d'autre : c'est tout l'objet de la
   * bibliotheque que d'exister a cote sans encombrer la semaine.
   */
  function duLivreDeCuisine() {
    return toutes().filter(function (r) {
      return !r.livre || r.auLivre;
    });
  }

  /** Les recettes rattachees a un livre donne, remontees ou non. */
  function duLivre(livreId) {
    return toutes().filter(function (r) {
      return r.livre === livreId;
    });
  }

  /** Toutes les recettes de la bibliotheque, tous livres confondus. */
  function deLaBibliotheque() {
    return toutes().filter(function (r) {
      return Boolean(r.livre);
    });
  }

  /** Table { livreId: nombre de recettes }, pour les cartes de la bibliotheque. */
  function comptesParLivre() {
    var table = {};
    toutes().forEach(function (r) {
      if (!r.livre) return;
      table[r.livre] = (table[r.livre] || 0) + 1;
    });
    return table;
  }

  /**
   * Deplace une recette d'une etagere a une autre.
   *
   * `versLivre` est l'identifiant du livre d'arrivee, ou null pour le livre de cuisine.
   * Le rattachement est le seul champ touche : la recette, ses ingredients, sa photo et
   * son historique dans le semainier ne bougent pas, la photo etant rangee sous
   * l'identifiant de la recette et non sous celui du livre.
   *
   * Deux garde-fous. Une recette **d'origine** ne peut pas entrer dans un livre : elle
   * vit dans le fichier servi avec le site, et la sortir du livre de cuisine la ferait
   * simplement reapparaitre a la prochaine lecture, en double. Et deplacer vers le
   * livre de cuisine retire `auLivre`, qui n'a plus d'objet : une recette du livre de
   * cuisine y est, elle n'y est pas « remontee ».
   */
  function deplacerVersLivre(id, versLivre) {
    var recette = parId(id);
    if (!recette) return Promise.reject(new Error('cette recette n’existe pas'));

    var cible = versLivre ? String(versLivre) : null;
    var actuel = recette.livre || null;
    if (cible === actuel) return Promise.resolve(recette);

    if (!cible && idsDeBase()[id]) {
      // Cas impossible en pratique (une recette d'origine n'a pas de livre), mais la
      // regle est ecrite : le fichier d'origine est la reference.
      return Promise.resolve(recette);
    }
    if (cible && idsDeBase()[id]) {
      return Promise.reject(
        new Error(
          'cette recette vient du carnet d’origine : elle ne peut pas être rangée dans un livre, ' +
            'elle réapparaîtrait dans le livre de cuisine à la prochaine mise à jour.'
        )
      );
    }

    var copie = JSON.parse(JSON.stringify(recette));
    if (cible) copie.livre = cible;
    else {
      delete copie.livre;
      delete copie.auLivre;
    }
    return enregistrer(copie);
  }

  /**
   * Remonte une recette de livre dans le livre de cuisine, ou la redescend.
   *
   * Refuse pour une recette qui n'est pas dans un livre : le livre de cuisine est
   * deja son unique place, et un drapeau y serait sans objet.
   */
  function remonter(id, dedans) {
    var recette = parId(id);
    if (!recette) return Promise.reject(new Error('cette recette n’existe pas'));
    if (!recette.livre) {
      return Promise.reject(new Error('cette recette est déjà dans le livre de cuisine'));
    }

    var copie = JSON.parse(JSON.stringify(recette));
    if (dedans) copie.auLivre = true;
    else delete copie.auLivre;
    return enregistrer(copie);
  }

  function parId(id) {
    var trouvee = null;
    toutes().forEach(function (r) {
      if (r.id === id) trouvee = r;
    });
    return trouvee;
  }

  /** Version d'origine d'une recette, indépendamment des modifications. */
  function originale(id) {
    var trouvee = null;
    base.forEach(function (r) {
      if (r.id === id) trouvee = r;
    });
    return trouvee;
  }

  function estModifiee(id) {
    return Object.prototype.hasOwnProperty.call(lireCache(), id);
  }

  /**
   * Une recette ajoutee depuis l'application n'existe pas dans data/recipes.json.
   * La distinction compte a l'ecran : une recette d'origine modifiee peut etre
   * reinitialisee, une recette ajoutee ne peut qu'etre supprimee, et le dire
   * evite de proposer un « Rétablir l'original » qui n'a pas d'original.
   */
  function estAjoutee(id) {
    return estModifiee(id) && !idsDeBase()[id];
  }

  /** Relit les modifications depuis Firestore. Hors ligne, garde le cache local. */
  async function rafraichir() {
    try {
      var distantes = await Sync.lireRecettesModifiees();
      etat.erreur = null;
      etat.chargeLe = Date.now();
      return ecrireCache(distantes);
    } catch (erreur) {
      etat.erreur = erreur.message;
      notifier();
      return lireCache();
    }
  }

  function etatChargement() {
    return { erreur: etat.erreur, chargeLe: etat.chargeLe, nbModifiees: Object.keys(lireCache()).length };
  }

  // --- Enregistrement ---------------------------------------------------------

  /** Enregistre une recette modifiee. Le cache local est mis a jour immediatement. */
  async function enregistrer(recette) {
    var modifiees = lireCache();
    modifiees[recette.id] = recette;
    ecrireCache(modifiees);

    try {
      await Sync.ecrireRecette(recette);
      etat.erreur = null;
    } catch (erreur) {
      // La modification reste visible en local ; elle sera perdue au prochain
      // rafraichissement reussi si l'envoi n'a jamais abouti. On le signale plutot
      // que de laisser croire que c'est enregistre.
      etat.erreur = erreur.message;
    }
    notifier();
    return recette;
  }

  // --- Creation ---------------------------------------------------------------

  function slug(texte) {
    return String(texte || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // Les ligatures ne se decomposent pas en NFD : sans elles, « Œufs mimosa » donne
      // « ufs-mimosa ». Defaut trouve en ajoutant la bibliotheque, corrige ici aussi.
      .replace(/œ/g, 'oe')
      .replace(/Œ/g, 'OE')
      .replace(/æ/g, 'ae')
      .replace(/Æ/g, 'AE')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .toLowerCase();
  }

  /**
   * Identifiant libre derive du titre. Si le slug est deja pris, un rang est
   * ajoute : deux recettes portant le meme nom sont possibles et ne doivent pas
   * s'ecraser l'une l'autre.
   */
  function idLibre(titre) {
    var racine = slug(titre) || 'recette';
    var pris = idsDeBase();
    Object.keys(lireCache()).forEach(function (id) {
      pris[id] = true;
    });
    if (!pris[racine]) return racine;
    for (var n = 2; n < 200; n += 1) {
      if (!pris[racine + '-' + n]) return racine + '-' + n;
    }
    return racine + '-' + Date.now();
  }

  /**
   * Squelette d'une recette vide, pour l'ecran de creation.
   *
   * `livre` rattache la nouvelle recette a un livre de la bibliotheque. La source
   * prend alors le titre de l'ouvrage : une recette venue d'un livre papier a une
   * source, et c'est ce livre. Sans lui, la recette est du livre de cuisine.
   */
  function recetteVide(livre) {
    return {
      livre: livre && livre.id ? livre.id : undefined,
      id: '',
      titre: '',
      categorie: 'Plat',
      origine: 'Non indiquée',
      difficulte: 'Non indiquée',
      portions: '4 personnes',
      temps: { preparation: 'Non indiqué', cuisson: 'Non indiqué', repos: 'Non indiqué', total: 'Non indiqué' },
      calories: null,
      // Tableau nutritionnel : absent par defaut. La plupart des recettes n'en ont pas,
      // et un tableau vide s'afficherait comme une section sans contenu. Voir
      // L.lignesNutrition pour la forme attendue.
      nutrition: null,
      source: { label: livre && livre.titre ? livre.titre : 'Recette de la maison', url: '' },
      ingredients: [{ groupe: null, items: [] }],
      instructions: [],
      astuces: { recette: [], commentaires: [] },
      variantes: { recette: [], associees: [] },
      manquants: [],
      // Pas de tableau fourni : l'application reconstitue le deroule depuis les
      // etapes, comme pour les recettes des extractions recentes.
      flowTable: { headers: [], rows: [] },
    };
  }

  /**
   * Enregistre une nouvelle recette. Le titre est obligatoire : c'est la seule
   * donnee sans laquelle la fiche serait introuvable dans le livre.
   * Retourne la recette creee, avec son identifiant.
   */
  async function creer(brouillon) {
    var titre = String((brouillon && brouillon.titre) || '').trim();
    if (titre === '') throw new Error('une recette a besoin d’un titre');

    var recette = JSON.parse(JSON.stringify(brouillon));
    recette.titre = titre;
    recette.id = idLibre(titre);
    await enregistrer(recette);
    return recette;
  }

  /**
   * Supprime definitivement une recette ajoutee depuis l'application.
   * Refuse de toucher a une recette d'origine : celle-ci vit dans le fichier servi
   * avec le site, la supprimer de Firestore la ferait simplement reapparaitre a la
   * prochaine lecture. Pour celles-la, c'est `reinitialiser` qu'il faut.
   */
  async function supprimer(id) {
    if (idsDeBase()[id]) {
      throw new Error('cette recette vient du carnet d’origine : elle peut être rétablie, pas supprimée');
    }
    return reinitialiser(id);
  }

  /** Supprime la version modifiee : la recette d'origine reprend sa place. */
  async function reinitialiser(id) {
    var modifiees = lireCache();
    delete modifiees[id];
    ecrireCache(modifiees);

    try {
      await Sync.supprimerRecette(id);
      etat.erreur = null;
    } catch (erreur) {
      etat.erreur = erreur.message;
    }
    notifier();
    return originale(id);
  }

  // --- Mise a l'echelle -------------------------------------------------------

  /**
   * Recalcule une recette pour un nouveau nombre de parts.
   *
   * Retourne { possible, facteur, recette, remplacements, ignorees } ou :
   * - `possible` vaut false si le nombre de parts d'origine n'est pas lisible ;
   * - `remplacements` liste les quantites modifiees dans les instructions, pour
   *   qu'on puisse les montrer avant d'enregistrer ;
   * - `ignorees` liste les ingredients dont la quantite n'etait pas chiffrable
   *   (« Selon goût ») et qui restent donc inchanges.
   *
   * Les durees et les temperatures des instructions ne sont jamais touchees :
   * doubler une recette ne double pas le temps de cuisson. Voir la liste blanche
   * d'unites dans quantites.js.
   */
  function echelonner(recette, nouveauNombre) {
    var portions = Q.analyserPortions(recette.portions);
    if (portions.nombre === null || portions.nombre <= 0) {
      return { possible: false, facteur: 1, recette: recette, remplacements: [], ignorees: [] };
    }
    if (typeof nouveauNombre !== 'number' || !isFinite(nouveauNombre) || nouveauNombre <= 0) {
      return { possible: false, facteur: 1, recette: recette, remplacements: [], ignorees: [] };
    }

    var facteur = nouveauNombre / portions.nombre;
    var remplacements = [];
    var ignorees = [];

    var copie = JSON.parse(JSON.stringify(recette));
    copie.portions = Q.ecrirePortions(nouveauNombre, portions.libelle);

    (copie.ingredients || []).forEach(function (groupe) {
      (groupe.items || []).forEach(function (item) {
        var avant = item.quantite;
        var analyse = Q.analyser(avant);
        if (!analyse.lisible) {
          ignorees.push(item.nom);
          return;
        }
        item.quantite = Q.echelonner(avant, facteur);
      });
    });

    // Le tableau de flux fourni avec la recette porte lui aussi des quantites :
    // elles doivent suivre, sinon la fiche s'affiche avec deux valeurs differentes
    // pour le meme ingredient.
    if (copie.flowTable) {
      var tableau = Flux.echelonnerFlowTable(copie.flowTable, facteur);
      copie.flowTable = tableau.flowTable;
      remplacements = remplacements.concat(tableau.remplacements);
    }

    (copie.instructions || []).forEach(function (etape) {
      var texte = Q.echelonnerTexte(etape.texte, facteur);
      etape.texte = texte.texte;
      remplacements = remplacements.concat(texte.remplacements);

      if (etape.astuce) {
        var astuce = Q.echelonnerTexte(etape.astuce, facteur);
        etape.astuce = astuce.texte;
        remplacements = remplacements.concat(astuce.remplacements);
      }
    });

    return { possible: true, facteur: facteur, recette: copie, remplacements: remplacements, ignorees: ignorees };
  }

  var api = {
    CLE_CACHE: CLE_CACHE,
    surChangement: surChangement,
    definirBase: definirBase,
    toutes: toutes,
    parId: parId,
    originale: originale,
    estModifiee: estModifiee,
    estAjoutee: estAjoutee,
    livreDe: livreDe,
    estRemontee: estRemontee,
    duLivreDeCuisine: duLivreDeCuisine,
    duLivre: duLivre,
    deLaBibliotheque: deLaBibliotheque,
    comptesParLivre: comptesParLivre,
    remonter: remonter,
    deplacerVersLivre: deplacerVersLivre,
    rafraichir: rafraichir,
    etatChargement: etatChargement,
    enregistrer: enregistrer,
    reinitialiser: reinitialiser,
    echelonner: echelonner,
    slug: slug,
    idLibre: idLibre,
    recetteVide: recetteVide,
    creer: creer,
    supprimer: supprimer,
  };

  if (estNode) module.exports = api;
  else global.CarnetRecettes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
