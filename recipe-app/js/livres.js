/* La bibliotheque : les livres de cuisine « en vrai » de la maison.

   Un livre est une **etagere**, pas un recueil : un titre, un theme, et rien
   d'autre. Il ne porte pas la liste de ses recettes ; c'est chaque recette qui
   nomme son livre, dans son propre document. Trois consequences, toutes voulues :

   1. Une recette rattachee a un livre est ecrite exactement comme une recette
      ajoutee a la main, dans la collection `recettes`. Rien du mecanisme existant
      ne change : ni la modification, ni la photo, ni le partage, ni les courses.

   2. Deux appareils qui rattachent chacun une recette au meme livre modifient deux
      documents distincts. Avec la liste des recettes dans le document du livre, le
      dernier qui ecrit ecraserait le travail de l'autre.

   3. Supprimer un livre ne supprime aucune recette. C'est aussi pourquoi la
      suppression est refusee tant que le livre en contient : sinon ses recettes
      resteraient dans la base en pointant vers une etagere disparue, visibles
      nulle part. Voir `supprimer()`.

   Le cache local, la file d'attente et l'etat de synchronisation viennent de
   collection.js, comme pour la liste de courses, les menus et le placard.

   **Le theme n'est pas la categorie.** La categorie d'une recette (Entree, Plat,
   Dessert) existe depuis le debut et decrit un plat. Le theme decrit un ouvrage
   (Patisserie, Boisson, Plats). Les deux coexistent sur le meme ecran, d'ou deux
   mots differents, tenus a l'ecart l'un de l'autre.

   Expose window.CarnetLivres dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  var estNode = typeof module !== 'undefined' && module.exports;
  var Sync = estNode ? require('./sync.js') : global.CarnetSync;
  var Collection = estNode ? require('./collection.js') : global.CarnetCollection;

  var CLE_CACHE = 'carnet-de-recettes:livres';
  var CLE_FILE = 'carnet-de-recettes:file-livres';

  // Themes proposes a la creation. Ce n'est pas une liste fermee : le champ accepte
  // n'importe quel mot, et les filtres de l'ecran sont deduits des livres presents,
  // comme les filtres du livre de cuisine le sont des recettes presentes. Un livre
  // de conserves fera donc apparaitre « Conserves » sans toucher au code.
  var THEMES_SUGGERES = ['Pâtisserie', 'Plats', 'Boisson', 'Apéritif', 'Pain', 'Autres'];

  /**
   * Identifiant d'un livre, derive du titre.
   *
   * Le titre est le seul repere dont on dispose a la creation, et il ne bouge plus
   * ensuite : c'est ce qui permet a une recette de citer son livre par un
   * identifiant lisible (« ferrandi-patisserie ») plutot que par un nombre.
   */
  function identifiant(titre) {
    return String(titre || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // Les ligatures ne se decomposent pas en NFD : sans cette ligne, « Œufs » donne
      // « ufs ». Les deux casses, parce qu'un titre de livre commence par une capitale.
      .replace(/œ/g, 'oe')
      .replace(/Œ/g, 'OE')
      .replace(/æ/g, 'ae')
      .replace(/Æ/g, 'AE')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .toLowerCase();
  }

  function trier(livres) {
    return livres.slice().sort(function (a, b) {
      // Par theme puis par titre : c'est l'ordre dans lequel l'ecran les regroupe,
      // et le faire ici evite de retrier a chaque rendu.
      var parTheme = String(a.theme).localeCompare(String(b.theme), 'fr');
      if (parTheme !== 0) return parTheme;
      return String(a.titre).localeCompare(String(b.titre), 'fr');
    });
  }

  function normaliserUn(brut) {
    return {
      id: String(brut.id || ''),
      titre: String(brut.titre || ''),
      theme: String(brut.theme || 'Autres'),
      auteur: brut.auteur ? String(brut.auteur) : '',
    };
  }

  var col = Collection.creer({
    cleCache: CLE_CACHE,
    cleFile: CLE_FILE,
    executer: function (operation) {
      if (operation.type === 'ecrire') return Sync.ecrireLivre(operation.livre);
      return Sync.supprimerLivre(operation.id);
    },
    lireDistant: function () {
      return Sync.lireLivres();
    },
    normaliser: function (distants) {
      // Un livre sans identifiant ou sans titre est un residu : l'ignorer plutot que
      // d'afficher une etagere anonyme sur laquelle on ne pourra rien ranger.
      return trier(
        distants.map(normaliserUn).filter(function (l) {
          return l.id && l.titre;
        })
      );
    },
  });

  var tous = col.tous;

  function parId(id) {
    var trouve = null;
    tous().forEach(function (l) {
      if (l.id === id) trouve = l;
    });
    return trouve;
  }

  /** Les themes presents dans la bibliotheque, dans l'ordre d'affichage. */
  function themes() {
    var vus = {};
    var liste = [];
    tous().forEach(function (l) {
      if (vus[l.theme]) return;
      vus[l.theme] = true;
      liste.push(l.theme);
    });
    return liste;
  }

  /**
   * Les livres regroupes par theme : [{ theme, livres }].
   * L'ecran affiche un intertitre par groupe, ce decoupage lui evite de le refaire.
   */
  function parTheme() {
    var groupes = [];
    var index = {};
    tous().forEach(function (livre) {
      if (!index[livre.theme]) {
        index[livre.theme] = { theme: livre.theme, livres: [] };
        groupes.push(index[livre.theme]);
      }
      index[livre.theme].livres.push(livre);
    });
    return groupes;
  }

  /**
   * Cree un livre. Le titre est obligatoire, le theme prend « Autres » par defaut.
   *
   * Un titre deja pris rend le livre existant au lieu d'en creer un second :
   * l'identifiant vient du titre, et deux etageres homonymes seraient
   * indiscernables a l'ecran comme dans les donnees.
   */
  function creer(titre, theme, auteur) {
    var propre = String(titre || '').trim();
    if (propre === '') return Promise.reject(new Error('un livre a besoin d’un titre'));

    var id = identifiant(propre);
    if (id === '') return Promise.reject(new Error('ce titre ne donne aucun identifiant lisible'));

    var existant = parId(id);
    if (existant) return Promise.resolve(existant);

    var livre = {
      id: id,
      titre: propre,
      theme: String(theme || '').trim() || 'Autres',
      auteur: String(auteur || '').trim(),
    };
    return col
      .appliquer(trier(tous().concat([livre])), { type: 'ecrire', livre: livre })
      .then(function () {
        return livre;
      });
  }

  /** Change le titre, le theme ou l'auteur d'un livre. L'identifiant ne bouge pas. */
  function modifier(id, champs) {
    var livre = parId(id);
    if (!livre) return Promise.reject(new Error('ce livre n’existe pas'));

    var modifie = normaliserUn(Object.assign({}, livre, champs || {}, { id: livre.id }));
    if (modifie.titre.trim() === '') return Promise.reject(new Error('un livre a besoin d’un titre'));
    modifie.theme = modifie.theme.trim() || 'Autres';

    var apres = tous().map(function (l) {
      return l.id === id ? modifie : l;
    });
    return col.appliquer(trier(apres), { type: 'ecrire', livre: modifie }).then(function () {
      return modifie;
    });
  }

  /**
   * Supprime un livre vide.
   *
   * `nbRecettes` est fourni par l'appelant, parce que ce module ne connait pas les
   * recettes : le compte se fait dans recettes.js, qui les detient. Un livre encore
   * garni n'est pas supprime, et la raison est dite plutot que devinee : ses recettes
   * resteraient en base, rattachees a une etagere absente, donc invisibles partout.
   */
  function supprimer(id, nbRecettes) {
    var livre = parId(id);
    if (!livre) return Promise.resolve(tous());
    if (Number(nbRecettes) > 0) {
      return Promise.reject(
        new Error(
          'ce livre contient encore ' +
            nbRecettes +
            (nbRecettes > 1 ? ' recettes' : ' recette') +
            '. Déplacez-les ou supprimez-les d’abord : sans leur livre, elles ne seraient plus visibles nulle part.'
        )
      );
    }

    var apres = tous().filter(function (l) {
      return l.id !== id;
    });
    return col.appliquer(apres, { type: 'supprimer', id: id });
  }

  var api = {
    CLE_CACHE: CLE_CACHE,
    CLE_FILE: CLE_FILE,
    THEMES_SUGGERES: THEMES_SUGGERES,

    surChangement: col.surChangement,
    initialiser: col.initialiser,
    rafraichir: col.rafraichir,
    ageDonnees: col.ageDonnees,
    etatSync: col.etatSync,

    identifiant: identifiant,
    tous: tous,
    parId: parId,
    themes: themes,
    parTheme: parTheme,

    creer: creer,
    modifier: modifier,
    supprimer: supprimer,
  };

  if (estNode) module.exports = api;
  else global.CarnetLivres = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
