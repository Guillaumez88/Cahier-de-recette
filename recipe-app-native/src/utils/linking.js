// Adaptation du routage web au sous-chemin de déploiement.
//
// Le site est servi sous https://guillaumez88.github.io/Cahier-de-recette/, donc
// les URL réelles ressemblent à /Cahier-de-recette/recette/<id>. React Navigation
// ne connaît pas ce préfixe : sans adaptation, il compare « /Cahier-de-recette/
// recette/<id> » à ses motifs, n'en reconnaît aucun, et retombe sur l'écran
// d'accueil. Symptôme observé avant correction : ouvrir une fiche par son URL, ou
// simplement recharger la page, affichait la liste complète.
//
// `experiments.baseUrl` d'Expo ne règle que le préfixe des actifs à la
// compilation (JS, images), pas le routage applicatif : les deux sont à traiter.
//
// Fonctions pures, testées dans tests/run-tests.js.

/** Retire le préfixe de base d'un chemin entrant. */
export function stripBasePath(chemin, basePath) {
  if (!basePath) return chemin;
  const normalise = chemin.startsWith('/') ? chemin : `/${chemin}`;
  if (normalise === basePath || normalise === `${basePath}/`) return '/';
  if (normalise.startsWith(`${basePath}/`)) return normalise.slice(basePath.length);
  // Chemin déjà sans préfixe (cas du développement local) : on n'y touche pas.
  return normalise;
}

/** Ajoute le préfixe de base à un chemin produit par le routeur. */
export function addBasePath(chemin, basePath) {
  if (!basePath) return chemin;
  const normalise = chemin.startsWith('/') ? chemin : `/${chemin}`;
  if (normalise === basePath || normalise.startsWith(`${basePath}/`)) return normalise;
  return normalise === '/' ? `${basePath}/` : `${basePath}${normalise}`;
}
