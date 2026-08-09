/* Le placard : les ingrédients qu'on a toujours et qu'il ne faut pas racheter.

   Le sel, la farine, l'huile d'olive reviennent dans presque toutes les recettes.
   Sans cette liste, ils repartaient en courses chaque semaine, et on les décochait
   à la main, ou on les rachetait.

   Ce module suit les trois principes de storage.js : le cache local est la source
   du rendu, les modifications sont appliquées en local puis poussées via une file
   persistée, et un rafraîchissement remplace le cache par ce que dit le serveur.

   **Le placard est partagé, comme le reste.** Il décrit la maison, pas l'appareil.
   S'il était local, l'un curerait sa liste et l'autre recevrait quand même le sel
   dans ses courses : c'est exactement le défaut corrigé sur le semainier.

   **Dégradation assumée.** Tant que `firestore.rules` n'accorde pas l'accès à la
   collection `placard`, la lecture échoue. Le carnet continue de fonctionner : le
   placard est simplement vide, aucun ingrédient n'est décoché, et `etatSync()` porte
   l'erreur pour que l'écran puisse le dire. Une fonctionnalité absente vaut mieux
   qu'un écran bloqué.

   Expose window.CarnetPlacard dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  var estNode = typeof module !== 'undefined' && module.exports;
  var Sync = estNode ? require('./sync.js') : global.CarnetSync;

  var CLE_CACHE = 'carnet-de-recettes:placard';
  var CLE_FILE = 'carnet-de-recettes:file-placard';

  var abonnes = [];
  var dejaCharge = false;

  var etat = {
    enLigne: null,
    dernierSucces: null,
    erreur: null,
    statut: null,
    enCours: false,
    versionLocale: 0,
  };

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

  // --- Cache local ------------------------------------------------------------

  function lireJson(cle, defaut) {
    try {
      var brut = global.localStorage && global.localStorage.getItem(cle);
      if (!brut) return defaut;
      var valeur = JSON.parse(brut);
      return Array.isArray(valeur) ? valeur : defaut;
    } catch (erreur) {
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

  /** Le placard, trie par nom. Synchrone, lu dans le cache local. */
  function tous() {
    return lireJson(CLE_CACHE, []);
  }

  // --- Cle -------------------------------------------------------------------

  /**
   * Cle d'une entree : le nom, sans accent ni casse.
   *
   * « Huile d'olive », « huile d'olive » et « HUILE D'OLIVE » designent le meme
   * bocal. Sans normalisation, le placard accumulerait trois entrees pour un seul
   * ingredient et n'en reconnaitrait aucune.
   */
  function cle(nom) {
    return String(nom || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u2019']/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function trier(entrees) {
    return entrees.slice().sort(function (a, b) {
      return String(a.nom).localeCompare(String(b.nom), 'fr');
    });
  }

  // --- File d'attente ---------------------------------------------------------

  function lireFile() {
    return lireJson(CLE_FILE, []);
  }

  function nbEnAttente() {
    return lireFile().length;
  }

  async function viderFile() {
    var file = lireFile();
    while (file.length > 0) {
      var operation = file[0];
      try {
        if (operation.type === 'ecrire') await Sync.ecrirePlacard(operation.entree);
        else if (operation.type === 'supprimer') await Sync.supprimerPlacard(operation.cle);
        file.shift();
        ecrireJson(CLE_FILE, file);
      } catch (erreur) {
        ecrireJson(CLE_FILE, file);
        throw erreur;
      }
    }
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

  function appliquer(entrees, operation) {
    etat.versionLocale += 1;
    ecrireJson(CLE_CACHE, entrees);
    notifier();
    var file = lireFile();
    file.push(operation);
    ecrireJson(CLE_FILE, file);
    return pousser();
  }

  // --- Rafraichissement -------------------------------------------------------

  async function rafraichir() {
    if (etat.enCours) return tous();
    etat.enCours = true;
    notifier();

    var versionAvant = etat.versionLocale;

    try {
      await viderFile();
      var distants = await Sync.lirePlacard();

      if (etat.versionLocale !== versionAvant) {
        etat.enLigne = true;
        etat.erreur = null;
        etat.statut = null;
        return tous();
      }

      var entrees = trier(
        distants
          .map(function (e) {
            return { cle: e.cle, nom: e.nom || '' };
          })
          .filter(function (e) {
            return e.cle && e.nom;
          })
      );

      etat.enLigne = true;
      etat.erreur = null;
      etat.statut = null;
      etat.dernierSucces = Date.now();
      ecrireJson(CLE_CACHE, entrees);
      notifier();
      return entrees;
    } catch (erreur) {
      // Regles non publiees ou reseau coupe : le placard reste vide et le carnet
      // fonctionne sans lui. L'erreur est conservee pour que l'ecran puisse le dire.
      etat.enLigne = false;
      etat.erreur = erreur.message;
      etat.statut = erreur.statut || null;
      return tous();
    } finally {
      etat.enCours = false;
      notifier();
    }
  }

  function initialiser() {
    if (dejaCharge) return Promise.resolve(tous());
    dejaCharge = true;
    return rafraichir();
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

  // --- Lecture ----------------------------------------------------------------

  /** Vrai si cet ingredient est declare toujours en placard. */
  function contient(nom) {
    var k = cle(nom);
    if (k === '') return false;
    return tous().some(function (e) {
      return e.cle === k;
    });
  }

  /** Index { cle: true }, pour un rendu qui ne refait pas la recherche 200 fois. */
  function index() {
    var table = {};
    tous().forEach(function (e) {
      table[e.cle] = true;
    });
    return table;
  }

  /**
   * Combien d'ingredients de `recette` sont couverts par le placard.
   * Sert a annoncer « 3 ingredients sont déjà en placard » avant d'ajouter.
   */
  function couverts(recette) {
    var table = index();
    var noms = [];
    ((recette && recette.ingredients) || []).forEach(function (groupe) {
      (groupe.items || []).forEach(function (item) {
        if (table[cle(item.nom)] && noms.indexOf(item.nom) === -1) noms.push(item.nom);
      });
    });
    return noms;
  }

  // --- Modifications ----------------------------------------------------------

  /** Ajoute un ingredient au placard. Sans effet s'il y est deja. */
  function ajouter(nom) {
    var propre = String(nom || '').trim();
    var k = cle(propre);
    if (k === '') return Promise.resolve(tous());
    if (contient(propre)) return Promise.resolve(tous());

    var entree = { cle: k, nom: propre };
    return appliquer(trier(tous().concat([entree])), { type: 'ecrire', entree: entree });
  }

  /** Retire un ingredient du placard. */
  function retirer(nom) {
    var k = cle(nom);
    var avant = tous();
    var apres = avant.filter(function (e) {
      return e.cle !== k;
    });
    if (apres.length === avant.length) return Promise.resolve(avant);
    return appliquer(apres, { type: 'supprimer', cle: k });
  }

  var api = {
    CLE_CACHE: CLE_CACHE,
    CLE_FILE: CLE_FILE,

    surChangement: surChangement,
    initialiser: initialiser,
    rafraichir: rafraichir,
    etatSync: etatSync,

    cle: cle,
    tous: tous,
    contient: contient,
    index: index,
    couverts: couverts,

    ajouter: ajouter,
    retirer: retirer,
  };

  if (estNode) module.exports = api;
  else global.CarnetPlacard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
