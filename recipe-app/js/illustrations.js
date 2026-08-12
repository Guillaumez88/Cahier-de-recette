/* Les illustrations des étapes d'une recette.

   Une photo par étape, facultative : la plupart des recettes n'en ont aucune, celles
   qui viennent d'une fiche HelloFresh en ont une par étape.

   ## Pourquoi un module à part, et pas photos.js

   Ce n'est pas le même besoin de lecture, et c'est tout ce qui compte ici.

   Une vignette de recette sert dans les **listes** : le livre, le semainier, la
   bibliothèque. Il faut donc toutes les connaître dès le chargement de la page, ce que
   `photos.js` fait en une requête masquée, et c'est ce qui lui permet de savoir « qui a
   une photo » sans interroger vingt documents.

   Une illustration d'étape ne sert que sur **la fiche ouverte**. Les ranger dans la
   collection `photos` les aurait fait lire toutes, à chaque chargement, pour n'en
   afficher aucune : cinq recettes de six étapes, ce sont trente documents et environ
   600 Ko lus pour rien. Elles vivent donc dans leur propre collection, **un document
   par recette**, lu à l'ouverture de la fiche : une lecture par fiche consultée.

   ## Ce qui est réutilisé de photos.js

   Tout le reste : `Ph.preparer(fichier)` redimensionne dans le navigateur et rend une
   vignette de 320 px bornée à 60 000 caractères. C'est la taille d'affichage d'une
   illustration d'étape, donc la vignette suffit et la grande version n'est pas
   conservée. Six étapes font ainsi environ 120 Ko dans un document limité à 1 Mio.

   ## Le rang, et non le numéro

   Une illustration est indexée par le **rang** de l'étape (1 pour la première), pas par
   son champ `numero`, qui peut valoir « Pour finir » dans certaines recettes. Supprimer
   une étape décale donc les suivantes : `retirerEtape()` décale les illustrations avec
   elles, sinon la photo de l'étape 4 se retrouverait sur l'étape 3.

   Expose window.CarnetIllustrations dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  var estNode = typeof module !== 'undefined' && module.exports;
  var Sync = estNode ? require('./sync.js') : global.CarnetSync;

  // { recetteId: { rang: dataUrl } }. Uniquement en memoire : ces images ne servent
  // qu'a l'ecran, et le stockage local est deja etroit (voir photos.js).
  var enMemoire = {};
  var abonnes = [];

  function surChangement(rappel) {
    abonnes.push(rappel);
  }

  function notifier() {
    abonnes.forEach(function (rappel) {
      try {
        rappel();
      } catch (erreur) {
        /* un abonne fautif ne doit pas bloquer les autres */
      }
    });
  }

  /** Les illustrations connues d'une recette. Synchrone : lues en memoire. */
  function pour(recetteId) {
    return enMemoire[recetteId] || {};
  }

  /** Vrai si cette recette a au moins une illustration deja chargee. */
  function aUne(recetteId, rang) {
    return Boolean(pour(recetteId)[String(rang)]);
  }

  function nombre(recetteId) {
    return Object.keys(pour(recetteId)).length;
  }

  /** Vrai si la recette a deja ete lue, meme sans resultat. Evite de relire pour rien. */
  function dejaLue(recetteId) {
    return Object.prototype.hasOwnProperty.call(enMemoire, recetteId);
  }

  /**
   * Lit les illustrations d'une recette, une fois. Idempotente.
   *
   * Une recette sans illustration est memorisee comme telle : sans cela, chaque
   * ouverture de fiche redemanderait un document absent, soit une lecture facturee par
   * visite pour dix-neuf recettes sur vingt.
   */
  async function charger(recetteId) {
    if (dejaLue(recetteId)) return pour(recetteId);
    try {
      var table = await Sync.lireIllustrations(recetteId);
      enMemoire[recetteId] = normaliser(table);
    } catch (erreur) {
      // Illisible (hors ligne, regles non republiees) : la fiche s'affiche sans
      // illustrations plutot que de ne pas s'afficher. On ne memorise pas l'echec,
      // pour retenter a la prochaine ouverture.
      return {};
    }
    notifier();
    return pour(recetteId);
  }

  /** Ne garde que des rangs entiers positifs et des chaines non vides. */
  function normaliser(table) {
    var propre = {};
    Object.keys(table || {}).forEach(function (cle) {
      var rang = parseInt(cle, 10);
      if (!(rang > 0)) return;
      var valeur = table[cle];
      if (typeof valeur !== 'string' || valeur === '') return;
      propre[String(rang)] = valeur;
    });
    return propre;
  }

  /**
   * Enregistre l'illustration d'une etape.
   *
   * Le cache est mis a jour d'abord, pour que l'image apparaisse tout de suite, mais
   * l'erreur reseau est propagee : une image qui n'est pas partie ne doit pas etre
   * annoncee comme enregistree. C'est la meme regle que dans photos.js.
   */
  async function enregistrer(recetteId, rang, image) {
    var avant = pour(recetteId);
    var apres = Object.assign({}, avant);
    apres[String(rang)] = image;
    enMemoire[recetteId] = apres;
    notifier();

    try {
      await Sync.ecrireIllustrations(recetteId, apres);
    } catch (erreur) {
      enMemoire[recetteId] = avant;
      notifier();
      throw erreur;
    }
    return apres;
  }

  /** Retire l'illustration d'une etape, sans toucher aux autres. */
  async function retirer(recetteId, rang) {
    var avant = pour(recetteId);
    if (!avant[String(rang)]) return avant;

    var apres = Object.assign({}, avant);
    delete apres[String(rang)];
    enMemoire[recetteId] = apres;
    notifier();

    try {
      if (Object.keys(apres).length === 0) await Sync.supprimerIllustrations(recetteId);
      else await Sync.ecrireIllustrations(recetteId, apres);
    } catch (erreur) {
      enMemoire[recetteId] = avant;
      notifier();
      throw erreur;
    }
    return apres;
  }

  /**
   * Une etape a ete supprimee de la recette : les illustrations suivantes remontent
   * d'un rang.
   *
   * Sans cela, supprimer l'etape 2 laisserait la photo de l'ancienne etape 3 sur la
   * nouvelle etape 3, qui est l'ancienne 4 : chaque photo se retrouverait sur l'etape
   * suivante, en silence.
   */
  async function retirerEtape(recetteId, rang) {
    var avant = pour(recetteId);
    var supprime = parseInt(rang, 10);
    var apres = {};
    Object.keys(avant).forEach(function (cle) {
      var r = parseInt(cle, 10);
      if (r === supprime) return;
      apres[String(r > supprime ? r - 1 : r)] = avant[cle];
    });

    if (JSON.stringify(apres) === JSON.stringify(avant)) return avant;

    enMemoire[recetteId] = apres;
    notifier();
    try {
      if (Object.keys(apres).length === 0) await Sync.supprimerIllustrations(recetteId);
      else await Sync.ecrireIllustrations(recetteId, apres);
    } catch (erreur) {
      enMemoire[recetteId] = avant;
      notifier();
      throw erreur;
    }
    return apres;
  }

  /** Oublie le cache d'une recette, pour la relire. Sert aux tests et au rafraichissement. */
  function oublier(recetteId) {
    if (recetteId === undefined) enMemoire = {};
    else delete enMemoire[recetteId];
  }

  var api = {
    surChangement: surChangement,
    pour: pour,
    aUne: aUne,
    nombre: nombre,
    dejaLue: dejaLue,
    charger: charger,
    normaliser: normaliser,
    enregistrer: enregistrer,
    retirer: retirer,
    retirerEtape: retirerEtape,
    oublier: oublier,
  };

  if (estNode) module.exports = api;
  else global.CarnetIllustrations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
