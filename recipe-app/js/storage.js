/* Liste de courses : lecture et ecriture, sans rendu.
   Actuellement persistee dans le localStorage du navigateur, donc propre a chaque
   appareil. Tout le reste de l'application passe par cette interface et ignore ou
   les donnees sont rangees : c'est ce qui permettra de basculer vers un stockage
   partage sans toucher au rendu.

   Expose window.CarnetStorage dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  var CLE_STOCKAGE = 'carnet-de-recettes:liste-de-courses';

  // Les abonnes sont notifies apres chaque ecriture (le badge de l'en-tete, par exemple).
  var abonnes = [];

  function surChangement(rappel) {
    abonnes.push(rappel);
  }

  function notifier() {
    abonnes.forEach(function (rappel) {
      rappel();
    });
  }

  /* --- liste de courses ------------------------------------------------- */

  function cleArticle(recetteId, nom) {
    return recetteId + '::' + nom;
  }

  function getShoppingList() {
    try {
      var brut = global.localStorage.getItem(CLE_STOCKAGE);
      if (!brut) return [];
      var articles = JSON.parse(brut);
      return Array.isArray(articles) ? articles : [];
    } catch (erreur) {
      return [];
    }
  }

  function ecrire(articles) {
    try {
      global.localStorage.setItem(CLE_STOCKAGE, JSON.stringify(articles));
    } catch (erreur) {
      // Stockage indisponible (navigation privée, quota) : la liste reste en mémoire
      // pour la session courante plutôt que de faire échouer l'action.
    }
    notifier();
    return articles;
  }

  function addRecipeToList(recette) {
    var articles = getShoppingList();
    var presents = {};
    articles.forEach(function (a) {
      presents[a.cle] = true;
    });

    (recette.ingredients || []).forEach(function (groupe) {
      (groupe.items || []).forEach(function (item) {
        var cle = cleArticle(recette.id, item.nom);
        if (presents[cle]) return;
        presents[cle] = true;
        articles.push({
          cle: cle,
          nom: item.nom,
          quantite: item.quantite || '',
          groupe: groupe.groupe || null,
          recetteId: recette.id,
          recetteTitre: recette.titre,
          coche: false,
        });
      });
    });
    return ecrire(articles);
  }

  function removeRecipeFromList(recetteId) {
    return ecrire(
      getShoppingList().filter(function (a) {
        return a.recetteId !== recetteId;
      })
    );
  }

  function toggleArticle(cle) {
    return ecrire(
      getShoppingList().map(function (a) {
        if (a.cle !== cle) return a;
        return Object.assign({}, a, { coche: !a.coche });
      })
    );
  }

  function removeArticle(cle) {
    return ecrire(
      getShoppingList().filter(function (a) {
        return a.cle !== cle;
      })
    );
  }

  function clearShoppingList() {
    return ecrire([]);
  }

  function recetteDansListe(articles, recetteId) {
    return (articles || []).some(function (a) {
      return a.recetteId === recetteId;
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
    CLE_STOCKAGE: CLE_STOCKAGE,
    surChangement: surChangement,
    cleArticle: cleArticle,
    getShoppingList: getShoppingList,
    addRecipeToList: addRecipeToList,
    removeRecipeFromList: removeRecipeFromList,
    toggleArticle: toggleArticle,
    removeArticle: removeArticle,
    clearShoppingList: clearShoppingList,
    recetteDansListe: recetteDansListe,
    grouperParRecette: grouperParRecette,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.CarnetStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
