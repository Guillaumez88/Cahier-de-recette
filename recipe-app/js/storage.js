/* Liste de courses commune.
   Une seule liste, partagee par tous ceux qui ouvrent le site, stockee dans
   Firestore et recopiee en local a chaque chargement.

   Le cache local, la file d'attente et l'etat de synchronisation sont tenus par
   collection.js, partage avec le semainier et le placard. Ce fichier ne porte que
   ce qui est propre a la liste :

   - la forme d'un article et sa cle ;
   - le rangement par rayon de magasin, dans l'ordre du parcours ;
   - l'addition des quantites d'un meme ingredient venu de plusieurs recettes ;
   - le regroupement visuel des lignes proches, sans fusion ;
   - les mutations : ajouter, cocher, retirer.

   Expose window.CarnetStorage dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  var estNode = typeof module !== 'undefined' && module.exports;
  var Sync = estNode ? require('./sync.js') : global.CarnetSync;
  var Rayons = estNode ? require('./rayons.js') : global.CarnetRayons;
  var Quantites = estNode ? require('./quantites.js') : global.CarnetQuantites;
  var Collection = estNode ? require('./collection.js') : global.CarnetCollection;

  var CLE_CACHE = 'carnet-de-recettes:liste-commune';
  var CLE_FILE = 'carnet-de-recettes:file-attente';

  var RECETTE_LIBRE = '__libre__';
  var TITRE_LIBRE = 'Ajouts libres';

  // --- Collection synchronisee -------------------------------------------------
  //
  // Le cache local, la file d'attente et l'etat de synchronisation sont tenus par
  // collection.js, partage avec le semainier et le placard. Ce fichier ne garde que
  // ce qui est propre a la liste : la forme d'un article, le rangement par rayon,
  // l'addition des quantites et les mutations.

  var col = Collection.creer({
    cleCache: CLE_CACHE,
    cleFile: CLE_FILE,
    executer: function (operation) {
      if (operation.type === 'ecrire') return Sync.ecrireArticle(operation.article);
      if (operation.type === 'modifier') return Sync.modifierArticle(operation.cle, operation.champs);
      return Sync.supprimerArticle(operation.cle);
    },
    lireDistant: function () {
      return Sync.lireArticles();
    },
    normaliser: function (distants) {
      return distants
        .map(function (article) {
          return {
            cle: article.cle,
            nom: article.nom,
            quantite: article.quantite || '',
            groupe: article.groupe || null,
            recetteId: article.recetteId,
            recetteTitre: article.recetteTitre,
            coche: Boolean(article.coche),
            ajouteLe: article.ajouteLe || null,
          };
        })
        // Ordre stable : par recette puis par date d'ajout. Sans tri, Firestore rend
        // les documents par identifiant et la liste sautille d'un rafraichissement
        // a l'autre des qu'un article est ajoute.
        .sort(function (a, b) {
          if (a.recetteTitre !== b.recetteTitre) {
            return String(a.recetteTitre).localeCompare(String(b.recetteTitre), 'fr');
          }
          return String(a.ajouteLe || '').localeCompare(String(b.ajouteLe || ''));
        });
    },
  });

  /** Liste affichee. Synchrone, lue dans le cache local. */
  var getShoppingList = col.tous;
  var appliquer = col.appliquer;

  // --- Modifications ----------------------------------------------------------

  function cleArticle(recetteId, nom) {
    return `${recetteId}::${nom}`;
  }

  function horodatage() {
    return new Date().toISOString();
  }

  /** Ajoute une selection d'ingredients. `items` : [{ nom, quantite, groupe }]. */
  function addItemsToList(recette, items) {
    var articles = getShoppingList();
    var presents = {};
    articles.forEach(function (a) {
      presents[a.cle] = true;
    });

    var ajoutes = [];
    (items || []).forEach(function (item) {
      var cle = cleArticle(recette.id, item.nom);
      if (presents[cle]) return;
      presents[cle] = true;
      var article = {
        cle: cle,
        nom: item.nom,
        quantite: item.quantite || '',
        groupe: item.groupe || null,
        recetteId: recette.id,
        recetteTitre: recette.titre,
        coche: false,
        ajouteLe: horodatage(),
      };
      articles.push(article);
      ajoutes.push(article);
    });

    if (ajoutes.length === 0) return Promise.resolve(articles);

    return appliquer(
      articles,
      ajoutes.map(function (article) {
        return { type: 'ecrire', article: article };
      })
    );
  }

  /** Ajoute tous les ingredients d'une recette. */
  function addRecipeToList(recette) {
    var items = [];
    (recette.ingredients || []).forEach(function (groupe) {
      (groupe.items || []).forEach(function (item) {
        items.push({ nom: item.nom, quantite: item.quantite, groupe: groupe.groupe || null });
      });
    });
    return addItemsToList(recette, items);
  }

  /**
   * Ajoute les ingredients de plusieurs recettes en une seule salve.
   *
   * Appeler addRecipeToList en boucle marcherait, mais provoquerait un rendu et un
   * envoi par recette : en ajoutant les cinq plats de la semaine, l'ecran clignote
   * cinq fois et cinq lots partent en sequence. Ici tout est applique d'un coup,
   * puis une seule file part.
   *
   * Retourne { articles, ajoutes, deja } : `deja` compte les articles qui etaient
   * deja en liste, pour que l'ecran puisse le dire plutot que de laisser croire que
   * rien ne s'est passe.
   */
  /**
   * Ajoute plusieurs recettes d'un coup.
   *
   * `estExclu(nom)` est optionnel : quand il rend vrai, l'ingredient n'est pas ajoute.
   * C'est ce qui laisse le placard hors des courses sans que ce module ait a le
   * connaitre. Les exclus sont comptes a part pour que l'ecran puisse le dire.
   */
  function addRecipesToList(recettes, estExclu) {
    var exclure = typeof estExclu === 'function' ? estExclu : null;
    var articles = getShoppingList();
    var presents = {};
    articles.forEach(function (a) {
      presents[a.cle] = true;
    });

    var ajoutes = [];
    var deja = 0;
    var exclus = 0;

    (recettes || []).forEach(function (recette) {
      if (!recette || !recette.id) return;
      (recette.ingredients || []).forEach(function (groupe) {
        (groupe.items || []).forEach(function (item) {
          if (exclure && exclure(item.nom)) {
            exclus += 1;
            return;
          }
          var cle = cleArticle(recette.id, item.nom);
          if (presents[cle]) {
            deja += 1;
            return;
          }
          presents[cle] = true;
          var article = {
            cle: cle,
            nom: item.nom,
            quantite: item.quantite || '',
            groupe: groupe.groupe || null,
            recetteId: recette.id,
            recetteTitre: recette.titre,
            coche: false,
            ajouteLe: horodatage(),
          };
          articles.push(article);
          ajoutes.push(article);
        });
      });
    });

    if (ajoutes.length === 0) {
      return Promise.resolve({ articles: articles, ajoutes: 0, deja: deja, exclus: exclus });
    }

    return appliquer(
      articles,
      ajoutes.map(function (article) {
        return { type: 'ecrire', article: article };
      })
    ).then(function (apres) {
      return { articles: apres, ajoutes: ajoutes.length, deja: deja, exclus: exclus };
    });
  }

  /** Ajoute un article saisi a la main, hors recette. */
  function addFreeItem(nom, quantite) {
    var propre = String(nom || '').trim();
    if (!propre) return Promise.resolve(getShoppingList());

    var articles = getShoppingList();
    var cle = cleArticle(RECETTE_LIBRE, propre);
    if (
      articles.some(function (a) {
        return a.cle === cle;
      })
    ) {
      return Promise.resolve(articles);
    }

    var article = {
      cle: cle,
      nom: propre,
      quantite: String(quantite || '').trim(),
      groupe: null,
      recetteId: RECETTE_LIBRE,
      recetteTitre: TITRE_LIBRE,
      coche: false,
      ajouteLe: horodatage(),
    };
    articles.push(article);
    return appliquer(articles, { type: 'ecrire', article: article });
  }

  /** Coche ou decoche un article. Seul le champ `coche` est envoye. */
  function toggleArticle(cle) {
    var nouvelleValeur = null;
    var articles = getShoppingList().map(function (a) {
      if (a.cle !== cle) return a;
      nouvelleValeur = !a.coche;
      return Object.assign({}, a, { coche: nouvelleValeur });
    });
    if (nouvelleValeur === null) return Promise.resolve(articles);

    return appliquer(articles, { type: 'modifier', cle: cle, champs: { coche: nouvelleValeur } });
  }

  function removeArticle(cle) {
    return removeArticles([cle]);
  }

  /**
   * Coche ou decoche plusieurs articles d'un coup.
   * Une ligne de la liste peut representer plusieurs articles fusionnes (le meme
   * ingredient venu de deux recettes) : la cocher doit cocher tout ce qu'elle
   * recouvre, en une seule salve d'operations.
   */
  function cocherArticles(cles, valeur) {
    var aChanger = {};
    cles.forEach(function (c) {
      aChanger[c] = true;
    });

    var operations = [];
    var articles = getShoppingList().map(function (a) {
      if (!aChanger[a.cle] || a.coche === valeur) return a;
      operations.push({ type: 'modifier', cle: a.cle, champs: { coche: valeur } });
      return Object.assign({}, a, { coche: valeur });
    });

    if (operations.length === 0) return Promise.resolve(articles);
    return appliquer(articles, operations);
  }

  /** Supprime plusieurs articles d'un coup. */
  function removeArticles(cles) {
    var aSupprimer = {};
    cles.forEach(function (c) {
      aSupprimer[c] = true;
    });

    var articles = getShoppingList();
    var operations = articles
      .filter(function (a) {
        return aSupprimer[a.cle];
      })
      .map(function (a) {
        return { type: 'supprimer', cle: a.cle };
      });

    if (operations.length === 0) return Promise.resolve(articles);
    return appliquer(
      articles.filter(function (a) {
        return !aSupprimer[a.cle];
      }),
      operations
    );
  }

  /** Retire d'un coup tous les articles correspondant a un predicat. */
  function retirerSi(predicat) {
    var articles = getShoppingList();
    var aSupprimer = articles.filter(predicat);
    if (aSupprimer.length === 0) return Promise.resolve(articles);

    var restants = articles.filter(function (a) {
      return !predicat(a);
    });
    return appliquer(
      restants,
      aSupprimer.map(function (a) {
        return { type: 'supprimer', cle: a.cle };
      })
    );
  }

  function removeRecipeFromList(recetteId) {
    return retirerSi(function (a) {
      return a.recetteId === recetteId;
    });
  }

  /** Retire uniquement les articles coches : le reflexe au retour des courses. */
  function removeCheckedArticles() {
    return retirerSi(function (a) {
      return Boolean(a.coche);
    });
  }

  function clearShoppingList() {
    return retirerSi(function () {
      return true;
    });
  }

  // --- Lectures derivees ------------------------------------------------------

  function recetteDansListe(articles, recetteId) {
    return (articles || []).some(function (a) {
      return a.recetteId === recetteId;
    });
  }

  /** Noms des ingredients d'une recette deja presents dans la liste. */
  function nomsPresents(articles, recetteId) {
    var noms = {};
    (articles || []).forEach(function (a) {
      if (a.recetteId === recetteId) noms[a.nom] = true;
    });
    return noms;
  }

  /**
   * Clef de fusion d'un ingredient : deux articles de meme clef sont le meme produit
   * et voient leurs quantites additionnees.
   *
   * On normalise la casse, les accents, la ligature oe et le pluriel, si bien que
   * « Œufs » et « Œuf » se rejoignent. On ne va pas plus loin volontairement :
   * « Sucre glace » et « Sucre en poudre » restent deux produits distincts, et
   * « Beurre » n'est pas confondu avec « Beurre mou ». Fusionner sur une
   * ressemblance approximative reviendrait a additionner 200 g de sucre glace avec
   * 160 g de sucre en poudre, ce qui donnerait une liste de courses fausse.
   */
  function cleFusion(nom) {
    return String(nom || '')
      .replace(/œ/gi, 'oe')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u2019]/g, "'")
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/(s|x)$/, '');
  }

  /**
   * Fusionne les articles portant le meme ingredient.
   *
   * Retourne des lignes { cleFusion, nom, quantite, rayon, coche, articles, recettes }
   * ou `quantite` est la somme quand elle est calculable, `coche` vaut vrai
   * seulement si tout ce que la ligne recouvre est coche, et `articles` porte les
   * clefs sous-jacentes pour que cocher ou supprimer agisse sur l'ensemble.
   *
   * La fusion est faite a l'affichage, pas en base : chaque contribution reste un
   * document Firestore distinct. C'est ce qui permet de retirer une recette de la
   * liste et de voir le total diminuer d'autant, sans recalcul fragile.
   */
  function fusionner(articles) {
    var lignes = [];
    var index = {};

    (articles || []).forEach(function (article) {
      var cle = cleFusion(article.nom);
      if (!index[cle]) {
        index[cle] = {
          cleFusion: cle,
          nom: article.nom,
          rayon: Rayons.rayonDe(article.nom),
          quantites: [],
          articles: [],
          recettes: [],
          coche: true,
        };
        lignes.push(index[cle]);
      }
      var ligne = index[cle];
      ligne.quantites.push(article.quantite);
      ligne.articles.push(article.cle);
      if (!article.coche) ligne.coche = false;
      if (article.recetteTitre && ligne.recettes.indexOf(article.recetteTitre) === -1) {
        ligne.recettes.push(article.recetteTitre);
      }
    });

    lignes.forEach(function (ligne) {
      ligne.quantite = Quantites.additionner(ligne.quantites);
      ligne.nbSources = ligne.articles.length;
    });

    return lignes;
  }

  /**
   * Liste prete a afficher : fusionnee par ingredient, puis groupee par rayon dans
   * l'ordre d'un parcours de magasin.
   */
  // --- Regroupement visuel des lignes proches ---------------------------------
  //
  // En magasin, « Beurre 70 g », « Beurre aux cristaux de sel 75 g » et « Beurre aux
  // cristaux de sel ramolli 120 g » sont trois lignes pour un seul produit a prendre,
  // et on les decouvre eparpillees dans le rayon cremerie.
  //
  // La fusion des donnees, elle, reste interdite : additionner sur une ressemblance
  // approximative donnerait une liste fausse (« Sucre glace » n'est pas « Sucre en
  // poudre »). Ce regroupement est donc purement visuel. Chaque ligne reste
  // distincte, cochable et supprimable separement.
  //
  // Le critere est le premier mot significatif du nom, apres normalisation. Deux
  // garde-fous limitent les faux rapprochements :
  //   - au moins quatre caracteres, ce qui ecarte « ail », « sel » ou « the », deja
  //     courts et sans variantes ;
  //   - au moins deux lignes, sinon il n'y a rien a regrouper.
  // Un faux rapprochement ne coute qu'un cadre de trop, jamais une quantite fausse.

  var LONGUEUR_TETE_MINIMALE = 4;

  /** Premier mot significatif d'un nom, normalise. */
  function motDeTete(nom) {
    var normalise = cleFusion(nom);
    var premier = normalise.split(/[\s,()/]+/)[0] || '';
    // cleFusion ne desingularise que la fin de la chaine : « oeufs pour cookie »
    // garde son « s ». On le retire ici, sur le mot isole.
    return premier.replace(/(s|x)$/, '');
  }

  /**
   * Range les lignes d'un rayon en entrees d'affichage.
   * Rend une liste de { type: 'groupe', tete, lignes } et { type: 'ligne', ligne },
   * dans l'ordre d'arrivee : un groupe prend la place de son premier membre.
   */
  function grouperProches(lignes) {
    var comptes = {};
    (lignes || []).forEach(function (ligne) {
      var tete = motDeTete(ligne.nom);
      if (tete.length < LONGUEUR_TETE_MINIMALE) return;
      comptes[tete] = (comptes[tete] || 0) + 1;
    });

    var entrees = [];
    var groupes = {};

    (lignes || []).forEach(function (ligne) {
      var tete = motDeTete(ligne.nom);
      if (tete.length < LONGUEUR_TETE_MINIMALE || comptes[tete] < 2) {
        entrees.push({ type: 'ligne', ligne: ligne });
        return;
      }
      if (!groupes[tete]) {
        // Le libelle du groupe reprend le mot tel qu'il est ecrit dans la premiere
        // ligne, accents compris : « Œufs » ne doit pas s'afficher « oeuf ».
        groupes[tete] = {
          type: 'groupe',
          tete: String(ligne.nom).split(/[\s,()/]+/)[0],
          cle: tete,
          lignes: [],
        };
        entrees.push(groupes[tete]);
      }
      groupes[tete].lignes.push(ligne);
    });

    return entrees;
  }

  function listeParRayon(articles) {
    var lignes = fusionner(articles);
    return Rayons.grouperParRayon(lignes).map(function (groupe) {
      return {
        rayon: groupe.rayon,
        lignes: groupe.articles.slice().sort(function (a, b) {
          return String(a.nom).localeCompare(String(b.nom), 'fr');
        }),
      };
    });
  }

  /** Recettes actuellement representees dans la liste, pour pouvoir les retirer. */
  function recettesDansListe(articles) {
    var vues = [];
    var index = {};
    (articles || []).forEach(function (a) {
      if (a.recetteId === RECETTE_LIBRE) return;
      if (index[a.recetteId]) {
        index[a.recetteId].nb += 1;
        return;
      }
      index[a.recetteId] = { recetteId: a.recetteId, titre: a.recetteTitre, nb: 1 };
      vues.push(index[a.recetteId]);
    });
    return vues.sort(function (a, b) {
      return String(a.titre).localeCompare(String(b.titre), 'fr');
    });
  }

  function grouperParRecette(articles) {
    var groupes = [];
    var index = {};
    (articles || []).forEach(function (article) {
      if (!index[article.recetteId]) {
        index[article.recetteId] = { recetteId: article.recetteId, titre: article.recetteTitre, articles: [] };
        groupes.push(index[article.recetteId]);
      }
      index[article.recetteId].articles.push(article);
    });
    return groupes;
  }

  var api = {
    RECETTE_LIBRE: RECETTE_LIBRE,
    TITRE_LIBRE: TITRE_LIBRE,
    CLE_CACHE: CLE_CACHE,
    CLE_FILE: CLE_FILE,

    surChangement: col.surChangement,
    cleArticle: cleArticle,
    getShoppingList: getShoppingList,

    initialiser: col.initialiser,
    rafraichir: col.rafraichir,
    ageDonnees: col.ageDonnees,
    etatSync: col.etatSync,

    addItemsToList: addItemsToList,
    addRecipeToList: addRecipeToList,
    addRecipesToList: addRecipesToList,
    addFreeItem: addFreeItem,
    toggleArticle: toggleArticle,
    removeArticle: removeArticle,
    removeArticles: removeArticles,
    cocherArticles: cocherArticles,
    removeRecipeFromList: removeRecipeFromList,
    removeCheckedArticles: removeCheckedArticles,
    clearShoppingList: clearShoppingList,

    recetteDansListe: recetteDansListe,
    nomsPresents: nomsPresents,
    grouperParRecette: grouperParRecette,
    cleFusion: cleFusion,
    motDeTete: motDeTete,
    grouperProches: grouperProches,
    fusionner: fusionner,
    listeParRayon: listeParRayon,
    recettesDansListe: recettesDansListe,
  };

  if (estNode) module.exports = api;
  else global.CarnetStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
