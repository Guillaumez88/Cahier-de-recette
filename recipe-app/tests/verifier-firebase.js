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
const Semainier = require(path.join(racine, 'js/semainier.js'));
const Photos = require(path.join(racine, 'js/photos.js'));

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

// Créneau de vérification, posé très loin dans le futur pour ne jamais tomber sur
// une semaine affichée à l'écran : ce contrôle écrit dans la vraie base, il ne doit
// pas faire apparaître un plat fantôme dans le semainier de la maison.
const JOUR_TEST = '2099-12-28';

/** Supprime tout ce que ce contrôle a pu laisser derrière lui. */
async function nettoyer() {
  const distants = await Sync.lireArticles();
  const residus = distants.filter((a) => a.recetteId === RECETTE.id);
  for (const article of residus) {
    await Sync.supprimerArticle(article.cle);
  }
  // Et la recette de verification, si la collection est accessible.
  try {
    await Sync.supprimerRecette('__verification__');
  } catch (erreur) {
    /* collection refusee ou deja propre : sans consequence */
  }
  // Les cles de plat portent un suffixe tire au hasard : on ne peut plus deviner la
  // cle d'un residu, il faut relire la collection et supprimer tout ce qui porte le
  // jour de verification.
  try {
    const creneaux = await Sync.lireCreneaux();
    for (const c of creneaux.filter((c) => c.jour === JOUR_TEST)) {
      await Sync.supprimerCreneau(c.cle);
    }
  } catch (erreur) {
    /* collection refusee ou deja propre */
  }
  try {
    await Sync.supprimerPhoto('__verification__');
  } catch (erreur) {
    /* collection refusee ou deja propre */
  }
  return residus.length;
}

