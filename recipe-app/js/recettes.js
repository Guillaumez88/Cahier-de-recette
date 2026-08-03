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

  /**
   * Liste effective : les recettes d'origine, celles modifiees remplacant les leurs.
   * L'ordre du fichier d'origine est conserve, pour que l'accueil ne se reorganise
   * pas a chaque modification.
   */
  function toutes() {
    var modifiees = lireCache();
    return base.map(function (recette) {
      return modifiees[recette.id] || recette;
    });
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
    rafraichir: rafraichir,
    etatChargement: etatChargement,
    enregistrer: enregistrer,
    reinitialiser: reinitialiser,
    echelonner: echelonner,
  };

  if (estNode) module.exports = api;
  else global.CarnetRecettes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
