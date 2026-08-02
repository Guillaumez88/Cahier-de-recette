// Liste de courses persistée.
//
// La v1 web utilise localStorage (synchrone) ; ici AsyncStorage, donc toutes les
// fonctions retournent des Promises. Le format stocké est volontairement le même
// dans les deux versions (tableau d'articles sérialisé en JSON) pour qu'une
// évolution de l'un reste transposable à l'autre.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const CLE_STOCKAGE = 'carnet-de-recettes:liste-de-courses';

/** Identifiant stable d'un article, pour éviter les doublons. */
export function cleArticle(recetteId, nom) {
  return `${recetteId}::${nom}`;
}

async function ecrire(articles) {
  await AsyncStorage.setItem(CLE_STOCKAGE, JSON.stringify(articles));
  return articles;
}

/** Retourne la liste de courses, ou [] si elle est vide ou illisible. */
export async function getShoppingList() {
  try {
    const brut = await AsyncStorage.getItem(CLE_STOCKAGE);
    if (!brut) return [];
    const articles = JSON.parse(brut);
    return Array.isArray(articles) ? articles : [];
  } catch (erreur) {
    // Stockage corrompu ou indisponible : on repart d'une liste vide plutôt que
    // de laisser l'écran planter.
    return [];
  }
}

/**
 * Ajoute tous les ingrédients d'une recette. Les articles déjà présents pour
 * cette recette ne sont pas dupliqués et conservent leur état coché.
 */
export async function addRecipeToList(recette) {
  const articles = await getShoppingList();
  const dejaPresents = new Set(articles.map((a) => a.cle));

  (recette.ingredients || []).forEach((groupe) => {
    (groupe.items || []).forEach((item) => {
      const cle = cleArticle(recette.id, item.nom);
      if (dejaPresents.has(cle)) return;
      dejaPresents.add(cle);
      articles.push({
        cle,
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

/** Retire tous les articles issus d'une recette. */
export async function removeRecipeFromList(recetteId) {
  const articles = await getShoppingList();
  return ecrire(articles.filter((a) => a.recetteId !== recetteId));
}

/** Coche ou décoche un article. */
export async function toggleArticle(cle) {
  const articles = await getShoppingList();
  return ecrire(articles.map((a) => (a.cle === cle ? { ...a, coche: !a.coche } : a)));
}

/** Retire un article. */
export async function removeArticle(cle) {
  const articles = await getShoppingList();
  return ecrire(articles.filter((a) => a.cle !== cle));
}

/** Vide la liste. */
export async function clearShoppingList() {
  await AsyncStorage.removeItem(CLE_STOCKAGE);
  return [];
}

/** Indique si une recette est déjà entièrement représentée dans la liste. */
export function recetteDansListe(articles, recetteId) {
  return (articles || []).some((a) => a.recetteId === recetteId);
}

/** Regroupe les articles par recette, dans l'ordre d'ajout. */
export function grouperParRecette(articles) {
  const groupes = [];
  const index = new Map();
  (articles || []).forEach((article) => {
    if (!index.has(article.recetteId)) {
      const groupe = { recetteId: article.recetteId, titre: article.recetteTitre, articles: [] };
      index.set(article.recetteId, groupe);
      groupes.push(groupe);
    }
    index.get(article.recetteId).articles.push(article);
  });
  return groupes;
}
