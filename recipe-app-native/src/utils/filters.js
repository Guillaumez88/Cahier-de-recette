// Logique de recherche et de filtrage : fonctions pures, sans React Native,
// donc testables sous Node. Dupliquée à l'identique dans la v1 web.

import { origineCourte, difficulteCourte, parseMinutes, trancheTemps } from './format';

/** Retire les accents et passe en minuscules, pour une recherche tolérante. */
export function normaliser(texte) {
  if (typeof texte !== 'string') return '';
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2019']/g, "'")
    .toLowerCase()
    .trim();
}

/**
 * Concatène tout ce sur quoi la recherche doit porter : titre, catégorie,
 * origine, noms d'ingrédients et texte des étapes.
 */
export function texteIndexable(recette) {
  const morceaux = [
    recette.titre,
    recette.categorie,
    recette.origine,
    recette.source && recette.source.label,
  ];

  (recette.ingredients || []).forEach((groupe) => {
    if (groupe.groupe) morceaux.push(groupe.groupe);
    (groupe.items || []).forEach((item) => morceaux.push(item.nom, item.quantite));
  });

  (recette.instructions || []).forEach((etape) => morceaux.push(etape.texte));

  return normaliser(morceaux.filter(Boolean).join(' '));
}

/** Liste des valeurs de filtre réellement présentes dans le jeu de recettes. */
export function optionsDisponibles(recettes) {
  const uniques = (valeurs) => [...new Set(valeurs)].sort((a, b) => a.localeCompare(b, 'fr'));
  return {
    categories: uniques(recettes.map((r) => r.categorie).filter(Boolean)),
    origines: uniques(recettes.map((r) => origineCourte(r.origine))),
    difficultes: uniques(recettes.map((r) => difficulteCourte(r.difficulte))),
  };
}

/**
 * Filtre les recettes.
 * `criteres` : { recherche, categorie, origine, difficulte, temps }
 * Une valeur absente, vide ou null signifie « pas de filtre sur ce critère ».
 */
export function filterRecipes(recettes, criteres = {}) {
  const { recherche, categorie, origine, difficulte, temps } = criteres;
  const requete = normaliser(recherche || '');
  const mots = requete ? requete.split(/\s+/).filter(Boolean) : [];

  return (recettes || []).filter((recette) => {
    if (categorie && recette.categorie !== categorie) return false;
    if (origine && origineCourte(recette.origine) !== origine) return false;
    if (difficulte && difficulteCourte(recette.difficulte) !== difficulte) return false;

    if (temps) {
      const minutes = parseMinutes(recette.temps && recette.temps.total);
      // Une recette sans durée exploitable est exclue dès qu'on filtre sur le temps :
      // mieux vaut ne pas l'afficher que la ranger dans une tranche arbitraire.
      if (trancheTemps(minutes) !== temps) return false;
    }

    if (mots.length > 0) {
      const index = texteIndexable(recette);
      if (!mots.every((mot) => index.includes(mot))) return false;
    }

    return true;
  });
}
