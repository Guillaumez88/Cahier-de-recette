/* Où l'on en est dans la préparation d'une recette.

   Deux informations, par recette : le mode d'affichage de la fiche (consulter ou
   cuisiner) et l'étape en cours en mode cuisiner.

   Volontairement LOCAL, jamais partagé. Deux personnes qui cuisinent le même plat
   sur deux appareils ne doivent pas se pousser mutuellement d'une étape à l'autre,
   et l'endroit où l'on en est n'intéresse personne d'autre. C'est aussi ce qui
   evite d'ajouter des ecritures Firestore a chaque « Suivante ».

   Ce module existe pour que app.js n'ait pas a toucher au localStorage : c'est
   l'invariant du projet, le rendu passe toujours par un module de stockage.

   Expose window.CarnetCuisson dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  var CLE = 'carnet-de-recettes:cuisson';

  var MODE_CONSULTER = 'consulter';
  var MODE_CUISINER = 'cuisiner';

  function lire() {
    try {
      var brut = global.localStorage && global.localStorage.getItem(CLE);
      if (!brut) return {};
      var valeur = JSON.parse(brut);
      return valeur && typeof valeur === 'object' && !Array.isArray(valeur) ? valeur : {};
    } catch (erreur) {
      return {};
    }
  }

  function ecrire(etat) {
    try {
      if (global.localStorage) global.localStorage.setItem(CLE, JSON.stringify(etat));
    } catch (erreur) {
      // Quota atteint ou navigation privee : on cuisine quand meme, on repart
      // simplement de l'etape 1 au prochain chargement.
    }
    return etat;
  }

  function pour(recetteId) {
    var etat = lire()[recetteId];
    return etat && typeof etat === 'object' ? etat : {};
  }

  /** Mode de la fiche. « consulter » par defaut. */
  function mode(recetteId) {
    return pour(recetteId).mode === MODE_CUISINER ? MODE_CUISINER : MODE_CONSULTER;
  }

  function definirMode(recetteId, valeur) {
    var etat = lire();
    etat[recetteId] = Object.assign({}, etat[recetteId], {
      mode: valeur === MODE_CUISINER ? MODE_CUISINER : MODE_CONSULTER,
    });
    ecrire(etat);
    return mode(recetteId);
  }

  /**
   * Etape en cours, comptee a partir de zero, bornee au nombre d'etapes fourni.
   * Le bornage est fait a la lecture et non a l'ecriture : une recette raccourcie
   * par une modification laisserait sinon un index au-dela de la derniere etape, et
   * l'ecran resterait vide sans qu'on comprenne pourquoi.
   */
  function etape(recetteId, nbEtapes) {
    var valeur = pour(recetteId).etape;
    if (typeof valeur !== 'number' || !isFinite(valeur) || valeur < 0) return 0;
    var maximum = typeof nbEtapes === 'number' && nbEtapes > 0 ? nbEtapes - 1 : 0;
    return Math.min(Math.floor(valeur), maximum);
  }

  function definirEtape(recetteId, valeur) {
    var etat = lire();
    etat[recetteId] = Object.assign({}, etat[recetteId], {
      etape: Math.max(0, Math.floor(Number(valeur) || 0)),
    });
    ecrire(etat);
    return etat[recetteId].etape;
  }

  /** Oublie tout ce qui concerne une recette. */
  function oublier(recetteId) {
    var etat = lire();
    delete etat[recetteId];
    ecrire(etat);
  }

  var api = {
    CLE: CLE,
    MODE_CONSULTER: MODE_CONSULTER,
    MODE_CUISINER: MODE_CUISINER,
    mode: mode,
    definirMode: definirMode,
    etape: etape,
    definirEtape: definirEtape,
    oublier: oublier,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.CarnetCuisson = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
