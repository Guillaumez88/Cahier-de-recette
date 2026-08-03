/* Contrôle de bout en bout contre le VRAI projet Firebase.
 *
 *   node tests/verifier-firebase.js --reel
 *
 * À la différence des autres suites, celle-ci n'utilise aucune émulation : elle
 * charge js/sync.js et js/storage.js avec la configuration réelle et écrit dans la
 * base du projet. Le drapeau --reel est obligatoire, précisément pour qu'elle ne
 * puisse pas être lancée par accident ni par la CI.
 *
 * Les articles créés portent tous la recette « __verification__ » et sont supprimés
 * à la fin, y compris si un contrôle échoue. En cas d'interruption brutale, relancer
 * le script nettoie les résidus avant de commencer.
 *
 * À lancer après toute modification de la configuration Firebase ou des règles de
 * sécurité : c'est le seul contrôle qui prouve que le projet répond réellement.
 */

const path = require('path');
const assert = require('assert');

if (!process.argv.includes('--reel')) {
  console.error(
    "Ce contrôle écrit dans la vraie base Firestore du projet.\n" +
      'Relancer avec le drapeau explicite :  node tests/verifier-firebase.js --reel'
  );
  process.exit(2);
}

const racine = path.join(__dirname, '..');

// localStorage minimal : les modules s'en servent pour le cache et le jeton.
const memoire = new Map();
global.localStorage = {
  getItem: (c) => (memoire.has(c) ? memoire.get(c) : null),
  setItem: (c, v) => memoire.set(c, String(v)),
  removeItem: (c) => memoire.delete(c),
};

const config = require(path.join(racine, 'js/firebase-config.js'));
const Sync = require(path.join(racine, 'js/sync.js'));
const Storage = require(path.join(racine, 'js/storage.js'));

const RECETTE = {
  id: '__verification__',
  titre: 'Vérification technique',
  ingredients: [
    {
      groupe: null,
      items: [
        { nom: 'Câpres (vérification)', quantite: '8' },
        { nom: 'Huile d’olive (vérification)', quantite: '3 c. à s.' },
      ],
    },
  ],
};

let reussis = 0;
const echecs = [];

async function test(nom, fn) {
  try {
    await fn();
    reussis += 1;
    console.log(`  OK    ${nom}`);
  } catch (erreur) {
    echecs.push({ nom, message: erreur.message });
    console.log(`  ECHEC ${nom}\n        ${erreur.message}`);
  }
}

/** Supprime tout ce que ce contrôle a pu laisser derrière lui. */
async function nettoyer() {
  const distants = await Sync.lireArticles();
  const residus = distants.filter((a) => a.recetteId === RECETTE.id);
  for (const article of residus) {
    await Sync.supprimerArticle(article.cle);
  }
  return residus.length;
}