(async () => {
  console.log(`\nProjet : ${config.projectId}`);
  console.log(`Liste  : listes/${config.listeId}/articles`);
  console.log(`Menus  : semainiers/${config.semainierId}/creneaux\n`);

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

  // --- Collection des recettes modifiees --------------------------------------
  //
  // Cette collection a ete ajoutee apres la premiere publication des regles : si
  // firestore.rules n'a pas ete republie depuis, ces controles echouent en 403 et
  // c'est precisement le message a lire.

  const Recettes = require(path.join(racine, 'js/recettes.js'));
  const ID_TEST = '__verification__';

  await test('la collection des recettes est accessible', async () => {
    try {
      await Sync.lireRecettesModifiees();
    } catch (erreur) {
      if (/PERMISSION_DENIED|insufficient/i.test(erreur.message)) {
        throw new Error(
          'Firestore refuse la collection « recettes ». Republier firestore.rules dans la ' +
            'console Firebase : les regles actuellement publiees ne couvrent que les articles.'
        );
      }
      throw erreur;
    }
  });

  await test('une recette modifiee est enregistree, relue puis supprimee', async () => {
    Recettes.definirBase([
      { id: ID_TEST, titre: 'Original', portions: '6 personnes', ingredients: [], instructions: [] },
    ]);
    await Recettes.rafraichir();

    const modifiee = {
      id: ID_TEST,
      titre: 'Modifié',
      portions: '12 personnes',
      ingredients: [],
      instructions: [],
    };
    await Recettes.enregistrer(modifiee);
    assert.ok(!Recettes.etatChargement().erreur, `envoi refuse : ${Recettes.etatChargement().erreur}`);

    const distantes = await Sync.lireRecettesModifiees();
    assert.ok(distantes[ID_TEST], 'recette introuvable cote serveur');
    assert.strictEqual(distantes[ID_TEST].titre, 'Modifié');
    assert.strictEqual(distantes[ID_TEST].portions, '12 personnes');

    await Recettes.reinitialiser(ID_TEST);
    const apres = await Sync.lireRecettesModifiees();
    assert.ok(!apres[ID_TEST], 'la recette de verification n a pas ete supprimee');
  });

  // --- Semainier -------------------------------------------------------------

  await test('un créneau du semainier est écrit, relu puis vidé', async () => {
    await Semainier.poser(JOUR_TEST, 'diner', { type: 'libre', titre: 'Vérification technique' });
    assert.strictEqual(Semainier.etatSync().enAttente, 0, 'la file du semainier n a pas été vidée');
    assert.strictEqual(
      Semainier.etatSync().enLigne,
      true,
      `écriture refusée : ${Semainier.etatSync().erreur}. Les règles de firestore.rules ` +
        'couvrant semainiers/{id}/creneaux doivent être publiées.'
    );

    const pose = Semainier.creneau(JOUR_TEST, 'diner');
    assert.ok(pose, 'le plat posé est absent du cache local');

    const distants = await Sync.lireCreneaux();
    const mien = distants.find((c) => c.cle === pose.cle);
    assert.ok(mien, 'créneau introuvable côté serveur');
    assert.strictEqual(mien.titre, 'Vérification technique');
    assert.strictEqual(mien.jour, JOUR_TEST);
    assert.strictEqual(mien.moment, 'diner');
    assert.strictEqual(mien.type, 'libre');

    await Semainier.vider(JOUR_TEST, 'diner');
    const apres = await Sync.lireCreneaux();
    assert.ok(!apres.find((c) => c.cle === pose.cle), 'le créneau de vérification n a pas été supprimé');
  });

  await test('les règles acceptent une clé de plat à trois morceaux', async () => {
    // C'est le seul contrôle qui prouve que le passage a plusieurs plats par repas
    // ne demande pas de republier les regles : la borne de `cle` est de 100
    // caracteres, une cle a trois morceaux en fait 35. Lu dans firestore.rules, mais
    // seul le serveur fait foi.
    await Semainier.ajouter(JOUR_TEST, 'diner', { type: 'libre', titre: 'Vérification plat' });
    await Semainier.ajouter(JOUR_TEST, 'diner', { type: 'libre', titre: 'Vérification dessert' });
    assert.strictEqual(
      Semainier.etatSync().enLigne,
      true,
      `écriture refusée : ${Semainier.etatSync().erreur}`
    );

    const distants = await Sync.lireCreneaux();
    const miens = distants.filter((c) => c.jour === JOUR_TEST && c.moment === 'diner');
    assert.strictEqual(miens.length, 2, `${miens.length} plat(s) côté serveur au lieu de 2`);
    // Deux documents distincts, et non un qui aurait écrasé l'autre : c'est tout
    // l'objet du suffixe tiré au hasard.
    assert.strictEqual(new Set(miens.map((c) => c.cle)).size, 2, 'les deux plats partagent la même clé');
    miens.forEach((c) => {
      assert.strictEqual(c.cle.split('::').length, 3, `clé inattendue : ${c.cle}`);
    });

    await Semainier.vider(JOUR_TEST, 'diner');
    const apres = await Sync.lireCreneaux();
    assert.strictEqual(apres.filter((c) => c.jour === JOUR_TEST).length, 0, 'des plats de vérification subsistent');
  });

  await test('les règles refusent un créneau au moment inconnu', async () => {
    // Contrôle de la règle elle-même, pas du client : « goûter » n'est pas dans la
    // liste autorisée, le serveur doit refuser. Si ce contrôle passe, les règles
    // publiées ne sont pas celles du dépôt.
    let refuse = false;
    try {
      await Sync.ecrireCreneau({
        cle: `${JOUR_TEST}::gouter`,
        jour: JOUR_TEST,
        moment: 'gouter',
        type: 'libre',
        titre: 'Vérification technique',
      });
    } catch (erreur) {
      refuse = true;
    }
    if (!refuse) {
      await Sync.supprimerCreneau(`${JOUR_TEST}::gouter`);
    }
    assert.ok(refuse, 'un moment inconnu a été accepté : les règles publiées ne sont pas celles du dépôt');
  });

  // --- Photos ---------------------------------------------------------------

  await test('une photo est écrite en deux tailles, relue par masque, puis supprimée', async () => {
    // Une data URL minuscule mais bien formée : ce contrôle vérifie le transport et
    // les règles, pas la compression, déjà couverte par les tests navigateur.
    const vignette = 'data:image/jpeg;base64,' + 'A'.repeat(600);
    const grande = 'data:image/jpeg;base64,' + 'B'.repeat(6000);

    await Photos.enregistrer('__verification__', { vignette, grande });

    const vignettes = await Sync.lireVignettes();
    assert.strictEqual(vignettes['__verification__'], vignette, 'vignette introuvable ou altérée');
    // Le masque de lecture doit vraiment masquer : sans cela, afficher le livre
    // téléchargerait toutes les grandes images.
    assert.ok(
      !JSON.stringify(vignettes).includes('BBBB'),
      'la grande image est descendue avec les vignettes : le masque de lecture est inopérant'
    );
    assert.strictEqual(await Sync.lireGrandePhoto('__verification__'), grande);

    await Photos.supprimer('__verification__');
    assert.strictEqual(await Sync.lireGrandePhoto('__verification__'), null, 'la photo n a pas été supprimée');
  });

  await test('les règles refusent une photo dépassant la borne de taille', async () => {
    // 800 001 caractères : au-delà des 700 000 autorisés pour `grande`. Le serveur
    // doit refuser, sinon un envoi trop lourd remplirait la base.
    let refuse = false;
    try {
      await Sync.ecrirePhoto('__verification__', 'data:image/jpeg;base64,AAAA', 'x'.repeat(800001));
    } catch (erreur) {
      refuse = true;
    }
    if (!refuse) {
      await Sync.supprimerPhoto('__verification__');
    }
    assert.ok(refuse, 'une photo hors borne a été acceptée : les règles publiées ne sont pas celles du dépôt');
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
