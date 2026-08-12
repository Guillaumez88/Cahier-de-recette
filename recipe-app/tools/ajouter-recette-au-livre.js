/* Ajoute une recette à un livre de la bibliothèque, dans le vrai projet Firebase.
 *
 *   node tools/ajouter-recette-au-livre.js tools/recettes/<fichier>.json <id-du-livre>
 *   node tools/ajouter-recette-au-livre.js tools/recettes/<fichier>.json <id-du-livre> --ecrire
 *
 * Sans --ecrire, l'outil ne fait que lire et rapporter : le livre existe-t-il,
 * l'identifiant est-il libre, la recette est-elle bien formée, quelles quantités
 * seront lues par la liste de courses. C'est le mode à utiliser d'abord.
 *
 * ## Pourquoi cet outil existe
 *
 * Une recette de livre **ne peut pas** être ajoutée à `data/recipes.json`. Ce fichier
 * est le livre de cuisine : il est servi avec le site, et une recette qui y figure est
 * par construction dans le livre de cuisine, donc dans le planning de la semaine.
 * C'est exactement ce que la bibliothèque sépare. Une recette de livre vit donc dans
 * Firestore, comme toute recette saisie depuis l'application, avec son champ `livre`.
 *
 * Reste que saisir à la main, sur un téléphone, une recette lue sur une page de livre
 * photographiée est long. Cet outil fait le même travail que l'écran « Ajouter une
 * recette » d'un livre, depuis un fichier JSON relu et versionné.
 *
 * ## Ce qu'il n'invente jamais
 *
 * Rien. Il ne calcule pas de temps total absent, ne devine pas une unité, ne complète
 * pas une difficulté. Ce que la page ne donne pas doit être écrit dans le champ
 * `manquants` du fichier JSON, que l'application affiche sous « Ce que la source ne
 * donne pas ». L'outil refuse d'écrire une recette sans titre, sans ingrédient ou sans
 * étape, et refuse d'écraser une recette existante : pour corriger une fiche déjà en
 * base, l'éditeur de l'application montre ce qui change avant d'enregistrer.
 *
 * ## Ce qu'il touche
 *
 * Un document de la collection `recettes` du projet configuré dans
 * js/firebase-config.js, c'est-à-dire les données réelles de la maison. D'où le double
 * appel : sans `--ecrire`, il ne se passe rien.
 */

const fs = require('fs');
const path = require('path');

const racine = path.join(__dirname, '..');
const Sync = require(path.join(racine, 'js/sync.js'));
const Recettes = require(path.join(racine, 'js/recettes.js'));
const Quantites = require(path.join(racine, 'js/quantites.js'));

const [, , chemin, idLivre, ...options] = process.argv;
const ecrire = options.includes('--ecrire');

function sortir(message) {
  console.error(message);
  process.exit(1);
}

if (!chemin || !idLivre) {
  sortir(
    'Usage : node tools/ajouter-recette-au-livre.js <fichier.json> <id-du-livre> [--ecrire]\n' +
      'L’identifiant du livre est celui de son adresse : #/bibliotheque/<id-du-livre>.'
  );
}

/** Contrôles de forme. Ce qui manque est dit, rien n'est complété. */
function verifierForme(recette) {
  const fautes = [];
  if (!recette.titre || String(recette.titre).trim() === '') fautes.push('titre absent');
  if (!Array.isArray(recette.ingredients) || recette.ingredients.length === 0) {
    fautes.push('aucun groupe d’ingrédients');
  } else {
    const nb = recette.ingredients.reduce((t, g) => t + ((g.items && g.items.length) || 0), 0);
    if (nb === 0) fautes.push('aucun ingrédient');
    recette.ingredients.forEach((groupe, i) => {
      (groupe.items || []).forEach((item, j) => {
        if (!item.nom || String(item.nom).trim() === '') {
          fautes.push(`ingrédient sans nom (groupe ${i + 1}, ligne ${j + 1})`);
        }
      });
    });
  }
  if (!Array.isArray(recette.instructions) || recette.instructions.length === 0) {
    fautes.push('aucune étape');
  }
  if (!recette.temps || typeof recette.temps !== 'object') fautes.push('champ temps absent');
  if (!recette.source || !recette.source.label) fautes.push('source absente : d’où vient la recette ?');
  if (!Array.isArray(recette.manquants)) {
    fautes.push('champ manquants absent : y mettre ce que la page ne dit pas, ou un tableau vide');
  }
  return fautes;
}