(async () => {
  console.log(`\nProjet : ${config.projectId}`);
  console.log(`Liste  : listes/${config.listeId}/articles\n`);

  try {
    // Nettoyage préalable, au cas où une exécution précédente ait été interrompue.
    const residus = await nettoyer();
    if (residus > 0) console.log(`  (${residus} résidu(s) d'une exécution précédente supprimé(s))\n`);
  } catch (erreur) {
    console.error(
      `\nImpossible de joindre Firestore : ${erreur.message}\n\n` +
        "Causes usuelles :\n" +
        "  - SERVICE_DISABLED        la base Firestore n'est pas créée\n" +
        "  - CONFIGURATION_NOT_FOUND la connexion anonyme n'est pas activée\n" +
        "  - PERMISSION_DENIED       les règles de firestore.rules ne sont pas publiées\n"
    );
    process.exit(1);
  }

  const articlesAvant = (await Sync.lireArticles()).length;
  console.log(`  (${articlesAvant} article(s) réel(s) déjà dans la liste, ils ne seront pas touchés)\n`);

  await test('une session anonyme est obtenue', async () => {
    const jeton = await Sync.obtenirJeton();
    assert.ok(jeton && jeton.length > 100, 'jeton absent ou trop court');
  });

  await test('ajouter une sélection écrit un document par article', async () => {
    await Storage.addRecipeToList(RECETTE);
    const miens = Storage.getShoppingList().filter((a) => a.recetteId === RECETTE.id);
    assert.strictEqual(miens.length, 2, `${miens.length} articles en local`);
    assert.strictEqual(Storage.etatSync().enAttente, 0, 'la file n a pas été vidée');
    assert.strictEqual(Storage.etatSync().enLigne, true, `hors ligne : ${Storage.etatSync().erreur}`);
  });

  await test('les accents et les quantités survivent à l aller-retour', async () => {
    const distants = (await Sync.lireArticles()).filter((a) => a.recetteId === RECETTE.id);
    assert.strictEqual(distants.length, 2, `${distants.length} documents côté serveur`);
    const capres = distants.find((a) => a.nom === 'Câpres (vérification)');
    assert.ok(capres, 'article introuvable, les accents ont été altérés');
    assert.strictEqual(capres.quantite, '8');
    assert.strictEqual(capres.coche, false, 'le booléen faux a été mal encodé');
  });

  await test('cocher ne réécrit que le champ concerné', async () => {
    const article = Storage.getShoppingList().find((a) => a.recetteId === RECETTE.id);
    await Storage.toggleArticle(article.cle);

    const distant = (await Sync.lireArticles()).find((a) => a.cle === article.cle);
    assert.strictEqual(distant.coche, true, 'le cochage n a pas été enregistré');
    assert.strictEqual(distant.nom, article.nom, 'le nom a été perdu');
    assert.strictEqual(distant.quantite, article.quantite, 'la quantité a été perdue');
  });

  await test('un second appareil retrouve la liste et le cochage', async () => {
    // Nouveau cache local, nouvelle session : c'est un autre navigateur.
    memoire.clear();
    const articles = await Storage.rafraichir();
    const miens = articles.filter((a) => a.recetteId === RECETTE.id);
    assert.strictEqual(miens.length, 2, `${miens.length} articles reçus`);
    assert.strictEqual(miens.filter((a) => a.coche).length, 1, 'le cochage n a pas été vu');
  });

  await test('un article libre s ajoute et se relit', async () => {
    await Storage.addFreeItem('Pain (vérification)', '1');
    const distants = await Sync.lireArticles();
    const libre = distants.find((a) => a.nom === 'Pain (vérification)');
    assert.ok(libre, 'article libre introuvable côté serveur');
    assert.strictEqual(libre.recetteId, Storage.RECETTE_LIBRE);
  });

  await test('retirer les articles cochés ne touche pas aux autres', async () => {
    const avant = (await Sync.lireArticles()).length;
    await Storage.removeCheckedArticles();
    const apres = (await Sync.lireArticles()).length;
    assert.strictEqual(apres, avant - 1, `${avant} articles avant, ${apres} après`);
  });

  await test('la suppression fonctionne et laisse la base propre', async () => {
    // On retire aussi l'article libre créé plus haut.
    const libre = Storage.getShoppingList().find((a) => a.nom === 'Pain (vérification)');
    if (libre) await Storage.removeArticle(libre.cle);
    await Storage.removeRecipeFromList(RECETTE.id);

    const restants = (await Sync.lireArticles()).filter(
      (a) => a.recetteId === RECETTE.id || a.nom === 'Pain (vérification)'
    );
    assert.strictEqual(restants.length, 0, `${restants.length} article(s) de vérification non supprimé(s)`);
  });

  await test('les articles réels préexistants sont intacts', async () => {
    const apres = (await Sync.lireArticles()).length;
    assert.strictEqual(apres, articlesAvant, `${articlesAvant} articles avant, ${apres} après`);
  });

  // Filet de sécurité : quoi qu'il se soit passé, on ne laisse rien.
  const oublies = await nettoyer();
  if (oublies > 0) console.log(`\n  (${oublies} article(s) de vérification nettoyé(s) en sortie)`);

  console.log(`\n${reussis} contrôle(s) réussi(s), ${echecs.length} échec(s)\n`);
  process.exit(echecs.length > 0 ? 1 : 0);
})().catch(async (erreur) => {
  console.error('\nLe contrôle a levé :', erreur.message);
  try {
    await nettoyer();
    console.error('(base nettoyée malgré l échec)');
  } catch (autre) {
    console.error(`(nettoyage impossible : ${autre.message} — vérifier la collection à la main)`);
  }
  process.exit(2);
});
