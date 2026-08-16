/* Une collection partagée : le cache local, la file d'attente et l'état de synchro.

   Trois modules suivaient exactement le même schéma, écrit trois fois :
   `storage.js` (la liste de courses), `semainier.js` (les menus) et `placard.js`
   (les ingrédients qu'on a toujours). Soixante-quatorze lignes identiques, et
   surtout trois occasions de corriger un défaut à deux endroits sur trois. La
   mémorisation de l'analyse JSON a d'ailleurs dû être appliquée trois fois.

   Ce module ne connaît aucun métier : ni article, ni créneau, ni ingrédient. Il
   tient les trois principes du projet, et rien d'autre :

   1. **Le cache local est la source du rendu.** `tous()` est synchrone : l'écran
      s'affiche sans attendre le réseau, et reste consultable hors ligne.

   2. **Une modification s'applique en local puis part**, inscrite dans une file
      persistée. Cocher un article sans réseau fonctionne, et repart au retour du
      signal. La file s'arrête à la première opération qui échoue et conserve le
      reste : l'ordre compte, ajouter puis cocher n'est pas cocher puis ajouter.

   3. **Firestore est la référence.** Un rafraîchissement vide d'abord la file,
      puis remplace le cache par ce que dit le serveur.

   Ce que l'appelant fournit :

     cleCache       clé du cache local
     cleFile        clé de la file d'attente
     executer(op)   envoie une opération de la file ; doit rejeter en cas d'échec
     lireDistant()  lit la collection côté serveur
     normaliser(d)  met en forme et ordonne ce que le serveur a rendu

   Expose window.CarnetCollection dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  /**
   * Analyse mémorisée du stockage local, validée sur la chaîne brute.
   *
   * Un rendu d'accueil lit le cache du semainier quatre fois, et chaque appel
   * réanalysait tout le JSON : 56 Ko et environ 1 ms par appel pour quatre mois
   * d'historique, qui grossit d'environ 1 100 créneaux par an.
   *
   * La validation porte sur la chaîne et non sur un drapeau interne : une écriture
   * faite en dehors du module (un test, un autre onglet) reste donc détectée, ce
   * qu'un simple drapeau invalidé manquerait.
   *
   * La table est partagée par toutes les collections, les clés étant distinctes.
   */
  var memo = {};

  function lireJson(cle, defaut) {
    try {
      var brut = global.localStorage && global.localStorage.getItem(cle);
      if (!brut) return defaut;
      var connu = memo[cle];
      if (connu && connu.brut === brut) return connu.valeur;
      var valeur = JSON.parse(brut);
      if (!Array.isArray(valeur)) return defaut;
      memo[cle] = { brut: brut, valeur: valeur };
      return valeur;
    } catch (erreur) {
      // Stockage illisible ou corrompu : on repart proprement plutôt que de lever.
      return defaut;
    }
  }

  function ecrireJson(cle, valeur) {
    try {
      if (global.localStorage) global.localStorage.setItem(cle, JSON.stringify(valeur));
    } catch (erreur) {
      /* quota atteint ou navigation privee : la valeur reste en memoire */
    }
  }

  /** Construit une collection synchronisée. */
  function creer(reglages) {
    var cleCache = reglages.cleCache;
    var cleFile = reglages.cleFile;
    var executer = reglages.executer;
    var lireDistant = reglages.lireDistant;
    var normaliser =
      reglages.normaliser ||
      function (distants) {
        return distants;
      };

    var abonnes = [];
    var dejaCharge = false;

    var etat = {
      enLigne: null, // null tant qu'aucun echange n'a eu lieu
      dernierSucces: null, // horodatage du dernier rafraichissement reussi
      erreur: null, // message de la derniere erreur
      statut: null, // statut HTTP de la derniere erreur, pour la distinguer a l'ecran

      enCours: false,

      // Compteur incremente a chaque modification locale. Sert a detecter qu'une
      // modification est survenue pendant qu'une lecture etait en vol : la reponse
      // decrit alors un etat anterieur, il ne faut pas en ecraser le cache.
      versionLocale: 0,
    };

    // --- Abonnement -----------------------------------------------------------

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

    // --- Cache local ----------------------------------------------------------

    /** Le contenu affiché. Synchrone, lu dans le cache local. */
    function tous() {
      return lireJson(cleCache, []);
    }

    function ecrireCache(valeurs) {
      ecrireJson(cleCache, valeurs);
      notifier();
      return valeurs;
    }

    // --- File d'attente -------------------------------------------------------

    function lireFile() {
      return lireJson(cleFile, []);
    }

    function empiler(operation) {
      var file = lireFile();
      file.push(operation);
      ecrireJson(cleFile, file);
    }

    function nbEnAttente() {
      return lireFile().length;
    }

    /**
     * Envoie les opérations en attente, dans l'ordre.
     *
     * S'arrête à la première qui échoue et conserve le reste : hors ligne, la file est
     * exactement ce qu'il faut, elle repartira au retour du réseau.
     *
     * **Sauf pour un refus.** Un 403, comme une écriture tentée sans foyer, ne se
     * réessaie pas : l'appareil n'a pas le droit
     * d'écrire, et il ne l'aura pas davantage dans dix minutes. Garder l'opération
     * laisserait une file qui ne se vide jamais et une bannière « hors ligne »
     * permanente sur un appareil qui, lui, est parfaitement en ligne. Elle est donc
     * retirée, et l'erreur remontée pour que l'écran le dise.
     */
    async function viderFile() {
      var file = lireFile();
      var refus = null;

      while (file.length > 0) {
        try {
          await executer(file[0]);
          file.shift();
          ecrireJson(cleFile, file);
        } catch (erreur) {
          // Un refus, un verrou local, ou l'absence de foyer : trois façons de ne pas
          // avoir le droit d'écrire, et aucune ne se répare en attendant.
          if (erreur.statut === 403 || erreur.lectureSeule || erreur.sansFoyer) {
            file.shift();
            ecrireJson(cleFile, file);
            refus = erreur;
            continue;
          }
          ecrireJson(cleFile, file);
          throw erreur;
        }
      }

      if (refus) throw refus;
    }

    async function pousser() {
      try {
        await viderFile();
        etat.enLigne = true;
        etat.erreur = null;
        etat.statut = null;
      } catch (erreur) {
        etat.enLigne = false;
        etat.erreur = erreur.message;
        etat.statut = erreur.statut || null;
      }
      notifier();
      return tous();
    }

    /**
     * Applique une modification en local, l'inscrit dans la file, puis tente l'envoi.
     * L'échec de l'envoi est normal hors ligne : la file en garde la trace.
     */
    function appliquer(valeurs, operations) {
      etat.versionLocale += 1;
      ecrireCache(valeurs);
      (Array.isArray(operations) ? operations : [operations]).forEach(empiler);
      return pousser();
    }

    // --- Rafraichissement -----------------------------------------------------

    async function rafraichir() {
      if (etat.enCours) return tous();
      etat.enCours = true;
      notifier();

      var versionAvant = etat.versionLocale;

      try {
        await viderFile();
        var distants = await lireDistant();

        // Une modification locale est survenue pendant la lecture : la reponse decrit
        // un etat deja depasse. L'ecrire ferait reapparaitre a l'ecran ce qui vient
        // d'etre supprime, ou decocher ce qui vient d'etre coche.
        if (etat.versionLocale !== versionAvant) {
          etat.enLigne = true;
          etat.erreur = null;
          etat.statut = null;
          return tous();
        }

        var valeurs = normaliser(distants);

        etat.enLigne = true;
        etat.erreur = null;
        etat.statut = null;
        etat.dernierSucces = Date.now();
        ecrireCache(valeurs);
        return valeurs;
      } catch (erreur) {
        // Hors ligne, le cache local est conserve tel quel : mieux vaut un contenu
        // un peu ancien mais utilisable qu'un ecran vide.
        etat.enLigne = false;
        etat.erreur = erreur.message;
        etat.statut = erreur.statut || null;
        return tous();
      } finally {
        etat.enCours = false;
        notifier();
      }
    }

    /**
     * Lecture initiale, au chargement de la page. Idempotente.
     *
     * IL N'Y A PLUS DE SONDAGE PERIODIQUE, et c'est le point le plus important de ce
     * fichier. La liste etait relue toutes les 5 secondes ; cela a epuise le palier
     * gratuit de Firestore, qui est de 50 000 lectures de document par jour et facture
     * chaque document a chaque lecture. L'arithmetique : 720 sondages par heure, tous
     * les articles lus a chaque fois, soit 18 720 lectures par heure avec 26 articles,
     * et par onglet ouvert. Deux onglets oublies epuisaient la journee en deux heures,
     * apres quoi le serveur repondait « 429 Quota exceeded » sur tout, y compris les
     * ecritures : la liste et les menus paraissaient alors non partages, chaque
     * appareil retombant sur sa copie locale.
     *
     * La mise a jour est donc explicite : un bouton dans l'en-tete. En echange, l'age
     * de la donnee affichee est visible, sinon on coche dans une liste perimee sans
     * le savoir : voir `ageDonnees()`.
     */
    function initialiser() {
      if (dejaCharge) return Promise.resolve(tous());
      dejaCharge = true;
      return rafraichir();
    }

    /** Age du contenu affiché, en millisecondes, ou null si rien n'a encore été lu. */
    function ageDonnees() {
      return etat.dernierSucces === null ? null : Date.now() - etat.dernierSucces;
    }

    function etatSync() {
      return {
        enLigne: etat.enLigne,
        dernierSucces: etat.dernierSucces,
        erreur: etat.erreur,
        statut: etat.statut,
        enCours: etat.enCours,
        enAttente: nbEnAttente(),
      };
    }

    return {
      surChangement: surChangement,
      notifier: notifier,
      tous: tous,
      ecrireCache: ecrireCache,
      appliquer: appliquer,
      nbEnAttente: nbEnAttente,
      initialiser: initialiser,
      rafraichir: rafraichir,
      ageDonnees: ageDonnees,
      etatSync: etatSync,
    };
  }

  var api = { creer: creer };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.CarnetCollection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
