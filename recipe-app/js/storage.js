/* Liste de courses commune.
   Une seule liste, partagee par tous ceux qui ouvrent le site, stockee dans
   Firestore et recopiee en local a chaque chargement.

   Trois principes gouvernent ce fichier :

   1. Le cache local est la source du rendu. getShoppingList() reste synchrone et lit
      le localStorage : l'affichage n'attend jamais le reseau, et la liste est
      consultable en magasin meme sans connexion.

   2. Les modifications sont appliquees d'abord en local, puis poussees. Chacune est
      inscrite dans une file d'attente persistee : si le reseau manque, cocher un
      article fonctionne quand meme, et la file est videe au retour du reseau. Sans
      cette file, cocher hors ligne serait perdu au rafraichissement suivant.

   3. Firestore est la reference. Un rafraichissement vide d'abord la file, puis
      remplace le cache par ce que dit le serveur.

   Expose window.CarnetStorage dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  var estNode = typeof module !== 'undefined' && module.exports;
  var config = estNode ? require('./firebase-config.js') : global.CarnetConfig;
  var Sync = estNode ? require('./sync.js') : global.CarnetSync;
  var Rayons = estNode ? require('./rayons.js') : global.CarnetRayons;
  var Quantites = estNode ? require('./quantites.js') : global.CarnetQuantites;

  var CLE_CACHE = 'carnet-de-recettes:liste-commune';
  var CLE_FILE = 'carnet-de-recettes:file-attente';

  var RECETTE_LIBRE = '__libre__';
  var TITRE_LIBRE = 'Ajouts libres';

  var abonnes = [];
  var minuteur = null;

  var etat = {
    enLigne: null, // null tant qu'aucun echange n'a eu lieu
    dernierSucces: null, // horodatage du dernier rafraichissement reussi
    erreur: null, // message de la derniere erreur
    enCours: false,

    // Compteur incremente a chaque modification locale. Sert a detecter qu'une
    // modification est survenue pendant qu'une lecture etait en vol : la reponse
    // decrit alors un etat anterieur, il ne faut pas en ecraser le cache.
    versionLocale: 0,
  };

  // --- Abonnement -------------------------------------------------------------

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
      // Stockage illisible ou corrompu : on repart proprement.
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

  /** Liste affichee. Synchrone, lue dans le cache local. */
  function getShoppingList() {
    return lireJson(CLE_CACHE, []);
  }

  function ecrireCache(articles) {
    ecrireJson(CLE_CACHE, articles);
    notifier();
    return articles;
  }

  // --- File d'attente ---------------------------------------------------------

  function lireFile() {
    return lireJson(CLE_FILE, []);
  }

  function empiler(operation) {
    var file = lireFile();
    file.push(operation);
    ecrireJson(CLE_FILE, file);
  }

  function nbEnAttente() {
    return lireFile().length;
  }

  /**
   * Envoie les operations en attente, dans l'ordre.
   * S'arrete a la premiere qui echoue et conserve le reste : l'ordre compte
   * (ajouter puis cocher n'est pas cocher puis ajouter).
   */
  async function viderFile() {
    var file = lireFile();

    while (file.length > 0) {
      var operation = file[0];
      try {
        if (operation.type === 'ecrire') await Sync.ecrireArticle(operation.article);
        else if (operation.type === 'modifier') await Sync.modifierArticle(operation.cle, operation.champs);
        else if (operation.type === 'supprimer') await Sync.supprimerArticle(operation.cle);
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
    } catch (erreur) {
      etat.enLigne = false;
      etat.erreur = erreur.message;
    }
    notifier();
    return getShoppingList();
  }

  /** Applique une modification en local, l'inscrit dans la file, puis tente l'envoi. */
  function appliquer(articles, operations) {
    etat.versionLocale += 1;
    ecrireCache(articles);
    (Array.isArray(operations) ? operations : [operations]).forEach(empiler);
    // Envoi opportuniste : l'echec est normal hors ligne, la file garde la trace.
    return pousser();
  }

  // --- Rafraichissement -------------------------------------------------------

  /**
   * Vide la file puis relit la liste depuis Firestore et remplace le cache.
   * Hors ligne, le cache local est conserve tel quel : mieux vaut une liste un peu
   * ancienne mais utilisable qu'une liste vide.
   */
  async function rafraichir() {
    if (etat.enCours) return getShoppingList();
    etat.enCours = true;
    notifier();

    var versionAvant = etat.versionLocale;

    try {
      await viderFile();
      var distants = await Sync.lireArticles();

      // Une modification locale est survenue pendant la lecture : la reponse decrit
      // un etat deja depasse. L'ecrire ferait reapparaitre a l'ecran ce qui vient
      // d'etre supprime, ou decocher ce qui vient d'etre coche. On garde le cache et
      // on laisse le sondage suivant reconcilier, une fois la file envoyee.
      if (etat.versionLocale !== versionAvant) {
        etat.enLigne = true;
        etat.erreur = null;
        return getShoppingList();
      }

      var articles = distants
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

      etat.enLigne = true;
      etat.erreur = null;
      etat.dernierSucces = Date.now();
      ecrireCache(articles);
      return articles;
    } catch (erreur) {
      etat.enLigne = false;
      etat.erreur = erreur.message;
      return getShoppingList();
    } finally {
      etat.enCours = false;
      notifier();
    }
  }

  /**
   * Demarre le rafraichissement automatique. Idempotent.
   *
   * Le sondage est suspendu quand l'onglet n'est pas visible, et relance des qu'il
   * le redevient. Ce n'est pas une optimisation cosmetique : Firestore facture a la
   * lecture de document, et le palier gratuit est de 50 000 lectures par jour. A
   * 5 secondes d'intervalle, un onglet laisse ouvert fait 720 sondages par heure ;
   * avec 10 articles en liste cela represente 7 200 lectures par heure, soit le
   * palier gratuit epuise en sept heures par un seul onglet oublie. En ne sondant
   * que l'onglet actif, le cout suit l'usage reel.
   */
  function demarrer() {
    if (minuteur) return;

    var aUnDocument = typeof document !== 'undefined' && document;
    var estVisible = function () {
      return !aUnDocument || document.visibilityState !== 'hidden';
    };

    rafraichir();
    minuteur = setInterval(function () {
      if (estVisible()) rafraichir();
    }, config.intervalleRafraichissement);

    if (aUnDocument && !document.__carnetVisibiliteBranchee) {
      document.__carnetVisibiliteBranchee = true;
      document.addEventListener('visibilitychange', function () {
        // Au retour sur l'onglet, ne pas attendre le prochain intervalle : la liste
        // affichee peut avoir plusieurs minutes de retard.
        if (estVisible()) rafraichir();
      });
    }
  }

  function arreter() {
    if (minuteur) clearInterval(minuteur);
    minuteur = null;
  }

  function etatSync() {
    return {
      enLigne: etat.enLigne,
      dernierSucces: etat.dernierSucces,
      erreur: etat.erreur,
      enCours: etat.enCours,
      enAttente: nbEnAttente(),
    };
  }

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

    surChangement: surChangement,
    cleArticle: cleArticle,
    getShoppingList: getShoppingList,

    demarrer: demarrer,
    arreter: arreter,
    rafraichir: rafraichir,
    etatSync: etatSync,

    addItemsToList: addItemsToList,
    addRecipeToList: addRecipeToList,
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
    fusionner: fusionner,
    listeParRayon: listeParRayon,
    recettesDansListe: recettesDansListe,
  };

  if (estNode) module.exports = api;
  else global.CarnetStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