(async () => {
  const brut = fs.readFileSync(path.isAbsolute(chemin) ? chemin : path.join(process.cwd(), chemin), 'utf8');
  const recette = JSON.parse(brut);

  const fautes = verifierForme(recette);
  if (fautes.length > 0) sortir('Recette mal formée :\n- ' + fautes.join('\n- '));

  // Le livre doit exister : une recette rattachée à une étagère absente ne serait
  // visible nulle part, ni dans la bibliothèque ni dans le livre de cuisine.
  const livres = await Sync.lireLivres();
  const livre = livres.find((l) => l.id === idLivre);
  if (!livre) {
    sortir(
      `Aucun livre « ${idLivre} » dans la bibliothèque.\n` +
        'Livres disponibles :\n' +
        (livres.length === 0
          ? '  (aucun)'
          : livres.map((l) => `  ${l.id}  —  ${l.titre} (${l.theme})`).join('\n'))
    );
  }

  // L'identifiant est calculé comme le fait l'application, et vérifié libre contre les
  // deux sources : le fichier d'origine et Firestore.
  const base = JSON.parse(fs.readFileSync(path.join(racine, 'data/recipes.json'), 'utf8'));
  Recettes.definirBase(base);
  const distantes = await Sync.lireRecettesModifiees();

  const racineId = Recettes.slug(recette.titre) || 'recette';
  const pris = {};
  base.forEach((r) => {
    pris[r.id] = 'data/recipes.json';
  });
  Object.keys(distantes).forEach((id) => {
    pris[id] = distantes[id].livre ? `livre ${distantes[id].livre}` : 'livre de cuisine';
  });

  let id = racineId;
  if (pris[id]) {
    for (let n = 2; n < 200 && pris[id]; n += 1) id = `${racineId}-${n}`;
  }

  const aEcrire = Object.assign({}, recette, { id, livre: livre.id });

  // Ce que la liste de courses saura lire. Une quantité illisible n'est pas une
  // erreur, mais elle ne s'additionnera pas : autant le savoir avant.
  const illisibles = [];
  aEcrire.ingredients.forEach((groupe) => {
    (groupe.items || []).forEach((item) => {
      const lu = Quantites.analyser(item.quantite || '');
      if (!lu.lisible) illisibles.push(`${item.nom} : « ${item.quantite || ''} »`);
    });
  });

  const nbIngredients = aEcrire.ingredients.reduce((t, g) => t + g.items.length, 0);

  console.log(`\nLivre        : ${livre.titre} (${livre.id}, thème ${livre.theme})`);
  console.log(`Recette      : ${aEcrire.titre}`);
  console.log(`Identifiant  : ${id}${id === racineId ? '' : `  (« ${racineId} » était pris par ${pris[racineId]})`}`);
  console.log(`Catégorie    : ${aEcrire.categorie} · ${aEcrire.portions}`);
  console.log(`Contenu      : ${nbIngredients} ingrédients en ${aEcrire.ingredients.length} groupes, ${aEcrire.instructions.length} étapes`);
  console.log(`Ce que la source ne donne pas : ${aEcrire.manquants.length} mention(s)`);
  if (illisibles.length > 0) {
    console.log(`Quantités non additionnables par la liste de courses : ${illisibles.length}`);
    illisibles.forEach((l) => console.log(`  - ${l}`));
  } else {
    console.log('Quantités     : toutes lisibles par la liste de courses');
  }

  if (!ecrire) {
    console.log('\nRien n’a été écrit. Relancer avec --ecrire pour envoyer la recette.\n');
    return;
  }

  await Sync.ecrireRecette(aEcrire);

  // Relu depuis le serveur, et non depuis ce qu'on vient d'envoyer : c'est le seul
  // contrôle qui prouve que la recette est bien arrivée et bien rattachée.
  const apres = await Sync.lireRecettesModifiees();
  const relue = apres[id];
  if (!relue) sortir('La recette n’a pas été relue côté serveur après l’écriture.');
  if (relue.livre !== livre.id) {
    sortir(`La recette est arrivée mais rattachée à « ${relue.livre} » au lieu de « ${livre.id} ».`);
  }

  console.log(`\nÉcrite et relue depuis le serveur : ${relue.titre} → ${livre.titre}`);
  console.log(`Fiche : #/recette/${id}\n`);
})().catch((erreur) => {
  sortir(`Échec : ${erreur.statut ? erreur.statut + ' ' : ''}${erreur.message}`);
});
