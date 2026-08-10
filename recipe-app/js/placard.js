/* Le placard : les ingrédients qu'on a toujours et qu'il ne faut pas racheter.

   Le sel, la farine, l'huile d'olive reviennent dans presque toutes les recettes.
   Sans cette liste, ils repartaient en courses chaque semaine, et on les décochait
   à la main, ou on les rachetait.

   Le cache local, la file d'attente et l'état de synchronisation sont tenus par
   collection.js, partagé avec la liste de courses et le semainier. Ce fichier ne
   porte que la clé d'un ingrédient, la mise en forme et les deux mutations.

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
  var Collection = estNode ? require('./collection.js') : global.CarnetCollection;

  var CLE_CACHE = 'carnet-de-recettes:placard';
  var CLE_FILE = 'carnet-de-recettes:file-placard';

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

  // --- Collection synchronisee -------------------------------------------------
  //
  // Le cache local, la file d'attente et l'etat de synchronisation sont tenus par
  // collection.js, comme pour la liste de courses et les menus. Ce fichier ne garde
  // que ce qui est propre au placard : la cle d'un ingredient et la mise en forme.

  var col = Collection.creer({
    cleCache: CLE_CACHE,
    cleFile: CLE_FILE,
    executer: function (operation) {
      if (operation.type === 'ecrire') return Sync.ecrirePlacard(operation.entree);
      return Sync.supprimerPlacard(operation.cle);
    },
    lireDistant: function () {
      return Sync.lirePlacard();
    },
    normaliser: function (distants) {
      // Une entree sans cle ou sans nom est un residu : l'ignorer plutot que de la
      // rendre a l'ecran sous une forme incomprehensible.
      return trier(
        distants
          .map(function (e) {
            return { cle: e.cle, nom: e.nom || '' };
          })
          .filter(function (e) {
            return e.cle && e.nom;
          })
      );
    },
  });

  var tous = col.tous;

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
    return col.appliquer(trier(tous().concat([entree])), { type: 'ecrire', entree: entree });
  }

  /** Retire un ingredient du placard. */
  function retirer(nom) {
    var k = cle(nom);
    var avant = tous();
    var apres = avant.filter(function (e) {
      return e.cle !== k;
    });
    if (apres.length === avant.length) return Promise.resolve(avant);
    return col.appliquer(apres, { type: 'supprimer', cle: k });
  }

  var api = {
    CLE_CACHE: CLE_CACHE,
    CLE_FILE: CLE_FILE,

    surChangement: col.surChangement,
    initialiser: col.initialiser,
    rafraichir: col.rafraichir,
    etatSync: col.etatSync,

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
